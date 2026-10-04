<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from 'vue'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import { ApiError, createApiClient } from '@/api'

const api = createApiClient()
const schema = z
  .object({
    name: z.string().trim().min(1, 'Le nom est obligatoire.'),
    email: z.string().trim().pipe(z.email('Saisissez une adresse email valide.')),
    password: z
      .string()
      .min(8, 'Le mot de passe doit contenir entre 8 et 24 caractères.')
      .max(24, 'Le mot de passe doit contenir entre 8 et 24 caractères.'),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Les mots de passe ne correspondent pas.',
    path: ['passwordConfirmation'],
  })
type RegisterForm = z.output<typeof schema>

const values = reactive<RegisterForm>({
  name: '',
  email: '',
  password: '',
  passwordConfirmation: '',
})
const pending = ref(false)
const success = ref(false)
const serverError = ref('')
const form = useTemplateRef('form')
const feedback = useTemplateRef('feedback')
let active = true

onBeforeUnmount(() => {
  active = false
  values.password = ''
  values.passwordConfirmation = ''
})

async function onValidationError(event: FormErrorEvent) {
  serverError.value = ''
  await nextTick()
  const id = event.errors[0]?.id
  if (id) document.getElementById(id)?.focus()
}

async function revalidateConfirmation() {
  if (values.passwordConfirmation || form.value?.getErrors('passwordConfirmation').length) {
    await form.value?.validate({ name: 'passwordConfirmation', silent: true })
  }
}

async function submit(event: FormSubmitEvent<RegisterForm>) {
  if (!active || pending.value || success.value) return

  serverError.value = ''
  pending.value = true
  try {
    await api.auth.register({
      name: event.data.name,
      email: event.data.email,
      password: event.data.password,
    })
    if (!active) return
    values.password = ''
    values.passwordConfirmation = ''
    success.value = true
  } catch (error) {
    if (!active) return
    serverError.value =
      error instanceof ApiError
        ? error.message
        : 'La création du compte a échoué. Veuillez réessayer.'
  } finally {
    pending.value = false
  }

  await nextTick()
  feedback.value?.focus()
}
</script>

<template>
  <UCard class="mx-auto max-w-md">
    <template #header>
      <h1 class="text-2xl font-semibold">Inscription</h1>
    </template>
    <p v-if="success" ref="feedback" role="status" tabindex="-1" class="text-success">
      Votre compte a été créé. Vous pouvez maintenant vous connecter.
    </p>
    <UForm
      v-else
      ref="form"
      :schema="schema"
      :state="values"
      :validate-on="['blur']"
      :loading-auto="false"
      novalidate
      :aria-busy="pending"
      class="space-y-5"
      @submit="submit"
      @error="onValidationError"
    >
      <p class="text-sm text-muted">Créez votre compte pour accéder à votre tableau Kanban.</p>
      <p
        v-if="serverError"
        ref="feedback"
        role="alert"
        tabindex="-1"
        class="whitespace-pre-line break-words text-sm text-error"
      >
        {{ serverError }}
      </p>
      <!-- Réserve la place des erreurs pour ne pas déplacer le bouton pendant un clic. -->
      <fieldset :disabled="pending" class="space-y-5">
        <UFormField label="Nom" name="name" class="min-h-22" required>
          <UInput v-model="values.name" name="name" autocomplete="name" class="w-full" required />
        </UFormField>
        <UFormField label="Email" name="email" class="min-h-22" required>
          <UInput
            v-model="values.email"
            name="email"
            type="email"
            autocomplete="email"
            autocapitalize="none"
            :spellcheck="false"
            class="w-full"
            required
          />
        </UFormField>
        <UFormField
          label="Mot de passe"
          name="password"
          help="Entre 8 et 24 caractères."
          class="min-h-27"
          required
        >
          <UInput
            v-model="values.password"
            name="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            required
            @blur="revalidateConfirmation"
          />
        </UFormField>
        <UFormField
          label="Confirmer le mot de passe"
          name="passwordConfirmation"
          class="min-h-22"
          required
        >
          <UInput
            v-model="values.passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            autocomplete="new-password"
            class="w-full"
            required
          />
        </UFormField>
        <UButton type="submit" :disabled="pending" :loading="pending" block>
          {{ pending ? 'Création en cours…' : 'Créer mon compte' }}
        </UButton>
      </fieldset>
    </UForm>
    <template #footer>
      <p v-if="!success" class="mb-3 text-sm text-muted">Vous avez déjà un compte ?</p>
      <UButton to="/connexion" color="neutral" variant="outline">Aller à la connexion</UButton>
    </template>
  </UCard>
</template>
