import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, type CartItem } from '../api/client.js'

export function CartPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null)
  const [couponCode, setCouponCode] = useState('')
  const cartQuery = useQuery({
    queryKey: ['storefront-cart'],
    queryFn: () => api.listCart(),
  })
  const productsQuery = useQuery({
    queryKey: ['storefront-products'],
    queryFn: () => api.listProducts({ page: 1, pageSize: 100 }),
  })
  const updateMutation = useMutation({
    mutationFn: ({ productId, quantity }: { productId: number; quantity: number }) =>
      api.updateCartItem(productId, quantity),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['storefront-cart'] }),
  })
  const removeMutation = useMutation({
    mutationFn: (productId: number) => api.removeCartItem(productId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['storefront-cart'] }),
  })
  const checkoutMutation = useMutation({
    mutationFn: (code: string | undefined) => api.checkout(code),
    onSuccess: (order) => {
      const discount = order.discountCents > 0
        ? `（优惠 ¥ ${(order.discountCents / 100).toFixed(2)}）`
        : ''
      setCheckoutMsg(`下单成功，订单 #${order.id}${discount}`)
      void queryClient.invalidateQueries({ queryKey: ['storefront-cart'] })
      void queryClient.invalidateQueries({ queryKey: ['storefront-orders'] })
      setTimeout(() => navigate('/orders'), 800)
    },
  })

  const productById = new Map(productsQuery.data?.items.map((p) => [p.id, p]) ?? [])

  function rowSubtotal(item: CartItem): number {
    const p = productById.get(item.productId)
    return (p?.priceCents ?? 0) * item.quantity
  }

  const items = cartQuery.data ?? []
  const total = items.reduce((s, it) => s + rowSubtotal(it), 0)

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>购物车</h2>
        {cartQuery.isLoading && <p className="muted">加载中…</p>}
        {cartQuery.error instanceof ApiError && (
          <div className="error">{cartQuery.error.message}</div>
        )}
        {cartQuery.data && items.length === 0 && (
          <p className="muted">购物车空空如也，去逛点商品吧</p>
        )}
        {items.length > 0 && (
          <>
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>单价</th>
                  <th>数量</th>
                  <th>小计</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const p = productById.get(it.productId)
                  return (
                    <tr key={it.id}>
                      <td>{p?.name ?? `#${it.productId}`}</td>
                      <td>{p ? `¥ ${(p.priceCents / 100).toFixed(2)}` : '—'}</td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          value={it.quantity}
                          style={{ width: 64 }}
                          onChange={(e) => {
                            const q = Number(e.target.value)
                            if (q >= 1) updateMutation.mutate({ productId: it.productId, quantity: q })
                          }}
                        />
                      </td>
                      <td>¥ {(rowSubtotal(it) / 100).toFixed(2)}</td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => removeMutation.mutate(it.productId)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 16, alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <strong>合计 ¥ {(total / 100).toFixed(2)}</strong>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <label htmlFor="cart-coupon" className="muted" style={{ marginRight: 4 }}>
                  优惠券
                </label>
                <input
                  id="cart-coupon"
                  type="text"
                  placeholder="可选"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.trim())}
                  style={{ width: 140 }}
                />
                <button
                  onClick={() => checkoutMutation.mutate(couponCode || undefined)}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending ? '提交中…' : '结算'}
                </button>
              </div>
            </div>
          </>
        )}
        {checkoutMsg && <div className="muted" style={{ marginTop: 8 }}>{checkoutMsg}</div>}
        {checkoutMutation.error instanceof ApiError && (
          <div className="error">结算失败：{checkoutMutation.error.message}</div>
        )}
      </div>
    </div>
  )
}
