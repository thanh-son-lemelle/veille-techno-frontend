/// <reference lib="dom" />

import { test, expect } from '@playwright/test'

for (const width of [375, 1280]) {
  test.describe(`connexion à ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('la validation locale décrit les erreurs et place le focus sur le premier champ invalide', async ({
      page,
    }) => {
      let requests = 0
      await page.route('**/api/auth/login', async (route) => {
        requests += 1
        await route.fulfill({ status: 200, json: { accessToken: 'unexpected-token' } })
      })
      await page.goto('/connexion')
      await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible()
      const email = page.getByLabel('Email', { exact: true })
      const password = page.getByLabel('Mot de passe', { exact: true })
      const submit = page.getByRole('button', { name: 'Se connecter', exact: true })

      await expect(email).not.toHaveAttribute('aria-invalid', 'true')
      await expect(password).not.toHaveAttribute('aria-invalid', 'true')
      await expect(email).toHaveAttribute('type', 'email')
      await expect(email).toHaveAttribute('autocomplete', 'username')
      await expect(password).toHaveAttribute('type', 'password')
      await expect(password).toHaveAttribute('autocomplete', 'current-password')
      await expect(page.locator('form')).toHaveAttribute('novalidate', '')
      for (const control of [email, password, submit]) {
        await expect(control).toBeVisible()
        await expect(control).toBeInViewport({ ratio: 1 })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )

      await email.fill('adresse-invalide')
      await submit.click()
      await expect(email).toBeFocused()
      for (const control of [email, password]) {
        await expect(control).toHaveAttribute('aria-invalid', 'true')
        await expect(control).toHaveAttribute('aria-describedby', /.+/)
        await expect(control).toHaveAccessibleDescription(/.+/)
      }
      await email.fill('lea@example.com')
      await submit.click()
      await expect(password).toBeFocused()
      expect(requests).toBe(0)
    })

    test('le clavier permet de réessayer après un 401 puis ouvre le Kanban sans stocker les secrets', async ({
      page,
    }) => {
      const requests: unknown[] = []
      await page.route('**/api/auth/login', async (route) => {
        expect(route.request().method()).toBe('POST')
        requests.push(route.request().postDataJSON())
        await route.fulfill(
          requests.length === 1
            ? { status: 401, json: { message: 'Ce compte est absent' } }
            : { status: 200, json: { accessToken: 'e2e-access-token-secret' } },
        )
      })
      await page.goto('/connexion')
      const email = page.getByLabel('Email', { exact: true })
      const password = page.getByLabel('Mot de passe', { exact: true })
      const submit = page.getByRole('button', { name: 'Se connecter', exact: true })

      await email.focus()
      await page.keyboard.type('lea@example.com')
      await page.keyboard.press('Tab')
      await expect(password).toBeFocused()
      await page.keyboard.type('court')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('alert')).toContainText('Identifiants invalides')
      await expect(page.getByRole('alert')).not.toContainText('Ce compte est absent')
      await expect(page).toHaveURL(/\/connexion$/)
      await expect(submit).toBeEnabled()

      await password.fill('court')
      await password.press('Enter')
      await expect(page).toHaveURL(/\/kanban$/)
      await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('input[type="password"]')).toHaveCount(0)
      expect(requests).toEqual([
        { email: 'lea@example.com', password: 'court' },
        { email: 'lea@example.com', password: 'court' },
      ])
      const stored = await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      )
      expect(stored).not.toContain('court')
      expect(stored).not.toContain('e2e-access-token-secret')
    })

    test('une requête en attente désactive le formulaire et empêche les doubles soumissions', async ({
      page,
    }) => {
      let requests = 0
      let release!: () => void
      const responseReady = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/api/auth/login', async (route) => {
        requests += 1
        await responseReady
        await route.fulfill({ status: 200, json: { accessToken: 'pending-token' } })
      })
      await page.goto('/connexion')
      const email = page.getByLabel('Email', { exact: true })
      const password = page.getByLabel('Mot de passe', { exact: true })
      const submit = page.getByRole('button', { name: 'Se connecter', exact: true })
      await email.fill('lea@example.com')
      await password.fill('mot-de-passe-existant-de-plus-de-24-caracteres')
      await password.press('Enter')
      try {
        await expect.poll(() => requests).toBe(1)
        for (const control of [email, password, submit]) {
          await expect(control).toBeDisabled()
        }
        await page.locator('form').evaluate((form) => {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        await page.keyboard.press('Enter')
        expect(requests).toBe(1)
      } finally {
        release()
      }
      await expect(page).toHaveURL(/\/kanban$/)
      await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
      expect(requests).toBe(1)
    })
  })
}
