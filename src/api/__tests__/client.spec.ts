import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createHttpClient } from '../client'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ id: 'list-1' }))
})

afterEach(() => {
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
    })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe(
      'application/json',
    )
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
