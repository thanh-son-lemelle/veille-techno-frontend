<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from 'vue'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import { ApiError, SessionChangedError, type List } from '@/api'
import { useSessionStore } from '@/stores/session'
import KanbanCards from '@/components/KanbanCards.vue'

const session = useSessionStore()
const lists = ref<List[]>([])
const loading = ref(false)
const failed = ref(false)
const schema = z.object({ title: z.string().trim().min(1, 'Le titre est obligatoire.') })
const values = reactive({ title: '' })
const creating = ref(false)
const pending = ref(false)
const serverError = ref('')
const created = ref(false)
const feedback = useTemplateRef('feedback')
const listToDelete = ref<List | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const deletionNotice = ref('')
const deletionMissing = ref(false)
const deleteFeedback = useTemplateRef('deleteFeedback')
const deleteErrorFeedback = useTemplateRef('deleteErrorFeedback')
let deleteTriggerId = ''
let active = true

onBeforeUnmount(() => {
  active = false
})

async function loadLists() {
  if (loading.value) return
  loading.value = true
  failed.value = false

  try {
    const response = await session.api.lists.getAll()
    if (!active) return
    const ids = new Set<string>()
    lists.value = response.filter((list) => {
      if (ids.has(list.id)) return false
      ids.add(list.id)
      return true
    })
  } catch (error) {
    if (!active || error instanceof SessionChangedError) return
    failed.value = true
  } finally {
    if (active) loading.value = false
  }
}

async function openCreation() {
  values.title = ''
  serverError.value = ''
  created.value = false
  deletionNotice.value = ''
  creating.value = true
  await nextTick()
  document.getElementById('new-list-title')?.focus()
}

async function cancelCreation() {
  if (pending.value) return
  creating.value = false
  values.title = ''
  serverError.value = ''
  await nextTick()
  document.getElementById('add-list')?.focus()
}

async function onValidationError(event: FormErrorEvent) {
  serverError.value = ''
  await nextTick()
  const id = event.errors[0]?.id
  if (id) document.getElementById(id)?.focus()
}

async function createList(event: FormSubmitEvent<z.output<typeof schema>>) {
  if (!active || !creating.value || pending.value || deleting.value) return
  pending.value = true
  serverError.value = ''

  try {
    const list = await session.api.lists.create({ title: event.data.title })
    if (!active) return
    if (!lists.value.some((existing) => existing.id === list.id)) lists.value.push(list)
    creating.value = false
    values.title = ''
    created.value = true
  } catch (error) {
    if (!active || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    serverError.value =
      error instanceof ApiError
        ? error.message
        : 'La création de la liste a échoué. Veuillez réessayer.'
  } finally {
    if (active) pending.value = false
  }

  await nextTick()
  feedback.value?.focus()
}

function requestDeletion(list: List) {
  if (pending.value || deleting.value) return
  deleteTriggerId = `delete-list-${list.id}`
  deleteError.value = ''
  deletionNotice.value = ''
  created.value = false
  listToDelete.value = list
}

function cancelDeletion() {
  if (!deleting.value) listToDelete.value = null
}

function focusDeleteCancel(event: Event) {
  event.preventDefault()
  document.getElementById('cancel-list-deletion')?.focus()
}

function restoreDeleteFocus(event: Event) {
  event.preventDefault()
  if (active) (deleteFeedback.value ?? document.getElementById(deleteTriggerId))?.focus()
}

async function deleteList() {
  const list = listToDelete.value
  if (!active || !list || deleting.value) return
  deleting.value = true
  deleteError.value = ''

  try {
    await session.api.lists.remove(list.id)
    if (!active) return
    lists.value = lists.value.filter((item) => item.id !== list.id)
    listToDelete.value = null
    deletionMissing.value = false
    deletionNotice.value = `La liste « ${list.title} » et toutes ses cartes ont été supprimées.`
  } catch (error) {
    if (!active || error instanceof SessionChangedError) return
    if (error instanceof ApiError && error.status === 401) return
    if (error instanceof ApiError && error.status === 404) {
      lists.value = lists.value.filter((item) => item.id !== list.id)
      listToDelete.value = null
      deletionMissing.value = true
      deletionNotice.value = `La liste « ${list.title} » n’existe plus.`
      await loadLists()
    } else {
      deleteError.value =
        error instanceof ApiError
          ? error.message
          : 'La suppression de la liste a échoué. Veuillez réessayer.'
    }
  } finally {
    if (active) deleting.value = false
  }

  await nextTick()
  if (active) (deleteErrorFeedback.value ?? deleteFeedback.value)?.focus()
}

void loadLists()
</script>

<template>
  <section class="min-w-0 space-y-8" aria-labelledby="kanban-title">
    <div class="space-y-3">
      <p class="text-sm font-medium text-primary">Votre espace personnel</p>
      <h1 id="kanban-title" class="text-3xl font-semibold tracking-tight sm:text-4xl">
        Tableau Kanban
      </h1>
      <p class="max-w-2xl text-lg text-muted">Retrouvez vos listes de veille.</p>
    </div>

    <div v-if="!loading && !failed" class="space-y-4">
      <UButton v-if="!creating" id="add-list" :disabled="deleting" @click="openCreation">
        Ajouter une liste
      </UButton>
      <p v-if="created" ref="feedback" role="status" tabindex="-1" class="text-success">
        La liste a été créée.
      </p>
      <UCard v-if="creating" class="max-w-md">
        <template #header>
          <h2 id="create-list-title" class="text-xl font-semibold">Nouvelle liste</h2>
        </template>
        <UForm
          :schema="schema"
          :state="values"
          :validate-on="['blur']"
          :loading-auto="false"
          novalidate
          aria-labelledby="create-list-title"
          :aria-busy="pending"
          class="space-y-5"
          @submit="createList"
          @error="onValidationError"
        >
          <p
            v-if="serverError"
            ref="feedback"
            role="alert"
            tabindex="-1"
            class="whitespace-pre-line wrap-break-word text-sm text-error"
          >
            {{ serverError }}
          </p>
          <fieldset :disabled="pending || deleting" class="space-y-5">
            <UFormField label="Titre de la liste" name="title" class="min-h-22" required>
              <UInput
                id="new-list-title"
                v-model="values.title"
                name="title"
                class="w-full"
                required
              />
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UButton type="submit" :disabled="pending" :loading="pending">
                {{ pending ? 'Création en cours…' : 'Créer la liste' }}
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                :disabled="pending"
                @click="cancelCreation"
              >
                Annuler
              </UButton>
            </div>
          </fieldset>
        </UForm>
      </UCard>
    </div>

    <p
      v-if="deletionNotice"
      ref="deleteFeedback"
      :role="deletionMissing ? 'alert' : 'status'"
      tabindex="-1"
      class="[overflow-wrap:anywhere]"
      :class="deletionMissing ? 'text-error' : 'text-success'"
    >
      {{ deletionNotice }}
    </p>

    <p v-if="loading" role="status" class="py-8 text-muted">Chargement des listes…</p>

    <UCard v-else-if="failed">
      <div class="space-y-4 py-4">
        <p role="alert">Impossible de charger vos listes. Veuillez réessayer.</p>
        <UButton @click="loadLists">Réessayer</UButton>
      </div>
    </UCard>

    <UCard v-else-if="lists.length === 0">
      <div class="space-y-3 py-8 text-center">
        <h2 class="text-xl font-semibold">Votre tableau est vide</h2>
        <p class="mx-auto max-w-lg text-muted">
          Créez votre première liste pour commencer à organiser votre veille.
        </p>
      </div>
    </UCard>

    <section
      v-else
      role="region"
      aria-label="Listes du tableau Kanban"
      tabindex="0"
      class="overflow-x-auto rounded-lg p-1 pb-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <ul class="flex items-stretch gap-4">
        <li
          v-for="list in lists"
          :key="list.id"
          :aria-labelledby="`list-${list.id}-title`"
          class="min-h-48 w-72 max-w-full shrink-0 rounded-lg bg-default p-5 ring ring-default"
        >
          <div class="flex items-start gap-3">
            <h2
              :id="`list-${list.id}-title`"
              class="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]"
            >
              {{ list.title }}
            </h2>
            <UButton
              :id="`delete-list-${list.id}`"
              :aria-label="`Supprimer la liste « ${list.title} »`"
              :disabled="pending || deleting"
              color="error"
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="requestDeletion(list)"
            >
              Supprimer
            </UButton>
          </div>
          <KanbanCards :list-id="list.id" />
        </li>
      </ul>
    </section>

    <UModal
      :open="!!listToDelete"
      title="Supprimer cette liste ?"
      :description="`La liste « ${listToDelete?.title} » et toutes ses cartes seront définitivement supprimées. Cette action est irréversible.`"
      :close="false"
      :dismissible="!deleting"
      :content="{ onOpenAutoFocus: focusDeleteCancel, onCloseAutoFocus: restoreDeleteFocus }"
      :ui="{
        title: '[overflow-wrap:anywhere]',
        description: '[overflow-wrap:anywhere]',
        footer: 'flex-wrap justify-end',
      }"
      @update:open="cancelDeletion"
    >
      <template v-if="deleteError" #body>
        <p
          ref="deleteErrorFeedback"
          role="alert"
          tabindex="-1"
          class="whitespace-pre-line wrap-break-word text-sm text-error"
        >
          {{ deleteError }}
        </p>
      </template>
      <template #footer>
        <UButton
          id="cancel-list-deletion"
          color="neutral"
          variant="outline"
          :disabled="deleting"
          @click="cancelDeletion"
        >
          Annuler
        </UButton>
        <UButton color="error" :disabled="deleting" :loading="deleting" @click="deleteList">
          {{ deleting ? 'Suppression en cours…' : 'Supprimer la liste' }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
