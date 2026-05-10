import { expect, test } from '@playwright/test'

test('locale switcher：默认中文 → 点击切换 EN → 切回中文', async ({ page }) => {
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'fake',
        refreshToken: 'rt',
        user: { id: 1, tenantId: 9, email: 'shopper@example.com', role: 'user' },
      }),
    })
  })
  await page.route('**/products**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
    })
  })
  await page.route(/\/cart$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
      return
    }
    await route.fallback()
  })

  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()

  await page.getByLabel('Tenant ID').fill('9')
  await page.getByLabel('Email').fill('shopper@example.com')
  await page.getByLabel('Password').fill('any-pw')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('heading', { name: '所有商品' })).toBeVisible()

  // 切换到 EN
  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByRole('heading', { name: 'All products' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cart' })).toBeVisible()

  // 切回中文
  await page.getByRole('button', { name: '中文' }).click()
  await expect(page.getByRole('heading', { name: '所有商品' })).toBeVisible()
})
