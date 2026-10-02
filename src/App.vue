<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { fr } from '@nuxt/ui/locale'

const route = useRoute()
const main = useTemplateRef('main')
const navigation = [
  { label: 'Kanban', to: '/kanban' },
  { label: 'Connexion', to: '/connexion' },
  { label: 'Inscription', to: '/inscription' },
]

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
        </nav>
      </UContainer>
    </header>

    <main id="contenu-principal" ref="main" tabindex="-1" class="py-10 sm:py-16">
      <UContainer>
        <RouterView />
      </UContainer>
    </main>
  </UApp>
</template>
