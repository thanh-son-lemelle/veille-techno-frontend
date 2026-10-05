import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import KanbanView from '@/views/KanbanView.vue'
import { createAppRouter } from '@/router'
import { useSessionStore } from '@/stores/session'
import type { User } from '@/api'

enableAutoUnmount(afterEach)

const fetchMock = vi.fn<typeof fetch>()
const profile: User = {
  id: 'alice',
  email: 'alice@example.test',
  name: 'Alice',
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
}

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

async function mountAt(path: string, token?: string) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  if (token) session.start(token)
  const router = createAppRouter(pinia, createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia, router, ui] } })
  await flushPromises()
  return { wrapper, router, session }
}

type AppWrapper = Awaited<ReturnType<typeof mountAt>>['wrapper']

async function submitLogin(wrapper: AppWrapper) {
  await wrapper.get('input[name="email"]').setValue('alice@example.test')
  await wrapper.get('input[name="password"]').setValue('secret')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Application', () => {
  it.each(['/', '/kanban'])('redirige %s vers la connexion sans session', async (path) => {
    const { wrapper, router } = await mountAt(path)

    expect(router.currentRoute.value.path).toBe('/connexion')
    expect(wrapper.get('h1').text()).toBe('Connexion')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Connexion')
    expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual([
      'Kanban',
      'Connexion',
      'Inscription',
    ])
  })

  it('affiche la page demandée et indique le lien actif après navigation', async () => {
    const { wrapper, router } = await mountAt('/connexion')
    expect(wrapper.get('h1').text()).toBe('Connexion')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Connexion')

    await router.push('/inscription')
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Inscription')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Inscription')
  })

  it('conserve la navigation et propose un retour pour une adresse inconnue', async () => {
    const { wrapper } = await mountAt('/page-absente')
    expect(wrapper.get('h1').text()).toBe('Page introuvable')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Navigation principale')
    expect(wrapper.get('main a').attributes('href')).toBe('/kanban')
  })

  it('ouvre le Kanban après connexion et ignore une redirection externe', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ accessToken: 'token-alice' }))
    const { wrapper, router, session } = await mountAt('/connexion?redirect=https://example.org')

    await submitLogin(wrapper)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/kanban'))
    await flushPromises()

    expect(session.token).toBe('token-alice')
    expect(session.isAuthenticated).toBe(true)
    expect(wrapper.get('h1').text()).toBe('Tableau Kanban')
    expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual(['Kanban'])
    expect(wrapper.get('nav button').text()).toBe('Se déconnecter')
  })

  it.each(['/connexion', '/inscription'])(
    'redirige %s vers le Kanban quand une session est ouverte',
    async (path) => {
      const { wrapper, router } = await mountAt(path, 'token-alice')
      expect(router.currentRoute.value.path).toBe('/kanban')
      expect(wrapper.get('h1').text()).toBe('Tableau Kanban')
    },
  )

  it('purge le profil à la déconnexion et bloque le retour vers le Kanban', async () => {
    const { wrapper, router, session } = await mountAt('/connexion')
    session.start('token-alice')
    session.profile = profile
    await router.push('/kanban')
    await flushPromises()
    const version = session.version

    await wrapper.get('nav button').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    await flushPromises()

    expect(session.token).toBeNull()
    expect(session.profile).toBeNull()
    expect(session.version).toBe(version + 1)
    expect(session.expired).toBe(false)
    expect(wrapper.find('#kanban-title').exists()).toBe(false)

    router.back()
    await flushPromises()
    await router.push('/kanban')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/connexion')
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
  })

  it('expire une seule fois pour deux 401 protégés et purge le profil', async () => {
    const { wrapper, router, session } = await mountAt('/kanban', 'token-alice')
    const replace = vi.spyOn(router, 'replace')
    session.profile = profile
    const version = session.version
    const first = deferredResponse()
    const second = deferredResponse()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const requests = Promise.allSettled([session.api.lists.getAll(), session.api.lists.getAll()])

    first.resolve(Response.json({ message: 'Expired token' }, { status: 401 }))
    second.resolve(Response.json({ message: 'Expired token' }, { status: 401 }))
    const results = await requests
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    await flushPromises()

    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(session.token).toBeNull()
    expect(session.profile).toBeNull()
    expect(session.version).toBe(version + 1)
    expect(session.expired).toBe(true)
    expect(replace).toHaveBeenCalledExactlyOnceWith({ name: 'connexion' })
    expect(wrapper.get('[role="alert"]').text()).toMatch(/session.*expiré/i)
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
  })

  it('conserve la session pour un 403 protégé et un 401 de connexion', async () => {
    const { router, session } = await mountAt('/kanban', 'token-alice')
    session.profile = profile
    const version = session.version
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Forbidden' }, { status: 403 }))
    await expect(session.api.lists.getAll()).rejects.toMatchObject({ status: 403 })
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Wrong password' }, { status: 401 }))
    await expect(
      session.api.auth.login({ email: 'alice@example.test', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401 })
    await flushPromises()

    expect(session.token).toBe('token-alice')
    expect(session.profile).toEqual(profile)
    expect(session.version).toBe(version)
    expect(session.expired).toBe(false)
    expect(router.currentRoute.value.path).toBe('/kanban')
  })

  it('ne signale pas une expiration pour un 401 reçu sans session', async () => {
    const { wrapper, router, session } = await mountAt('/connexion')
    const version = session.version
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Unauthorized' }, { status: 401 }))
    await expect(session.api.lists.getAll()).rejects.toMatchObject({ status: 401 })
    await flushPromises()

    expect(session.expired).toBe(false)
    expect(session.version).toBe(version)
    expect(router.currentRoute.value.path).toBe('/connexion')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('perd la session en mémoire lors d’un nouveau démarrage', async () => {
    const first = await mountAt('/kanban', 'token-alice')
    first.session.profile = profile
    first.wrapper.unmount()
    const { wrapper, router, session } = await mountAt('/kanban')

    expect(session.token).toBeNull()
    expect(session.profile).toBeNull()
    expect(router.currentRoute.value.path).toBe('/connexion')
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
  })

  it('rejette les anciennes réponses 200 et 401 après un changement de compte', async () => {
    const { wrapper, router, session } = await mountAt('/kanban', 'token-alice')
    const previousView = wrapper.getComponent(KanbanView).vm
    session.profile = profile
    const first = deferredResponse()
    const second = deferredResponse()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const requests = Promise.allSettled([session.api.lists.getAll(), session.api.lists.getAll()])
    const version = session.version

    session.start('token-bob')
    expect(session.profile).toBeNull()
    expect(session.version).toBe(version + 1)
    first.resolve(
      Response.json([
        {
          id: 'alice-private-list',
          title: 'Veille Alice',
          position: 0,
          ownerId: 'alice',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )
    second.resolve(Response.json({ message: 'Expired token' }, { status: 401 }))
    const results = await requests
    await flushPromises()

    for (const result of results) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: { name: 'SessionChangedError' },
      })
    }
    expect(session.token).toBe('token-bob')
    expect(session.expired).toBe(false)
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(wrapper.getComponent(KanbanView).vm).not.toBe(previousView)
    await session.api.lists.getAll()
    const headers = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-bob')
  })

  it('purge avant pagehide et protège une restauration du cache malgré une redirection retardée', async () => {
    const { wrapper, router, session } = await mountAt('/kanban', 'token-alice')
    session.profile = profile
    const version = session.version
    const replace = router.replace.bind(router)
    let finishFirstRedirect!: () => void
    vi.spyOn(router, 'replace')
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstRedirect = resolve
          }),
      )
      .mockImplementation(replace)

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(session.token).toBeNull()
    expect(session.profile).toBeNull()
    expect(session.version).toBe(version + 1)
    await flushPromises()
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/kanban')

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/connexion'))
    finishFirstRedirect()
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Connexion')
    expect(session.expired).toBe(false)
  })

  it('conserve une session active pendant un pageshow normal', async () => {
    const { wrapper, router, session } = await mountAt('/kanban', 'token-alice')
    session.profile = profile
    const version = session.version

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    await flushPromises()

    expect(session.token).toBe('token-alice')
    expect(session.profile).toEqual(profile)
    expect(session.version).toBe(version)
    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(wrapper.get('h1').text()).toBe('Tableau Kanban')
  })

  it('invalide aussi une connexion en attente lors de pagehide', async () => {
    const response = deferredResponse()
    fetchMock.mockReturnValueOnce(response.promise)
    const { wrapper, router, session } = await mountAt('/connexion')
    await submitLogin(wrapper)
    const version = session.version

    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(session.version).toBe(version + 1)
    response.resolve(Response.json({ accessToken: 'late-token' }))
    await flushPromises()

    expect(session.token).toBeNull()
    expect(router.currentRoute.value.path).toBe('/connexion')
    expect(wrapper.find('#kanban-title').exists()).toBe(false)
  })
})
