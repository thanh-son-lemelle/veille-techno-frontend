import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useSessionStore } from '@/stores/session'
import type { Card, List } from '@/api'

enableAutoUnmount(afterEach)

const lists: List[] = [
  { id: 'one', title: 'À lire', position: 0, ownerId: 'alice', createdAt: '2026-10-05' },
  { id: 'two', title: 'En cours', position: 1, ownerId: 'alice', createdAt: '2026-10-05' },
]
const cards: Card[] = [
  {
    id: 'b',
    title: 'Lire Vue',
    description: 'Documentation Vue',
    position: 0,
    listId: 'one',
    createdAt: '2026-10-04',
    updatedAt: '2026-10-05',
  },
  {
    id: 'a',
    title: '<img src=x onerror=alert(1)>',
    description: '<script>secret</script>',
    position: 0,
    listId: 'one',
    createdAt: '2026-10-05',
    updatedAt: '2026-10-05',
  },
]
const fetchMock = vi.fn<typeof fetch>()
const cardResponse = vi.fn<(listId: string) => Promise<Response>>()

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', fetchMock)
  cardResponse.mockImplementation(() => Promise.resolve(Response.json([])))
  fetchMock.mockImplementation((input, init) => {
    const path = String(input)
    if (path === '/api/lists') return Promise.resolve(Response.json(lists))
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
    const listId = path.match(/^\/api\/lists\/([^/]+)\/cards$/)?.[1]
    if (listId) return cardResponse(listId)
    throw new Error(`Requête inattendue : ${path}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fetchMock.mockReset()
  cardResponse.mockReset()
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

function deferredResponse() {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

type Board = Awaited<ReturnType<typeof mountKanban>>['wrapper']
function column(wrapper: Board, id: string) {
  return wrapper.get(`[aria-labelledby="list-${id}-title"]`)
}

describe('Cartes du tableau', () => {
  it('affiche les cartes authentifiées dans leur colonne, sans doublon et dans l’ordre serveur', async () => {
    cardResponse.mockImplementation((id) =>
      Promise.resolve(
        Response.json(
          id === 'one' ? [...cards, cards[0], { ...cards[0], id: 'foreign', listId: 'two' }] : [],
        ),
      ),
    )
    const { wrapper } = await mountKanban()
    const first = column(wrapper, 'one')
    expect(first.findAll('h3').map((item) => item.text())).toEqual([
      'Lire Vue',
      '<img src=x onerror=alert(1)>',
    ])
    expect(first.text()).toContain('Documentation Vue')
    expect(first.text()).toContain('<script>secret</script>')
    expect(first.find('img, script').exists()).toBe(false)
    expect(column(wrapper, 'two').text()).toMatch(/aucune carte/i)
    expect(column(wrapper, 'two').find('h3').exists()).toBe(false)
    const requests = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cards'))
    expect(requests.map(([url]) => url)).toEqual(['/api/lists/one/cards', '/api/lists/two/cards'])
    for (const [, init] of requests) {
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-alice')
    }
  })

  it('charge les colonnes indépendamment et distingue chargement et état vide', async () => {
    const pending = deferredResponse()
    cardResponse.mockImplementation((id) =>
      id === 'one' ? pending.promise : Promise.resolve(Response.json([])),
    )
    const { wrapper } = await mountKanban()
    expect(column(wrapper, 'one').get('[role="status"]').text()).toMatch(/chargement.*cartes/i)
    expect(column(wrapper, 'one').text()).not.toMatch(/aucune carte/i)
    expect(column(wrapper, 'two').text()).toMatch(/aucune carte/i)
    pending.resolve(Response.json(cards))
    await flushPromises()
    expect(column(wrapper, 'one').findAll('h3')).toHaveLength(2)
    expect(column(wrapper, 'one').find('[role="status"]').exists()).toBe(false)
  })

  it.each([null, 503])(
    'réessaie uniquement la colonne en erreur %s et conserve les autres cartes',
    async (status) => {
      cardResponse.mockImplementation((id) => {
        if (id === 'two')
          return Promise.resolve(Response.json([{ ...cards[0], id: 'other', listId: 'two' }]))
        return status === null
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(Response.json({ message: 'Service indisponible.' }, { status }))
      })
      const { wrapper } = await mountKanban()
      const first = column(wrapper, 'one')
      expect(first.get('[role="alert"]').text()).toMatch(
        status === null ? /réseau/i : /indisponible/i,
      )
      expect(column(wrapper, 'two').findAll('h3')).toHaveLength(1)
      const retry = first.findAll('button').find((item) => item.text() === 'Réessayer')!
      expect(retry).toBeDefined()
      const pending = deferredResponse()
      cardResponse.mockImplementation(() => pending.promise)
      await retry.trigger('click')
      await retry.trigger('click')
      expect(cardResponse.mock.calls.map(([id]) => id)).toEqual(['one', 'two', 'one'])
      expect(column(wrapper, 'two').findAll('h3')).toHaveLength(1)
      pending.resolve(Response.json(cards))
      await flushPromises()
      expect(first.findAll('h3')).toHaveLength(2)
      expect(first.find('[role="alert"]').exists()).toBe(false)
    },
  )

  it.each([400, 403, 404])(
    'signale l’erreur %s de la liste sans cartes ni relance réseau',
    async (status) => {
      cardResponse.mockImplementation((id) =>
        Promise.resolve(
          id === 'one'
            ? Response.json({ message: 'Requête invalide.' }, { status })
            : Response.json([{ ...cards[0], listId: 'two' }]),
        ),
      )
      const { wrapper, session } = await mountKanban()
      const first = column(wrapper, 'one')
      expect(first.get('[role="alert"]').text()).toMatch(
        status === 400 ? /invalide/i : /inaccessible|n’existe plus/i,
      )
      expect(first.findAll('h3')).toHaveLength(0)
      expect(first.text()).not.toMatch(/aucune carte|réessayer/i)
      expect(column(wrapper, 'two').findAll('h3')).toHaveLength(1)
      expect(session.token).toBe('token-alice')
    },
  )

  it('expire la session sur 401 et retire toutes les cartes', async () => {
    cardResponse.mockResolvedValue(Response.json({}, { status: 401 }))
    const { wrapper, session, router } = await mountKanban()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    expect(session.token).toBeNull()
    expect(wrapper.text()).toMatch(/session.*expiré/i)
    expect(wrapper.find('main h3').exists()).toBe(false)
  })

  it.each([200, 401, 500, null])(
    'ignore les cartes ou erreurs tardives %s après suppression de la liste',
    async (status) => {
      const pending = deferredResponse()
      cardResponse.mockImplementation((id) =>
        id === 'one' ? pending.promise : Promise.resolve(Response.json([])),
      )
      const { wrapper, session, router } = await mountKanban()
      expect(column(wrapper, 'one').get('[role="status"]').text()).toMatch(/chargement.*cartes/i)
      await wrapper.get('#delete-list-one').trigger('click')
      await flushPromises()
      const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
      await dialog
        .findAll('button')
        .find((item) => item.text() === 'Supprimer la liste')!
        .trigger('click')
      await flushPromises()
      expect(wrapper.find('#list-one-title').exists()).toBe(false)
      if (status === null) pending.reject(new TypeError('Failed to fetch'))
      else pending.resolve(Response.json(status === 200 ? cards : {}, { status }))
      await flushPromises()
      expect(wrapper.find('main h3').exists()).toBe(false)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-alice')
      expect(router.currentRoute.value.path).toBe('/kanban')
    },
  )

  it.each([200, 401, 500, null])(
    'ignore la réponse %s des cartes d’une ancienne session',
    async (status) => {
      const pending = deferredResponse()
      cardResponse.mockImplementation((id) =>
        id === 'one' ? pending.promise : Promise.resolve(Response.json([])),
      )
      const { wrapper, session, router } = await mountKanban()
      cardResponse.mockImplementation((id) =>
        Promise.resolve(
          Response.json(
            id === 'one' ? [{ ...cards[0], id: 'bob-card', title: 'Carte de Bob' }] : [],
          ),
        ),
      )
      session.start('token-bob')
      await flushPromises()
      expect(wrapper.findAll('main h3').map((item) => item.text())).toEqual(['Carte de Bob'])
      if (status === null) pending.reject(new TypeError('Failed to fetch'))
      else pending.resolve(Response.json(status === 200 ? cards : {}, { status }))
      await flushPromises()
      expect(wrapper.findAll('main h3').map((item) => item.text())).toEqual(['Carte de Bob'])
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-bob')
      expect(router.currentRoute.value.path).toBe('/kanban')
    },
  )
})
