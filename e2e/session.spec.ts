/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: [] }))
})

async function fillLogin(page: Page, email = 'lea@example.com', password = 'SecretLea42!') {
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1, exact: true })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
}

async function mockLogin(route: Route) {
  await route.fulfill({ status: 200, json: { accessToken: 'session-e2e-token' } })
}

test('un accès direct au Kanban sans session demande une connexion', async ({ page }) => {
  await page.goto('/kanban')

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toHaveCount(0)
})

for (const width of [375, 1280]) {
  test(`la connexion adapte la navigation sans débordement à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/auth/login', mockLogin)
    await page.goto('/connexion')
    await fillLogin(page)

    await expect(page).toHaveURL(/\/kanban$/)
    await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
    const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
    const kanban = navigation.getByRole('link', { name: 'Kanban', exact: true })
    const logout = navigation.getByRole('button', { name: 'Se déconnecter', exact: true })
    await expect(kanban).toHaveAttribute('href', '/kanban')
    for (const control of [kanban, logout]) {
      await expect(control).toBeVisible()
      await expect(control).toBeInViewport({ ratio: 1 })
    }
    for (const label of ['Connexion', 'Inscription']) {
      await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveCount(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
  })
}

test('recharger oublie la session sans stocker le jeton ni les identifiants', async ({
  page,
}) => {
  await page.route('**/api/auth/login', mockLogin)
  await page.goto('/connexion')
  await fillLogin(page)
  await expect(page).toHaveURL(/\/kanban$/)

  const stored = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  )
  for (const secret of ['session-e2e-token', 'lea@example.com', 'SecretLea42!']) {
    expect(stored).not.toContain(secret)
  }
  await page.reload()

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toHaveCount(0)
})

test('l’historique ne réouvre pas un formulaire public pendant une session', async ({ page }) => {
  await page.route('**/api/auth/login', mockLogin)
  await page.goto('/inscription')
  await page.getByRole('link', { name: 'Aller à la connexion', exact: true }).click()
  await fillLogin(page)
  await expect(page).toHaveURL(/\/kanban$/)

  await page.goBack()

  await expect(page).toHaveURL(/\/kanban$/)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible()
})

test('la déconnexion protège le Kanban même après Retour', async ({ page }) => {
  await page.route('**/api/auth/login', mockLogin)
  await page.goto('/inscription')
  await page.getByRole('link', { name: 'Aller à la connexion', exact: true }).click()
  await fillLogin(page)
  await expect(page).toHaveURL(/\/kanban$/)
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()

  await expect(page).toHaveURL(/\/connexion$/)
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
  for (const label of ['Kanban', 'Connexion', 'Inscription']) {
    await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await page.goBack()

  await expect(page).toHaveURL(/\/inscription$/)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toHaveCount(0)
  await navigation.getByRole('link', { name: 'Kanban', exact: true }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible()
})

test('une déconnexion permet de se connecter avec un autre compte', async ({ page }) => {
  const requests: unknown[] = []
  await page.route('**/api/auth/login', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      json: { accessToken: requests.length === 1 ? 'lea-token' : 'noe-token' },
    })
  })
  await page.goto('/connexion')
  await fillLogin(page)
  await expect(page).toHaveURL(/\/kanban$/)
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')

  await fillLogin(page, 'noe@example.com', 'SecretNoe42!')

  await expect(page).toHaveURL(/\/kanban$/)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible()
  expect(requests).toEqual([
    { email: 'lea@example.com', password: 'SecretLea42!' },
    { email: 'noe@example.com', password: 'SecretNoe42!' },
  ])
})

test('une destination externe dans la query ne détourne pas la connexion', async ({ page }) => {
  await page.route('**/api/auth/login', mockLogin)
  await page.goto('/connexion?redirect=https%3A%2F%2Fexample.com%2Fcollect-token')
  const origin = new URL(page.url()).origin
  await fillLogin(page)

  await expect(page).toHaveURL(`${origin}/kanban`)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
})

test('quitter la connexion ignore un succès tardif et garde le Kanban protégé', async ({
  page,
}) => {
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/auth/login', (route) => receiveRequest(route))
  await page.goto('/connexion')
  await fillLogin(page)
  const route = await pendingRequest
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
  await navigation.getByRole('link', { name: 'Inscription', exact: true }).click()
  await expect(page).toHaveURL(/\/inscription$/)

  const response = page.waitForResponse('**/api/auth/login')
  await mockLogin(route)
  await (await response).finished()
  await expect(page.getByRole('heading', { name: 'Inscription', level: 1 })).toBeVisible()
  await navigation.getByRole('link', { name: 'Kanban', exact: true }).click()

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toHaveCount(0)
})
