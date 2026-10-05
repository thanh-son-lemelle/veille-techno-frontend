<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { SessionChangedError, type List } from '@/api'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const lists = ref<List[]>([])
const loading = ref(false)
const failed = ref(false)
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
