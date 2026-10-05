import { watch } from 'vue'
import type { Pinia } from 'pinia'
import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'

export function createAppRouter(
  pinia: Pinia,
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const session = useSessionStore(pinia)
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/kanban' },
      {
        path: '/kanban',
        name: 'kanban',
        meta: { requiresAuth: true },
        component: () => import('../views/KanbanView.vue'),
      },
      {
        path: '/connexion',
        name: 'connexion',
        meta: { guestOnly: true },
        component: () => import('../views/LoginView.vue'),
      },
      {
        path: '/inscription',
        name: 'inscription',
        meta: { guestOnly: true },
        component: () => import('../views/RegisterView.vue'),
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../views/NotFoundView.vue'),
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  })

  router.beforeEach((to) => {
    if (to.meta.requiresAuth && !session.isAuthenticated) {
      return { name: 'connexion', replace: true }
    }
    if (to.meta.guestOnly && session.isAuthenticated) {
      return { name: 'kanban', replace: true }
    }
  })

  watch(
    () => session.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (wasAuthenticated && !authenticated) void router.replace({ name: 'connexion' })
    },
    { flush: 'sync' },
  )

  return router
}
