import { expect, test } from '@playwright/test'

test('convergent-replicated-struct browser suite', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__CRSTRUCT_RESULTS__)
  const results = await page.evaluate(() => window.__CRSTRUCT_RESULTS__)

  expect(
    results.ok,
    results.errors ? JSON.stringify(results.errors, null, 2) : 'unknown error'
  ).toBe(true)
})
