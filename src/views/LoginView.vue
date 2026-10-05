<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const errors = reactive({ email: '', password: '' })
const isSubmitting = ref(false)
const errorMessage = ref('')
const emailInput = useTemplateRef('emailInput')
const passwordInput = useTemplateRef('passwordInput')
let active = true

onBeforeUnmount(() => {
  active = false
  password.value = ''
})

async function submit() {
  if (!active || isSubmitting.value) return
  errorMessage.value = ''
  errors.email = emailInput.value?.inputRef?.validity.valid
    ? ''
    : 'Saisissez une adresse email valide.'
  errors.password = password.value ? '' : 'Saisissez votre mot de passe.'

  if (errors.email || errors.password) {
    await nextTick()
    const input = errors.email ? emailInput.value : passwordInput.value
    input?.inputRef?.focus()
    return
  }

  isSubmitting.value = true
  const sessionVersion = session.version
  try {
    const { accessToken } = await session.api.auth.login({
      email: email.value.trim(),
      password: password.value,
    })
    if (!active || session.version !== sessionVersion) return
    session.start(accessToken)
    await router.replace({ name: 'kanban' })
  } catch (error) {
    if (!active || session.version !== sessionVersion) return
    if (error instanceof ApiError && error.status === 401) {
      errorMessage.value = 'Identifiants invalides'
    } else if (error instanceof ApiError && error.status === 400) {
      errorMessage.value = 'Vérifiez les informations saisies, puis réessayez.'
    } else if (error instanceof ApiError && error.status === null) {
      errorMessage.value =
        'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.'
    } else {
      errorMessage.value = 'Le serveur est indisponible. Réessayez plus tard.'
    }
  } finally {
    password.value = ''
    isSubmitting.value = false
  }
}
</script>

<template>
  <UCard class="mx-auto max-w-md">
    <template #header>
      <h1 class="text-2xl font-semibold">Connexion</h1>
    </template>
    <form class="space-y-5" novalidate :aria-busy="isSubmitting" @submit.prevent="submit">
      <UFormField label="Email" name="email" :error="errors.email || false">
        <UInput
          ref="emailInput"
          v-model="email"
          type="email"
          autocomplete="username"
          autocapitalize="none"
          :spellcheck="false"
          required
          :disabled="isSubmitting"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Mot de passe" name="password" :error="errors.password || false">
        <UInput
          ref="passwordInput"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="isSubmitting"
          class="w-full"
        />
      </UFormField>
      <p v-if="errorMessage" role="alert" class="text-sm text-error">{{ errorMessage }}</p>
      <UButton type="submit" :loading="isSubmitting" :disabled="isSubmitting" block>
        Se connecter
      </UButton>
    </form>
    <template #footer>
      <p class="mb-3 text-sm text-muted">Vous n’avez pas encore de compte ?</p>
      <UButton to="/inscription" color="neutral" variant="outline">Aller à l’inscription</UButton>
    </template>
  </UCard>
</template>
