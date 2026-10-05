<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, useTemplateRef } from 'vue'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import { ApiError, SessionChangedError, type List } from '@/api'
import { useSessionStore } from '@/stores/session'

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
  if (!active || !creating.value || pending.value) return
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
      <UButton v-if="!creating" id="add-list" @click="openCreation">Ajouter une liste</UButton>
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
          <fieldset :disabled="pending" class="space-y-5">
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
          <h2 :id="`list-${list.id}-title`" class="text-lg font-semibold [overflow-wrap:anywhere]">
            {{ list.title }}
          </h2>
        </li>
      </ul>
    </section>
  </section>
</template>
