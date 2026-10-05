export interface HttpClientOptions {
  baseUrl?: string
  getToken?: () => string | null | undefined
  getSessionVersion?: () => number
  onUnauthorized?: () => void
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

const REQUEST_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  readonly status: number | null
  readonly details: string | string[]

  constructor(status: number | null, details: string | string[]) {
    super(Array.isArray(details) ? details.join('\n') : details)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export class SessionChangedError extends Error {
  constructor() {
    super('La session a changé pendant la requête.')
    this.name = 'SessionChangedError'
  }
}

function errorMessage(payload: unknown, status: number): string | string[] {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = payload.message
    if (typeof message === 'string' && message.trim()) return message
    if (
      Array.isArray(message) &&
      message.length > 0 &&
      message.every((item: unknown) => typeof item === 'string' && item.trim())
    ) {
      return message as string[]
    }
  }

  return status >= 500
    ? `Le serveur est indisponible (HTTP ${status}). Réessayez plus tard.`
    : `La requête a échoué (HTTP ${status}).`
}

export function createHttpClient(options: HttpClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api')
    .trim()
    .replace(/\/+$/, '')
    .replace(/(?:\/api)+$/, '')

  async function request<T>(
    path: string,
    { method = 'GET', body, auth = true }: RequestOptions = {},
  ): Promise<T> {
    const getSessionVersion = auth ? options.getSessionVersion : undefined
    const sessionVersion = getSessionVersion?.()
    function assertCurrentSession() {
      if (getSessionVersion && getSessionVersion() !== sessionVersion) {
        throw new SessionChangedError()
      }
    }

    const endpoint = path.replace(/^\/+/, '').replace(/^(?:api\/)+|^api$/, '')
    const headers = new Headers({ Accept: 'application/json' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const token = auth ? options.getToken?.() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/api/${endpoint}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch {
        assertCurrentSession()
        throw new ApiError(
          null,
          'Impossible de joindre le serveur. Vérifiez votre connexion réseau.',
        )
      }

      assertCurrentSession()
      if (response.status === 204) return undefined as T

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        assertCurrentSession()
        if (controller.signal.aborted) throw error
        if (response.ok) {
          throw new ApiError(
            response.status,
            'La réponse du serveur ne contient pas un JSON valide.',
          )
        }
      }

      assertCurrentSession()
      if (!response.ok) {
        const error = new ApiError(response.status, errorMessage(payload, response.status))
        if (auth && response.status === 401) options.onUnauthorized?.()
        throw error
      }

      return payload as T
    } catch (error) {
      if (error instanceof SessionChangedError) throw error
      if (controller.signal.aborted) {
        throw new ApiError(
          null,
          'Le serveur met trop de temps à répondre. Vérifiez si l’opération a abouti avant de réessayer.',
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  return { request }
}
