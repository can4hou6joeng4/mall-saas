import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// 字典 key 枚举：手写 Locale 字典必须 keyof 化，缺 key 编译期就能发现
const dict = {
  'zh-CN': {
    // App.tsx 导航
    nav_products: '商品',
    nav_cart: '购物车',
    nav_orders: '我的订单',
    nav_logout: '登出',
    locale_switch: 'EN',
    // LoginPage
    login_title: 'Mall Storefront',
    login_register_subtitle: '新用户注册',
    login_login_subtitle: '已有账号，欢迎回来',
    login_tenant_id: 'Tenant ID',
    login_email: 'Email',
    login_password: 'Password',
    login_submit_register: '注册并登录',
    login_submit_login: '登录',
    login_submitting: '处理中…',
    login_to_login: '去登录',
    login_to_register: '去注册',
    login_have_account: '已经有账号？',
    login_no_account: '还没有账号？',
    login_invalid_tenant: 'tenantId 必须是正整数',
    login_failed_register: 'register failed',
    login_failed_login: 'login failed',
    // ProductsPage
    products_title: '所有商品',
    products_loading: '加载中…',
    products_empty: '没有可买的商品，等掌柜上新',
    products_add: '加入购物车',
    products_adding: '加入中…',
    products_add_failed: '加购物车失败：',
    products_sold_out: '已售罄',
    products_stock: '库存',
    // CartPage
    cart_title: '购物车',
    cart_loading: '加载中…',
    cart_empty: '购物车空空如也，去逛点商品吧',
    cart_col_product: '商品',
    cart_col_price: '单价',
    cart_col_quantity: '数量',
    cart_col_subtotal: '小计',
    cart_total: '合计',
    cart_remove: '删除',
    cart_coupon: '优惠券',
    cart_coupon_placeholder: '可选',
    cart_checkout: '结算',
    cart_checking_out: '提交中…',
    cart_checkout_ok: '下单成功，订单',
    cart_checkout_discount: '优惠',
    cart_checkout_failed: '结算失败：',
    // Orders / OrderDetail
    orders_title: '我的订单',
    orders_loading: '加载中…',
    orders_empty: '还没有订单',
    orders_col_id: '订单号',
    orders_col_status: '状态',
    orders_col_count: '商品数',
    orders_col_subtotal: '原价',
    orders_col_discount: '折扣',
    orders_col_total: '实付',
    orders_col_created: '下单时间',
    order_back: '← 返回我的订单',
    order_invalid_id: '无效订单 ID',
    order_status: '状态',
    order_created: '下单时间',
    order_items: '商品',
    order_amounts: '金额',
    order_subtotal: '商品小计',
    order_discount: '优惠券折扣',
    order_total: '实付',
    order_pay: '去支付',
    order_paying: '调起支付中…',
    order_pay_dispatched: '支付已发起，等待回调…',
    order_pay_failed: '支付失败：',
    // 状态映射
    status_pending: '待支付',
    status_paid: '已支付',
    status_shipped: '已发货',
    status_cancelled: '已取消',
  },
  en: {
    nav_products: 'Products',
    nav_cart: 'Cart',
    nav_orders: 'My Orders',
    nav_logout: 'Logout',
    locale_switch: '中文',
    login_title: 'Mall Storefront',
    login_register_subtitle: 'Create a new account',
    login_login_subtitle: 'Welcome back',
    login_tenant_id: 'Tenant ID',
    login_email: 'Email',
    login_password: 'Password',
    login_submit_register: 'Register & Sign in',
    login_submit_login: 'Sign in',
    login_submitting: 'Working…',
    login_to_login: 'Sign in',
    login_to_register: 'Register',
    login_have_account: 'Already have an account?',
    login_no_account: "Don't have an account?",
    login_invalid_tenant: 'tenantId must be a positive integer',
    login_failed_register: 'register failed',
    login_failed_login: 'login failed',
    products_title: 'All products',
    products_loading: 'Loading…',
    products_empty: 'No products yet — check back later',
    products_add: 'Add to cart',
    products_adding: 'Adding…',
    products_add_failed: 'Add to cart failed: ',
    products_sold_out: 'Sold out',
    products_stock: 'Stock',
    cart_title: 'Cart',
    cart_loading: 'Loading…',
    cart_empty: 'Your cart is empty — go browse some products',
    cart_col_product: 'Product',
    cart_col_price: 'Price',
    cart_col_quantity: 'Qty',
    cart_col_subtotal: 'Subtotal',
    cart_total: 'Total',
    cart_remove: 'Remove',
    cart_coupon: 'Coupon',
    cart_coupon_placeholder: 'optional',
    cart_checkout: 'Checkout',
    cart_checking_out: 'Submitting…',
    cart_checkout_ok: 'Order placed: #',
    cart_checkout_discount: 'discount',
    cart_checkout_failed: 'Checkout failed: ',
    orders_title: 'My orders',
    orders_loading: 'Loading…',
    orders_empty: 'No orders yet',
    orders_col_id: 'Order',
    orders_col_status: 'Status',
    orders_col_count: 'Items',
    orders_col_subtotal: 'Subtotal',
    orders_col_discount: 'Discount',
    orders_col_total: 'Total',
    orders_col_created: 'Placed at',
    order_back: '← Back to orders',
    order_invalid_id: 'Invalid order ID',
    order_status: 'Status',
    order_created: 'Placed at',
    order_items: 'Items',
    order_amounts: 'Amounts',
    order_subtotal: 'Subtotal',
    order_discount: 'Coupon discount',
    order_total: 'Total',
    order_pay: 'Pay now',
    order_paying: 'Initiating payment…',
    order_pay_dispatched: 'Payment dispatched, waiting for callback…',
    order_pay_failed: 'Payment failed: ',
    status_pending: 'Pending',
    status_paid: 'Paid',
    status_shipped: 'Shipped',
    status_cancelled: 'Cancelled',
  },
} as const

export type Locale = keyof typeof dict
export type TKey = keyof (typeof dict)['zh-CN']

const LOCALE_KEY = 'mall_storefront_locale'

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN'
  const v = window.localStorage.getItem(LOCALE_KEY)
  return v === 'en' || v === 'zh-CN' ? v : 'zh-CN'
}

interface I18nValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale())

  const setLocale = (l: Locale): void => {
    setLocaleState(l)
    if (typeof window !== 'undefined') window.localStorage.setItem(LOCALE_KEY, l)
  }

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => dict[locale][key],
    }),
    [locale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

export function useT(): (key: TKey) => string {
  return useI18n().t
}
