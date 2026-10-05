import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '..'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ id: 'resource-id' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('public authentication endpoints', () => {
  it.each(['login', 'register'] as const)(
    '%s never sends a token or expires the session',
    async (operation) => {
      fetchMock.mockResolvedValue(
        Response.json({ message: 'Identifiants invalides.' }, { status: 401 }),
      )
      const onUnauthorized = vi.fn<() => void>()
      const api = createApiClient({ getToken: () => 'secret-token', onUnauthorized })
      const credentials = { email: 'user@example.test', password: 'Password123!' }
      const input = operation === 'register' ? { ...credentials, name: 'Alice' } : credentials

      const result =
        operation === 'register'
          ? api.auth.register({ ...credentials, name: 'Alice' })
          : api.auth.login(credentials)
      await expect(result).rejects.toMatchObject({ status: 401 })

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/auth/${operation}`, {
        method: 'POST',
        headers: expect.any(Headers),
        body: JSON.stringify(input),
        signal: expect.any(AbortSignal),
      })
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
      expect(onUnauthorized).not.toHaveBeenCalled()
    },
  )
})

describe('resource endpoints', () => {
  it('cancels card editing and ignores a late 401 after leaving the detail', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
    const controller = new AbortController()
    const onUnauthorized = vi.fn<() => void>()
    const api = createApiClient({ onUnauthorized })
    const result = api.cards
      .update('card-id', { description: '', position: 0 }, controller.signal)
      .catch((error: unknown) => error)

    controller.abort()
    resolve(Response.json({ message: 'Session expirée' }, { status: 401 }))

    expect(await result).toBe(controller.signal.reason)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it.each(['card detail', 'lists'] as const)(
    'allows cancelling %s loading without expiring the session on a late 401',
    async (resource) => {
      let resolve!: (response: Response) => void
      fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
      const controller = new AbortController()
      const onUnauthorized = vi.fn<() => void>()
      const api = createApiClient({ onUnauthorized })
      const result = (
        resource === 'card detail'
          ? api.cards.get('card-id', controller.signal)
          : api.lists.getAll(controller.signal)
      ).catch((error: unknown) => error)

      controller.abort()
      resolve(Response.json({ message: 'Session expirée' }, { status: 401 }))

      expect(await result).toBe(controller.signal.reason)
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(onUnauthorized).not.toHaveBeenCalled()
    },
  )

  it('allows cancelling card creation without expiring the session on a late 401', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
    const controller = new AbortController()
    const onUnauthorized = vi.fn<() => void>()
    const result = createApiClient({ onUnauthorized })
      .cards.create('list-id', { title: 'Lire', description: '' }, controller.signal)
      .catch((error: unknown) => error)

    controller.abort()
    resolve(Response.json({ message: 'Session expirée' }, { status: 401 }))

    expect(await result).toBe(controller.signal.reason)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('allows cancelling card loading without expiring the session on a late 401', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
    const controller = new AbortController()
    const onUnauthorized = vi.fn<() => void>()
    const result = createApiClient({ onUnauthorized })
      .cards.getAll('list-id', controller.signal)
      .catch((error: unknown) => error)

    controller.abort()
    resolve(Response.json({ message: 'Session expirée' }, { status: 401 }))

    expect(await result).toBe(controller.signal.reason)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('uses the implemented routes, methods, and payloads with the current token', async () => {
    const api = createApiClient({ getToken: () => 'current-token' })

    await api.users.update('user-id', { name: 'Alice' })
    await api.lists.getAll()
    await api.lists.create({ title: 'À faire' })
    await api.lists.update('list-id', { position: 2 })
    await api.lists.remove('list-id')
    await api.cards.getAll('list-id')
    await api.cards.create('list-id', { title: 'Lire', description: '' })
    await api.cards.get('card-id')
    await api.cards.update('card-id', { listId: 'other-list-id' })
    await api.cards.remove('card-id')

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['/api/users/user-id', 'PATCH', '{"name":"Alice"}'],
      ['/api/lists', 'GET', undefined],
      ['/api/lists', 'POST', '{"title":"À faire"}'],
      ['/api/lists/list-id', 'PATCH', '{"position":2}'],
      ['/api/lists/list-id', 'DELETE', undefined],
      ['/api/lists/list-id/cards', 'GET', undefined],
      ['/api/lists/list-id/cards', 'POST', '{"title":"Lire","description":""}'],
      ['/api/cards/card-id', 'GET', undefined],
      ['/api/cards/card-id', 'PATCH', '{"listId":"other-list-id"}'],
      ['/api/cards/card-id', 'DELETE', undefined],
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer current-token')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })
})
