import { expect, test } from '@playwright/test'

const ADMIN_TOKEN = 'fake-platform-token'

test.beforeEach(async ({ page }) => {
  // 路由 mock 后端：登录 + tenants 列表 + orders/payments 空响应
  await page.route('**/admin/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: ADMIN_TOKEN,
        admin: { id: 1, email: 'platform@example.com' },
      }),
    })
  })
  await page.route('**/admin/tenants', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, name: 'Acme Inc', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 2, name: 'Globex Corp', createdAt: '2026-02-01T00:00:00.000Z' },
      ]),
    })
  })
  await page.route('**/admin/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
    })
  })
  await page.route('**/admin/payments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
    })
  })
})

test('platform admin login → tenants list → switch to orders tab', async ({ page }) => {
  await page.goto('/')

  // 未登录默认跳到 /login
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Mall Admin' })).toBeVisible()

  await page.getByLabel('Email').fill('platform@example.com')
  await page.getByLabel('Password').fill('any-pw')
  await page.getByRole('button', { name: '登录' }).click()

  // 登录成功跳到 /tenants
  await expect(page).toHaveURL(/\/tenants$/)
  await expect(page.getByRole('heading', { name: '所有租户' })).toBeVisible()
  await expect(page.getByText('Acme Inc')).toBeVisible()
  await expect(page.getByText('Globex Corp')).toBeVisible()

  // 切到 Orders tab
  await page.getByRole('link', { name: 'Orders' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByText('没有匹配的订单')).toBeVisible()

  // logout 回到登录页
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('login failure shows error message', async ({ page }) => {
  await page.unroute('**/admin/auth/login')
  await page.route('**/admin/auth/login', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'UNAUTHORIZED',
        message: 'invalid platform admin credentials',
        requestId: 'test',
      }),
    })
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill('wrong@example.com')
  await page.getByLabel('Password').fill('bad')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('invalid platform admin credentials')).toBeVisible()
})
