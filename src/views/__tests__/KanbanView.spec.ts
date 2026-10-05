import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useSessionStore } from '@/stores/session'
import type { List } from '@/api'

enableAutoUnmount(afterEach)

const fetchMock = vi.fn<typeof fetch>()
const lists: List[] = [
  { id: 'b', title: 'À lire', position: 0, ownerId: 'alice', createdAt: '2026-01-01' },
  {
    id: 'a',
    title: '<img src=x onerror=alert(1)>',
    position: 0,
    ownerId: 'alice',
    createdAt: '2026-01-02',
  },
  { id: 'c', title: 'Terminé', position: 1, ownerId: 'alice', createdAt: '2026-01-01' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  fetchMock.mockImplementation(() => Promise.resolve(Response.json([])))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

async function mountKanban() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.start('token-alice')
  const router = createAppRouter(pinia, createMemoryHistory())
  await router.push('/kanban')
  await router.isReady()
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia, router, ui] } })
  await flushPromises()
  return { wrapper, router, session }
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Tableau Kanban', () => {
  it('charge les listes authentifiées une seule fois dans l’ordre serveur et rend les titres comme texte', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([...lists, lists[0]]))
    const { wrapper } = await mountKanban()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/lists')
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-alice')
    const board = wrapper.get('[role="region"][aria-label="Listes du tableau Kanban"]')
    expect(board.findAll('h2').map((heading) => heading.text())).toEqual([
      'À lire',
      '<img src=x onerror=alert(1)>',
      'Terminé',
    ])
    expect(board.findAll('h2').map((heading) => heading.attributes('id'))).toEqual([
      'list-b-title',
      'list-a-title',
      'list-c-title',
    ])
    expect(board.findAll('li')).toHaveLength(3)
    expect(board.find('img').exists()).toBe(false)
    expect(board.attributes('tabindex')).toBe('0')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('distingue le chargement du tableau vide puis affiche les listes reçues', async () => {
    const response = deferredResponse()
    fetchMock.mockReturnValueOnce(response.promise)
    const { wrapper } = await mountKanban()

    expect(wrapper.get('[role="status"]').text()).toMatch(/chargement/i)
    expect(wrapper.find('#kanban-title').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Votre tableau est vide')
    expect(wrapper.find('main li').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    response.resolve(Response.json(lists))
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAll('main li')).toHaveLength(3)
  })

  it('invite à créer la première liste sans inventer de colonnes', async () => {
    const { wrapper } = await mountKanban()
    expect(wrapper.get('main h2').text()).toMatch(/vide/i)
    expect(wrapper.text()).toMatch(/créez votre première liste/i)
    expect(wrapper.find('main li').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it.each([null, 500])(
    'permet de réessayer après une erreur %s sans afficher un tableau vide',
    async (status) => {
      if (status === null) fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      else fetchMock.mockResolvedValueOnce(Response.json({ message: 'Indisponible' }, { status }))
      const { wrapper, session } = await mountKanban()

      expect(wrapper.get('[role="alert"]').text()).toMatch(/listes/i)
      expect(wrapper.text()).not.toContain('Votre tableau est vide')
      expect(session.token).toBe('token-alice')
      const retry = wrapper.get('main button')
      expect(retry.text()).toBe('Réessayer')
      const response = deferredResponse()
      fetchMock.mockReturnValueOnce(response.promise)
      await retry.trigger('click')
      // Une seconde activation avant le rendu ne doit pas lancer une autre requête.
      await retry.trigger('click')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(wrapper.get('[role="status"]').text()).toMatch(/chargement/i)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)

      response.resolve(Response.json(lists))
      await flushPromises()
      expect(wrapper.findAll('main li')).toHaveLength(3)
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
    },
  )

  it('applique l’expiration de session sur le 401 du chargement', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Unauthorized' }, { status: 401 }))
    const { wrapper, router, session } = await mountKanban()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    await flushPromises()

    expect(session.token).toBeNull()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/session.*expiré/i)
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
    expect(wrapper.find('main li').exists()).toBe(false)
  })

  it('retire les listes chargées à la déconnexion', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(lists))
    const { wrapper, router } = await mountKanban()
    expect(wrapper.findAll('main li')).toHaveLength(3)

    await wrapper.get('nav button').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('À lire')
    expect(wrapper.find('main li').exists()).toBe(false)
  })

  it('efface les listes du premier compte pendant le chargement du suivant', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(lists))
    const { wrapper, session } = await mountKanban()
    const response = deferredResponse()
    fetchMock.mockReturnValueOnce(response.promise)

    session.start('token-bob')
    await flushPromises()
    expect(wrapper.text()).not.toContain('À lire')
    expect(wrapper.find('main li').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toMatch(/chargement/i)
    response.resolve(
      Response.json([{ ...lists[0], id: 'bob-list', title: 'Veille Bob', ownerId: 'bob' }]),
    )
    await flushPromises()
    expect(wrapper.findAll('main li h2').map((heading) => heading.text())).toEqual(['Veille Bob'])
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-bob')
  })

  it.each([200, 401, 500])(
    'ignore une ancienne réponse %s après changement de compte',
    async (status) => {
      const response = deferredResponse()
      fetchMock.mockReturnValueOnce(response.promise)
      const { wrapper, session, router } = await mountKanban()
      fetchMock.mockResolvedValueOnce(
        Response.json([{ ...lists[0], id: 'bob-list', title: 'Veille Bob', ownerId: 'bob' }]),
      )
      session.start('token-bob')
      await flushPromises()

      response.resolve(Response.json(status === 200 ? lists : { message: 'Old error' }, { status }))
      await flushPromises()
      expect(wrapper.findAll('main li h2').map((heading) => heading.text())).toEqual(['Veille Bob'])
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-bob')
      expect(router.currentRoute.value.path).toBe('/kanban')
    },
  )
})
