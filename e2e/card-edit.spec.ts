/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const sourceId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const cardId = '33333333-3333-4333-8333-333333333333'
const lists = [
  { id: sourceId, title: 'À lire', position: 0 },
  { id: targetId, title: 'En cours', position: 1 },
].map((list) => ({
  ...list,
  ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  createdAt: '2026-10-05T10:00:00.000Z',
}))
const card = {
  id: cardId,
  title: 'Ressource à découvrir',
  description: 'Une description utile',
  position: 7,
  listId: sourceId,
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
  await expect(page.getByRole('heading', { level: 3, name: card.title, exact: true })).toBeVisible()
}

async function openDraft(page: Page) {
  await login(page)
  await page.getByRole('link', { name: card.title, exact: true }).click()
  await page.getByRole('button', { name: 'Modifier la carte', exact: true }).click()
  await expect(page.getByLabel('Titre de la carte', { exact: true })).toBeFocused()
}

function column(page: Page, title: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('heading', { level: 2, name: title, exact: true }),
  })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/lists', (route) => route.fulfill({ status: 200, json: lists }))
  await page.route('**/api/lists/*/cards', (route) =>
    route.fulfill({
      status: 200,
      json:
        new URL(route.request().url()).pathname === `/api/lists/${sourceId}/cards` ? [card] : [],
    }),
  )
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ status: 200, json: card }))
})

for (const width of [375, 1280]) {
  test(`modifier et déplacer au clavier resynchronise les deux colonnes à ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const remaining = {
      ...card,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Carte restée à lire',
    }
    const tied = {
      ...card,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Carte déjà en cours',
      listId: targetId,
      position: 0,
    }
    const updated = {
      ...card,
      title: 'Ressource modifiée',
      description: '',
      position: 0,
      listId: targetId,
      updatedAt: '2026-10-05T11:00:00.000Z',
    }
    let saved = false
    const columnReads = new Map<string, number>()
    const patches: { path: string; body: unknown; authorization?: string }[] = []
    await page.route('**/api/lists/*/cards', async (route) => {
      const path = new URL(route.request().url()).pathname
      columnReads.set(path, (columnReads.get(path) ?? 0) + 1)
      await route.fulfill({
        status: 200,
        json:
          path === `/api/lists/${sourceId}/cards`
            ? saved
              ? [remaining]
              : [card, remaining]
            : saved
              ? [tied, updated, tied]
              : [tied],
      })
    })
    await page.route(`**/api/cards/${cardId}`, async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        patches.push({
          path: new URL(request.url()).pathname,
          body: request.postDataJSON(),
          authorization: request.headers().authorization,
        })
        saved = true
      }
      await route.fulfill({ status: 200, json: saved ? updated : card })
    })
    await login(page)
    await page.getByRole('link', { name: card.title, exact: true }).focus()
    await page.keyboard.press('Enter')
    const edit = page.getByRole('button', { name: 'Modifier la carte', exact: true })
    await edit.focus()
    await page.keyboard.press('Enter')
    const title = page.getByLabel('Titre de la carte', { exact: true })
    const description = page.getByLabel('Description', { exact: true })
    const destination = page.getByLabel('Liste de destination', { exact: true })
    const position = page.getByLabel('Position', { exact: true })
    const save = page.getByRole('button', { name: 'Enregistrer', exact: true })
    await expect(title).toBeFocused()
    await expect(title).toHaveValue(card.title)
    await expect(description).toHaveValue(card.description)
    await expect(destination).toHaveValue(sourceId)
    await expect(position).toHaveValue('7')
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('  Ressource modifiée  ')
    await page.keyboard.press('Tab')
    await expect(description).toBeFocused()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Tab')
    await expect(destination).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await expect(destination).toHaveValue(targetId)
    await expect(position).toBeFocused()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('0')
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({
      path: testInfo.outputPath(`edition-carte-${width}.png`),
      fullPage: true,
    })
    await page.keyboard.press('Enter')
    await expect(title).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ressource modifiée')
    await expect(page.getByText('Aucune description.', { exact: true })).toBeVisible()
    await expect(page.getByRole('definition')).toContainText(['En cours'])
    expect(patches).toEqual([
      {
        path: `/api/cards/${cardId}`,
        body: { title: 'Ressource modifiée', description: '', listId: targetId, position: 0 },
        authorization: 'Bearer kanban-token',
      },
    ])
    await page.getByRole('link', { name: 'Retour au tableau', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/kanban$/)
    await expect(column(page, 'À lire').getByRole('heading', { level: 3 })).toHaveText([
      'Carte restée à lire',
    ])
    await expect(column(page, 'En cours').getByRole('heading', { level: 3 })).toHaveText([
      'Carte déjà en cours',
      'Ressource modifiée',
    ])
    expect(Object.fromEntries(columnReads)).toEqual({
      [`/api/lists/${sourceId}/cards`]: 2,
      [`/api/lists/${targetId}/cards`]: 2,
    })
  })
}

test('annuler au clavier abandonne le brouillon sans PATCH et restaure le focus', async ({
  page,
}) => {
  const patches: unknown[] = []
  await page.route(`**/api/cards/${cardId}`, async (route) => {
    if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, json: card })
  })
  await openDraft(page)
  await page.getByLabel('Titre de la carte', { exact: true }).fill('Brouillon abandonné')
  await page.getByLabel('Description', { exact: true }).fill('Texte abandonné')
  await page.getByLabel('Liste de destination', { exact: true }).selectOption(targetId)
  await page.getByLabel('Position', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Annuler', exact: true }).focus()
  await page.keyboard.press('Enter')
  const edit = page.getByRole('button', { name: 'Modifier la carte', exact: true })
  await expect(edit).toBeFocused()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(card.title)
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Titre de la carte', { exact: true })).toHaveValue(card.title)
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(card.description)
  await expect(page.getByLabel('Liste de destination', { exact: true })).toHaveValue(sourceId)
  await expect(page.getByLabel('Position', { exact: true })).toHaveValue('7')
  expect(patches).toEqual([])
})

for (const status of [400, 403]) {
  test(`un ${status} conserve la saisie sans modification fictive ni réessai automatique`, async ({
    page,
  }) => {
    let patches = 0
    await page.route(`**/api/cards/${cardId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        patches += 1
        await route.fulfill({
          status,
          json: { message: status === 400 ? 'Titre invalide.' : 'Private server details' },
        })
      } else await route.fulfill({ status: 200, json: card })
    })
    await openDraft(page)
    await page.getByLabel('Titre de la carte', { exact: true }).fill('  Brouillon conservé  ')
    await page.getByLabel('Description', { exact: true }).fill('Description conservée')
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByLabel('Titre de la carte', { exact: true })).toHaveValue(
      '  Brouillon conservé  ',
    )
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
      'Description conservée',
    )
    await expect(page.getByLabel('Titre de la carte', { exact: true })).toBeEnabled()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Brouillon conservé', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText('Private server details', { exact: true })).toHaveCount(0)
    expect(patches).toBe(1)
  })
}

test('un 404 actualise la carte et les listes en préservant un brouillon corrigeable', async ({
  page,
}) => {
  await openDraft(page)
  const requests: string[] = []
  const patches: unknown[] = []
  await page.route('**/api/lists', async (route) => {
    requests.push('lists')
    await route.fulfill({ status: 200, json: [lists[0]] })
  })
  await page.route(`**/api/cards/${cardId}`, async (route) => {
    if (route.request().method() === 'GET') {
      requests.push('card')
      await route.fulfill({ status: 200, json: card })
    } else {
      patches.push(route.request().postDataJSON())
      await route.fulfill(
        patches.length === 1
          ? { status: 404, json: { message: 'Private server details' } }
          : {
              status: 200,
              json: { ...card, title: 'Brouillon conservé', description: '', position: 0 },
            },
      )
    }
  })
  await page.getByLabel('Titre de la carte', { exact: true }).fill('  Brouillon conservé  ')
  await page.getByLabel('Description', { exact: true }).fill('')
  const destination = page.getByLabel('Liste de destination', { exact: true })
  await destination.selectOption(targetId)
  await page.getByLabel('Position', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(destination.getByRole('option', { name: 'En cours', exact: true })).toHaveCount(0)
  await expect(
    destination.getByRole('option', { name: 'Liste sélectionnée indisponible', exact: true }),
  ).toBeDisabled()
  await expect(page.getByLabel('Titre de la carte', { exact: true })).toHaveValue(
    '  Brouillon conservé  ',
  )
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Position', { exact: true })).toHaveValue('0')
  expect(requests.sort()).toEqual(['card', 'lists'])
  expect(patches).toHaveLength(1)
  await destination.selectOption(sourceId)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Brouillon conservé')
  expect(patches).toEqual([
    { title: 'Brouillon conservé', description: '', listId: targetId, position: 0 },
    { title: 'Brouillon conservé', description: '', position: 0 },
  ])
})

test('un 401 à l’enregistrement expire la session et retire le brouillon', async ({ page }) => {
  await openDraft(page)
  await page.route(`**/api/cards/${cardId}`, (route) => route.fulfill({ status: 401, json: {} }))
  await page.getByLabel('Titre de la carte', { exact: true }).fill('Brouillon privé')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('alert')).toHaveText(
    'Votre session a expiré. Veuillez vous reconnecter.',
  )
  await expect(page.getByLabel('Titre de la carte', { exact: true })).toHaveCount(0)
  await expect(page.getByText(card.description, { exact: true })).toHaveCount(0)
})

for (const failure of ['réseau', 'serveur']) {
  test(`une erreur ${failure} autorise une nouvelle soumission explicite sans double PATCH`, async ({
    page,
  }) => {
    await openDraft(page)
    let receiveRetry!: (route: Route) => void
    const pending = new Promise<Route>((resolve) => {
      receiveRetry = resolve
    })
    const patches: unknown[] = []
    await page.route(`**/api/cards/${cardId}`, async (route) => {
      patches.push(route.request().postDataJSON())
      if (patches.length > 1) receiveRetry(route)
      else if (failure === 'réseau') await route.abort('failed')
      else await route.fulfill({ status: 503, json: {} })
    })
    const title = page.getByLabel('Titre de la carte', { exact: true })
    await title.fill('  Titre corrigé  ')
    const save = page.getByRole('button', { name: 'Enregistrer', exact: true })
    await save.click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(title).toHaveValue('  Titre corrigé  ')
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(card.description)
    await expect(save).toBeEnabled()
    expect(patches).toEqual([{ title: 'Titre corrigé' }])
    await save.focus()
    await page.keyboard.press('Enter')
    const route = await pending
    await expect(title).toBeDisabled()
    await expect(page.getByLabel('Description', { exact: true })).toBeDisabled()
    await expect(page.getByLabel('Liste de destination', { exact: true })).toBeDisabled()
    await expect(page.getByLabel('Position', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled()
    await page.keyboard.press('Enter')
    await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
    expect(patches).toHaveLength(2)
    await route.fulfill({ status: 200, json: { ...card, title: 'Titre corrigé' } })
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Titre corrigé')
    await expect(title).toHaveCount(0)
    expect(patches).toEqual([{ title: 'Titre corrigé' }, { title: 'Titre corrigé' }])
  })
}
