/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const lists = ['À lire', 'En cours', 'Terminé'].map((title, position) => ({
  id: `list-${position + 1}`,
  title,
  position,
  ownerId: 'alice',
  createdAt: '2026-10-05T10:00:00.000Z',
}))

const cards = [
  {
    id: 'card-2',
    title: 'Une carte avec un titre très long pour préparer la veille technique '.repeat(3),
    description: 'UneDescriptionSansEspaces'.repeat(30),
    position: 9,
    listId: 'list-1',
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
  },
  {
    id: 'card-1',
    title: '<script>alert("carte")</script>',
    description: '<img src=x onerror=alert("description")>',
    position: 0,
    listId: 'list-1',
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
  },
]

async function login(page: Page) {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'kanban-token' } }),
  )
  await page.goto('/connexion')
  await page.getByLabel('Email', { exact: true }).fill('alice@example.com')
  await page.getByLabel('Mot de passe', { exact: true }).fill('SecretAlice42!')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
}

function column(page: Page, title: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { level: 2, name: title, exact: true }),
  })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*/cards', (route) => route.fulfill({ status: 200, json: [] }))
})

for (const width of [375, 1280]) {
  test(`les cartes conservent l’ordre serveur sans doublons ni débordement à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const requests: { path: string; method: string; authorization?: string }[] = []
    await page.route('**/api/lists/*/cards', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      requests.push({
        path,
        method: request.method(),
        authorization: request.headers().authorization,
      })
      await route.fulfill({
        status: 200,
        json: path === '/api/lists/list-1/cards' ? [...cards, cards[0]] : [],
      })
    })
    await login(page)

    const first = column(page, 'À lire')
    await expect(first.getByRole('heading', { level: 3 })).toHaveText([
      cards[0]!.title.trim(),
      cards[1]!.title,
    ])
    await expect(first.getByText(cards[0]!.description, { exact: true })).toBeVisible()
    await expect(first.getByText(cards[1]!.description, { exact: true })).toBeVisible()
    await expect(first.locator('script, img')).toHaveCount(0)
    await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveCount(0)
    await expect(
      column(page, 'Terminé').getByText('Aucune carte dans cette liste.', { exact: true }),
    ).toBeVisible()
    expect(requests.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      { path: '/api/lists/list-1/cards', method: 'GET', authorization: 'Bearer kanban-token' },
      { path: '/api/lists/list-2/cards', method: 'GET', authorization: 'Bearer kanban-token' },
      { path: '/api/lists/list-3/cards', method: 'GET', authorization: 'Bearer kanban-token' },
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    expect(await first.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
      await first.evaluate((element) => element.clientWidth),
    )
    await page.screenshot({ path: testInfo.outputPath(`cartes-${width}.png`), fullPage: true })
  })
}

test('chaque colonne charge indépendamment et annonce son état vide après la réponse', async ({
  page,
}) => {
  let receiveRequest!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists/list-1/cards', (route) => receiveRequest(route))
  await page.route('**/api/lists/list-2/cards', (route) =>
    route.fulfill({
      status: 200,
      json: [{ ...cards[1], id: 'other-card', title: 'Carte déjà disponible', listId: 'list-2' }],
    }),
  )
  await login(page)
  const route = await pending

  const first = column(page, 'À lire')
  await expect(first.getByRole('status')).toHaveText('Chargement des cartes…')
  await expect(first.getByText('Aucune carte dans cette liste.', { exact: true })).toHaveCount(0)
  await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveText(
    'Carte déjà disponible',
  )
  await expect(
    column(page, 'Terminé').getByText('Aucune carte dans cette liste.', { exact: true }),
  ).toBeVisible()
  await route.fulfill({ status: 200, json: [] })
  await expect(first.getByText('Aucune carte dans cette liste.', { exact: true })).toBeVisible()
  await expect(first.getByRole('status')).toHaveCount(0)
})

for (const failure of ['réseau', 'serveur']) {
  test(`une erreur ${failure} se réessaie au clavier sans recharger les autres colonnes`, async ({
    page,
  }) => {
    const requests = new Map<string, number>()
    let receiveRetry!: (route: Route) => void
    const pending = new Promise<Route>((resolve) => {
      receiveRetry = resolve
    })
    await page.route('**/api/lists/*/cards', async (route) => {
      const path = new URL(route.request().url()).pathname
      const attempt = (requests.get(path) ?? 0) + 1
      requests.set(path, attempt)
      if (path === '/api/lists/list-1/cards') {
        if (attempt > 1) receiveRetry(route)
        else if (failure === 'réseau') await route.abort('failed')
        else await route.fulfill({ status: 503, json: {} })
      } else {
        await route.fulfill({
          status: 200,
          json:
            path === '/api/lists/list-2/cards'
              ? [{ ...cards[1], id: 'other-card', title: 'Carte conservée', listId: 'list-2' }]
              : [],
        })
      }
    })
    await login(page)
    const first = column(page, 'À lire')
    await expect(first.getByRole('alert')).toBeVisible()
    await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveText(
      'Carte conservée',
    )
    const retry = first.getByRole('button', { name: 'Réessayer', exact: true })
    await page.getByRole('button', { name: 'Supprimer la liste « À lire »', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(retry).toBeFocused()
    await page.keyboard.press('Enter')
    const route = await pending

    await expect(first.getByRole('status')).toHaveText('Chargement des cartes…')
    await expect(first.getByRole('alert')).toHaveCount(0)
    await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveText(
      'Carte conservée',
    )
    await route.fulfill({ status: 200, json: cards })
    await expect(first.getByRole('heading', { level: 3 })).toHaveCount(2)
    await expect(first.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0)
    expect(Object.fromEntries(requests)).toEqual({
      '/api/lists/list-1/cards': 2,
      '/api/lists/list-2/cards': 1,
      '/api/lists/list-3/cards': 1,
    })
  })
}

for (const { status, message } of [
  { status: 400, message: 'Identifiant de liste invalide.' },
  { status: 403, message: /inaccessible|accès|introuvable|n.existe plus/i },
  { status: 404, message: /inaccessible|accès|introuvable|n.existe plus/i },
]) {
  test(`une réponse ${status} affiche une erreur sans cartes ni nouvelle tentative`, async ({
    page,
  }) => {
    await page.route('**/api/lists/list-1/cards', (route) =>
      route.fulfill({
        status,
        json: { message: status === 400 ? 'Identifiant de liste invalide.' : 'Not accessible' },
      }),
    )
    await login(page)

    const first = column(page, 'À lire')
    await expect(first.getByRole('alert')).toBeVisible()
    await expect(first.getByRole('alert')).toContainText(message)
    await expect(first.getByRole('heading', { level: 3 })).toHaveCount(0)
    await expect(first.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0)
    await expect(
      column(page, 'Terminé').getByText('Aucune carte dans cette liste.', { exact: true }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/kanban$/)
  })
}

test('un 401 des cartes expire la session et retire le tableau', async ({ page }) => {
  await page.route('**/api/lists/list-1/cards', (route) => route.fulfill({ status: 401, json: {} }))
  await login(page)

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
})

test('une réponse tardive de la session précédente ne remplace pas les nouvelles cartes', async ({
  page,
}) => {
  let receiveRequest!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  let attempts = 0
  await page.route('**/api/lists/list-1/cards', async (route) => {
    attempts += 1
    if (attempts === 1) receiveRequest(route)
    else
      await route.fulfill({
        status: 200,
        json: [{ ...cards[1], title: 'Carte de la nouvelle session' }],
      })
  })
  await login(page)
  const route = await pending
  await expect(column(page, 'À lire').getByRole('status')).toHaveText('Chargement des cartes…')
  const canceled = page.waitForEvent('requestfailed', {
    predicate: (request) => request === route.request(),
  })
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await login(page)
  await expect(column(page, 'À lire').getByRole('heading', { level: 3 })).toHaveText(
    'Carte de la nouvelle session',
  )
  await route.fulfill({ status: 200, json: [{ ...cards[0], title: 'Ancienne carte privée' }] })
  await canceled
  await expect(page.getByRole('heading', { name: 'Ancienne carte privée', level: 3 })).toHaveCount(
    0,
  )
  await expect(column(page, 'À lire').getByRole('heading', { level: 3 })).toHaveText(
    'Carte de la nouvelle session',
  )
})
