/// <reference lib="dom" />

import { test, expect, type Page, type Route } from '@playwright/test'

const password = 'SoleilSecret42!'
const successMessage = 'Votre compte a été créé. Vous pouvez maintenant vous connecter.'
const user = {
  id: 'd1124420-b85b-4e45-a1e5-7e68079c4c39',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'user',
  createdAt: '2026-10-04T10:00:00.000Z',
}

async function fillRegistration(page: Page) {
  await page.getByLabel('Nom', { exact: true }).fill('  Alice  ')
  await page.getByLabel('Email', { exact: true }).fill('alice@example.com')
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(password)
}

async function expectNoStoredPassword(page: Page) {
  const storage = await page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
  }))
  expect(storage.local).not.toContain(password)
  expect(storage.session).not.toContain(password)
}

async function fulfillRegistration(route: Route) {
  await route.fulfill({ status: 201, json: user })
}

test('le formulaire envoie les trois champs et propose la connexion après création', async ({
  page,
}) => {
  const requests: { method: string; body: unknown; authorization: string | undefined }[] = []
  await page.route('**/api/auth/register', async (route) => {
    const request = route.request()
    requests.push({
      method: request.method(),
      body: request.postDataJSON(),
      authorization: request.headers().authorization,
    })
    await fulfillRegistration(route)
  })
  await page.goto('/inscription')
  await fillRegistration(page)
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('type', 'password')
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toHaveAttribute(
    'type',
    'password',
  )
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toHaveAttribute(
    'name',
    'passwordConfirmation',
  )
  await expectNoStoredPassword(page)
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click()

  await expect(page.getByRole('status')).toHaveText(successMessage)
  await expect(page.getByRole('status')).toBeFocused()
  expect(requests).toEqual([
    {
      method: 'POST',
      body: { name: 'Alice', email: 'alice@example.com', password: 'SoleilSecret42!' },
      authorization: undefined,
    },
  ])
  const remainingPasswords = await page
    .locator('input[type="password"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
  expect(remainingPasswords.every((value) => value === '')).toBe(true)
  await expectNoStoredPassword(page)
  await expect(page).toHaveURL(/\/inscription$/)
  const login = page.getByRole('link', { name: 'Aller à la connexion', exact: true })
  await expect(login).toHaveAttribute('href', '/connexion')
  await login.click()
  await expect(page).toHaveURL(/\/connexion$/)
  await page.goBack()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('une requête en cours bloque les soumissions répétées', async ({ page }) => {
  let requests = 0
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/auth/register', (route) => {
    requests++
    receiveRequest(route)
  })
  await page.goto('/inscription')
  await fillRegistration(page)
  const submit = page.locator('form button[type="submit"]')
  await submit.click()
  const route = await pendingRequest
  await expect(submit).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  await expectNoStoredPassword(page)
  expect(requests).toBe(1)
  await fulfillRegistration(route)
  await expect(page.getByRole('status')).toHaveText(successMessage)
  expect(requests).toBe(1)
})

for (const failure of [
  {
    label: '400 avec plusieurs erreurs de validation',
    status: 400,
    body: {
      message: ['email must be an email', 'password must be longer than or equal to 8 characters'],
    },
    messages: ['email must be an email', 'password must be longer than or equal to 8 characters'],
  },
  {
    label: '409 lorsque le compte existe déjà',
    status: 409,
    body: { message: 'Cet email est déjà utilisé.' },
    messages: ['Cet email est déjà utilisé.'],
  },
  {
    label: '500 lorsque le serveur est indisponible',
    status: 500,
    body: {},
    messages: ['Le serveur est indisponible (HTTP 500). Réessayez plus tard.'],
  },
  {
    label: 'une coupure réseau',
    status: null,
    body: {},
    messages: ['Impossible de joindre le serveur. Vérifiez votre connexion réseau.'],
  },
]) {
  test(`le formulaire affiche ${failure.label} et permet de réessayer`, async ({ page }) => {
    let attempts = 0
    await page.route('**/api/auth/register', async (route) => {
      attempts++
      if (attempts > 1) {
        await fulfillRegistration(route)
      } else if (failure.status === null) {
        await route.abort('failed')
      } else {
        await route.fulfill({ status: failure.status, json: failure.body })
      }
    })
    await page.goto('/inscription')
    await fillRegistration(page)
    const submit = page.getByRole('button', { name: 'Créer mon compte', exact: true })
    await submit.click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toBeFocused()
    for (const message of failure.messages) {
      await expect(alert).toContainText(message)
    }
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(submit).toBeEnabled()
    await expectNoStoredPassword(page)
    await submit.click()
    await expect(page.getByRole('status')).toHaveText(successMessage)
    await expect(alert).toHaveCount(0)
    expect(attempts).toBe(2)
  })
}

test('une requête trop longue rend le formulaire disponible pour une nouvelle tentative manuelle', async ({
  page,
}) => {
  await page.clock.install()
  let attempts = 0
  let receiveRequest!: () => void
  const pendingRequest = new Promise<void>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/auth/register', async (route) => {
    attempts++
    if (attempts === 1) {
      receiveRequest()
    } else {
      await fulfillRegistration(route)
    }
  })
  await page.goto('/inscription')
  await fillRegistration(page)
  const submit = page.locator('form button[type="submit"]')
  await submit.click()
  await pendingRequest
  await expect(submit).toBeDisabled()
  await page.clock.fastForward(15_000)

  const alert = page.getByRole('alert')
  await expect(alert).toHaveText(
    'Le serveur met trop de temps à répondre. Vérifiez si l’opération a abouti avant de réessayer.',
  )
  await expect(alert).toBeFocused()
  await expect(submit).toBeEnabled()
  for (const label of ['Nom', 'Email', 'Mot de passe', 'Confirmer le mot de passe']) {
    await expect(page.getByLabel(label, { exact: true })).toBeEnabled()
  }
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(attempts).toBe(1)
  await page.clock.fastForward(15_000)
  expect(attempts).toBe(1)
  await expect(page.getByRole('status')).toHaveCount(0)

  await submit.click()
  await expect(page.getByRole('status')).toHaveText(successMessage)
  await expect(alert).toHaveCount(0)
  expect(attempts).toBe(2)
})

test('quitter le formulaire oublie le mot de passe et ignore une réponse tardive', async ({
  page,
}) => {
  let receiveRequest!: (route: Route) => void
  const pendingRequest = new Promise<Route>((resolve) => {
    receiveRequest = resolve
  })
  await page.route('**/api/auth/register', (route) => receiveRequest(route))
  await page.goto('/inscription')
  await fillRegistration(page)
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click()
  const route = await pendingRequest
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Connexion', exact: true })
    .click()
  await expect(page).toHaveURL(/\/connexion$/)
  await page.goBack()
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toHaveValue('')
  await fulfillRegistration(route)
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toHaveValue('')
  await expectNoStoredPassword(page)
})

test('une saisie invalide dirige le focus vers le champ associé à son erreur', async ({ page }) => {
  let requests = 0
  await page.route('**/api/auth/register', async (route) => {
    requests++
    await fulfillRegistration(route)
  })
  await page.goto('/inscription')
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click()
  const name = page.getByLabel('Nom', { exact: true })
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveAccessibleDescription('Le nom est obligatoire.')
  expect(requests).toBe(0)
})

test('des mots de passe différents bloquent la requête puis permettent une correction', async ({
  page,
}) => {
  const requests: unknown[] = []
  await page.route('**/api/auth/register', async (route) => {
    requests.push(route.request().postDataJSON())
    await fulfillRegistration(route)
  })
  await page.goto('/inscription')
  await fillRegistration(page)
  const confirmation = page.getByLabel('Confirmer le mot de passe', { exact: true })
  await confirmation.fill('AutreSecret42!')
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click()
  await expect(confirmation).toBeFocused()
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
  await expect(confirmation).toHaveAccessibleDescription('Les mots de passe ne correspondent pas.')
  expect(requests).toEqual([])

  await confirmation.fill(password)
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(successMessage)
  expect(requests).toEqual([
    { name: 'Alice', email: 'alice@example.com', password: 'SoleilSecret42!' },
  ])
})

test('le blur corrige les erreurs et revalide la confirmation après un changement de mot de passe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 })
  let requests = 0
  await page.route('**/api/auth/register', async (route) => {
    requests++
    await fulfillRegistration(route)
  })
  await page.goto('/inscription')
  await fillRegistration(page)
  const email = page.getByLabel('Email', { exact: true })
  const passwordInput = page.getByLabel('Mot de passe', { exact: true })
  const confirmation = page.getByLabel('Confirmer le mot de passe', { exact: true })
  const name = page.getByLabel('Nom', { exact: true })
  const submit = page.getByRole('button', { name: 'Créer mon compte', exact: true })
  const submitPosition = await submit.boundingBox()

  await email.fill('email-invalide')
  await passwordInput.focus()
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveAccessibleDescription('Saisissez une adresse email valide.')
  expect(await submit.boundingBox()).toEqual(submitPosition)
  await email.fill('alice@example.com')
  await passwordInput.focus()
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')
  await expect(email).not.toHaveAccessibleDescription('Saisissez une adresse email valide.')

  await confirmation.focus()
  await name.focus()
  await expect(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await passwordInput.fill('court')
  await name.focus()
  await expect(passwordInput).toHaveAccessibleDescription(
    'Le mot de passe doit contenir entre 8 et 24 caractères.',
  )
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
  expect(await submit.boundingBox()).toEqual(submitPosition)
  await passwordInput.fill('AutreSecret42!')
  await name.focus()
  await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
  await expect(confirmation).toHaveAccessibleDescription('Les mots de passe ne correspondent pas.')
  expect(await submit.boundingBox()).toEqual(submitPosition)
  await confirmation.fill('AutreSecret42!')
  await name.focus()
  await expect(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await expect(confirmation).not.toHaveAccessibleDescription(
    'Les mots de passe ne correspondent pas.',
  )
  expect(requests).toBe(0)
})

test('le clavier parcourt les champs et Entrée crée le compte', async ({ page }) => {
  await page.route('**/api/auth/register', fulfillRegistration)
  await page.goto('/inscription')
  await page.getByLabel('Nom', { exact: true }).focus()
  await page.keyboard.type('Alice')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused()
  await page.keyboard.type('alice@example.com')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeFocused()
  await page.keyboard.type(password)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Confirmer le mot de passe', { exact: true })).toBeFocused()
  await page.keyboard.type(password)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText(successMessage)
})

for (const width of [375, 1280]) {
  test(`le formulaire reste visible sans débordement à ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/inscription')
    await fillRegistration(page)
    for (const label of ['Nom', 'Email', 'Mot de passe', 'Confirmer le mot de passe']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible()
      await expect(page.getByLabel(label, { exact: true })).toBeInViewport({ ratio: 1 })
    }
    await expect(
      page.getByRole('button', { name: 'Créer mon compte', exact: true }),
    ).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: testInfo.outputPath(`inscription-${width}.png`), fullPage: true })
  })
}
