import { expect, test } from '@playwright/test'

const TOKEN = 'fake-store-token'

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: TOKEN,
        refreshToken: 'rt-fake',
        user: { id: 1, tenantId: 9, email: 'merchant@example.com', role: 'admin' },
      }),
    })
  })

  await page.route('**/store/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ordersByStatus: {
          pending: { count: 3, totalCents: 9000 },
          paid: { count: 5, totalCents: 25000 },
          shipped: { count: 2, totalCents: 9000 },
        },
        productCount: 12,
        lowStockProducts: 1,
        lowStockThreshold: 5,
        reservedStockTotal: 4,
      }),
    })
  })

  await page.route('**/products**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 11,
            tenantId: 9,
            name: 'SKU-A',
            priceCents: 1500,
            stock: 8,
            reservedStock: 1,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    })
  })

  await page.route('**/store/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 501,
            tenantId: 9,
            userId: 7,
            status: 'paid',
            subtotalCents: 5000,
            discountCents: 0,
            totalCents: 5000,
            couponId: null,
            items: [
              {
                id: 1,
                orderId: 501,
                productId: 11,
                quantity: 1,
                unitPriceCents: 5000,
                subtotalCents: 5000,
              },
            ],
            createdAt: '2026-05-08T00:00:00.000Z',
            updatedAt: '2026-05-08T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    })
  })

  await page.route('**/coupons**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
    })
  })
})

test('store admin：登录 → dashboard → products → orders → logout', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Tenant ID').fill('9')
  await page.getByLabel('Email').fill('merchant@example.com')
  await page.getByLabel('Password').fill('any-pw')
  await page.getByRole('button', { name: '登录' }).click()

  // 默认进 dashboard
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '店铺总览' })).toBeVisible()
  await expect(page.getByText('商品总数')).toBeVisible()

  // products
  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByText('SKU-A')).toBeVisible()

  // orders
  await page.getByRole('link', { name: 'Orders' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByRole('link', { name: '#501' })).toBeVisible()
  // 用 cell 限定到表格里那一个 status-pill，避免 select option 也命中"已支付"
  await expect(page.getByRole('cell', { name: '已支付' })).toBeVisible()

  // logout
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
