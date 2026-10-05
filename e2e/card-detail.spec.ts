/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const lists = ['À lire', 'En cours'].map((title, position) => ({
  id: `list-${position + 1}`,
  title,
  position,
  ownerId: 'alice',
  createdAt: '2026-10-05T10:00:00.000Z',
}))
const card = {
  id: 'card-1',
  title: 'Ressource à découvrir',
  description: 'Une description utile',
  position: 0,
  listId: 'list-1',
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
}

async function login(page: Page) {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'kanban-token' } }),
  )
  await page.goto('/connexion')
  await page.getByLabel('Email', { exact: true }).fill('alice@example.com')
  await page.getByLabel('Mot de passe', { exact: true }).fill('SecretAlice42!')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(
    page.getByRole('heading', { level: 3, name: 'Ressource à découvrir', exact: true }),
  ).toBeVisible()
}

async function openDetail(page: Page) {
  await login(page)
  await page.getByRole('link', { name: 'Ressource à découvrir', exact: true }).click()
  await expect(page).toHaveURL(/\/cartes\/card-1$/)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*/cards', (route) =>
    route.fulfill({
      status: 200,
      json: new URL(route.request().url()).pathname === '/api/lists/list-1/cards' ? [card] : [],
    }),
  )
  await page.route('**/api/cards/*', (route) => route.fulfill({ status: 200, json: card }))
})

test('le titre de carte ouvre le détail au clavier et permet le retour au tableau', async ({
  page,
}) => {
  await login(page)
  const link = page.getByRole('link', { name: 'Ressource à découvrir', exact: true })
  await expect(link).toHaveAttribute('href', '/cartes/card-1')
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/cartes\/card-1$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Détail de la carte')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ressource à découvrir')
  await expect(page.getByText('Une description utile', { exact: true })).toBeVisible()
  await expect(page.getByRole('definition')).toContainText(['À lire'])
  await page.getByRole('link', { name: 'Retour au tableau', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/kanban$/)
  await expect(page.getByRole('heading', { level: 3 })).toHaveText('Ressource à découvrir')
})

test('le détail recharge la liste actuelle de la carte avant de dévoiler le contenu', async ({
  page,
}) => {
  const requests: { path: string; method: string; authorization?: string }[] = []
  let listRequests = 0
  let receiveLists!: (route: Route) => void
  const pendingLists = new Promise<Route>((resolve) => {
    receiveLists = resolve
  })
  await page.route('**/api/lists', async (route) => {
    listRequests += 1
    if (listRequests === 1) await route.fulfill({ status: 200, json: lists })
    else {
      requests.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        authorization: route.request().headers().authorization,
      })
      receiveLists(route)
    }
  })
  await page.route('**/api/cards/card-1', async (route) => {
    requests.push({
      path: new URL(route.request().url()).pathname,
      method: route.request().method(),
      authorization: route.request().headers().authorization,
    })
    await route.fulfill({
      status: 200,
      json: { ...card, title: 'Carte déplacée et actualisée', listId: 'list-2' },
    })
  })
  await openDetail(page)
  const route = await pendingLists
  await expect(page.getByRole('status')).toHaveText('Chargement de la carte…')
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  await expect(page.getByText('Une description utile', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Retour au tableau', exact: true })).toBeVisible()
  await route.fulfill({
    status: 200,
    json: [lists[0], { ...lists[1], title: 'Liste renommée récemment' }],
  })
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Carte déplacée et actualisée')
  await expect(page.getByRole('definition')).toContainText(['Liste renommée récemment'])
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(requests).toEqual([
    { path: '/api/cards/card-1', method: 'GET', authorization: 'Bearer kanban-token' },
    { path: '/api/lists', method: 'GET', authorization: 'Bearer kanban-token' },
  ])
})

for (const width of [375, 1280]) {
  test(`le détail affiche les longs textes sans HTML actif ni débordement à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const title = '<script>alert("titre")</script> ' + 'UnTitreSansEspaces'.repeat(35)
    const description =
      '<img src=x onerror=alert("description")>\n' + 'DescriptionSansEspaces'.repeat(100)
    await page.route('**/api/cards/card-1', (route) =>
      route.fulfill({ status: 200, json: { ...card, title, description } }),
    )
    await openDetail(page)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(title)
    await expect(page.getByText(description, { exact: true })).toBeVisible()
    await expect(page.locator('main script, main img')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Retour au tableau', exact: true })).toBeInViewport(
      {
        ratio: 1,
      },
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({
      path: testInfo.outputPath(`detail-carte-${width}.png`),
      fullPage: true,
    })
  })
}

test('une carte sans description annonce explicitement cette absence', async ({ page }) => {
  await page.route('**/api/cards/card-1', (route) =>
    route.fulfill({ status: 200, json: { ...card, description: '' } }),
  )
  await openDetail(page)
  await expect(page.getByText('Aucune description.', { exact: true })).toBeVisible()
})

for (const stage of ['carte', 'listes']) {
  const source = stage === 'carte' ? 'de la carte' : 'des listes'
  const message =
    stage === 'carte' ? 'Identifiant de carte invalide.' : 'Requête de listes invalide.'

  for (const status of [400, 403, 404]) {
    const expectedError =
      status === 400
        ? /invalide|erreur|charger|chargement/i
        : /inaccessible|introuvable|accès|n.existe plus/i

    test(`un ${status} ${source} masque le contenu privé et conserve le retour sans réessai`, async ({
      page,
    }) => {
      await login(page)
      await page.route(stage === 'carte' ? '**/api/cards/card-1' : '**/api/lists', (route) =>
        route.fulfill({
          status,
          json: { message: status === 400 ? message : 'private server details' },
        }),
      )
      await page.getByRole('link', { name: 'Ressource à découvrir', exact: true }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('alert')).toContainText(expectedError)
      await expect(page.getByText('private server details', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
      await expect(page.getByText('Une description utile', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Retour au tableau', exact: true })).toBeVisible()
      await expect(page).toHaveURL(/\/cartes\/card-1$/)
    })
  }

  test(`un 401 ${source} expire la session et retire le détail`, async ({ page }) => {
    await login(page)
    await page.route(stage === 'carte' ? '**/api/cards/card-1' : '**/api/lists', (route) =>
      route.fulfill({ status: 401, json: {} }),
    )
    await page.getByRole('link', { name: 'Ressource à découvrir', exact: true }).click()
    await expect(page).toHaveURL(/\/connexion$/)
    await expect(page.getByRole('alert')).toHaveText(
      'Votre session a expiré. Veuillez vous reconnecter.',
    )
    await expect(page.getByRole('heading', { level: 1, name: 'Détail de la carte' })).toHaveCount(0)
    await expect(page.getByText('Une description utile', { exact: true })).toHaveCount(0)
  })

  for (const failure of ['réseau', 'serveur']) {
    test(`une erreur ${failure} ${source} permet un seul réessai en cours au clavier`, async ({
      page,
    }) => {
      await login(page)
      let attempts = 0
      let receiveRetry!: (route: Route) => void
      const pendingRetry = new Promise<Route>((resolve) => {
        receiveRetry = resolve
      })
      await page.route(
        stage === 'carte' ? '**/api/cards/card-1' : '**/api/lists',
        async (route) => {
          attempts += 1
          if (attempts > 1) receiveRetry(route)
          else if (failure === 'réseau') await route.abort('failed')
          else await route.fulfill({ status: 503, json: {} })
        },
      )
      await page.getByRole('link', { name: 'Ressource à découvrir', exact: true }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
      const retry = page.getByRole('button', { name: 'Réessayer', exact: true })
      await retry.focus()
      await expect(retry).toBeFocused()
      await page.keyboard.press('Enter')
      const route = await pendingRetry
      await expect(page.getByRole('status')).toHaveText('Chargement de la carte…')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await page.keyboard.press('Enter')
      expect(attempts).toBe(2)
      await route.fulfill({ status: 200, json: stage === 'carte' ? card : lists })
      await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ressource à découvrir')
      await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0)
      expect(attempts).toBe(2)
    })
  }

  test(`le retour pendant le chargement ${source} empêche une réponse tardive de rouvrir le détail`, async ({
    page,
  }) => {
    await login(page)
    let receiveRequest!: (route: Route) => void
    const pending = new Promise<Route>((resolve) => {
      receiveRequest = resolve
    })
    let attempts = 0
    await page.route(stage === 'carte' ? '**/api/cards/card-1' : '**/api/lists', async (route) => {
      attempts += 1
      if (attempts === 1) receiveRequest(route)
      else await route.fulfill({ status: 200, json: lists })
    })
    await page.getByRole('link', { name: 'Ressource à découvrir', exact: true }).click()
    const route = await pending
    await expect(page.getByRole('status')).toHaveText('Chargement de la carte…')
    const canceled = page.waitForEvent('requestfailed', {
      predicate: (request) => request === route.request(),
    })
    await page.getByRole('link', { name: 'Retour au tableau', exact: true }).click()
    await expect(page).toHaveURL(/\/kanban$/)
    await expect(page.getByRole('heading', { level: 3 })).toHaveText('Ressource à découvrir')
    await route.fulfill({
      status: 200,
      json: stage === 'carte' ? { ...card, title: 'Ancien détail privé' } : lists,
    })
    await canceled
    await expect(page).toHaveURL(/\/kanban$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Détail de la carte' })).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'Ancien détail privé', exact: true }),
    ).toHaveCount(0)
  })
}
