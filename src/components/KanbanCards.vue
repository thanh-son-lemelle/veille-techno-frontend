<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ApiError, SessionChangedError, type Card } from '@/api'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ listId: string }>()
const session = useSessionStore()
const cards = ref<Card[]>([])
const loading = ref(false)
const errorMessage = ref('')
const retryable = ref(false)
const controller = new AbortController()

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
        <h3 class="font-medium">{{ card.title }}</h3>
        <p v-if="card.description" class="whitespace-pre-wrap text-sm text-muted">
          {{ card.description }}
        </p>
      </li>
    </ul>
  </div>
</template>
