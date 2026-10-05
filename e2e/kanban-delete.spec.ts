/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const lists = ['À lire', 'En cours'].map((title, position) => ({
  id: `list-${position + 1}`,
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

function deleteButton(page: Page) {
  return page.getByRole('button', { name: 'Supprimer la liste « À lire »', exact: true })
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Supprimer cette liste ?', exact: true })
}

for (const width of [375, 1280]) {
  test(`la suppression au clavier persiste après reconnexion à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    let savedLists = [...lists]
    const requests: {
      path: string
      method: string
      authorization?: string
      body: string | null
    }[] = []
    await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: savedLists }))
    await page.route('**/api/lists/*', async (route) => {
      const request = route.request()
      requests.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
        authorization: request.headers().authorization,
        body: request.postData(),
      })
      savedLists = savedLists.filter((list) => list.id !== 'list-1')
      await route.fulfill({ status: 204 })
    })
    await login(page)
    const remove = deleteButton(page)
    await expect(remove).toHaveText('Supprimer')
    await page.locator('main#contenu-principal').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Ajouter une liste', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')

    const confirmation = dialog(page)
    const cancel = confirmation.getByRole('button', { name: 'Annuler', exact: true })
    const confirm = confirmation.getByRole('button', { name: 'Supprimer la liste', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toHaveAccessibleDescription(
      /À lire.*cartes.*supprimées.*irréversible/,
    )
    await expect(cancel).toBeFocused()
    await expect(confirmation).toBeInViewport({ ratio: 1 })
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await expect(confirm).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: testInfo.outputPath(`suppression-${width}.png`), fullPage: true })
    await page.keyboard.press('Tab')
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(confirmation).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('À lire')
    await expect(page.getByRole('status')).toContainText(/supprimée/)
    const board = page.getByRole('region', { name: 'Listes du tableau Kanban', exact: true })
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['En cours'])
    expect(requests).toEqual([
      {
        path: '/api/lists/list-1',
        method: 'DELETE',
        authorization: 'Bearer kanban-token',
        body: null,
      },
    ])

    await page.reload()
    // La session reste en mémoire : le rechargement exige une nouvelle connexion.
    await expect(page).toHaveURL(/\/connexion$/)
    await login(page)
    await expect(board.getByRole('heading', { level: 2 })).toHaveText(['En cours'])
    await expect(remove).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(requests).toHaveLength(1)
  })
}

test('Annuler et Échap ferment la confirmation sans supprimer et rendent le focus', async ({
  page,
}) => {
  let deleteRequests = 0
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*', async (route) => {
    deleteRequests += 1
    await route.fulfill({ status: 204 })
  })
  await login(page)
  const remove = deleteButton(page)
  await remove.click()
  await expect(dialog(page).getByRole('button', { name: 'Annuler', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toHaveCount(0)
  await expect(remove).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(remove).toBeFocused()
  await expect(page.getByRole('heading', { name: 'À lire', exact: true })).toBeVisible()
  expect(deleteRequests).toBe(0)
})

test('une suppression en attente conserve la liste et bloque les doublons et la fermeture', async ({
  page,
}) => {
  let deleteRequests = 0
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*', (route) => {
    deleteRequests += 1
    receiveRequest(route)
  })
  await login(page)
  await deleteButton(page).click()
  const confirmation = dialog(page)
  await confirmation.getByRole('button', { name: 'Supprimer la liste', exact: true }).click()
  const route = await pendingRequest

  await expect(
    confirmation.getByRole('button', { name: 'Suppression en cours…', exact: true }),
  ).toBeDisabled()
  await expect(confirmation.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled()
  await expect(
    page.getByRole('heading', { name: 'À lire', exact: true, includeHidden: true }),
  ).toHaveCount(1)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(confirmation).toBeVisible()
  expect(deleteRequests).toBe(1)
  await route.fulfill({ status: 204 })
  await expect(confirmation).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'À lire', exact: true })).toHaveCount(0)
  expect(deleteRequests).toBe(1)
})

for (const failure of [
  { label: '400', status: 400, message: 'La suppression est invalide.' },
  { label: '403', status: 403, message: 'Vous ne pouvez pas supprimer cette liste.' },
  { label: 'serveur', status: 503, message: 'Le serveur est indisponible (HTTP 503).' },
  { label: 'réseau', status: null, message: 'Impossible de joindre le serveur.' },
]) {
  test(`une erreur ${failure.label} garde la liste et permet de réessayer dans la modale`, async ({
    page,
  }) => {
    let attempts = 0
    await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
    await page.route('**/api/lists/*', async (route) => {
      attempts += 1
      if (attempts > 1) {
        await route.fulfill({ status: 204 })
      } else if (failure.status === null) {
        await route.abort('failed')
      } else {
        await route.fulfill({ status: failure.status, json: { message: failure.message } })
      }
    })
    await login(page)
    await deleteButton(page).click()
    const confirmation = dialog(page)
    const confirm = confirmation.getByRole('button', { name: 'Supprimer la liste', exact: true })
    await confirm.click()

    await expect(confirmation.getByRole('alert')).toContainText(failure.message)
    await expect(confirm).toBeEnabled()
    await expect(confirmation.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled()
    await expect(
      page.getByRole('heading', { name: 'À lire', exact: true, includeHidden: true }),
    ).toHaveCount(1)
    await expect(page.getByRole('status', { includeHidden: true })).toHaveCount(0)
    await confirm.click()
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('À lire')
    await expect(page.getByRole('heading', { name: 'À lire', exact: true })).toHaveCount(0)
    expect(attempts).toBe(2)
  })
}

test('un 404 resynchronise le tableau et annonce que la liste est déjà absente', async ({
  page,
}) => {
  let loads = 0
  await page.route('**/api/lists', async (route) => {
    loads += 1
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ status: 200, json: loads === 1 ? lists : lists.slice(1) })
  })
  await page.route('**/api/lists/*', (route) =>
    route.fulfill({ status: 404, json: { message: 'Not found' } }),
  )
  await login(page)
  await deleteButton(page).click()
  await dialog(page).getByRole('button', { name: 'Supprimer la liste', exact: true }).click()

  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText(/À lire/)
  await expect(page.getByRole('alert')).toContainText(/n.existe plus|déjà|absente/)
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'À lire', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'En cours', exact: true })).toBeVisible()
  expect(loads).toBe(2)
})

test('un échec de resynchronisation après 404 permet de recharger le tableau', async ({ page }) => {
  let loads = 0
  await page.route('**/api/lists', async (route) => {
    loads += 1
    await route.fulfill(
      loads === 2
        ? { status: 503, json: {} }
        : { status: 200, json: loads === 1 ? lists : lists.slice(1) },
    )
  })
  await page.route('**/api/lists/*', (route) =>
    route.fulfill({ status: 404, json: { message: 'Not found' } }),
  )
  await login(page)
  await deleteButton(page).click()
  await dialog(page).getByRole('button', { name: 'Supprimer la liste', exact: true }).click()

  await expect(dialog(page)).toHaveCount(0)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Impossible de charger vos listes.' }),
  ).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'À lire' })).toContainText(
    /n.existe plus|déjà|absente/,
  )
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'En cours', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'À lire', exact: true })).toHaveCount(0)
  expect(loads).toBe(3)
})

test('un 401 pendant la suppression ferme la modale et demande une reconnexion', async ({
  page,
}) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*', (route) =>
    route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
  )
  await login(page)
  await deleteButton(page).click()
  await dialog(page).getByRole('button', { name: 'Supprimer la liste', exact: true }).click()

  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Listes du tableau Kanban' })).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveCount(0)
})
