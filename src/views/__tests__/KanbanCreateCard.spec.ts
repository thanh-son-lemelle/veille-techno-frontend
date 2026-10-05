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
const created: Card = {
  id: 'new-card',
  title: 'Lire Vue',
  description: 'Documentation Vue',
  position: 0,
  listId: 'one',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
}
const fetchMock = vi.fn<typeof fetch>()
let readLists: () => Promise<Response>
let readCards: (listId: string) => Promise<Response>
let createCard: () => Promise<Response>
let createList: () => Promise<Response>
let deleteList: () => Promise<Response>

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', fetchMock)
  readLists = () => Promise.resolve(Response.json(lists))
  readCards = () => Promise.resolve(Response.json([]))
  createCard = () => Promise.resolve(Response.json(created, { status: 201 }))
  createList = () => Promise.resolve(Response.json(lists[0], { status: 201 }))
  deleteList = () => Promise.resolve(new Response(null, { status: 204 }))
  fetchMock.mockImplementation((input, init) => {
    const path = String(input)
    if (path === '/api/lists' && init?.method === 'GET') return readLists()
    if (path === '/api/lists' && init?.method === 'POST') return createList()
    if (init?.method === 'DELETE') return deleteList()
    const listId = path.match(/^\/api\/lists\/([^/]+)\/cards$/)?.[1]
    if (listId && init?.method === 'GET') return readCards(listId)
    if (listId && init?.method === 'POST') return createCard()
    throw new Error(`Requête inattendue : ${init?.method} ${path}`)
  })
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

type Board = Awaited<ReturnType<typeof mountKanban>>['wrapper']
function column(wrapper: Board, id = 'one') {
  return wrapper.get(`[aria-labelledby="list-${id}-title"]`)
}
function cardTitles(container: Pick<DOMWrapper<Element>, 'findAll'>) {
  return container
    .findAll('h3')
    .filter((item) => !item.element.closest('form'))
    .map((item) => item.text())
}
function button(container: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  const found = container.findAll('button').find((item) => item.text() === label)
  expect(found, `Le bouton « ${label} » est accessible`).toBeDefined()
  return found!
}
async function openCreation(wrapper: Board, id = 'one') {
  await button(column(wrapper, id), 'Ajouter une carte').trigger('click')
  await flushPromises()
  return column(wrapper, id).get('form')
}
function posts() {
  return fetchMock.mock.calls.filter(([, request]) => request?.method === 'POST')
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

describe('Création d’une carte', () => {
  it('envoie le titre normalisé à la colonne choisie et insère la réponse selon position, date puis identifiant', async () => {
    readCards = (id) =>
      Promise.resolve(
        Response.json(
          id === 'two'
            ? [
                { ...created, id: 'z', title: 'Après', listId: 'two', createdAt: '2026-10-06' },
                { ...created, id: 'a', title: 'Avant', listId: 'two' },
                { ...created, id: 'p', title: 'Position suivante', listId: 'two', position: 1 },
              ]
            : [],
        ),
      )
    createCard = () =>
      Promise.resolve(Response.json({ ...created, listId: 'two' }, { status: 201 }))
    const { wrapper } = await mountKanban()
    const form = await openCreation(wrapper, 'two')
    expect(form.text()).toContain('Nouvelle carte')
    const title = form.get<HTMLInputElement>('input[name="title"]')
    expect(document.activeElement).toBe(title.element)
    await title.setValue('  Lire Vue  ')
    await form.get('[name="description"]').setValue('Documentation Vue')
    await form.trigger('submit')
    await flushPromises()
    const [url, request] = posts()[0]!
    expect(url).toBe('/api/lists/two/cards')
    expect(JSON.parse(request?.body as string)).toEqual({
      title: 'Lire Vue',
      description: 'Documentation Vue',
    })
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer token-alice')
    expect(
      column(wrapper, 'two')
        .findAll('h3')
        .map((item) => item.text()),
    ).toEqual(['Avant', 'Lire Vue', 'Après', 'Position suivante'])
    expect(column(wrapper).find('h3').exists()).toBe(false)
    expect(column(wrapper, 'two').text()).toContain('Documentation Vue')
    expect(column(wrapper, 'two').find('form').exists()).toBe(false)
    const success = column(wrapper, 'two').get('[role="status"]')
    expect(success.text()).toMatch(/carte.*créée/i)
    expect(document.activeElement).toBe(success.element)
    const reopened = await openCreation(wrapper, 'two')
    expect(reopened.get<HTMLInputElement>('input[name="title"]').element.value).toBe('')
    expect(reopened.get<HTMLTextAreaElement>('[name="description"]').element.value).toBe('')
  })

  it('accepte une description vide sans créer un doublon du même identifiant', async () => {
    readCards = (id) => Promise.resolve(Response.json(id === 'one' ? [created] : []))
    const { wrapper } = await mountKanban()
    const form = await openCreation(wrapper)
    await form.get('input[name="title"]').setValue('Lire Vue')
    await form.trigger('submit')
    await flushPromises()
    expect(posts()).toHaveLength(1)
    const payload = JSON.parse(posts()[0]![1]?.body as string)
    expect(payload.title).toBe('Lire Vue')
    expect(payload.description ?? '').toBe('')
    expect(payload).not.toHaveProperty('position')
    expect(
      column(wrapper)
        .findAll('h3')
        .map((item) => item.text()),
    ).toEqual(['Lire Vue'])
  })

  it('associe les champs à leurs libellés uniques dans chaque colonne', async () => {
    const { wrapper } = await mountKanban()
    await openCreation(wrapper)
    await openCreation(wrapper, 'two')
    const ids: string[] = []
    for (const id of ['one', 'two']) {
      const form = column(wrapper, id).get('form')
      for (const [name, label] of [
        ['title', 'Titre de la carte'],
        ['description', 'Description'],
      ]) {
        const input = form.get(`[name="${name}"]`)
        const fieldId = input.attributes('id')
        expect(fieldId).toBeTruthy()
        expect(form.get(`label[for="${fieldId}"]`).text()).toContain(label)
        ids.push(fieldId!)
      }
    }
    expect(new Set(ids).size).toBe(4)
  })

  it.each(['', '   '])('refuse un titre %j et permet de le corriger sans POST', async (value) => {
    const { wrapper } = await mountKanban()
    const form = await openCreation(wrapper)
    const title = form.get('input[name="title"]')
    await title.setValue(value)
    form.get<HTMLButtonElement>('button[type="submit"]').element.focus()
    await form.trigger('submit')
    await flushPromises()
    expect(posts()).toHaveLength(0)
    expect(title.attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(title.element)
    await title.setValue('Lire Vue')
    await form.trigger('submit')
    await flushPromises()
    expect(
      column(wrapper)
        .findAll('h3')
        .map((item) => item.text()),
    ).toEqual(['Lire Vue'])
  })

  it('attend le chargement des cartes avant de proposer une création', async () => {
    const pending = deferredResponse()
    readCards = (id) => (id === 'one' ? pending.promise : Promise.resolve(Response.json([])))
    const { wrapper } = await mountKanban()
    expect(
      column(wrapper)
        .findAll('button')
        .some((item) => item.text() === 'Ajouter une carte'),
    ).toBe(false)
    expect(button(column(wrapper, 'two'), 'Ajouter une carte')).toBeDefined()
    pending.resolve(Response.json([]))
    await flushPromises()
    expect(button(column(wrapper), 'Ajouter une carte')).toBeDefined()
  })

  it('annule le brouillon sans POST et rend le focus au bouton de la colonne', async () => {
    const { wrapper } = await mountKanban()
    const form = await openCreation(wrapper)
    await form.get('input[name="title"]').setValue('Brouillon')
    await button(form, 'Annuler').trigger('click')
    await flushPromises()
    expect(column(wrapper).find('form').exists()).toBe(false)
    expect(posts()).toHaveLength(0)
    expect(document.activeElement).toBe(button(column(wrapper), 'Ajouter une carte').element)
    const reopened = await openCreation(wrapper)
    expect(reopened.get<HTMLInputElement>('input[name="title"]').element.value).toBe('')
  })

  it('bloque les doubles soumissions sans carte optimiste', async () => {
    const { wrapper } = await mountKanban()
    const form = await openCreation(wrapper)
    await form.get('input[name="title"]').setValue('Lire Vue')
    const pending = deferredResponse()
    createCard = () => pending.promise
    await form.trigger('submit')
    await flushPromises()
    await form.trigger('submit')
    await flushPromises()
    expect(posts()).toHaveLength(1)
    expect(form.attributes('aria-busy')).toBe('true')
    expect(form.get('fieldset').attributes('disabled')).toBeDefined()
    expect(cardTitles(column(wrapper))).toEqual([])
    pending.resolve(Response.json(created, { status: 201 }))
    await flushPromises()
    expect(column(wrapper).findAll('h3')).toHaveLength(1)
  })

  it.each([400, 503, null])(
    'conserve le brouillon après %s et attend une relance explicite',
    async (status) => {
      const { wrapper } = await mountKanban()
      const form = await openCreation(wrapper)
      await form.get('input[name="title"]').setValue('  Lire Vue  ')
      await form.get('[name="description"]').setValue('Documentation Vue')
      createCard = () =>
        status === null
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(Response.json({ message: 'Création refusée.' }, { status }))
      await form.trigger('submit')
      await flushPromises()
      expect(posts()).toHaveLength(1)
      expect(form.get<HTMLInputElement>('input[name="title"]').element.value).toBe('  Lire Vue  ')
      expect(form.get<HTMLTextAreaElement>('[name="description"]').element.value).toBe(
        'Documentation Vue',
      )
      expect(form.get('[role="alert"]').text()).toMatch(status === null ? /réseau/i : /refusée/i)
      expect(document.activeElement).toBe(form.get('[role="alert"]').element)
      expect(form.get('fieldset').attributes('disabled')).toBeUndefined()
      expect(cardTitles(column(wrapper))).toEqual([])
      createCard = () => Promise.resolve(Response.json(created, { status: 201 }))
      await form.trigger('submit')
      await flushPromises()
      expect(posts()).toHaveLength(2)
      expect(column(wrapper).findAll('h3')).toHaveLength(1)
      expect(column(wrapper).find('[role="alert"]').exists()).toBe(false)
    },
  )

  it.each([403, 404])(
    'resynchronise les listes après %s et conserve un message accessible',
    async (status) => {
      const { wrapper, session } = await mountKanban()
      const form = await openCreation(wrapper)
      await form.get('input[name="title"]').setValue('Lire Vue')
      createCard = () => Promise.resolve(Response.json({}, { status }))
      const refreshed = deferredResponse()
      readLists = () => refreshed.promise
      await form.trigger('submit')
      await flushPromises()
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/lists')).toHaveLength(2)
      expect(wrapper.get('[role="alert"]').text()).toMatch(/inaccessible|n’existe plus/i)
      expect(wrapper.find('main h3').exists()).toBe(false)
      refreshed.resolve(Response.json([lists[1]]))
      await flushPromises()
      expect(wrapper.find('#list-one-title').exists()).toBe(false)
      expect(wrapper.get('#list-two-title').text()).toBe('En cours')
      expect(wrapper.get('[role="alert"]').text()).toMatch(/inaccessible|n’existe plus/i)
      expect(session.token).toBe('token-alice')
      expect(posts()).toHaveLength(1)
    },
  )

  it('expire la session après le 401 du POST', async () => {
    const { wrapper, session, router } = await mountKanban()
    const form = await openCreation(wrapper)
    await form.get('input[name="title"]').setValue('Lire Vue')
    createCard = () => Promise.resolve(Response.json({}, { status: 401 }))
    await form.trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    expect(session.token).toBeNull()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/session.*expiré/i)
    expect(wrapper.find('main h3').exists()).toBe(false)
  })

  it.each([
    ['création', 403],
    ['création', 404],
    ['suppression', 403],
    ['suppression', 404],
  ] as const)(
    'attend la %s de liste avant de resynchroniser après le POST carte %s',
    async (operation, status) => {
      readCards = (id) =>
        Promise.resolve(Response.json(id === 'one' ? [{ ...created, id: 'existing' }] : []))
      const { wrapper } = await mountKanban()
      const cardForm = await openCreation(wrapper)
      await cardForm.get('input[name="title"]').setValue('Autre carte')
      const cardRequest = deferredResponse()
      createCard = () => cardRequest.promise
      await cardForm.trigger('submit')
      await flushPromises()

      const listRequest = deferredResponse()
      const newList: List = {
        id: 'new-list',
        title: 'Nouvelle liste',
        position: 2,
        ownerId: 'alice',
        createdAt: '2026-10-05',
      }
      if (operation === 'création') {
        createList = () => listRequest.promise
        await wrapper.get('#add-list').trigger('click')
        await flushPromises()
        const listForm = wrapper.get('form[aria-labelledby="create-list-title"]')
        await listForm.get('input[name="title"]').setValue('Nouvelle liste')
        await listForm.trigger('submit')
      } else {
        deleteList = () => listRequest.promise
        await wrapper.get('#delete-list-two').trigger('click')
        await flushPromises()
        const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
        await button(dialog, 'Supprimer la liste').trigger('click')
      }
      await flushPromises()

      const refreshed = deferredResponse()
      readLists = () => refreshed.promise
      cardRequest.resolve(Response.json({}, { status }))
      await flushPromises()
      expect(
        fetchMock.mock.calls.filter(
          ([url, request]) => url === '/api/lists' && request?.method === 'GET',
        ),
      ).toHaveLength(1)
      expect(cardTitles(column(wrapper))).toEqual([])
      expect(wrapper.get('[role="alert"]').text()).toMatch(/inaccessible|n’existe plus/i)

      listRequest.resolve(
        operation === 'création'
          ? Response.json(newList, { status: 201 })
          : new Response(null, { status: 204 }),
      )
      await flushPromises()
      expect(
        fetchMock.mock.calls.filter(
          ([url, request]) => url === '/api/lists' && request?.method === 'GET',
        ),
      ).toHaveLength(2)
      refreshed.resolve(Response.json(operation === 'création' ? [lists[1], newList] : []))
      await flushPromises()
      expect(wrapper.findAll('main li h2').map((item) => item.text())).toEqual(
        operation === 'création' ? ['En cours', 'Nouvelle liste'] : [],
      )
      expect(wrapper.find('#list-one-title').exists()).toBe(false)
      expect(wrapper.find('main h3').exists()).toBe(false)
    },
  )

  it('ignore un 401 tardif après avoir quitté le tableau sans déconnecter le compte', async () => {
    const { wrapper, session, router } = await mountKanban()
    const form = await openCreation(wrapper)
    await form.get('input[name="title"]').setValue('Lire Vue')
    const pending = deferredResponse()
    createCard = () => pending.promise
    await form.trigger('submit')
    await flushPromises()
    await router.push('/page-inconnue')
    await flushPromises()
    pending.resolve(Response.json({}, { status: 401 }))
    await flushPromises()
    expect(session.token).toBe('token-alice')
    expect(router.currentRoute.value.path).toBe('/page-inconnue')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it.each([201, 401, 404, 500, null])(
    'ignore une réponse tardive %s du compte précédent',
    async (status) => {
      const { wrapper, session, router } = await mountKanban()
      const form = await openCreation(wrapper)
      await form.get('input[name="title"]').setValue('Lire Vue')
      const pending = deferredResponse()
      createCard = () => pending.promise
      await form.trigger('submit')
      await flushPromises()
      readCards = () => Promise.resolve(Response.json([]))
      session.start('token-bob')
      await flushPromises()
      if (status === null) pending.reject(new TypeError('Failed to fetch'))
      else pending.resolve(Response.json(status === 201 ? created : {}, { status }))
      await flushPromises()
      expect(wrapper.find('main h3').exists()).toBe(false)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-bob')
      expect(router.currentRoute.value.path).toBe('/kanban')
    },
  )

  it.each([201, 401, 404, 500, null])(
    'ignore une réponse tardive %s après suppression de la liste',
    async (status) => {
      const { wrapper, session, router } = await mountKanban()
      const form = await openCreation(wrapper)
      await form.get('input[name="title"]').setValue('Lire Vue')
      const pending = deferredResponse()
      createCard = () => pending.promise
      await form.trigger('submit')
      await flushPromises()
      await wrapper.get('#delete-list-one').trigger('click')
      await flushPromises()
      const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!)
      await button(dialog, 'Supprimer la liste').trigger('click')
      await flushPromises()
      expect(wrapper.find('#list-one-title').exists()).toBe(false)
      if (status === null) pending.reject(new TypeError('Failed to fetch'))
      else pending.resolve(Response.json(status === 201 ? created : {}, { status }))
      await flushPromises()
      expect(wrapper.find('main h3').exists()).toBe(false)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-alice')
      expect(router.currentRoute.value.path).toBe('/kanban')
    },
  )
})
