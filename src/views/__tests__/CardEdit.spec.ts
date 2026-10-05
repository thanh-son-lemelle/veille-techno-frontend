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

const sourceId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const cardId = '33333333-3333-4333-8333-333333333333'
const card: Card = {
  id: cardId,
  title: 'Lire Vue',
  description: 'Documentation Vue',
  position: 4,
  listId: sourceId,
  createdAt: '2026-10-04T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
}
const lists: List[] = [
  { id: sourceId, title: 'À lire', position: 0, ownerId: 'alice', createdAt: '2026-10-05' },
  { id: targetId, title: 'En cours', position: 1, ownerId: 'alice', createdAt: '2026-10-05' },
]
const fetchMock = vi.fn<typeof fetch>()
const cardResponse = vi.fn<(id: string) => Promise<Response>>()
const listResponse = vi.fn<() => Promise<Response>>()
const patchResponse = vi.fn<() => Promise<Response>>()
const boardResponse = vi.fn<(id: string) => Promise<Response>>()

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', fetchMock)
  cardResponse.mockImplementation((id) => Promise.resolve(Response.json({ ...card, id })))
  listResponse.mockImplementation(() => Promise.resolve(Response.json(lists)))
  patchResponse.mockImplementation(() =>
    Promise.resolve(Response.json({ ...card, title: 'Vue 3' })),
  )
  boardResponse.mockImplementation(() => Promise.resolve(Response.json([])))
  fetchMock.mockImplementation((input, init) => {
    const path = String(input)
    if (path === '/api/lists') return listResponse()
    const id = path.match(/^\/api\/cards\/([^/]+)$/)?.[1]
    if (id) return init?.method === 'PATCH' ? patchResponse() : cardResponse(id)
    const listId = path.match(/^\/api\/lists\/([^/]+)\/cards$/)?.[1]
    if (listId) return boardResponse(listId)
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
  patchResponse.mockReset()
  boardResponse.mockReset()
})

async function mountDetail() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.start('token-alice')
  const router = createAppRouter(pinia, createMemoryHistory())
  await router.push(`/cartes/${cardId}`)
  await router.isReady()
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia, router, ui] } })
  await flushPromises()
  return { wrapper, session, router }
}

function button(wrapper: Pick<DOMWrapper<Element>, 'findAll'>, label: string) {
  const result = wrapper.findAll('button').find((item) => item.text() === label)
  expect(result, `Bouton « ${label} »`).toBeDefined()
  return result!
}

function patchRequests() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

type Detail = Awaited<ReturnType<typeof mountDetail>>['wrapper']

async function openEditor(wrapper: Detail) {
  await button(wrapper, 'Modifier la carte').trigger('click')
  await flushPromises()
  return wrapper.get('main form')
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

function settle(pending: ReturnType<typeof deferredResponse>, status: number | null) {
  if (status === null) pending.reject(new TypeError('Failed to fetch'))
  else
    pending.resolve(
      Response.json(status === 200 ? { ...card, title: 'Ancienne modification' } : {}, { status }),
    )
}

function reads(path: string) {
  return fetchMock.mock.calls.filter(([url, init]) => url === path && init?.method === 'GET')
}

function returnLink(wrapper: Detail) {
  const result = wrapper.findAll('a').find((item) => item.text() === 'Retour au tableau')
  expect(result).toBeDefined()
  return result!
}

describe('Modification de la carte', () => {
  it('préremplit le formulaire et envoie uniquement le titre modifié avec le jeton courant', async () => {
    const { wrapper, router } = await mountDetail()
    await button(wrapper, 'Modifier la carte').trigger('click')
    expect(router.currentRoute.value.path).toBe(`/cartes/${cardId}`)
    expect(wrapper.get<HTMLInputElement>('#edit-card-title').element.value).toBe('Lire Vue')
    expect(wrapper.get<HTMLTextAreaElement>('#edit-card-description').element.value).toBe(
      'Documentation Vue',
    )
    expect(wrapper.get<HTMLSelectElement>('#edit-card-list').element.value).toBe(sourceId)
    expect(wrapper.get<HTMLInputElement>('#edit-card-position').element.value).toBe('4')
    await wrapper.get('#edit-card-title').setValue('Vue 3')
    await wrapper.get('main form').trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
    const [url, init] = patchRequests()[0]!
    expect(url).toBe(`/api/cards/${cardId}`)
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Vue 3' })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-alice')
    expect(wrapper.get('main h2').text()).toBe('Vue 3')
    expect(wrapper.find('main form').exists()).toBe(false)
  })

  it('associe les quatre champs à leur libellé et propose les listes accessibles', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    for (const [id, label] of [
      ['edit-card-title', 'Titre de la carte'],
      ['edit-card-description', 'Description'],
      ['edit-card-list', 'Liste de destination'],
      ['edit-card-position', 'Position'],
    ]) {
      expect(form.get(`label[for="${id}"]`).text()).toContain(label)
    }
    expect(
      form
        .get('select')
        .findAll('option')
        .map((option) => option.text()),
    ).toEqual(['À lire', 'En cours'])
    expect(button(form, 'Enregistrer').attributes('type')).toBe('submit')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([
    ['description', '', { description: '' }],
    ['position', '0', { position: 0 }],
    ['position', '-2147483648', { position: -2147483648 }],
    ['position', '2147483647', { position: 2147483647 }],
    ['list', targetId, { listId: targetId }],
    ['title', '  Vue 3  ', { title: 'Vue 3' }],
  ])('ne transmet que le champ %s modifié en %j', async (field, value, payload) => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get(`#edit-card-${field}`).setValue(value)
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
    expect(JSON.parse(String(patchRequests()[0]![1]?.body))).toEqual(payload)
  })

  it.each(['Lire Vue', '  Lire Vue  '])(
    'ne déclenche aucun PATCH quand les valeurs normalisées sont inchangées : %j',
    async (title) => {
      const { wrapper } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue(title)
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(0)
      expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    },
  )

  it('annule sans requête ni mutation et restaure les valeurs courantes à la réouverture', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Brouillon')
    await form.get('#edit-card-description').setValue('Description provisoire')
    await form.get('#edit-card-list').setValue(targetId)
    await form.get('#edit-card-position').setValue('0')
    const requestCount = fetchMock.mock.calls.length
    await button(form, 'Annuler').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls).toHaveLength(requestCount)
    expect(wrapper.find('main form').exists()).toBe(false)
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    expect(wrapper.get('main dd').text()).toBe('À lire')
    const reopened = await openEditor(wrapper)
    expect(reopened.get<HTMLInputElement>('#edit-card-title').element.value).toBe('Lire Vue')
    expect(reopened.get<HTMLTextAreaElement>('#edit-card-description').element.value).toBe(
      'Documentation Vue',
    )
    expect(reopened.get<HTMLSelectElement>('#edit-card-list').element.value).toBe(sourceId)
    expect(reopened.get<HTMLInputElement>('#edit-card-position').element.value).toBe('4')
  })

  it.each([
    ['title', ''],
    ['title', '   '],
    ['position', ''],
    ['position', '1.5'],
    ['position', '-2147483649'],
    ['position', '2147483648'],
  ])('refuse le champ %s invalide %j avant tout PATCH', async (field, value) => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    const input = form.get(`#edit-card-${field}`)
    await input.setValue(value)
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(0)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    await input.setValue(field === 'title' ? 'Vue 3' : '0')
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
  })

  it('refuse une destination dont l’identifiant retourné n’est pas un UUID', async () => {
    listResponse.mockImplementation(() =>
      Promise.resolve(Response.json([...lists, { ...lists[1], id: 'destination-invalide' }])),
    )
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-list').setValue('destination-invalide')
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(0)
    expect(form.get('#edit-card-list').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(form.get('#edit-card-list').element)
    const descriptionId = form.get('#edit-card-list').attributes('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(form.get(`#${descriptionId}`).text()).toMatch(/UUID/i)
    await form.get('#edit-card-list').setValue(targetId)
    await form.trigger('submit')
    await flushPromises()
    expect(JSON.parse(String(patchRequests()[0]![1]?.body))).toEqual({ listId: targetId })
  })

  it('affiche les valeurs autoritaires de la réponse sans appliquer le brouillon optimiste', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Brouillon')
    await form.get('#edit-card-description').setValue('Description saisie')
    await form.get('#edit-card-list').setValue(targetId)
    await form.get('#edit-card-position').setValue('0')
    const pending = deferredResponse()
    patchResponse.mockReturnValue(pending.promise)
    await form.trigger('submit')
    await flushPromises()
    expect(wrapper.get('main h2').text()).toBe('Lire Vue')
    expect(patchRequests()).toHaveLength(1)
    expect(JSON.parse(String(patchRequests()[0]![1]?.body))).toEqual({
      title: 'Brouillon',
      description: 'Description saisie',
      listId: targetId,
      position: 0,
    })
    pending.resolve(
      Response.json({
        ...card,
        title: 'Titre serveur',
        description: 'Description serveur',
        position: 2,
        listId: targetId,
      }),
    )
    await flushPromises()
    expect(wrapper.get('main h2').text()).toBe('Titre serveur')
    expect(wrapper.get('main dd').text()).toBe('En cours')
    expect(wrapper.text()).toContain('Description serveur')
    expect(wrapper.find('main form').exists()).toBe(false)
    const reopened = await openEditor(wrapper)
    expect(reopened.get<HTMLInputElement>('#edit-card-position').element.value).toBe('2')
    expect(reopened.get<HTMLInputElement>('#edit-card-title').element.value).toBe('Titre serveur')
  })

  it('bloque les doubles soumissions pendant le PATCH', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Vue 3')
    const pending = deferredResponse()
    patchResponse.mockReturnValue(pending.promise)
    await form.trigger('submit')
    await flushPromises()
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
    expect(form.attributes('aria-busy')).toBe('true')
    expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    pending.resolve(Response.json({ ...card, title: 'Vue 3' }))
    await flushPromises()
    expect(wrapper.get('main h2').text()).toBe('Vue 3')
  })

  it.each([400, 503, null])(
    'conserve le brouillon après %s et attend une nouvelle soumission explicite',
    async (status) => {
      const { wrapper } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('  Vue 3  ')
      await form.get('#edit-card-description').setValue('Brouillon\nconservé')
      await form.get('#edit-card-list').setValue(targetId)
      await form.get('#edit-card-position').setValue('0')
      patchResponse.mockImplementation(() =>
        status === null
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(Response.json({ message: 'Modification refusée.' }, { status })),
      )
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(1)
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe('  Vue 3  ')
      expect(form.get<HTMLTextAreaElement>('#edit-card-description').element.value).toBe(
        'Brouillon\nconservé',
      )
      expect(form.get<HTMLSelectElement>('#edit-card-list').element.value).toBe(targetId)
      expect(form.get<HTMLInputElement>('#edit-card-position').element.value).toBe('0')
      expect(form.get('[role="alert"]').text()).toMatch(status === null ? /réseau/i : /refusée/i)
      expect(button(form, 'Enregistrer').attributes('disabled')).toBeUndefined()
      expect(wrapper.get('main h2').text()).toBe('Lire Vue')
      patchResponse.mockImplementation(() =>
        Promise.resolve(Response.json({ ...card, title: 'Vue 3' })),
      )
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(2)
      expect(wrapper.get('main h2').text()).toBe('Vue 3')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
    },
  )

  it('expire la session sur le 401 du PATCH', async () => {
    const { wrapper, router, session } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Vue 3')
    patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 401 })))
    await form.trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    expect(session.token).toBeNull()
    expect(wrapper.text()).toMatch(/session.*expiré/i)
    expect(wrapper.text()).not.toContain('Documentation Vue')
  })

  it.each([
    [403, false],
    [404, false],
    [403, true],
    [404, true],
  ] as const)(
    'signale prudemment le refus %s avec déplacement %s lorsque les ressources restent accessibles',
    async (status, moving) => {
      const { wrapper } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Brouillon conservé')
      if (moving) await form.get('#edit-card-list').setValue(targetId)
      patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status })))
      await form.trigger('submit')
      await flushPromises()
      expect(reads(`/api/cards/${cardId}`)).toHaveLength(2)
      expect(reads('/api/lists')).toHaveLength(2)
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe(
        'Brouillon conservé',
      )
      expect(form.get('[role="alert"]').text()).toMatch(/modification.*refusée/i)
      expect(form.get('[role="alert"]').text()).not.toMatch(
        /destination.*(?:inaccessible|existe plus)/i,
      )
      expect(button(form, 'Enregistrer').attributes('disabled')).toBeUndefined()
      expect(patchRequests()).toHaveLength(1)
    },
  )

  it.each([403, 404])(
    'resynchronise une destination disparue après %s sans écraser les champs saisis',
    async (status) => {
      const { wrapper, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Brouillon conservé')
      await form.get('#edit-card-description').setValue('Texte conservé')
      await form.get('#edit-card-list').setValue(targetId)
      await form.get('#edit-card-position').setValue('0')
      patchResponse.mockImplementation(() =>
        Promise.resolve(Response.json({ message: 'Accès privé' }, { status })),
      )
      cardResponse.mockImplementation(() =>
        Promise.resolve(Response.json({ ...card, title: 'Titre concurrent', position: 12 })),
      )
      listResponse.mockImplementation(() => Promise.resolve(Response.json([lists[0]])))
      await form.trigger('submit')
      await flushPromises()
      expect(reads(`/api/cards/${cardId}`)).toHaveLength(2)
      expect(reads('/api/lists')).toHaveLength(2)
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe(
        'Brouillon conservé',
      )
      expect(form.get<HTMLTextAreaElement>('#edit-card-description').element.value).toBe(
        'Texte conservé',
      )
      expect(form.get<HTMLInputElement>('#edit-card-position').element.value).toBe('0')
      expect(form.get<HTMLSelectElement>('#edit-card-list').element.value).toBe(targetId)
      const unavailable = form.get(`option[value="${targetId}"]`)
      expect(unavailable.attributes('disabled')).toBeDefined()
      expect(
        form.findAll('option:not([disabled])').map((item) => item.attributes('value')),
      ).toEqual([sourceId])
      expect(form.get('[role="alert"]').text()).toMatch(
        /destination|liste.*inaccessible|liste.*disponible/i,
      )
      expect(wrapper.text()).not.toContain('Accès privé')
      expect(patchRequests()).toHaveLength(1)
      expect(session.token).toBe('token-alice')
      await form.get('#edit-card-list').setValue(sourceId)
      patchResponse.mockImplementation(() =>
        Promise.resolve(Response.json({ ...card, title: 'Brouillon conservé' })),
      )
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(2)
      expect(JSON.parse(String(patchRequests()[1]![1]?.body))).toEqual({
        title: 'Brouillon conservé',
        description: 'Texte conservé',
        position: 0,
      })
      expect(wrapper.get('main h2').text()).toBe('Brouillon conservé')
    },
  )

  it.each([403, 404])(
    'bloque la sauvegarde si la carte source est devenue inaccessible après %s',
    async (status) => {
      const { wrapper, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Brouillon conservé')
      await form.get('#edit-card-list').setValue(targetId)
      patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status })))
      cardResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status })))
      await form.trigger('submit')
      await flushPromises()
      expect(reads(`/api/cards/${cardId}`)).toHaveLength(2)
      expect(wrapper.find('main form').exists()).toBe(true)
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe(
        'Brouillon conservé',
      )
      expect(form.get('[role="alert"]').text()).toMatch(/carte.*inaccessible|carte.*existe plus/i)
      expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined()
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(1)
      expect(session.token).toBe('token-alice')
      expect(returnLink(wrapper).attributes('href')).toBe('/kanban')
      await button(form, 'Annuler').trigger('click')
      await flushPromises()
      expect(wrapper.find('main form').exists()).toBe(false)
      expect(wrapper.get('main [role="alert"]').text()).toMatch(/inaccessible|existe plus/i)
      expect(document.activeElement).toBe(returnLink(wrapper).element)
    },
  )

  it('bloque la sauvegarde lorsque la liste source disparaît pendant la resynchronisation', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Brouillon conservé')
    await form.get('#edit-card-list').setValue(targetId)
    patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 404 })))
    listResponse.mockImplementation(() => Promise.resolve(Response.json([lists[1]])))
    await form.trigger('submit')
    await flushPromises()
    expect(reads(`/api/cards/${cardId}`)).toHaveLength(2)
    expect(reads('/api/lists')).toHaveLength(2)
    expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe('Brouillon conservé')
    expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(form.get('[role="alert"]').text()).toMatch(/source.*inaccessible|source.*existe plus/i)
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
  })

  it('garde la sauvegarde bloquée tant que la destination n’a pas été resynchronisée', async () => {
    const { wrapper } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Brouillon conservé')
    await form.get('#edit-card-list').setValue(targetId)
    patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 404 })))
    const pending = deferredResponse()
    listResponse.mockReturnValue(pending.promise)
    await form.trigger('submit')
    await flushPromises()
    expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await form.trigger('submit')
    await flushPromises()
    expect(patchRequests()).toHaveLength(1)
    pending.resolve(Response.json([lists[0]]))
    await flushPromises()
    expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe('Brouillon conservé')
    expect(form.get(`option[value="${targetId}"]`).attributes('disabled')).toBeDefined()
  })

  it.each(['card', 'lists'] as const)(
    'expire la session si la resynchronisation %s après le PATCH reçoit un 401',
    async (endpoint) => {
      const { wrapper, router, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Brouillon')
      patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 404 })))
      const responder = endpoint === 'card' ? cardResponse : listResponse
      responder.mockImplementation(() => Promise.resolve(Response.json({}, { status: 401 })))
      await form.trigger('submit')
      await flushPromises()
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
      expect(session.token).toBeNull()
      expect(wrapper.text()).toMatch(/session.*expiré/i)
      expect(wrapper.find('#edit-card-title').exists()).toBe(false)
    },
  )

  it('ignore le 401 tardif de la resynchronisation après navigation vers une autre carte', async () => {
    const { wrapper, router, session } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-title').setValue('Brouillon')
    patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 404 })))
    const pending = deferredResponse()
    listResponse.mockReturnValueOnce(pending.promise)
    await form.trigger('submit')
    await flushPromises()
    const signal = reads('/api/lists')[1]![1]?.signal
    const nextId = '77777777-7777-4777-8777-777777777777'
    cardResponse.mockImplementation((id) =>
      Promise.resolve(Response.json({ ...card, id, title: 'Carte B' })),
    )
    await router.push(`/cartes/${nextId}`)
    await flushPromises()
    expect(signal?.aborted).toBe(true)
    pending.resolve(Response.json({}, { status: 401 }))
    await flushPromises()
    expect(wrapper.get('main h2').text()).toBe('Carte B')
    expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
    expect(session.token).toBe('token-alice')
    expect(router.currentRoute.value.path).toBe(`/cartes/${nextId}`)
  })

  it.each(['card', 'lists'] as const)(
    'permet une actualisation explicite après une erreur temporaire de %s sans perdre le brouillon',
    async (endpoint) => {
      const { wrapper } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Brouillon conservé')
      await form.get('#edit-card-list').setValue(targetId)
      patchResponse.mockImplementation(() => Promise.resolve(Response.json({}, { status: 404 })))
      const responder = endpoint === 'card' ? cardResponse : listResponse
      responder.mockImplementation(() => Promise.resolve(Response.json({}, { status: 503 })))
      await form.trigger('submit')
      await flushPromises()
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe(
        'Brouillon conservé',
      )
      expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined()
      expect(form.get('[role="alert"]').text()).toMatch(/actualiser/i)
      expect(patchRequests()).toHaveLength(1)
      const pending = deferredResponse()
      cardResponse.mockImplementation(() => Promise.resolve(Response.json(card)))
      listResponse.mockReturnValue(pending.promise)
      const retry = button(form, 'Actualiser les données')
      await retry.trigger('click')
      await retry.trigger('click')
      await flushPromises()
      expect(reads(`/api/cards/${cardId}`)).toHaveLength(3)
      expect(reads('/api/lists')).toHaveLength(3)
      expect(patchRequests()).toHaveLength(1)
      pending.resolve(Response.json(lists))
      await flushPromises()
      expect(form.get<HTMLInputElement>('#edit-card-title').element.value).toBe(
        'Brouillon conservé',
      )
      expect(form.get<HTMLSelectElement>('#edit-card-list').element.value).toBe(targetId)
      expect(button(form, 'Enregistrer').attributes('disabled')).toBeUndefined()
      patchResponse.mockImplementation(() =>
        Promise.resolve(
          Response.json({
            ...card,
            title: 'Brouillon conservé',
            listId: targetId,
          }),
        ),
      )
      await form.trigger('submit')
      await flushPromises()
      expect(patchRequests()).toHaveLength(2)
      expect(JSON.parse(String(patchRequests()[1]![1]?.body))).toEqual({
        title: 'Brouillon conservé',
        listId: targetId,
      })
      expect(wrapper.get('main h2').text()).toBe('Brouillon conservé')
      expect(wrapper.get('main dd').text()).toBe('En cours')
    },
  )

  it('recharge les deux colonnes au retour et respecte l’ordre serveur avec positions égales', async () => {
    const { wrapper, router } = await mountDetail()
    const form = await openEditor(wrapper)
    await form.get('#edit-card-list').setValue(targetId)
    patchResponse.mockImplementation(() =>
      Promise.resolve(Response.json({ ...card, listId: targetId })),
    )
    await form.trigger('submit')
    await flushPromises()
    boardResponse.mockImplementation((id) =>
      Promise.resolve(
        Response.json(
          id === sourceId
            ? [{ ...card, id: '44444444-4444-4444-8444-444444444444', title: 'Restante' }]
            : [
                {
                  ...card,
                  id: '55555555-5555-4555-8555-555555555555',
                  title: 'Avant',
                  listId: targetId,
                },
                { ...card, listId: targetId },
                {
                  ...card,
                  id: '66666666-6666-4666-8666-666666666666',
                  title: 'Après',
                  listId: targetId,
                },
              ],
        ),
      ),
    )
    await returnLink(wrapper).trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/kanban'))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(reads(`/api/lists/${sourceId}/cards`)).toHaveLength(1)
    expect(reads(`/api/lists/${targetId}/cards`)).toHaveLength(1)
    expect(
      wrapper
        .get(`[aria-labelledby="list-${sourceId}-title"]`)
        .findAll('h3 a')
        .map((item) => item.text()),
    ).toEqual(['Restante'])
    expect(
      wrapper
        .get(`[aria-labelledby="list-${targetId}-title"]`)
        .findAll('h3 a')
        .map((item) => item.text()),
    ).toEqual(['Avant', 'Lire Vue', 'Après'])
    expect(wrapper.findAll(`a[href="/cartes/${cardId}"]`)).toHaveLength(1)
  })

  it.each([200, 401, 403, 404, 500, null])(
    'ignore la réponse PATCH tardive %s après navigation de A vers B',
    async (status) => {
      const { wrapper, router, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Vue 3')
      const pending = deferredResponse()
      patchResponse.mockReturnValue(pending.promise)
      await form.trigger('submit')
      await flushPromises()
      const signal = patchRequests()[0]![1]?.signal
      expect(signal).toBeInstanceOf(AbortSignal)
      const nextId = '77777777-7777-4777-8777-777777777777'
      cardResponse.mockImplementation((id) =>
        Promise.resolve(Response.json({ ...card, id, title: 'Carte B' })),
      )
      await router.push(`/cartes/${nextId}`)
      await flushPromises()
      expect(signal?.aborted).toBe(true)
      settle(pending, status)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe(`/cartes/${nextId}`)
      expect(wrapper.get('main h2').text()).toBe('Carte B')
      expect(wrapper.find('main form').exists()).toBe(false)
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-alice')
      expect(reads('/api/lists')).toHaveLength(2)
    },
  )

  it.each([200, 401, 404, 500, null])(
    'ignore la réponse PATCH tardive %s après le retour au tableau',
    async (status) => {
      const { wrapper, router, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Vue 3')
      const pending = deferredResponse()
      patchResponse.mockReturnValue(pending.promise)
      await form.trigger('submit')
      await flushPromises()
      const signal = patchRequests()[0]![1]?.signal
      await returnLink(wrapper).trigger('click')
      await flushPromises()
      expect(signal?.aborted).toBe(true)
      settle(pending, status)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/kanban')
      expect(wrapper.get('main h1').text()).toBe('Tableau Kanban')
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Ancienne modification')
      expect(session.token).toBe('token-alice')
    },
  )

  it.each([200, 401, 404, 500, null])(
    'ignore la réponse PATCH tardive %s du compte précédent',
    async (status) => {
      const { wrapper, router, session } = await mountDetail()
      const form = await openEditor(wrapper)
      await form.get('#edit-card-title').setValue('Vue 3')
      const pending = deferredResponse()
      patchResponse.mockReturnValue(pending.promise)
      await form.trigger('submit')
      await flushPromises()
      const signal = patchRequests()[0]![1]?.signal
      cardResponse.mockImplementation(() =>
        Promise.resolve(Response.json({ ...card, title: 'Carte de Bob' })),
      )
      session.start('token-bob')
      await flushPromises()
      expect(signal?.aborted).toBe(true)
      settle(pending, status)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe(`/cartes/${cardId}`)
      expect(wrapper.get('main h2').text()).toBe('Carte de Bob')
      expect(wrapper.find('main form').exists()).toBe(false)
      expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
      expect(session.token).toBe('token-bob')
    },
  )
})
