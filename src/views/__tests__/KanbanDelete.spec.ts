import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
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
  { id: 'one', title: 'À faire', position: 0, ownerId: 'alice', createdAt: '2026-01-01' },
  { id: 'two', title: 'À faire', position: 1, ownerId: 'alice', createdAt: '2026-01-02' },
]

beforeEach(() => {
  // Ces tests suivent les requêtes de listes ; les colonnes chargent des cartes vides.
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof input === 'string' && /^\/api\/lists\/[^/]+\/cards$/.test(input)) {
      return Promise.resolve(Response.json([]))
    }
    return fetchMock(input, init)
  })
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  fetchMock.mockResolvedValueOnce(Response.json(lists))
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
  return { wrapper, session, router }
}

async function openDeletion(
  wrapper: Awaited<ReturnType<typeof mountKanban>>['wrapper'],
  index = 0,
) {
  const button = wrapper.findAll('main li button')[index]
  expect(button, 'Chaque liste propose sa suppression').toBeDefined()
  await button!.trigger('click')
  await flushPromises()
  const element = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(element, 'La suppression exige une confirmation').not.toBeNull()
  return new DOMWrapper(element!)
}

function button(dialog: DOMWrapper<Element>, label: string) {
  return dialog.findAll('button').find((item) => item.text() === label)!
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Suppression d’une liste', () => {
  it('nomme la liste et avertit de la cascade, puis annule sans mutation', async () => {
    const { wrapper } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    expect(dialog.text()).toContain('À faire')
    expect(dialog.text()).toMatch(/toutes ses cartes.*définitivement supprimées/i)
    expect(dialog.text()).toMatch(/irréversible/i)
    await vi.waitFor(() => expect(document.activeElement).toBe(button(dialog, 'Annuler').element))
    await button(dialog, 'Annuler').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('main li')).toHaveLength(2)
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(wrapper.get('main li button').element),
    )
  })

  it('supprime uniquement l’identifiant confirmé après 204, sans corps ni parsing JSON', async () => {
    const { wrapper } = await mountKanban()
    const dialog = await openDeletion(wrapper, 1)
    const response = new Response(null, { status: 204 })
    const parse = vi.spyOn(response, 'json')
    fetchMock.mockResolvedValueOnce(response)
    await button(dialog, 'Supprimer la liste').trigger('click')
    await flushPromises()

    const [url, request] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/lists/two')
    expect(request?.method).toBe('DELETE')
    expect(request?.body).toBeUndefined()
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer token-alice')
    expect(parse).not.toHaveBeenCalled()
    expect(wrapper.find('#list-two-title').exists()).toBe(false)
    expect(wrapper.get('#list-one-title').text()).toBe('À faire')
    expect(wrapper.get('[role="status"]').text()).toMatch(/À faire.*supprimée/)
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(wrapper.get('[role="status"]').element),
    )
  })

  it('attend la réponse et bloque les doubles confirmations', async () => {
    const { wrapper } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    const response = deferredResponse()
    fetchMock.mockReturnValueOnce(response.promise)
    const confirm = button(dialog, 'Supprimer la liste')
    await confirm.trigger('click')
    await confirm.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(button(dialog, 'Annuler').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('main li')).toHaveLength(2)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    response.resolve(new Response(null, { status: 204 }))
    await flushPromises()
    expect(wrapper.findAll('main li')).toHaveLength(1)
  })

  it.each([400, 403, 503, null])(
    'conserve la liste après une erreur %s et permet de réessayer',
    async (status) => {
      const { wrapper } = await mountKanban()
      const dialog = await openDeletion(wrapper)
      if (status === null) fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      else
        fetchMock.mockResolvedValueOnce(
          Response.json({ message: 'Suppression refusée.' }, { status }),
        )
      await button(dialog, 'Supprimer la liste').trigger('click')
      await flushPromises()
      expect(dialog.get('[role="alert"]').text()).toMatch(status === null ? /réseau/i : /refusée/i)
      expect(wrapper.findAll('main li')).toHaveLength(2)
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
      expect(button(dialog, 'Supprimer la liste').attributes('disabled')).toBeUndefined()
      expect(document.activeElement).toBe(dialog.get('[role="alert"]').element)
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
      await button(dialog, 'Supprimer la liste').trigger('click')
      await flushPromises()
      expect(wrapper.find('#list-one-title').exists()).toBe(false)
    },
  )

  it('signale une 404 et resynchronise toutes les listes sans annoncer une suppression réussie', async () => {
    const { wrapper } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    const refreshed = deferredResponse()
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Not found' }, { status: 404 }))
    fetchMock.mockReturnValueOnce(refreshed.promise)
    await button(dialog, 'Supprimer la liste').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.map(([url, request]) => [url, request?.method])).toEqual([
      ['/api/lists', 'GET'],
      ['/api/lists/one', 'DELETE'],
      ['/api/lists', 'GET'],
    ])
    expect(wrapper.get('[role="alert"]').text()).toMatch(/À faire.*n’existe plus/)
    expect(wrapper.get('[role="status"]').text()).toMatch(/chargement/i)
    refreshed.resolve(Response.json([{ ...lists[1], title: 'Titre actualisé' }]))
    await flushPromises()
    expect(wrapper.findAll('main li h2').map((item) => item.text())).toEqual(['Titre actualisé'])
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/n’existe plus/)
  })

  it('permet de relancer une resynchronisation échouée après 404', async () => {
    const { wrapper } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 404 }))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await button(dialog, 'Supprimer la liste').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toMatch(/n’existe plus/)
    expect(wrapper.text()).toMatch(/Impossible de charger/)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    fetchMock.mockResolvedValueOnce(Response.json([]))
    await wrapper.get('main button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Votre tableau est vide')
  })

  it('laisse la session traiter le 401 sans message de suppression réussie', async () => {
    const { wrapper, session, router } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }))
    await button(dialog, 'Supprimer la liste').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    expect(session.token).toBeNull()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/session.*expiré/i)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([204, 401, 404, 500])('ignore une réponse %s du compte précédent', async (status) => {
    const { wrapper, session, router } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    const response = deferredResponse()
    fetchMock.mockReturnValueOnce(response.promise)
    await button(dialog, 'Supprimer la liste').trigger('click')
    fetchMock.mockResolvedValueOnce(
      Response.json([{ ...lists[0], title: 'Liste de Bob', ownerId: 'bob' }]),
    )
    session.start('token-bob')
    await flushPromises()
    response.resolve(
      status === 204 ? new Response(null, { status }) : Response.json({}, { status }),
    )
    await flushPromises()
    expect(wrapper.findAll('main li h2').map((item) => item.text())).toEqual(['Liste de Bob'])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(session.token).toBe('token-bob')
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('ignore une resynchronisation tardive après un changement de compte', async () => {
    const { wrapper, session } = await mountKanban()
    const dialog = await openDeletion(wrapper)
    const response = deferredResponse()
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 404 }))
    fetchMock.mockReturnValueOnce(response.promise)
    await button(dialog, 'Supprimer la liste').trigger('click')
    await flushPromises()
    fetchMock.mockResolvedValueOnce(Response.json([]))
    session.start('token-bob')
    await flushPromises()
    response.resolve(Response.json(lists))
    await flushPromises()
    expect(wrapper.findAll('main li')).toHaveLength(0)
    expect(wrapper.text()).toContain('Votre tableau est vide')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
