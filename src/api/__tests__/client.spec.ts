import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createHttpClient, SessionChangedError } from '../client'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ id: 'list-1' }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('API URLs', () => {
  it.each([
    ['', 'lists', '/api/lists'],
    ['/', '/lists', '/api/lists'],
    ['/api/', '/api/lists', '/api/lists'],
    ['/api/api/', '/api/api/lists', '/api/lists'],
    ['http://localhost:3000', 'lists', 'http://localhost:3000/api/lists'],
    ['http://localhost:3000/api/', '/lists', 'http://localhost:3000/api/lists'],
    ['/backend/api/', '/api/lists', '/backend/api/lists'],
  ])('joins %s and %s with a single API prefix', async (baseUrl, path, expected) => {
    await createHttpClient({ baseUrl }).request(path)

    expect(fetchMock).toHaveBeenCalledWith(expected, expect.any(Object))
  })

  it('uses the configured public URL by default', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/')

    await createHttpClient().request('/lists')

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/lists', expect.any(Object))
  })
})

describe('request headers and bodies', () => {
  it('reads the current token for every protected request', async () => {
    let token: string | null = 'first-token'
    const client = createHttpClient({ getToken: () => token })

    await client.request('/lists')
    token = 'second-token'
    await client.request('/lists')
    token = null
    await client.request('/lists')

    const headers = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers))
    expect(headers[0]?.get('Authorization')).toBe('Bearer first-token')
    expect(headers[1]?.get('Authorization')).toBe('Bearer second-token')
    expect(headers[2]?.has('Authorization')).toBe(false)
    expect(headers[0]?.get('Accept')).toBe('application/json')
    expect(headers[0]?.has('Content-Type')).toBe(false)
  })

  it('sends public requests without reading or leaking the token', async () => {
    const getToken = vi.fn<() => string>(() => 'private-token')
    await createHttpClient({ getToken }).request('/auth/login', { auth: false })

    expect(getToken).not.toHaveBeenCalled()
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(false)
  })

  it('serializes a mutation once and declares its JSON content', async () => {
    await createHttpClient().request('/lists', { method: 'POST', body: { title: 'À faire' } })

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/lists', {
      method: 'POST',
      headers: expect.any(Headers),
      body: '{"title":"À faire"}',
      signal: expect.any(AbortSignal),
    })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe(
      'application/json',
    )
  })
})

describe('request timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  const timeoutMessage =
    'Le serveur met trop de temps à répondre. Vérifiez si l’opération a abouti avant de réessayer.'

  it('aborts pending response headers after 15 seconds without retrying a mutation', async () => {
    let signal: AbortSignal | null | undefined
    fetchMock.mockImplementation((_url, init) => {
      signal = init?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })
    const onUnauthorized = vi.fn<() => void>()
    const client = createHttpClient({ onUnauthorized })
    const result = client
      .request('/lists', { method: 'POST', body: { title: 'À faire' } })
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(14_999)
    expect(signal?.aborted).not.toBe(true)
    await vi.advanceTimersByTimeAsync(1)

    expect(signal?.aborted).toBe(true)
    expect(await result).toMatchObject({
      name: 'ApiError',
      status: null,
      message: timeoutMessage,
      details: timeoutMessage,
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValue(Response.json({ id: 'list-1' }, { status: 201 }))
    await expect(
      client.request('/lists', { method: 'POST', body: { title: 'À faire' } }),
    ).resolves.toEqual({ id: 'list-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([200, 201, 400, 401, 500])(
    'includes a pending JSON body for status %i in the same 15-second deadline',
    async (status) => {
      let signal: AbortSignal | null | undefined
      fetchMock.mockImplementation((_url, init) => {
        signal = init?.signal
        return new Promise((resolve) => {
          setTimeout(() => {
            const body = new ReadableStream({
              start(controller) {
                signal?.addEventListener('abort', () => controller.error(signal?.reason), {
                  once: true,
                })
              },
            })
            resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }))
          }, 10_000)
        })
      })
      const onUnauthorized = vi.fn<() => void>()
      const result = createHttpClient({ onUnauthorized })
        .request('/lists')
        .catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(14_999)
      expect(signal?.aborted).not.toBe(true)
      await vi.advanceTimersByTimeAsync(1)

      expect(signal?.aborted).toBe(true)
      expect(await result).toMatchObject({ status: null, message: timeoutMessage })
      expect(onUnauthorized).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each([
    [200, '{"id":"list-1"}'],
    [201, '{"id":"list-1"}'],
    [204, null],
    [400, '{"message":"Requête refusée"}'],
    [401, '{"message":"Session expirée"}'],
    [500, '<html>upstream failure</html>'],
    [200, 'not json'],
  ])(
    'clears the timeout after a completed response with status %i and body %s',
    async (status, body) => {
      const response = new Response(body, { status })
      fetchMock.mockResolvedValue(response)

      await createHttpClient()
        .request('/lists')
        .catch(() => undefined)

      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    },
  )

  it('clears the timeout after a network error and preserves the network message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(createHttpClient().request('/lists')).rejects.toMatchObject({
      status: null,
      message: 'Impossible de joindre le serveur. Vérifiez votre connexion réseau.',
    })

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })
})

describe('responses', () => {
  it.each([200, 201])('returns the JSON body for status %i', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ id: 'list-1', title: 'À faire' }, { status }))

    await expect(createHttpClient().request('/lists')).resolves.toEqual({
      id: 'list-1',
      title: 'À faire',
    })
  })

  it('accepts a 204 without trying to parse JSON', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      createHttpClient().request<void>('/lists/list-1', { method: 'DELETE' }),
    ).resolves.toBeUndefined()
  })

  it.each([400, 401, 403, 404, 409])(
    'keeps the HTTP status %i and a server message',
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ message: 'Requête refusée' }, { status }))

      await expect(createHttpClient().request('/lists')).rejects.toMatchObject({
        name: 'ApiError',
        status,
        message: 'Requête refusée',
        details: 'Requête refusée',
      })
    },
  )

  it('preserves validation messages as an array and exposes a readable Error.message', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: ['Titre requis', 'Position invalide'] }, { status: 400 }),
    )

    const error = await createHttpClient()
      .request('/lists')
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      details: ['Titre requis', 'Position invalide'],
      message: expect.stringMatching(/Titre requis[\s\S]+Position invalide/),
    })
  })

  it.each([500, 502, 503])(
    'reports a non-JSON %i without leaking HTML or retrying',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('<html>upstream failure</html>', { status }))

      const error = await createHttpClient()
        .request('/lists', { method: 'POST', body: { title: 'À faire' } })
        .catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status, message: expect.stringMatching(/serveur/i) })
      expect((error as ApiError).message).not.toContain('<html>')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('preserves a JSON server error message', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: 'Internal server error' }, { status: 500 }),
    )

    await expect(createHttpClient().request('/lists')).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    })
  })

  it.each([null, {}, { message: [] }, { message: 42 }, { message: [null] }])(
    'provides a fallback for an unusable error body: %j',
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body, { status: 400 }))

      await expect(createHttpClient().request('/lists')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/400/),
      })
    },
  )

  it('reports malformed successful JSON as an API error', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    await expect(createHttpClient().request('/lists')).rejects.toMatchObject({
      status: 200,
      message: expect.stringMatching(/JSON/),
    })
  })

  it('normalizes network errors without retrying a mutation', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      createHttpClient().request('/lists', { method: 'POST', body: { title: 'À faire' } }),
    ).rejects.toMatchObject({ status: null, message: expect.stringMatching(/réseau/i) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('session expiration integration', () => {
  it('notifies the session handler on a protected 401, including a non-JSON body', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const onUnauthorized = vi.fn<() => void>()

    await expect(createHttpClient({ onUnauthorized }).request('/lists')).rejects.toMatchObject({
      status: 401,
    })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it.each([
    [401, false],
    [403, true],
    [500, true],
  ])('does not notify for status %i with auth=%s', async (status, auth) => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Refusé' }, { status }))
    const onUnauthorized = vi.fn<() => void>()

    await expect(
      createHttpClient({ onUnauthorized }).request('/lists', { auth }),
    ).rejects.toMatchObject({ status })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('requests from a previous session', () => {
  it.each([
    [200, '{"id":"old-list"}'],
    [204, null],
    [401, '{"message":"Session expirée"}'],
    [401, 'Unauthorized'],
    [403, '{"message":"Refusé"}'],
  ])('rejects a late response with status %i before consuming it', async (status, body) => {
    let version = 1
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
    const onUnauthorized = vi.fn<() => void>()
    const request = createHttpClient({
      getSessionVersion: () => version,
      onUnauthorized,
    }).request('/lists')

    version = 2
    const response = new Response(body, { status })
    resolve(response)

    await expect(request).rejects.toBeInstanceOf(SessionChangedError)
    expect(response.bodyUsed).toBe(false)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it.each([
    [200, '{"id":"old-list"}'],
    [401, '{"message":"Session expirée"}'],
    [403, '{"message":"Refusé"}'],
    [200, 'invalid JSON'],
    [401, 'Unauthorized'],
  ])('rejects a late body with status %i and contents %s', async (status, body) => {
    let version = 1
    let bodyController!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller
        },
      }),
      { status },
    )
    fetchMock.mockResolvedValueOnce(response)
    const onUnauthorized = vi.fn<() => void>()
    const request = createHttpClient({
      getSessionVersion: () => version,
      onUnauthorized,
    }).request('/lists')
    await vi.waitFor(() => expect(response.bodyUsed).toBe(true))

    version = 2
    bodyController.enqueue(new TextEncoder().encode(body))
    bodyController.close()

    await expect(request).rejects.toBeInstanceOf(SessionChangedError)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('rejects a late network failure as a session change', async () => {
    let version = 1
    let reject!: (error: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((_resolve, fail) => (reject = fail)))
    const request = createHttpClient({ getSessionVersion: () => version }).request('/lists')

    version = 2
    reject(new TypeError('Failed to fetch'))

    await expect(request).rejects.toBeInstanceOf(SessionChangedError)
  })

  it('preserves the session-change error when an old request times out', async () => {
    vi.useFakeTimers()
    let version = 1
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const result = createHttpClient({ getSessionVersion: () => version })
      .request('/lists')
      .catch((error: unknown) => error)

    version = 2
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await result).toBeInstanceOf(SessionChangedError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('captures the current version separately for each request', async () => {
    let version = 1
    const client = createHttpClient({ getSessionVersion: () => version })

    await expect(client.request('/lists')).resolves.toEqual({ id: 'list-1' })
    version = 2
    await expect(client.request('/lists')).resolves.toEqual({ id: 'list-1' })
  })

  it('keeps a current 401 local to the request that expires the session', async () => {
    let version = 1
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Session expirée' }, { status: 401 }))
    const request = createHttpClient({
      getSessionVersion: () => version,
      onUnauthorized: () => version++,
    }).request('/lists')

    await expect(request).rejects.toMatchObject({ name: 'ApiError', status: 401 })
    expect(version).toBe(2)
  })

  it.each([
    { status: 200, expected: { accessToken: 'new-token' } },
    { status: 401, expected: { name: 'ApiError', status: 401 } },
  ])(
    'ignores the session version for a public response with status $status',
    async ({ status, expected }) => {
      let version = 1
      let resolve!: (response: Response) => void
      fetchMock.mockReturnValueOnce(new Promise<Response>((done) => (resolve = done)))
      const getSessionVersion = vi.fn<() => number>(() => version)
      const onUnauthorized = vi.fn<() => void>()
      const request = createHttpClient({ getSessionVersion, onUnauthorized }).request('/auth/login', {
        auth: false,
      })

      version = 2
      resolve(Response.json({ accessToken: 'new-token' }, { status }))

      expect(await request.catch((error: unknown) => error)).toMatchObject(expected)
      expect(getSessionVersion).not.toHaveBeenCalled()
      expect(onUnauthorized).not.toHaveBeenCalled()
    },
  )
})
