import { computed, markRaw, ref } from 'vue'
import { defineStore } from 'pinia'
import { createApiClient, type User } from '@/api'

export const useSessionStore = defineStore('session', () => {
  const token = ref<string | null>(null)
  const profile = ref<User | null>(null)
  const version = ref(0)
  const expired = ref(false)
  const isAuthenticated = computed(() => Boolean(token.value))

  function start(accessToken: string) {
    profile.value = null
    expired.value = false
    version.value += 1
    token.value = accessToken
  }

  function logout() {
    profile.value = null
    expired.value = false
    version.value += 1
    token.value = null
  }

  function expire() {
    if (!token.value) return
    logout()
    expired.value = true
  }

  const api = markRaw(
    createApiClient({
      getToken: () => token.value,
      getSessionVersion: () => version.value,
      onUnauthorized: expire,
    }),
  )

  return { token, profile, version, expired, isAuthenticated, api, start, logout }
})
