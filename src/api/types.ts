export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  createdAt: string
}

export interface List {
  id: string
  title: string
  position: number
  ownerId: string
  createdAt: string
}

export interface Card {
  id: string
  title: string
  description: string
  position: number
  listId: string
  createdAt: string
  updatedAt: string
}

export interface AuthToken {
  accessToken: string
}

export interface RegisterInput {
  email: string
  password: string
  name: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface UpdateUserInput {
  name?: string
  email?: string
  role?: UserRole
}

export interface CreateListInput {
  title: string
  position?: number
}

export type UpdateListInput = Partial<CreateListInput>

export interface CreateCardInput {
  title: string
  description?: string
  position?: number
}

export interface UpdateCardInput extends Partial<CreateCardInput> {
  listId?: string
}
