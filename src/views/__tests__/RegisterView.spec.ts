import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import RegisterView from '../RegisterView.vue'

enableAutoUnmount(afterEach)

const fetchMock = vi.fn<typeof fetch>()
const user = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'user',
  createdAt: '2026-10-04T12:00:00.000Z',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function mountForm() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inscription', component: RegisterView },
      { path: '/connexion', component: { template: '<h1>Connexion</h1>' } },
    ],
  })
  await router.push('/inscription')
  const wrapper = mount(RegisterView, { global: { plugins: [router, ui] } })
  return wrapper
}

async function fillForm(
  wrapper: Awaited<ReturnType<typeof mountForm>>,
  values = { name: 'Alice', email: 'alice@example.com', password: 'Secret123!' },
) {
  await wrapper.get('input[name="name"]').setValue(values.name)
  await wrapper.get('input[name="email"]').setValue(values.email)
  await wrapper.get('input[name="password"]').setValue(values.password)
  await wrapper.get('input[name="passwordConfirmation"]').setValue(values.password)
}

describe('Inscription', () => {
  it('actualise les erreurs de saisie à la sortie du champ sans soumettre', async () => {
    const wrapper = await mountForm()
    const email = wrapper.get('input[name="email"]')
    await email.setValue('invalide')
    await email.trigger('blur')
    await flushPromises()
    expect(email.attributes('aria-invalid')).toBe('true')

    await email.setValue('alice@example.com')
    await email.trigger('blur')
    await flushPromises()
    expect(email.attributes('aria-invalid')).toBe('false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revérifie la confirmation à la sortie du mot de passe puis de la confirmation', async () => {
    const wrapper = await mountForm()
    await fillForm(wrapper)
    const password = wrapper.get('input[name="password"]')
    const confirmation = wrapper.get('input[name="passwordConfirmation"]')
    await confirmation.trigger('blur')
    await flushPromises()
    expect(confirmation.attributes('aria-invalid')).toBe('false')

    await password.setValue('Nouveau123!')
    await password.trigger('blur')
    await flushPromises()
    expect(confirmation.attributes('aria-invalid')).toBe('true')

    await confirmation.setValue('Nouveau123!')
    await confirmation.trigger('blur')
    await flushPromises()
    expect(confirmation.attributes('aria-invalid')).toBe('false')

    await password.setValue('Secret123!')
    await password.trigger('blur')
    await flushPromises()
    expect(confirmation.attributes('aria-invalid')).toBe('true')
    await password.setValue('Nouveau123!')
    await password.trigger('blur')
    await flushPromises()
    expect(confirmation.attributes('aria-invalid')).toBe('false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attend la saisie de la confirmation avant de signaler une différence', async () => {
    const wrapper = await mountForm()
    await wrapper.get('input[name="password"]').setValue('Secret123!')
    await wrapper.get('input[name="password"]').trigger('blur')
    await flushPromises()

    expect(wrapper.get('input[name="passwordConfirmation"]').attributes('aria-invalid')).toBe(
      'false',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['', 'Different123!', ' Secret123!', 'Secret123! '])(
    'bloque une confirmation différente (%j) puis permet de la corriger',
    async (confirmation) => {
      fetchMock.mockResolvedValue(Response.json(user, { status: 201 }))
      const wrapper = await mountForm()
      await fillForm(wrapper)
      const input = wrapper.get('input[name="passwordConfirmation"]')
      await input.setValue(confirmation)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(input.attributes('type')).toBe('password')
      expect(input.attributes('aria-invalid')).toBe('true')
      expect(wrapper.text()).toContain('Les mots de passe ne correspondent pas.')
      expect(fetchMock).not.toHaveBeenCalled()

      await input.setValue('Secret123!')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
      expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'Secret123!',
      })
    },
  )

  it('revérifie la confirmation lorsque le mot de passe est modifié', async () => {
    const wrapper = await mountForm()
    await fillForm(wrapper)
    await wrapper.get('input[name="password"]').setValue('Nouveau123!')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('input[name="passwordConfirmation"]').attributes('aria-invalid')).toBe(
      'true',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { name: '   ', email: 'alice@example.com', password: 'Secret123!', field: 'name' },
    { name: 'Alice', email: 'invalide', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: 'alice@exemple', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: 'alice@example..com', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: 'alice..test@example.com', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: '.alice@example.com', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: '', password: 'Secret123!', field: 'email' },
    { name: 'Alice', email: 'alice@example.com', password: '1234567', field: 'password' },
    {
      name: 'Alice',
      email: 'alice@example.com',
      password: '1234567890123456789012345',
      field: 'password',
    },
  ])('signale $field invalide sans requête ($password)', async ({ field, ...values }) => {
    const wrapper = await mountForm()
    await fillForm(wrapper, values)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const input = wrapper.get(`input[name="${field}"]`)
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['12345678', '123456789012345678901234'])(
    'accepte la limite de %s et confirme le compte sans JWT',
    async (password) => {
      fetchMock.mockResolvedValue(Response.json(user, { status: 201 }))
      const wrapper = await mountForm()
      await fillForm(wrapper, { name: ' Alice ', email: ' alice@example.com ', password })
      const formState = wrapper.getComponent({ ref: 'form' }).props('state') as {
        password: string
        passwordConfirmation: string
      }
      expect(formState.password).toBe(password)
      expect(formState.passwordConfirmation).toBe(password)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/auth/register')
      expect(options?.method).toBe('POST')
      expect(JSON.parse(options?.body as string)).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
        password,
      })
      expect(new Headers(options?.headers).has('Authorization')).toBe(false)
      expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
      expect(wrapper.get('a[href="/connexion"]').text()).toContain('connexion')
      expect(wrapper.find('input[type="password"]').exists()).toBe(false)
      expect(wrapper.find('form').exists()).toBe(false)
      expect(formState.password).toBe('')
      expect(formState.passwordConfirmation).toBe('')
    },
  )

  it('permet de corriger une validation locale puis de soumettre', async () => {
    fetchMock.mockResolvedValue(Response.json(user, { status: 201 }))
    const wrapper = await mountForm()
    await wrapper.get('form').trigger('submit')
    expect(fetchMock).not.toHaveBeenCalled()

    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
  })

  it.each([
    { status: 400, message: ['email: Adresse email invalide'] },
    { status: 409, message: 'Cette adresse email est déjà utilisée.' },
    { status: 500, message: 'Service temporairement indisponible.' },
  ])(
    'affiche une erreur $status et autorise une correction puis un nouvel envoi',
    async (error) => {
      fetchMock.mockResolvedValueOnce(Response.json(error, { status: error.status }))
      const wrapper = await mountForm()
      await fillForm(wrapper)
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toContain(
        Array.isArray(error.message) ? error.message[0] : error.message,
      )
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
      expect(wrapper.get<HTMLInputElement>('input[name="password"]').element.value).toBe(
        'Secret123!',
      )
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()

      fetchMock.mockResolvedValueOnce(Response.json(user, { status: 201 }))
      await wrapper.get('input[name="email"]').setValue('corrige@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    },
  )

  it('affiche une panne réseau et permet de réessayer sans faux succès', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const wrapper = await mountForm()
    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Impossible de joindre le serveur')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce(Response.json(user, { status: 201 }))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
  })

  it('remplace une erreur API par les erreurs de saisie lors du nouvel envoi', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ message: 'Cette adresse email est déjà utilisée.' }, { status: 409 }),
    )
    const wrapper = await mountForm()
    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('déjà utilisée')

    await wrapper.get('input[name="email"]').setValue('invalide')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('input[name="email"]').attributes('aria-invalid')).toBe('true')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('n’envoie pas de requête si la page est quittée pendant la validation', async () => {
    const wrapper = await mountForm()
    await fillForm(wrapper)
    const submission = wrapper.get('form').trigger('submit')
    wrapper.unmount()
    await submission
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ne lance qu’une requête tant que la première est en cours', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValue(new Promise((done) => (resolve = done)))
    const wrapper = await mountForm()
    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')

    resolve(Response.json(user, { status: 201 }))
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('compte a été créé')
  })

  it.each([201, 409])(
    'efface le mot de passe au départ même si la réponse %s arrive après',
    async (status) => {
      let resolve!: (response: Response) => void
      fetchMock.mockReturnValue(new Promise((done) => (resolve = done)))
      const wrapper = await mountForm()
      await fillForm(wrapper)
      await wrapper.get('form').trigger('submit')
      const formState = wrapper.getComponent({ ref: 'form' }).props('state') as {
        password: string
        passwordConfirmation: string
      }
      expect(formState.password).toBe('Secret123!')
      expect(formState.passwordConfirmation).toBe('Secret123!')
      wrapper.unmount()
      expect(formState.password).toBe('')
      expect(formState.passwordConfirmation).toBe('')

      resolve(Response.json(status === 201 ? user : { message: 'Email utilisé' }, { status }))
      await flushPromises()
      expect(formState.password).toBe('')
      expect(formState.passwordConfirmation).toBe('')
      const fresh = await mountForm()

      expect(fresh.get<HTMLInputElement>('input[name="password"]').element.value).toBe('')
      expect(fresh.get<HTMLInputElement>('input[name="passwordConfirmation"]').element.value).toBe(
        '',
      )
      expect(fresh.find('[role="status"]').exists()).toBe(false)
      expect(fresh.find('[role="alert"]').exists()).toBe(false)
    },
  )
})
