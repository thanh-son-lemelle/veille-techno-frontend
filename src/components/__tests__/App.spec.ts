import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import App from '@/App.vue'
import appRouter from '@/router'

enableAutoUnmount(afterEach)

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: appRouter.options.routes,
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router, ui] } })
  await flushPromises()
  return { wrapper, router }
}

describe('Application', () => {
  it('ouvre le Kanban depuis la racine et active son lien de navigation', async () => {
    const { wrapper, router } = await mountAt('/')

    expect(router.currentRoute.value.path).toBe('/kanban')
    expect(wrapper.get('h1').text()).toBe('Tableau Kanban')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Kanban')
  })

  it('affiche la page demandée et indique le lien actif après navigation', async () => {
    const { wrapper, router } = await mountAt('/connexion')
    expect(wrapper.get('h1').text()).toBe('Connexion')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Connexion')

    await router.push('/inscription')
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Inscription')
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Inscription')
  })

  it('conserve la navigation et propose un retour pour une adresse inconnue', async () => {
    const { wrapper } = await mountAt('/page-absente')
    expect(wrapper.get('h1').text()).toBe('Page introuvable')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Navigation principale')
    expect(wrapper.get('main a').attributes('href')).toBe('/kanban')
  })
})
