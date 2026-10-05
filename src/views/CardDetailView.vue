<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import { ApiError, SessionChangedError, type Card, type List, type UpdateCardInput } from '@/api'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()
const session = useSessionStore()
const card = ref<Card | null>(null)
const listTitle = ref('')
const loading = ref(false)
const errorMessage = ref('')
const retryable = ref(false)
const lists = ref<List[]>([])
const editing = ref(false)
const pending = ref(false)
const serverError = ref('')
const notice = ref('')
const needsRefresh = ref(false)
const values = reactive({ title: '', description: '', listId: '', position: '' })
let original: Card | null = null
let controller = new AbortController()
const schema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.'),
  description: z.string(),
  listId: z
    .uuid('La liste de destination doit avoir un identifiant UUID valide.')
    .refine((id) => lists.value.some((list) => list.id === id), 'Choisissez une liste disponible.'),
  position: z
    .string()
    .trim()
    .refine(
      (value) =>
        value !== '' &&
        Number.isInteger(Number(value)) &&
        Number(value) >= -2147483648 &&
        Number(value) <= 2147483647,
      'La position doit être un entier entre -2147483648 et 2147483647.',
    )
    .transform(Number),
})

onBeforeUnmount(() => controller.abort())

async function loadCard() {
  if (loading.value) return
  const request = controller
  loading.value = true
  card.value = null
  listTitle.value = ''
  lists.value = []
  errorMessage.value = ''
  retryable.value = false

  try {
    const response = await session.api.cards.get(props.id, request.signal)
    const responseLists = await session.api.lists.getAll(request.signal)
    if (request.signal.aborted) return
    const list = responseLists.find((item) => item.id === response.listId)
    if (!list) throw new ApiError(404, 'Liste introuvable.')
    lists.value = responseLists
    card.value = response
    listTitle.value = list.title
  } catch (error) {
    if (request.signal.aborted || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      errorMessage.value = 'Cette carte est inaccessible ou n’existe plus.'
    } else {
      errorMessage.value =
        error instanceof ApiError ? error.message : 'Impossible de charger la carte.'
      retryable.value = !(error instanceof ApiError) || error.status === null || error.status >= 500
    }
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

async function openEditor() {
  if (!card.value) return
  original = { ...card.value }
  Object.assign(values, {
    title: original.title,
    description: original.description,
    listId: original.listId,
    position: String(original.position),
  })
  serverError.value = ''
  notice.value = ''
  needsRefresh.value = false
  editing.value = true
  await nextTick()
  document.getElementById('edit-card-title')?.focus()
}

async function closeEditor() {
  if (pending.value) return
  editing.value = false
  original = null
  serverError.value = ''
  if (!card.value) errorMessage.value = 'Cette carte est inaccessible ou n’existe plus.'
  await nextTick()
  document.getElementById(card.value ? 'edit-card' : 'return-to-board')?.focus()
}

async function onValidationError(event: FormErrorEvent) {
  serverError.value = ''
  await nextTick()
  const first = event.errors[0]
  const id = first?.name === 'listId' ? 'edit-card-list' : first?.id
  if (id) document.getElementById(id)?.focus()
}

async function refreshEditor(status?: number, destinationId?: string) {
  const request = controller
  card.value = null
  listTitle.value = ''
  needsRefresh.value = false
  const [source, destinations] = await Promise.allSettled([
    session.api.cards.get(props.id, request.signal),
    session.api.lists.getAll(request.signal),
  ])
  if (request.signal.aborted) return
  lists.value = destinations.status === 'fulfilled' ? destinations.value : []
  if (
    source.status === 'rejected' &&
    source.reason instanceof ApiError &&
    (source.reason.status === 403 || source.reason.status === 404)
  ) {
    serverError.value =
      source.reason.status === 403
        ? 'La carte source est inaccessible. Votre saisie est conservée.'
        : 'La carte source n’existe plus. Votre saisie est conservée.'
  } else if (source.status === 'rejected' || destinations.status === 'rejected') {
    serverError.value =
      'Impossible d’actualiser la carte et les listes. Votre saisie est conservée.'
    needsRefresh.value = true
  } else {
    const list = destinations.value.find((item) => item.id === source.value.listId)
    if (!list) {
      serverError.value =
        'La liste source est inaccessible ou n’existe plus. Votre saisie est conservée.'
      return
    }
    card.value = source.value
    listTitle.value = list.title
    const destinationMissing =
      destinationId && !lists.value.some((item) => item.id === destinationId)
    serverError.value =
      destinationMissing && status === 403
        ? 'La liste de destination est inaccessible. Aucun déplacement effectué. Votre saisie est conservée.'
        : destinationMissing && status === 404
          ? 'La liste de destination n’existe plus. Aucun déplacement effectué. Votre saisie est conservée.'
          : status
            ? 'La modification a été refusée. Les données ont été actualisées. Votre saisie est conservée.'
            : 'Les données ont été actualisées. Vérifiez votre saisie avant d’enregistrer.'
  }
}

async function retryRefresh() {
  if (pending.value) return
  pending.value = true
  const request = controller
  await refreshEditor()
  if (!request.signal.aborted) pending.value = false
}

async function saveCard(event: FormSubmitEvent<z.output<typeof schema>>) {
  if (!editing.value || pending.value || !card.value || !original) return
  const body: UpdateCardInput = {}
  for (const key of ['title', 'description', 'listId'] as const) {
    if (event.data[key] !== original[key]) body[key] = event.data[key]
  }
  if (event.data.position !== original.position) body.position = event.data.position
  if (Object.keys(body).length === 0) {
    await closeEditor()
    return
  }
  const request = controller
  pending.value = true
  serverError.value = ''
  try {
    const response = await session.api.cards.update(props.id, body, request.signal)
    if (request.signal.aborted) return
    card.value = response
    listTitle.value = lists.value.find((list) => list.id === response.listId)?.title ?? ''
    editing.value = false
    original = null
    notice.value = 'La carte a été mise à jour.'
  } catch (error) {
    if (request.signal.aborted || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      await refreshEditor(error.status, body.listId)
    } else {
      serverError.value =
        error instanceof ApiError ? error.message : 'La modification a échoué. Réessayez.'
    }
  } finally {
    if (!request.signal.aborted) pending.value = false
  }
  await nextTick()
  if (!request.signal.aborted) document.getElementById('edit-card-feedback')?.focus()
}

watch(
  () => props.id,
  () => {
    controller.abort()
    controller = new AbortController()
    loading.value = false
    editing.value = false
    pending.value = false
    original = null
    notice.value = ''
    serverError.value = ''
    void loadCard()
  },
  { immediate: true },
)
</script>

<template>
  <section class="mx-auto min-w-0 max-w-3xl space-y-6" aria-labelledby="card-detail-title">
    <UButton id="return-to-board" to="/kanban" color="neutral" variant="outline"
      >Retour au tableau</UButton
    >
    <h1 id="card-detail-title" class="text-3xl font-semibold tracking-tight sm:text-4xl">
      Détail de la carte
    </h1>
    <p v-if="notice" id="edit-card-feedback" role="status" tabindex="-1" class="text-success">
      {{ notice }}
    </p>

    <div :aria-busy="loading">
      <p v-if="loading" role="status" class="py-8 text-muted">Chargement de la carte…</p>
      <UCard v-else-if="errorMessage">
        <div class="space-y-4">
          <p role="alert" class="whitespace-pre-line text-error [overflow-wrap:anywhere]">
            {{ errorMessage }}
          </p>
          <UButton v-if="retryable" @click="loadCard">Réessayer</UButton>
        </div>
      </UCard>
      <UCard v-else-if="card">
        <template #header>
          <h2 class="text-xl font-semibold [overflow-wrap:anywhere]">{{ card.title }}</h2>
        </template>
        <div class="space-y-6">
          <UButton v-if="!editing" id="edit-card" @click="openEditor">Modifier la carte</UButton>
          <dl class="space-y-1">
            <dt class="font-medium">Liste</dt>
            <dd class="text-muted [overflow-wrap:anywhere]">{{ listTitle }}</dd>
          </dl>
          <div class="space-y-2">
            <h3 class="font-medium">Description</h3>
            <p class="whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
              {{ card.description || 'Aucune description.' }}
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <UCard v-if="editing">
      <template #header>
        <h3 id="edit-card-title-heading" class="text-xl font-semibold">Modifier la carte</h3>
      </template>
      <UForm
        :schema="schema"
        :state="values"
        :validate-on="['blur']"
        :loading-auto="false"
        novalidate
        aria-labelledby="edit-card-title-heading"
        :aria-busy="pending"
        class="space-y-5"
        @submit="saveCard"
        @error="onValidationError"
      >
        <p
          v-if="serverError"
          id="edit-card-feedback"
          role="alert"
          tabindex="-1"
          class="whitespace-pre-line text-error [overflow-wrap:anywhere]"
        >
          {{ serverError }}
        </p>
        <fieldset :disabled="pending" class="min-w-0 space-y-5">
          <UFormField label="Titre de la carte" name="title" required>
            <UInput id="edit-card-title" v-model="values.title" class="w-full" required />
          </UFormField>
          <UFormField label="Description" name="description">
            <UTextarea id="edit-card-description" v-model="values.description" class="w-full" />
          </UFormField>
          <UFormField name="listId" required>
            <template #default="{ error }">
              <label for="edit-card-list" class="mb-1 block text-sm font-medium"
                >Liste de destination</label
              >
              <select
                id="edit-card-list"
                v-model="values.listId"
                name="listId"
                required
                :aria-invalid="!!error"
                :aria-describedby="error ? 'edit-card-list-error' : undefined"
                class="w-full min-w-0 rounded-md bg-default px-3 py-2 text-sm ring ring-default focus:outline-2 focus:outline-primary"
              >
                <option
                  v-if="!lists.some((list) => list.id === values.listId)"
                  :value="values.listId"
                  disabled
                >
                  Liste sélectionnée indisponible
                </option>
                <option v-for="list in lists" :key="list.id" :value="list.id">
                  {{ list.title }}
                </option>
              </select>
            </template>
            <template #error="{ error }"
              ><span id="edit-card-list-error">{{ error }}</span></template
            >
          </UFormField>
          <UFormField label="Position" name="position" required>
            <UInput
              id="edit-card-position"
              v-model="values.position"
              inputmode="numeric"
              class="w-full"
              required
            />
          </UFormField>
          <div class="flex flex-wrap gap-3">
            <UButton type="submit" :disabled="pending || !card" :loading="pending">
              {{ pending ? 'Enregistrement en cours…' : 'Enregistrer' }}
            </UButton>
            <UButton
              v-if="needsRefresh"
              type="button"
              color="neutral"
              variant="outline"
              @click="retryRefresh"
            >
              Actualiser les données
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :disabled="pending"
              @click="closeEditor"
            >
              Annuler
            </UButton>
          </div>
        </fieldset>
      </UForm>
    </UCard>
  </section>
</template>
