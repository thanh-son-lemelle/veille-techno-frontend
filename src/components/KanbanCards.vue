<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import { ApiError, SessionChangedError, type Card } from '@/api'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ listId: string; disabled?: boolean }>()
const emit = defineEmits<{ inaccessible: [] }>()
const session = useSessionStore()
const cards = ref<Card[]>([])
const loading = ref(false)
const errorMessage = ref('')
const retryable = ref(false)
const controller = new AbortController()
const schema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.'),
  description: z.string(),
})
const values = reactive({ title: '', description: '' })
const creating = ref(false)
const pending = ref(false)
const serverError = ref('')
const created = ref(false)
const feedback = useTemplateRef('feedback')

onBeforeUnmount(() => controller.abort())

async function loadCards() {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  errorMessage.value = ''
  retryable.value = false

  try {
    const response = await session.api.cards.getAll(props.listId, controller.signal)
    if (controller.signal.aborted) return
    const ids = new Set<string>()
    cards.value = response.filter((card) => {
      if (card.listId !== props.listId || ids.has(card.id)) return false
      ids.add(card.id)
      return true
    })
  } catch (error) {
    if (controller.signal.aborted || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    cards.value = []
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      errorMessage.value = 'Cette liste est inaccessible ou n’existe plus.'
    } else {
      errorMessage.value =
        error instanceof ApiError ? error.message : 'Impossible de charger les cartes.'
      retryable.value = !(error instanceof ApiError) || error.status === null || error.status >= 500
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

async function openCreation() {
  values.title = ''
  values.description = ''
  serverError.value = ''
  created.value = false
  creating.value = true
  await nextTick()
  document.getElementById(`new-card-${props.listId}-title`)?.focus()
}

async function cancelCreation() {
  if (pending.value) return
  creating.value = false
  values.title = ''
  values.description = ''
  serverError.value = ''
  await nextTick()
  document.getElementById(`add-card-${props.listId}`)?.focus()
}

async function onValidationError(event: FormErrorEvent) {
  serverError.value = ''
  await nextTick()
  const id = event.errors[0]?.id
  if (id) document.getElementById(id)?.focus()
}

async function createCard(event: FormSubmitEvent<z.output<typeof schema>>) {
  if (controller.signal.aborted || !creating.value || pending.value || props.disabled) return
  pending.value = true
  serverError.value = ''

  try {
    const card = await session.api.cards.create(
      props.listId,
      {
        title: event.data.title,
        ...(event.data.description !== '' ? { description: event.data.description } : {}),
      },
      controller.signal,
    )
    if (controller.signal.aborted) return
    if (!cards.value.some((existing) => existing.id === card.id)) {
      cards.value.push(card)
      cards.value.sort(
        (a, b) =>
          a.position - b.position ||
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          a.id.localeCompare(b.id),
      )
    }
    creating.value = false
    values.title = ''
    values.description = ''
    created.value = true
  } catch (error) {
    if (controller.signal.aborted || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      cards.value = []
      emit('inaccessible')
      return
    }
    serverError.value =
      error instanceof ApiError ? error.message : 'La création de la carte a échoué.'
  } finally {
    if (!controller.signal.aborted) pending.value = false
  }

  await nextTick()
  if (!controller.signal.aborted) feedback.value?.focus()
}

void loadCards()
</script>

<template>
  <div class="mt-5 space-y-3" :aria-busy="loading">
    <p v-if="loading" role="status" class="text-sm text-muted">Chargement des cartes…</p>
    <div v-else-if="errorMessage" class="space-y-3">
      <p role="alert" class="whitespace-pre-line text-sm text-error [overflow-wrap:anywhere]">
        {{ errorMessage }}
      </p>
      <UButton v-if="retryable" color="neutral" variant="outline" @click="loadCards">
        Réessayer
      </UButton>
    </div>
    <p v-else-if="cards.length === 0" class="text-sm text-muted">Aucune carte dans cette liste.</p>
    <ul v-else class="space-y-3">
      <li
        v-for="card in cards"
        :key="card.id"
        class="space-y-2 rounded-md bg-muted p-3 ring ring-default [overflow-wrap:anywhere]"
      >
        <h3 class="font-medium">
          <RouterLink
            :to="{ name: 'carte', params: { id: card.id } }"
            class="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {{ card.title }}
          </RouterLink>
        </h3>
        <p v-if="card.description" class="whitespace-pre-wrap text-sm text-muted">
          {{ card.description }}
        </p>
      </li>
    </ul>
    <div v-if="!loading && !errorMessage" class="space-y-3">
      <UButton
        v-if="!creating"
        :id="`add-card-${listId}`"
        color="neutral"
        variant="outline"
        :disabled="disabled"
        @click="openCreation"
      >
        Ajouter une carte
      </UButton>
      <p v-if="created" ref="feedback" role="status" tabindex="-1" class="text-sm text-success">
        La carte a été créée.
      </p>
      <UForm
        v-if="creating"
        :schema="schema"
        :state="values"
        :validate-on="['blur']"
        :loading-auto="false"
        :aria-labelledby="`create-card-${listId}-title`"
        :aria-busy="pending"
        novalidate
        class="space-y-4 rounded-md p-3 ring ring-default"
        @submit="createCard"
        @error="onValidationError"
      >
        <h3 :id="`create-card-${listId}-title`" class="font-medium">Nouvelle carte</h3>
        <p
          v-if="serverError"
          ref="feedback"
          role="alert"
          tabindex="-1"
          class="whitespace-pre-line text-sm text-error [overflow-wrap:anywhere]"
        >
          {{ serverError }}
        </p>
        <fieldset :disabled="pending || disabled" class="space-y-4">
          <UFormField label="Titre de la carte" name="title" class="min-h-22" required>
            <UInput
              :id="`new-card-${listId}-title`"
              v-model="values.title"
              name="title"
              class="w-full"
              required
            />
          </UFormField>
          <UFormField label="Description" name="description" hint="Optionnelle">
            <UTextarea
              :id="`new-card-${listId}-description`"
              v-model="values.description"
              name="description"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap gap-3">
            <UButton type="submit" :disabled="pending || disabled" :loading="pending">
              {{ pending ? 'Création en cours…' : 'Créer la carte' }}
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :disabled="pending || disabled"
              @click="cancelCreation"
            >
              Annuler
            </UButton>
          </div>
        </fieldset>
      </UForm>
    </div>
  </div>
</template>
