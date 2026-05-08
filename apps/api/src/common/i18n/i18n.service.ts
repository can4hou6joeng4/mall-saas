import { Injectable } from '@nestjs/common'

export type Locale = 'en' | 'zh-CN'

const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    'product.notFound': 'Product {id} not found',
    'product.insufficientStock': 'Insufficient available stock for product {id}',
    'order.notFound': 'Order {id} not found',
    'order.invalidTransition': 'Order {id} cannot transition from {from} to {to}',
    'coupon.notFound': 'Coupon "{code}" not found',
    'coupon.expired': 'Coupon "{code}" has expired',
    'coupon.notActive': 'Coupon "{code}" is not active',
    'coupon.usageLimit': 'Coupon usage limit reached',
    'coupon.minNotMet': 'Coupon requires minimum order of {min} cents',
    'auth.invalidCredentials': 'Invalid credentials',
    'auth.tooManyAttempts': 'Too many auth attempts, please retry later',
  },
  'zh-CN': {
    'product.notFound': '商品 {id} 不存在',
    'product.insufficientStock': '商品 {id} 可用库存不足',
    'order.notFound': '订单 {id} 不存在',
    'order.invalidTransition': '订单 {id} 状态无法从 {from} 流转到 {to}',
    'coupon.notFound': '优惠券 "{code}" 不存在',
    'coupon.expired': '优惠券 "{code}" 已过期',
    'coupon.notActive': '优惠券 "{code}" 未激活',
    'coupon.usageLimit': '优惠券使用次数已达上限',
    'coupon.minNotMet': '订单金额需达到 {min} 分起才能使用该券',
    'auth.invalidCredentials': '凭据无效',
    'auth.tooManyAttempts': '认证尝试次数过多，请稍后再试',
  },
}

export const SUPPORTED_LOCALES: Locale[] = ['en', 'zh-CN']
export const DEFAULT_LOCALE: Locale = 'en'

@Injectable()
export class I18nService {
  resolve(acceptLanguage: string | string[] | undefined): Locale {
    const raw = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage
    if (!raw) return DEFAULT_LOCALE
    const tags = raw
      .split(',')
      .map((t) => t.trim().split(';')[0]!.trim().toLowerCase())
      .filter(Boolean)
    for (const tag of tags) {
      if (tag.startsWith('zh')) return 'zh-CN'
      if (tag.startsWith('en')) return 'en'
    }
    return DEFAULT_LOCALE
  }

  translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
    const dict = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE]
    const template = dict[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, k: string) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    )
  }
}
