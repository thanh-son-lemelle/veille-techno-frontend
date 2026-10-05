import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useSessionStore } from '@/stores/session'
import type { Card, List } from '@/api'

enableAutoUnmount(afterEach)

const card: Card = {
  id: 'a',
  title: 'Lire Vue',
  description: 'Documentation Vue',
  position: 0,
  listId: 'two',
  createdAt: '2026-10-04',
  updatedAt: '2026-10-05',
}
const lists: List[] = [
  { id: 'one', title: 'À lire', position: 0, ownerId: 'alice', createdAt: '2026-10-05' },
  { id: 'two', title: 'En cours', position: 1, ownerId: 'alice', createdAt: '2026-10-05' },
]
const fetchMock = vi.fn<typeof fetch>()
const cardResponse = vi.fn<(id: string) => Promise<Response>>()
const listResponse = vi.fn<() => Promise<Response>>()

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', fetchMock)
  cardResponse.mockImplementation((id) => Promise.resolve(Response.json({ ...card, id })))
  listResponse.mockImplementation(() => Promise.resolve(Response.json(lists)))
  fetchMock.mockImplementation((input) => {
    const path = String(input)
    if (path === '/api/lists') return listResponse()
    const id = path.match(/^\/api\/cards\/([^/]+)$/)?.[1]
    if (id) return cardResponse(id)
    if (path.match(/^\/api\/lists\/[^/]+\/cards$/)) return Promise.resolve(Response.json([]))
    throw new Error(`Requête inattendue : ${path}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fetchMock.mockReset()
  cardResponse.mockReset()
  listResponse.mockReset()
})

async function mountDetail(path = '/cartes/a') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.start('token-alice')
  const router = createAppRouter(pinia, createMemoryHistory())
  await router.push(path)
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

function button(wrapper: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  const result = wrapper.findAll('button').find((item) => item.text() === label)
  expect(result, `Bouton « ${label} »`).toBeDefined()
  return result!
}

function returnLink(wrapper: Pick<DOMWrapper<Element>, 'findAll'>) {
  const result = wrapper.findAll('a').find((item) => item.text() === 'Retour au tableau')
  expect(result).toBeDefined()
  expect(result!.attributes('href')).toBe('/kanban')
  return result!
}

type PendingResponse = ReturnType<typeof deferredResponse>
function settle(pending: PendingResponse, status: number | null) {
  if (status === null) pending.reject(new TypeError('Failed to fetch'))
  else
    pending.resolve(
      Response.json(
        status === 200 ? { ...card, title: 'Ancienne carte' } : { message: 'Erreur ancienne' },
        { status },
      ),
    )
}

function requestSignal(path: string) {
  const request = fetchMock.mock.calls.find(([url]) => String(url) === path)
  expect(request).toBeDefined()
  expect(request![1]?.signal).toBeInstanceOf(AbortSignal)
  return request![1]!.signal!
}

describe('Détail de la carte', () => {
  it('affiche la carte et le titre de sa liste actuelle depuis les réponses authentifiées', async () => {
    const { wrapper } = await mountDetail()
    expect(wrapper.get('main h1').text()).toBe('Détail de la carte')
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    expect(wrapper.text()).toContain('Documentation Vue')
    expect(wrapper.get('main dd').text()).toBe('En cours')
    const requests = fetchMock.mock.calls
    expect(requests.map(([url]) => url)).toEqual(['/api/cards/a', '/api/lists'])
    for (const [, init] of requests) {
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-alice')
    }
  })

  it('ouvre une page depuis le titre du tableau et recharge la carte déplacée et sa liste renommée', async () => {
    fetchMock.mockImplementation((input) => {
      const path = String(input)
      if (path === '/api/lists') return listResponse()
      if (path === '/api/lists/one/cards')
        return Promise.resolve(Response.json([{ ...card, listId: 'one', title: 'Ancien titre' }]))
      if (path === '/api/lists/two/cards') return Promise.resolve(Response.json([]))
      if (path === '/api/cards/a') return cardResponse('a')
      throw new Error(`Requête inattendue : ${path}`)
    })
    const { wrapper, router } = await mountDetail('/kanban')
    const link = wrapper.get('main h3 a')
    expect(link.text()).toBe('Ancien titre')
    expect(link.attributes('href')).toBe('/cartes/a')
    listResponse.mockResolvedValue(
      Response.json([lists[0], { ...lists[1], title: 'Liste renommée' }]),
    )
    cardResponse.mockResolvedValue(
      Response.json({ ...card, title: 'Titre actualisé', description: 'Description actualisée' }),
    )
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/cartes/a')
    expect(wrapper.get('main h1').text()).toBe('Détail de la carte')
    expect(wrapper.get('main h2').text()).toBe('Titre actualisé')
    expect(wrapper.text()).toContain('Description actualisée')
    expect(wrapper.get('main dd').text()).toBe('Liste renommée')
    expect(wrapper.text()).not.toContain('Ancien titre')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await returnLink(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(wrapper.get('main h1').text()).toBe('Tableau Kanban')
  })

  it('attend la carte puis sa liste avant de révéler son contenu', async () => {
    const pendingCard = deferredResponse()
    const pendingLists = deferredResponse()
    cardResponse.mockReturnValue(pendingCard.promise)
    listResponse.mockReturnValue(pendingLists.promise)
    const { wrapper } = await mountDetail()
    expect(wrapper.get('main h1').text()).toBe('Détail de la carte')
    expect(wrapper.get('main [role="status"]').text()).toBe('Chargement de la carte…')
    returnLink(wrapper)
    expect(wrapper.find('main h2').exists()).toBe(false)
    pendingCard.resolve(Response.json(card))
    await flushPromises()
    expect(wrapper.get('main [role="status"]').text()).toBe('Chargement de la carte…')
    expect(wrapper.text()).not.toContain('Documentation Vue')
    expect(wrapper.find('main h2').exists()).toBe(false)
    pendingLists.resolve(Response.json(lists))
    await flushPromises()
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    expect(wrapper.find('main [role="status"]').exists()).toBe(false)
  })

  it.each(['', null])(
    'affiche un état explicite pour une description vide %s',
    async (description) => {
      cardResponse.mockResolvedValue(Response.json({ ...card, description }))
      const { wrapper } = await mountDetail()
      expect(wrapper.text()).toContain('Aucune description.')
      expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    },
  )

  it('affiche le titre, la description et la liste HTML comme du texte', async () => {
    cardResponse.mockResolvedValue(
      Response.json({
        ...card,
        title: '<img src=x onerror=alert(1)>',
        description: '<script>secret</script>',
      }),
    )
    listResponse.mockResolvedValue(
      Response.json([{ ...lists[1], title: '<img src=x onerror=alert(2)>' }]),
    )
    const { wrapper } = await mountDetail()
    expect(wrapper.get('main h2').text()).toBe('<img src=x onerror=alert(1)>')
    expect(wrapper.text()).toContain('<script>secret</script>')
    expect(wrapper.get('main dd').text()).toBe('<img src=x onerror=alert(2)>')
    expect(wrapper.find('main img, main script').exists()).toBe(false)
  })

  it.each(['card', 'list'] as const)(
    'ne révèle aucun contenu si la requête %s renvoie une erreur définitive',
    async (endpoint) => {
      const responder = endpoint === 'card' ? cardResponse : listResponse
      responder.mockResolvedValue(Response.json({ message: 'Requête invalide.' }, { status: 400 }))
      const { wrapper, session } = await mountDetail()
      expect(wrapper.get('main [role="alert"]').text()).toContain('Requête invalide.')
      expect(wrapper.find('main h2').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Documentation Vue')
      expect(wrapper.text()).not.toContain('Réessayer')
      expect(session.token).toBe('token-alice')
      returnLink(wrapper)
    },
  )

  it.each([
    ['card', 403],
    ['card', 404],
    ['list', 403],
    ['list', 404],
  ] as const)(
    'signale une carte inaccessible sans exposer le payload de %s %s',
    async (endpoint, status) => {
      const responder = endpoint === 'card' ? cardResponse : listResponse
      responder.mockResolvedValue(Response.json({ message: 'Contenu confidentiel' }, { status }))
      const { wrapper, session } = await mountDetail()
      expect(wrapper.get('main [role="alert"]').text()).toBe(
        'Cette carte est inaccessible ou n’existe plus.',
      )
      expect(wrapper.find('main h2').exists()).toBe(false)
      expect(wrapper.text()).not.toMatch(/Contenu confidentiel|Documentation Vue|Réessayer/)
      expect(session.token).toBe('token-alice')
      returnLink(wrapper)
    },
  )

  it('signale une carte inaccessible si sa liste actuelle n’est plus retournée', async () => {
    listResponse.mockResolvedValue(Response.json([lists[0]]))
    const { wrapper } = await mountDetail()
    expect(wrapper.get('main [role="alert"]').text()).toBe(
      'Cette carte est inaccessible ou n’existe plus.',
    )
    expect(wrapper.find('main h2').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Documentation Vue|Réessayer/)
  })

  it.each([
    ['card', null],
    ['card', 503],
    ['list', null],
    ['list', 503],
  ] as const)(
    'réessaie une erreur temporaire %s %s sans lancer deux chargements',
    async (endpoint, status) => {
      const responder = endpoint === 'card' ? cardResponse : listResponse
      if (status === null) responder.mockRejectedValue(new TypeError('Failed to fetch'))
      else
        responder.mockResolvedValue(Response.json({ message: 'Service indisponible.' }, { status }))
      const { wrapper } = await mountDetail()
      expect(wrapper.get('main [role="alert"]').text()).toMatch(
        status === null ? /réseau/i : /indisponible/i,
      )
      expect(wrapper.find('main h2').exists()).toBe(false)
      const pending = deferredResponse()
      cardResponse.mockReturnValue(pending.promise)
      listResponse.mockResolvedValue(Response.json(lists))
      const retry = button(wrapper, 'Réessayer')
      await retry.trigger('click')
      await retry.trigger('click')
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/cards/a')).toHaveLength(2)
      expect(wrapper.get('main [role="status"]').text()).toBe('Chargement de la carte…')
      pending.resolve(Response.json(card))
      await flushPromises()
      expect(wrapper.get('main h2').text()).toBe('Lire Vue')
      expect(wrapper.get('main dd').text()).toBe('En cours')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
    },
  )

  it.each(['card', 'list'] as const)(
    'expire la session sur un 401 de la requête %s',
    async (endpoint) => {
      const responder = endpoint === 'card' ? cardResponse : listResponse
      responder.mockResolvedValue(
        Response.json({ message: 'Ancien contenu privé' }, { status: 401 }),
      )
      const { wrapper, session, router } = await mountDetail()
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
      expect(session.token).toBeNull()
      expect(wrapper.text()).toMatch(/session.*expiré/i)
      expect(wrapper.text()).not.toMatch(/Ancien contenu privé|Documentation Vue/)
      expect(wrapper.find('main h2').exists()).toBe(false)
    },
  )

  it.each([200, 401, 500, null])(
    'ignore la réponse %s de A après navigation vers B',
    async (status) => {
      const pending = deferredResponse()
      cardResponse.mockImplementation((id) =>
        id === 'a'
          ? pending.promise
          : Promise.resolve(Response.json({ ...card, id, title: 'Carte B' })),
      )
      const { wrapper, session, router } = await mountDetail()
      const signal = requestSignal('/api/cards/a')
      await router.push('/cartes/b')
      await flushPromises()
      expect(signal.aborted).toBe(true)
      expect(wrapper.get('main h2').text()).toBe('Carte B')
      settle(pending, status)
      await flushPromises()
      expect(wrapper.get('main h2').text()).toBe('Carte B')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-alice')
      expect(router.currentRoute.value.path).toBe('/cartes/b')
    },
  )

  it.each([200, 401, 500, null])(
    'ignore la réponse %s de la liste de A après navigation vers B',
    async (status) => {
      const pending = deferredResponse()
      listResponse.mockReturnValueOnce(pending.promise)
      const { wrapper, session, router } = await mountDetail()
      const signal = requestSignal('/api/lists')
      cardResponse.mockResolvedValue(
        Response.json({ ...card, id: 'b', title: 'Carte B', listId: 'one' }),
      )
      await router.push('/cartes/b')
      await flushPromises()
      expect(signal.aborted).toBe(true)
      expect(wrapper.get('main dd').text()).toBe('À lire')
      if (status === 200) pending.resolve(Response.json([{ ...lists[1], title: 'Ancienne liste' }]))
      else settle(pending, status)
      await flushPromises()
      expect(wrapper.get('main h2').text()).toBe('Carte B')
      expect(wrapper.get('main dd').text()).toBe('À lire')
      expect(wrapper.text()).not.toContain('Ancienne liste')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-alice')
      expect(router.currentRoute.value.path).toBe('/cartes/b')
    },
  )

  it('retire la carte précédente pendant le chargement puis l’erreur de la suivante', async () => {
    const { wrapper, router } = await mountDetail()
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    const pending = deferredResponse()
    cardResponse.mockReturnValue(pending.promise)
    await router.push('/cartes/b')
    await flushPromises()
    expect(wrapper.find('main h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Documentation Vue')
    pending.resolve(Response.json({ message: 'Carte privée' }, { status: 403 }))
    await flushPromises()
    expect(wrapper.get('main [role="alert"]').text()).toBe(
      'Cette carte est inaccessible ou n’existe plus.',
    )
    expect(wrapper.find('main h2').exists()).toBe(false)
  })

  it.each([200, 401, 500])('ignore une réponse %s après retour au tableau', async (status) => {
    const pending = deferredResponse()
    cardResponse.mockReturnValue(pending.promise)
    const { wrapper, session, router } = await mountDetail()
    const signal = requestSignal('/api/cards/a')
    await returnLink(wrapper).trigger('click')
    await flushPromises()
    expect(signal.aborted).toBe(true)
    settle(pending, status)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(wrapper.get('main h1').text()).toBe('Tableau Kanban')
    expect(wrapper.text()).not.toContain('Ancienne carte')
    expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
    expect(session.token).toBe('token-alice')
  })

  it.each([200, 401, 500, null])(
    'ignore une réponse %s provenant de la session précédente',
    async (status) => {
      const pending = deferredResponse()
      cardResponse.mockReturnValueOnce(pending.promise)
      const { wrapper, session, router } = await mountDetail()
      const signal = requestSignal('/api/cards/a')
      cardResponse.mockResolvedValue(Response.json({ ...card, title: 'Carte de Bob' }))
      session.start('token-bob')
      await flushPromises()
      expect(signal.aborted).toBe(true)
      expect(wrapper.get('main h2').text()).toBe('Carte de Bob')
      settle(pending, status)
      await flushPromises()
      expect(wrapper.get('main h2').text()).toBe('Carte de Bob')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-bob')
      expect(router.currentRoute.value.path).toBe('/cartes/a')
      const requests = fetchMock.mock.calls.filter(([url]) => url === '/api/cards/a')
      expect(new Headers(requests[1]![1]?.headers).get('Authorization')).toBe('Bearer token-bob')
    },
  )

  it('annule la requête au démontage sans expirer la session sur une réponse tardive', async () => {
    const pending = deferredResponse()
    cardResponse.mockReturnValue(pending.promise)
    const { wrapper, session } = await mountDetail()
    const signal = requestSignal('/api/cards/a')
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    settle(pending, 401)
    await flushPromises()
    expect(session.token).toBe('token-alice')
  })
})
