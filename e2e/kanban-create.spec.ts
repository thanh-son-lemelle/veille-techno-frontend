/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists/*/cards', (route) => route.fulfill({ status: 200, json: [] }))
})

const existingList = {
  id: 'list-1',
  title: 'À lire',
  position: 0,
  ownerId: 'alice',
  createdAt: '2026-10-05T10:00:00.000Z',
}
const createdList = {
  id: 'list-2',
  title: 'À approfondir',
  position: 1,
  ownerId: 'alice',
  createdAt: '2026-10-05T11:00:00.000Z',
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

for (const width of [375, 1280]) {
  test(`la création au clavier persiste après rechargement sans débordement à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const savedLists = [existingList]
    const requests: { body: unknown; authorization: string | undefined }[] = []
    await page.route('**/api/lists', async (route) => {
      if (route.request().method() === 'POST') {
        requests.push({
          body: route.request().postDataJSON(),
          authorization: route.request().headers().authorization,
        })
        savedLists.push(createdList)
        await route.fulfill({ status: 201, json: createdList })
      } else {
        await route.fulfill({ status: 200, json: savedLists })
      }
    })
    await login(page)
    const add = page.getByRole('button', { name: 'Ajouter une liste', exact: true })
    await expect(add).toBeVisible()
    await page.locator('main#contenu-principal').focus()
    await page.keyboard.press('Tab')
    await expect(add).toBeFocused()
    await page.keyboard.press('Enter')
    const title = page.getByLabel('Titre de la liste', { exact: true })
    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('name', 'title')
    await page.keyboard.type('  À approfondir  ')
    await expect(page.getByRole('heading', { name: 'Nouvelle liste', exact: true })).toBeVisible()
    await expect(title).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Créer la liste', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeInViewport({
      ratio: 1,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: testInfo.outputPath(`creation-${width}.png`), fullPage: true })
    await page.keyboard.press('Enter')

    const board = page.getByRole('region', { name: 'Listes du tableau Kanban', exact: true })
    await expect(page.getByRole('status').filter({ hasText: 'La liste a été créée.' })).toHaveText(
      'La liste a été créée.',
    )
    await expect(title).toHaveCount(0)
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['À lire', 'À approfondir'])
    expect(requests).toEqual([
      { body: { title: 'À approfondir' }, authorization: 'Bearer kanban-token' },
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )

    await page.reload()
    // La session reste en mémoire : un vrai rechargement exige une nouvelle connexion.
    await expect(page).toHaveURL(/\/connexion$/)
    await login(page)
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['À lire', 'À approfondir'])
    await expect(board.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(requests).toHaveLength(1)
  })
}

test('annuler au clavier efface le brouillon et rend le focus au bouton d’ajout', async ({
  page,
}) => {
  let postRequests = 0
  await page.route('**/api/lists', async (route) => {
    if (route.request().method() === 'POST') postRequests += 1
    await route.fulfill({ status: 200, json: [] })
  })
  await login(page)
  const add = page.getByRole('button', { name: 'Ajouter une liste', exact: true })
  await add.click()
  const title = page.getByLabel('Titre de la liste', { exact: true })
  await expect(title).toBeFocused()
  await page.keyboard.type('Brouillon à oublier')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Créer la liste', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(title).toHaveCount(0)
  await expect(add).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('')
  expect(postRequests).toBe(0)
})

for (const value of ['', '   ']) {
  test(`un titre ${value ? 'composé d’espaces' : 'vide'} bloque la création`, async ({ page }) => {
    let postRequests = 0
    await page.route('**/api/lists', async (route) => {
      if (route.request().method() === 'POST') postRequests += 1
      await route.fulfill({ status: 200, json: [] })
    })
    await login(page)
    await page.getByRole('button', { name: 'Ajouter une liste', exact: true }).click()
    const title = page.getByLabel('Titre de la liste', { exact: true })
    await title.fill(value)
    await page.getByRole('button', { name: 'Créer la liste', exact: true }).click()

    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(postRequests).toBe(0)
  })
}

test('une création en cours désactive le formulaire et empêche les doublons', async ({ page }) => {
  let postRequests = 0
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists', async (route) => {
    if (route.request().method() === 'POST') {
      postRequests += 1
      receiveRequest(route)
    } else {
      await route.fulfill({ status: 200, json: [] })
    }
  })
  await login(page)
  await page.getByRole('button', { name: 'Ajouter une liste', exact: true }).click()
  const title = page.getByLabel('Titre de la liste', { exact: true })
  await title.fill('À approfondir')
  await page.getByRole('button', { name: 'Créer la liste', exact: true }).click()
  const route = await pendingRequest

  await expect(page.getByRole('button', { name: 'Création en cours…', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled()
  await expect(title).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  expect(postRequests).toBe(1)
  await route.fulfill({ status: 201, json: createdList })
  await expect(page.getByRole('status').filter({ hasText: 'La liste a été créée.' })).toHaveText(
    'La liste a été créée.',
  )
  await expect(page.getByRole('heading', { name: 'À approfondir', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Votre tableau est vide' })).toHaveCount(0)
  expect(postRequests).toBe(1)
})

for (const failure of [
  {
    label: '400',
    status: 400,
    body: { message: 'Ce titre de liste est invalide.' },
    message: 'Ce titre de liste est invalide.',
  },
  {
    label: 'serveur',
    status: 503,
    body: {},
    message: 'Le serveur est indisponible (HTTP 503). Réessayez plus tard.',
  },
  {
    label: 'réseau',
    status: null,
    body: {},
    message: 'Impossible de joindre le serveur. Vérifiez votre connexion réseau.',
  },
]) {
  test(`une erreur ${failure.label} conserve la saisie et permet de réessayer`, async ({
    page,
  }) => {
    let attempts = 0
    await page.route('**/api/lists', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: [existingList] })
        return
      }
      attempts += 1
      if (attempts > 1) {
        await route.fulfill({ status: 201, json: createdList })
      } else if (failure.status === null) {
        await route.abort('failed')
      } else {
        await route.fulfill({ status: failure.status, json: failure.body })
      }
    })
    await login(page)
    await page.getByRole('button', { name: 'Ajouter une liste', exact: true }).click()
    const title = page.getByLabel('Titre de la liste', { exact: true })
    await title.fill('  À approfondir  ')
    const submit = page.getByRole('button', { name: 'Créer la liste', exact: true })
    await submit.click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(failure.message)
    await expect(title).toHaveValue('  À approfondir  ')
    await expect(title).toBeEnabled()
    await expect(submit).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)
    const board = page.getByRole('region', { name: 'Listes du tableau Kanban', exact: true })
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['À lire'])
    await submit.click()

    await expect(page.getByRole('status').filter({ hasText: 'La liste a été créée.' })).toHaveText(
      'La liste a été créée.',
    )
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['À lire', 'À approfondir'])
    expect(attempts).toBe(2)
  })
}

test('un 401 pendant la création demande une reconnexion et retire les listes', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, json: [existingList] })
      : route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
  )
  await login(page)
  await page.getByRole('button', { name: 'Ajouter une liste', exact: true }).click()
  await page.getByLabel('Titre de la liste', { exact: true }).fill('À approfondir')
  await page.getByRole('button', { name: 'Créer la liste', exact: true }).click()

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByLabel('Titre de la liste', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveCount(0)
})
