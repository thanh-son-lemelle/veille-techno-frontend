import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { build } from 'vite'

type ApiWindow = typeof window & { SmokeApi: typeof import('../src/api') }

test.describe('real API through the frontend proxy', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- This integration test requires an opt-in backend.
  test.skip(process.env.API_SMOKE_TEST !== '1', 'Set API_SMOKE_TEST=1 with the backend running')

  let clientBundle: string

  test.beforeAll(async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
      build: {
        write: false,
        lib: {
          entry: fileURLToPath(new URL('../src/api/index.ts', import.meta.url)),
          name: 'SmokeApi',
          formats: ['iife'],
        },
      },
    })
    const output = Array.isArray(result) ? result[0] : result
    if (!output || !('output' in output)) throw new Error('Expected an in-memory client bundle')
    const chunk = output.output.find((item) => item.type === 'chunk')
    if (!chunk) throw new Error('Client bundle contains no JavaScript')
    clientBundle = chunk.code
  })

  test('normalizes backend errors and handles unauthorized protected requests', async ({
    page,
  }) => {
    await page.goto('/')
    await page.addScriptTag({ content: clientBundle })

    const [listsResponse, loginResponse, result] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/lists'),
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login'),
      page.evaluate(async () => {
        const { createApiClient, ApiError } = (window as ApiWindow).SmokeApi
        let unauthorizedCalls = 0
        const api = createApiClient({ onUnauthorized: () => unauthorizedCalls++ })

        async function captureError(request: Promise<unknown>) {
          try {
            await request
          } catch (error) {
            if (!(error instanceof ApiError)) throw error
            return { status: error.status, message: error.message, details: error.details }
          }
          throw new Error('Expected the API request to fail')
        }

        const protectedError = await captureError(api.lists.getAll())
        const protectedUnauthorizedCalls = unauthorizedCalls
        const publicError = await captureError(api.auth.login({ email: 'invalid', password: '' }))

        return { protectedError, publicError, protectedUnauthorizedCalls, unauthorizedCalls }
      }),
    ])

    expect(listsResponse.url()).toBe(new URL('/api/lists', page.url()).href)
    expect(listsResponse.status()).toBe(401)
    expect(listsResponse.request().headers().authorization).toBeUndefined()
    expect(result.protectedError).toEqual({
      status: 401,
      message: 'Unauthorized',
      details: 'Unauthorized',
    })
    expect(result.protectedUnauthorizedCalls).toBe(1)

    expect(loginResponse.url()).toBe(new URL('/api/auth/login', page.url()).href)
    expect(loginResponse.status()).toBe(400)
    expect(loginResponse.request().headers().authorization).toBeUndefined()
    expect(result.publicError.status).toBe(400)
    expect(result.publicError.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('email'),
        expect.stringContaining('password'),
      ]),
    )
    expect(result.publicError.message).toContain('email')
    expect(result.publicError.message).toContain('password')
    expect(result.unauthorizedCalls).toBe(1)
  })
})
