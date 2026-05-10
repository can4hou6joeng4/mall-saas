import { expect, test } from '@playwright/test'

const TOKEN = 'fake-storefront-token'

interface CartItem {
  id: number
  tenantId: number
  userId: number
  productId: number
  quantity: number
  createdAt: string
  updatedAt: string
}

const PRODUCTS = {
  items: [
    {
      id: 11,
      tenantId: 9,
      name: 'Notebook',
      priceCents: 2000,
      stock: 10,
      reservedStock: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 22,
      tenantId: 9,
      name: 'Pen',
      priceCents: 500,
      stock: 50,
      reservedStock: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
}

test.beforeEach(async ({ page }) => {
  // 路由 mock：login + products + cart + checkout + orders
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: TOKEN,
        refreshToken: 'rt-fake',
        user: { id: 1, tenantId: 9, email: 'shopper@example.com', role: 'user' },
      }),
    })
  })

  // mutable mock cart 状态
  let cart: CartItem[] = []

  await page.route('**/products**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PRODUCTS),
    })
  })

  await page.route('**/cart/items**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { productId: number; quantity: number }
      const next: CartItem = {
        id: cart.length + 1,
        tenantId: 9,
        userId: 1,
        productId: body.productId,
        quantity: body.quantity,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }
      cart.push(next)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      })
      return
    }
    await route.fallback()
  })

  await page.route(/\/cart$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(cart),
      })
      return
    }
    await route.fallback()
  })

  await page.route('**/cart/checkout', async (route) => {
    cart = []
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 999,
        tenantId: 9,
        userId: 1,
        status: 'pending',
        subtotalCents: 2000,
        discountCents: 500,
        totalCents: 1500,
        couponId: 1,
        items: [
          {
            id: 1,
            orderId: 999,
            productId: 11,
            quantity: 1,
            unitPriceCents: 2000,
            subtotalCents: 2000,
          },
        ],
        createdAt: '2026-05-08T00:00:00.000Z',
        updatedAt: '2026-05-08T00:00:00.000Z',
      }),
    })
  })

  await page.route('**/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 999,
            tenantId: 9,
            userId: 1,
            status: 'pending',
            subtotalCents: 2000,
            discountCents: 500,
            totalCents: 1500,
            couponId: 1,
            items: [
              {
                id: 1,
                orderId: 999,
                productId: 11,
                quantity: 1,
                unitPriceCents: 2000,
                subtotalCents: 2000,
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
})

test('storefront：登录 → 加购 → 带券结账 → 订单列表含 #999', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Tenant ID').fill('9')
  await page.getByLabel('Email').fill('shopper@example.com')
  await page.getByLabel('Password').fill('any-pw')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByText('Notebook')).toBeVisible()

  // 第一个商品行点"加入购物车"
  await page.getByRole('button', { name: /加入购物车|Add/ }).first().click()

  await page.getByRole('link', { name: '购物车' }).click()
  await expect(page).toHaveURL(/\/cart$/)
  await expect(page.getByText('Notebook')).toBeVisible()

  await page.getByLabel('优惠券').fill('SAVE5')
  await page.getByRole('button', { name: '结算' }).click()

  await expect(page.getByText(/下单成功，订单 #999/)).toBeVisible()

  await expect(page).toHaveURL(/\/orders$/, { timeout: 5000 })
  await expect(page.getByText('#999')).toBeVisible()
})
