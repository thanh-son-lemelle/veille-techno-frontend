import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import LoginView from '@/views/LoginView.vue'
import appRouter from '@/router'

enableAutoUnmount(afterEach)

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', '/api')
  fetchMock.mockResolvedValue(Response.json({ accessToken: 'test-token' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

async function mountLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: appRouter.options.routes,
  })
  await router.push('/connexion')
  await router.isReady()
  const onAuthenticated = vi.fn<(token: string) => void>()
  const wrapper = mount(LoginView, {
    props: { onAuthenticated },
    attachTo: document.body,
    global: { plugins: [router, ui] },
  })
  await flushPromises()
  return { wrapper, router, onAuthenticated }
}

type LoginWrapper = Awaited<ReturnType<typeof mountLogin>>['wrapper']

async function fillCredentials(wrapper: LoginWrapper, email: string, password: string) {
  await wrapper.get('input[name="email"]').setValue(email)
  await wrapper.get('input[name="password"]').setValue(password)
}

describe('Connexion', () => {
  it('ne signale pas les champs en erreur avant la première soumission', async () => {
    const { wrapper } = await mountLogin()
    for (const input of wrapper.findAll('input')) {
      expect(input.attributes('aria-invalid')).not.toBe('true')
    }
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    ['', 'secret', 'email'],
    ['invalide', 'secret', 'email'],
    ['alice@', 'secret', 'email'],
    ['alice@example..com', 'secret', 'email'],
    ['alice@example,com.org', 'secret', 'email'],
    ['alice@example.test', '', 'password'],
  ])(
    'bloque les données invalides (%s, %s) et indique le champ à corriger',
    async (email, password, field) => {
      const { wrapper, onAuthenticated } = await mountLogin()
      await fillCredentials(wrapper, email, password)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(onAuthenticated).not.toHaveBeenCalled()
      const input = wrapper.get(`input[name="${field}"]`)
      expect(input.attributes('aria-invalid')).toBe('true')
      const errorId = input.attributes('aria-describedby')
      expect(document.getElementById(errorId!)?.textContent).toBeTruthy()
      expect(document.activeElement).toBe(input.element)
    },
  )

  it.each(['x', 'a'.repeat(25), '  secret  '])(
    'transmet le token au callback sans imposer les bornes de l’inscription (%s)',
    async (password) => {
      const { wrapper, router, onAuthenticated } = await mountLogin()
      await fillCredentials(wrapper, 'alice@example.test', password)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/auth/login', {
        method: 'POST',
        headers: expect.any(Headers),
        signal: expect.any(AbortSignal),
        body: JSON.stringify({ email: 'alice@example.test', password }),
      })
      expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith('test-token')
      expect(wrapper.get('[role="status"]').text()).toContain('Identifiants vérifiés')
      expect(wrapper.get<HTMLInputElement>('input[name="password"]').element.value).toBe('')
      expect(router.currentRoute.value.path).toBe('/connexion')
    },
  )

  it('ne persiste ni ne journalise les identifiants ou le token', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log'),
    )
    const { wrapper } = await mountLogin()
    await fillCredentials(wrapper, 'alice@example.test', 'secret-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(setItem).not.toHaveBeenCalled()
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    expect(wrapper.html()).not.toContain('test-token')
    expect(wrapper.html()).not.toContain('secret-password')
  })

  it('empêche les requêtes concurrentes et signale le chargement', async () => {
    let resolveResponse!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    const { wrapper, onAuthenticated } = await mountLogin()
    await fillCredentials(wrapper, 'alice@example.test', 'secret')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[name="password"]').attributes('disabled')).toBeDefined()
    expect(onAuthenticated).not.toHaveBeenCalled()

    resolveResponse(Response.json({ accessToken: 'test-token' }))
    await flushPromises()
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith('test-token')
    expect(wrapper.get('form').attributes('aria-busy')).toBe('false')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it.each(['Unknown email', 'Wrong password'])(
    'présente le même message pour un 401 (%s), sans redirection',
    async (message) => {
      fetchMock.mockResolvedValueOnce(Response.json({ message }, { status: 401 }))
      const { wrapper, router, onAuthenticated } = await mountLogin()
      await fillCredentials(wrapper, 'alice@example.test', 'secret')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toBe('Identifiants invalides')
      expect(onAuthenticated).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/connexion')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    [400, 'Vérifiez les informations saisies'],
    [500, 'Le serveur est indisponible'],
    [503, 'Le serveur est indisponible'],
    [null, 'Impossible de joindre le serveur'],
  ])('permet de réessayer après une erreur %s sans émettre de token', async (status, message) => {
    if (status === null) fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else
      fetchMock.mockResolvedValueOnce(
        Response.json({ message: 'private server detail' }, { status }),
      )
    const { wrapper, onAuthenticated } = await mountLogin()
    await fillCredentials(wrapper, 'alice@example.test', 'secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain(message)
    expect(wrapper.text()).not.toContain('private server detail')
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get<HTMLInputElement>('input[name="password"]').element.value).toBe('')
    expect(wrapper.get<HTMLInputElement>('input[name="email"]').element.value).toBe(
      'alice@example.test',
    )

    await wrapper.get('input[name="password"]').setValue('retry-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith('test-token')
  })
})
