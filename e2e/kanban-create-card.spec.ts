/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const lists = ['À lire', 'En cours'].map((title, position) => ({
  id: `list-${position + 1}`,
  title,
  position,
  ownerId: 'alice',
  createdAt: '2026-10-05T10:00:00.000Z',
}))
const createdCard = {
  id: 'created-card',
  title: 'Ressource à découvrir',
  description: 'Une description utile',
  position: 0,
  listId: 'list-1',
  createdAt: '2026-10-05T11:00:00.000Z',
  updatedAt: '2026-10-05T11:00:00.000Z',
}

async function login(page: Page) {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'kanban-token' } }),
  )
  await page.goto('/connexion')
  await page.getByLabel('Email', { exact: true }).fill('alice@example.com')
  await page.getByLabel('Mot de passe', { exact: true }).fill('SecretAlice42!')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
}

function column(page: Page, title = 'À lire') {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { level: 2, name: title, exact: true }),
  })
}

async function openDraft(page: Page) {
  await login(page)
  const first = column(page)
  await first.getByRole('button', { name: 'Ajouter une carte', exact: true }).click()
  await expect(first.getByLabel('Titre de la carte', { exact: true })).toBeFocused()
  return first
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*/cards', (route) => route.fulfill({ status: 200, json: [] }))
})

for (const width of [375, 1280]) {
  test(`la carte créée au clavier persiste après reconnexion à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const existing = { ...createdCard, id: 'existing-card', title: 'Carte existante', position: 9 }
    const savedCards = [existing]
    const requests: { path: string; body: unknown; authorization?: string }[] = []
    await page.route('**/api/lists/*/cards', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'POST') {
        requests.push({
          path,
          body: request.postDataJSON(),
          authorization: request.headers().authorization,
        })
        savedCards.unshift(createdCard)
        await route.fulfill({ status: 201, json: createdCard })
      } else {
        await route.fulfill({
          status: 200,
          json: path === '/api/lists/list-1/cards' ? [...savedCards, existing] : [],
        })
      }
    })
    await login(page)
    const first = column(page)
    const add = first.getByRole('button', { name: 'Ajouter une carte', exact: true })
    await expect(add).toBeVisible()
    await first.getByRole('link', { name: 'Carte existante', exact: true }).focus()
    await expect(first.getByRole('link', { name: 'Carte existante', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(add).toBeFocused()
    await page.keyboard.press('Enter')
    const title = first.getByLabel('Titre de la carte', { exact: true })
    const description = first.getByLabel('Description', { exact: true })
    const submit = first.getByRole('button', { name: 'Créer la carte', exact: true })
    await expect(title).toBeFocused()
    await page.keyboard.type('  Ressource à découvrir  ')
    await page.keyboard.press('Tab')
    await expect(description).toBeFocused()
    await page.keyboard.type('Une description utile')
    await expect(first.getByRole('heading', { name: 'Nouvelle carte', exact: true })).toBeVisible()
    await expect(submit).toBeInViewport({ ratio: 1 })
    await expect(first.getByRole('button', { name: 'Annuler', exact: true })).toBeInViewport({
      ratio: 1,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    expect(await first.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
      await first.evaluate((element) => element.clientWidth),
    )
    await page.screenshot({
      path: testInfo.outputPath(`creation-carte-${width}.png`),
      fullPage: true,
    })
    await page.keyboard.press('Tab')
    await expect(submit).toBeFocused()
    await page.keyboard.press('Enter')

    const success = page.getByRole('status').filter({ hasText: 'La carte a été créée.' })
    await expect(success).toHaveText('La carte a été créée.')
    await expect(success).toBeFocused()
    await expect(title).toHaveCount(0)
    await expect(first.getByRole('heading', { level: 3 })).toHaveText([
      'Ressource à découvrir',
      'Carte existante',
    ])
    await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveCount(0)
    expect(requests).toEqual([
      {
        path: '/api/lists/list-1/cards',
        body: { title: 'Ressource à découvrir', description: 'Une description utile' },
        authorization: 'Bearer kanban-token',
      },
    ])

    await page.reload()
    await expect(page).toHaveURL(/\/connexion$/)
    await login(page)
    await expect(first.getByRole('heading', { level: 3 })).toHaveText([
      'Ressource à découvrir',
      'Carte existante',
    ])
    expect(requests).toHaveLength(1)
  })
}

test('annuler au clavier efface le brouillon sans requête et restaure le focus', async ({
  page,
}) => {
  let posts = 0
  await page.route('**/api/lists/*/cards', async (route) => {
    if (route.request().method() === 'POST') posts += 1
    await route.fulfill({ status: 200, json: [] })
  })
  const first = await openDraft(page)
  const title = first.getByLabel('Titre de la carte', { exact: true })
  await title.fill('Brouillon')
  await page.keyboard.press('Tab')
  await expect(first.getByLabel('Description', { exact: true })).toBeFocused()
  await page.keyboard.type('À oublier')
  await page.keyboard.press('Tab')
  await expect(first.getByRole('button', { name: 'Créer la carte', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(first.getByRole('button', { name: 'Annuler', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  const add = first.getByRole('button', { name: 'Ajouter une carte', exact: true })
  await expect(add).toBeFocused()
  await expect(title).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(title).toHaveValue('')
  await expect(first.getByLabel('Description', { exact: true })).toHaveValue('')
  expect(posts).toBe(0)
})

for (const value of ['', '   ']) {
  test(`un titre de carte ${value ? 'composé d’espaces' : 'vide'} bloque la requête`, async ({
    page,
  }) => {
    let posts = 0
    await page.route('**/api/lists/*/cards', async (route) => {
      if (route.request().method() === 'POST') posts += 1
      await route.fulfill({ status: 200, json: [] })
    })
    const first = await openDraft(page)
    const title = first.getByLabel('Titre de la carte', { exact: true })
    await title.fill(value)
    await first.getByRole('button', { name: 'Créer la carte', exact: true }).click()
    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(posts).toBe(0)
  })
}

test('une description vide est facultative et la carte rejoint la colonne choisie', async ({
  page,
}) => {
  const requests: unknown[] = []
  await page.route('**/api/lists/*/cards', async (route) => {
    if (route.request().method() === 'POST') {
      requests.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      })
      await route.fulfill({
        status: 201,
        json: { ...createdCard, listId: 'list-2', description: '' },
      })
    } else await route.fulfill({ status: 200, json: [] })
  })
  await login(page)
  const second = column(page, 'En cours')
  await second.getByRole('button', { name: 'Ajouter une carte', exact: true }).click()
  await second.getByLabel('Titre de la carte', { exact: true }).fill('  Ressource à découvrir  ')
  await second.getByRole('button', { name: 'Créer la carte', exact: true }).click()
  await expect(second.getByRole('heading', { level: 3 })).toHaveText('Ressource à découvrir')
  await expect(column(page).getByRole('heading', { level: 3 })).toHaveCount(0)
  expect(requests).toEqual([
    { path: '/api/lists/list-2/cards', body: { title: 'Ressource à découvrir' } },
  ])
})

test('la création en cours désactive la saisie et empêche un second POST', async ({ page }) => {
  let posts = 0
  let receiveRequest!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists/*/cards', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1
      receiveRequest(route)
    } else await route.fulfill({ status: 200, json: [] })
  })
  const first = await openDraft(page)
  const title = first.getByLabel('Titre de la carte', { exact: true })
  await title.fill('Ressource à découvrir')
  await first.getByRole('button', { name: 'Créer la carte', exact: true }).click()
  const route = await pending
  await expect(title).toBeDisabled()
  await expect(first.getByLabel('Description', { exact: true })).toBeDisabled()
  await expect(first.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled()
  await expect(
    first.getByRole('button', { name: 'Création en cours…', exact: true }),
  ).toBeDisabled()
  await expect(first.getByRole('heading', { level: 3, name: 'Ressource à découvrir' })).toHaveCount(
    0,
  )
  await page.keyboard.press('Enter')
  await first.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  expect(posts).toBe(1)
  await route.fulfill({ status: 201, json: createdCard })
  await expect(first.getByRole('heading', { level: 3, name: 'Ressource à découvrir' })).toHaveCount(
    1,
  )
  expect(posts).toBe(1)
})

for (const failure of [
  {
    label: '400',
    status: 400,
    json: { message: 'Ce titre de carte est invalide.' },
    message: /titre.*invalide/i,
  },
  { label: 'serveur', status: 503, json: {}, message: /serveur|503/i },
  { label: 'réseau', status: null, json: {}, message: /réseau|connexion|joindre/i },
]) {
  test(`une erreur ${failure.label} conserve le brouillon sans création ni nouvelle tentative automatique`, async ({
    page,
  }) => {
    let posts = 0
    await page.route('**/api/lists/*/cards', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: [] })
        return
      }
      posts += 1
      if (posts > 1) await route.fulfill({ status: 201, json: createdCard })
      else if (failure.status === null) await route.abort('failed')
      else await route.fulfill({ status: failure.status, json: failure.json })
    })
    const first = await openDraft(page)
    const title = first.getByLabel('Titre de la carte', { exact: true })
    const description = first.getByLabel('Description', { exact: true })
    await title.fill('  Ressource à découvrir  ')
    await description.fill('Une description utile')
    const submit = first.getByRole('button', { name: 'Créer la carte', exact: true })
    await submit.click()
    await expect(first.getByRole('alert')).toContainText(failure.message)
    await expect(title).toHaveValue('  Ressource à découvrir  ')
    await expect(description).toHaveValue('Une description utile')
    await expect(title).toBeEnabled()
    await expect(submit).toBeEnabled()
    await expect(
      first.getByRole('heading', { level: 3, name: 'Ressource à découvrir' }),
    ).toHaveCount(0)
    expect(posts).toBe(1)
    await title.fill('Ressource à découvrir')
    await submit.click()
    await expect(
      first.getByRole('heading', { level: 3, name: 'Ressource à découvrir' }),
    ).toHaveCount(1)
    await expect(first.getByRole('alert')).toHaveCount(0)
    expect(posts).toBe(2)
  })
}

for (const status of [403, 404]) {
  test(`un ${status} de création resynchronise les listes et n’ajoute aucune carte fictive`, async ({
    page,
  }) => {
    let listRequests = 0
    let posts = 0
    await page.route('**/api/lists', async (route) => {
      listRequests += 1
      await route.fulfill({ status: 200, json: listRequests === 1 ? lists : [lists[1]] })
    })
    await page.route('**/api/lists/*/cards', async (route) => {
      if (route.request().method() === 'POST') {
        posts += 1
        await route.fulfill({ status, json: { message: 'Not accessible' } })
      } else await route.fulfill({ status: 200, json: [] })
    })
    const first = await openDraft(page)
    await first.getByLabel('Titre de la carte', { exact: true }).fill('Ressource à découvrir')
    await first.getByRole('button', { name: 'Créer la carte', exact: true }).click()
    await expect(first).toHaveCount(0)
    await expect(column(page, 'En cours')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Ressource à découvrir', exact: true }),
    ).toHaveCount(0)
    await expect(page).toHaveURL(/\/kanban$/)
    expect(listRequests).toBe(2)
    expect(posts).toBe(1)
  })
}

test('un 401 de création expire la session et retire le tableau', async ({ page }) => {
  await page.route('**/api/lists/*/cards', (route) =>
    route.fulfill({ status: route.request().method() === 'POST' ? 401 : 200, json: [] }),
  )
  const first = await openDraft(page)
  await first.getByLabel('Titre de la carte', { exact: true }).fill('Ressource à découvrir')
  await first.getByRole('button', { name: 'Créer la carte', exact: true }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
})

test('l’ajout est disponible uniquement après le chargement réussi des cartes', async ({
  page,
}) => {
  let receiveRequest!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists/list-1/cards', (route) => receiveRequest(route))
  await page.route('**/api/lists/list-2/cards', (route) => route.fulfill({ status: 503, json: {} }))
  await login(page)
  const route = await pending
  await expect(column(page).getByRole('status')).toHaveText('Chargement des cartes…')
  await expect(
    column(page).getByRole('button', { name: 'Ajouter une carte', exact: true }),
  ).toHaveCount(0)
  await expect(column(page, 'En cours').getByRole('alert')).toBeVisible()
  await expect(
    column(page, 'En cours').getByRole('button', { name: 'Ajouter une carte', exact: true }),
  ).toHaveCount(0)
  await route.fulfill({ status: 200, json: [] })
  await expect(
    column(page).getByRole('button', { name: 'Ajouter une carte', exact: true }),
  ).toBeVisible()
})
