/// <reference lib="dom" />

import { test, expect } from '@playwright/test'
import process from 'node:process'

test('la racine ouvre le Kanban avec un document en français', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/kanban$/)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page).toHaveTitle('Kanban')
})

for (const { path, heading } of [
  { path: '/kanban', heading: 'Tableau Kanban' },
  { path: '/connexion', heading: 'Connexion' },
  { path: '/inscription', heading: 'Inscription' },
]) {
  test(`${path} reste accessible après un accès direct et un rechargement`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
  })
}

test('la navigation principale change de page et conserve un historique utilisable', async ({
  page,
}) => {
  await page.goto('/kanban')
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
  const main = page.locator('main#contenu-principal')

  for (const { label, path, heading } of [
    { label: 'Connexion', path: '/connexion', heading: 'Connexion' },
    { label: 'Inscription', path: '/inscription', heading: 'Inscription' },
    { label: 'Kanban', path: '/kanban', heading: 'Tableau Kanban' },
  ]) {
    const link = navigation.getByRole('link', { name: label, exact: true })
    await expect(link).toHaveAttribute('href', path)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible()
    await expect(main).toBeFocused()
  }

  await page.goBack()
  await expect(page).toHaveURL(/\/inscription$/)
  await expect(page.getByRole('heading', { name: 'Inscription', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible()
})

test('une route inconnue propose un retour fonctionnel au Kanban', async ({ page }) => {
  await page.goto('/route-inconnue')
  await expect(page.getByRole('heading', { name: 'Page introuvable', level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Revenir au Kanban', exact: true }).click()
  await expect(page).toHaveURL(/\/kanban$/)
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
})

test('le premier lien clavier permet de rejoindre le contenu principal', async ({
  page,
  browserName,
}) => {
  test.fixme(
    browserName === 'webkit' && process.platform === 'win32',
    'WebKit Windows ne parcourt pas les liens avec Tab, y compris sur une page HTML minimale.',
  )
  await page.goto('/kanban')
  await expect(page.getByRole('heading', { name: 'Tableau Kanban', level: 1 })).toBeVisible()
  await expect(page.locator('main#contenu-principal')).not.toBeFocused()
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Aller au contenu', exact: true })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
  await page.keyboard.press('Enter')
  const main = page.locator('main#contenu-principal')
  await expect(main).toHaveAttribute('tabindex', '-1')
  await expect(main).toBeFocused()
})

test('la navigation mobile reste visible sans débordement', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/kanban')
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
  for (const label of ['Kanban', 'Connexion', 'Inscription']) {
    const link = navigation.getByRole('link', { name: label, exact: true })
    await expect(link).toBeVisible()
    await expect(link).toBeInViewport({ ratio: 1 })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

test('la navigation mobile signale le focus clavier', async ({ page, browserName }) => {
  test.fixme(
    browserName === 'webkit' && process.platform === 'win32',
    'WebKit Windows ne parcourt pas les liens avec Tab, y compris sur une page HTML minimale.',
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/kanban')
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' })
  const connexion = navigation.getByRole('link', { name: 'Connexion', exact: true })
  const initialShadow = await connexion.evaluate((element) => getComputedStyle(element).boxShadow)
  await navigation.getByRole('link', { name: 'Kanban', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(connexion).toBeFocused()
  const focusStyle = await connexion.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    }
  })
  expect(
    (focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth > 0) ||
      (focusStyle.boxShadow !== 'none' && focusStyle.boxShadow !== initialShadow),
  ).toBe(true)
})
