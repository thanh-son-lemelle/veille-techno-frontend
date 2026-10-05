<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, SessionChangedError, type Card } from '@/api'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()
const session = useSessionStore()
const card = ref<Card | null>(null)
const listTitle = ref('')
const loading = ref(false)
const errorMessage = ref('')
const retryable = ref(false)
let controller: AbortController | undefined

onBeforeUnmount(() => controller?.abort())

async function loadCard() {
  if (loading.value) return
  const request = new AbortController()
  controller = request
  loading.value = true
  card.value = null
  listTitle.value = ''
  errorMessage.value = ''
  retryable.value = false

  try {
    const response = await session.api.cards.get(props.id, request.signal)
    const lists = await session.api.lists.getAll(request.signal)
    if (request.signal.aborted) return
    const list = lists.find((item) => item.id === response.listId)
    if (!list) throw new ApiError(404, 'Liste introuvable.')
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

watch(
  () => props.id,
  () => {
    controller?.abort()
    loading.value = false
    void loadCard()
  },
  { immediate: true },
)
</script>

<template>
  <section class="mx-auto min-w-0 max-w-3xl space-y-6" aria-labelledby="card-detail-title">
    <UButton to="/kanban" color="neutral" variant="outline">Retour au tableau</UButton>
    <h1 id="card-detail-title" class="text-3xl font-semibold tracking-tight sm:text-4xl">
      Détail de la carte
    </h1>

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
  </section>
</template>
