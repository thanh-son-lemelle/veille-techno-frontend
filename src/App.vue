<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { fr } from '@nuxt/ui/locale'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const main = useTemplateRef('main')
const navigation = computed(() =>
  session.isAuthenticated
    ? [{ label: 'Kanban', to: '/kanban' }]
    : [
        { label: 'Kanban', to: '/kanban' },
        { label: 'Connexion', to: '/connexion' },
        { label: 'Inscription', to: '/inscription' },
      ],
)

function restorePage(event: PageTransitionEvent) {
  if (event.persisted && route.meta.requiresAuth && !session.isAuthenticated) {
    void router.replace({ name: 'connexion' })
  }
}

onMounted(() => {
  // Une page conservée dans le cache arrière/avant garde aussi sa mémoire JavaScript.
  window.addEventListener('pagehide', session.logout)
  window.addEventListener('pageshow', restorePage)
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', session.logout)
  window.removeEventListener('pageshow', restorePage)
})

watch(
  () => route.path,
  async () => {
    await nextTick()
    main.value?.focus()
  },
)
</script>

<template>
  <UApp :locale="fr">
    <a class="skip-link" href="#contenu-principal">Aller au contenu</a>

    <header class="border-b border-default bg-default">
      <UContainer class="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
        <RouterLink class="w-fit text-xl font-semibold tracking-tight" to="/kanban">
          Veille <span class="text-primary">Kanban</span>
        </RouterLink>
        <nav aria-label="Navigation principale" class="flex flex-wrap gap-2">
          <UButton
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            :label="item.label"
            exact
            color="neutral"
            variant="ghost"
            active-variant="soft"
          />
          <UButton
            v-if="session.isAuthenticated"
            color="neutral"
            variant="ghost"
            @click="session.logout"
          >
            Se déconnecter
          </UButton>
        </nav>
      </UContainer>
    </header>

    <main id="contenu-principal" ref="main" tabindex="-1" class="py-10 sm:py-16">
      <UContainer>
        <p v-if="session.expired" role="alert" class="mb-5 text-error">
          Votre session a expiré. Veuillez vous reconnecter.
        </p>
        <RouterView v-slot="{ Component }">
          <component
            :is="Component"
            v-if="!route.meta.requiresAuth || session.isAuthenticated"
            :key="session.version"
          />
        </RouterView>
      </UContainer>
    </main>
  </UApp>
</template>
