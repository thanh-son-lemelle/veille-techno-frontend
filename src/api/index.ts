import { createHttpClient, type HttpClientOptions } from './client'
import type {
  AuthToken,
  Card,
  CreateCardInput,
  CreateListInput,
  List,
  LoginInput,
  RegisterInput,
  UpdateCardInput,
  UpdateListInput,
  UpdateUserInput,
  User,
} from './types'

export { ApiError, SessionChangedError, createHttpClient } from './client'
export type { HttpClientOptions } from './client'
export type * from './types'

export function createApiClient(options: HttpClientOptions = {}) {
  const { request } = createHttpClient(options)

  return {
    auth: {
      register: (body: RegisterInput) =>
        request<User>('/auth/register', { method: 'POST', body, auth: false }),
      login: (body: LoginInput) =>
        request<AuthToken>('/auth/login', { method: 'POST', body, auth: false }),
    },
    users: {
      update: (id: string, body: UpdateUserInput) =>
        request<User>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    },
    lists: {
      getAll: (signal?: AbortSignal) => request<List[]>('/lists', { signal }),
      create: (body: CreateListInput) => request<List>('/lists', { method: 'POST', body }),
      update: (id: string, body: UpdateListInput) =>
        request<List>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id: string) =>
        request<void>(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    cards: {
      getAll: (listId: string, signal?: AbortSignal) =>
        request<Card[]>(`/lists/${encodeURIComponent(listId)}/cards`, { signal }),
      create: (listId: string, body: CreateCardInput, signal?: AbortSignal) =>
        request<Card>(`/lists/${encodeURIComponent(listId)}/cards`, {
          method: 'POST',
          body,
          signal,
        }),
      get: (id: string, signal?: AbortSignal) =>
        request<Card>(`/cards/${encodeURIComponent(id)}`, { signal }),
      update: (id: string, body: UpdateCardInput) =>
        request<Card>(`/cards/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
      remove: (id: string) =>
        request<void>(`/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
  }
}
