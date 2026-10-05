/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const lists = [
  'À lire',
  'En cours',
  'Une liste avec un titre très long pour organiser toutes les ressources de veille technique',
  'UnTitreSansEspaces'.repeat(12),
  '<script>alert("titre")</script>',
  'Terminé',
].map((title, position) => ({
  id: `list-${position}`,
  title,
  position,
  ownerId: 'alice',
  createdAt: '2026-10-05T10:00:00.000Z',
}))

async function login(page: Page) {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'kanban-token' } }),
  )
  await page.goto('/connexion')
  await page.getByLabel('Email', { exact: true }).fill('alice@example.com')
  await page.getByLabel('Mot de passe', { exact: true }).fill('SecretAlice42!')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
}

for (const width of [375, 1280]) {
  test(`les listes restent dans l’ordre du serveur sans débordement à ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    let requests = 0
    await page.route('**/api/lists', async (route) => {
      requests += 1
      expect(route.request().method()).toBe('GET')
      expect(route.request().headers().authorization).toBe('Bearer kanban-token')
      // Le serveur décide de l’ordre, même si les positions ne sont pas croissantes.
      await route.fulfill({ status: 200, json: [...lists].reverse() })
    })
    await login(page)

    const board = page.getByRole('region', { name: 'Listes du tableau Kanban', exact: true })
    await expect(board).toBeVisible()
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(
      [...lists].reverse().map((list) => list.title),
    )
    await expect(board.getByRole('listitem')).toHaveCount(lists.length)
    await expect(board.locator('script')).toHaveCount(0)
    expect(requests).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    expect(await board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  })
}

test('le tableau se rejoint et défile au clavier', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await login(page)
  const board = page.getByRole('region', { name: 'Listes du tableau Kanban', exact: true })
  await expect(board).toBeVisible()
  await expect(board).toHaveAttribute('tabindex', '0')
  await page.locator('main#contenu-principal').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Ajouter une liste', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(board).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})

test('un tableau vide invite à créer la première liste', async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: [] }))
  await login(page)

  await expect(
    page.getByRole('heading', { name: 'Votre tableau est vide', level: 2 }),
  ).toBeVisible()
  await expect(
    page.getByText('Créez votre première liste pour commencer à organiser votre veille.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const failure of ['réseau', 'serveur']) {
  test(`une erreur ${failure} permet de réessayer puis affiche les listes`, async ({ page }) => {
    let requests = 0
    let receiveRetry!: (route: Route) => void
    const retry = new Promise<Route>((resolve) => {
      receiveRetry = resolve
    })
    await page.route('**/api/lists', async (route) => {
      requests += 1
      if (requests > 1) {
        receiveRetry(route)
      } else if (failure === 'réseau') {
        await route.abort('failed')
      } else {
        await route.fulfill({ status: 503, json: { message: 'Service unavailable' } })
      }
    })
    await login(page)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/kanban$/)
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
    const route = await retry

    await expect(page.getByRole('status')).toHaveText('Chargement des listes…')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await route.fulfill({ status: 200, json: lists.slice(0, 1) })
    await expect(page.getByRole('heading', { name: 'À lire', level: 2, exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(requests).toBe(2)
  })
}

test('le chargement initial attend les listes sans annoncer un tableau vide', async ({ page }) => {
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists', (route) => receiveRequest(route))
  await login(page)
  const route = await pendingRequest

  await expect(page.getByRole('status')).toHaveText('Chargement des listes…')
  await expect(page.getByRole('heading', { name: 'Votre tableau est vide' })).toHaveCount(0)
  await route.fulfill({ status: 200, json: lists.slice(0, 1) })
  await expect(page.getByRole('heading', { name: 'À lire', level: 2, exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('un 401 pendant le chargement des listes demande une reconnexion', async ({ page }) => {
  await page.route('**/api/lists', (route) =>
    route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
  )
  await login(page)

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0)
})

test('la déconnexion retire les listes personnelles du document', async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await login(page)
  await expect(page.getByRole('heading', { name: 'À lire', level: 2, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByText(lists[3]!.title, { exact: true })).toHaveCount(0)
})
