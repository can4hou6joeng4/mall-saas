import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../api/client.js'
import { useT, type TKey } from '../i18n/index.js'

const STATUS_KEY: Record<string, TKey> = {
  pending: 'status_pending',
  paid: 'status_paid',
  shipped: 'status_shipped',
  cancelled: 'status_cancelled',
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function OrderDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const queryClient = useQueryClient()
  const t = useT()
  const orderQuery = useQuery({
    queryKey: ['storefront-order', id],
    queryFn: () => api.getOrder(id),
    enabled: Number.isFinite(id) && id > 0,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false),
  })
  const payMutation = useMutation({
    mutationFn: () => api.payOrder(id, 'mock'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storefront-order', id] })
      void queryClient.invalidateQueries({ queryKey: ['storefront-orders'] })
    },
  })

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="panel">
        <p className="error">{t('order_invalid_id')}</p>
        <Link to="/orders">{t('order_back')}</Link>
      </div>
    )
  }

  const statusKey = orderQuery.data ? STATUS_KEY[orderQuery.data.status] : undefined

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/orders">{t('order_back')}</Link>
        {orderQuery.data?.status === 'pending' && (
          <button
            onClick={() => payMutation.mutate()}
            disabled={payMutation.isPending || payMutation.isSuccess}
          >
            {payMutation.isPending
              ? t('order_paying')
              : payMutation.isSuccess
                ? t('order_pay_dispatched')
                : t('order_pay')}
          </button>
        )}
      </div>

      {orderQuery.error instanceof ApiError && (
        <div className="error">{orderQuery.error.message}</div>
      )}
      {payMutation.error instanceof ApiError && (
        <div className="error">
          {t('order_pay_failed')}
          {payMutation.error.message}
        </div>
      )}

      {orderQuery.data && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>
              {`${t('orders_col_id')} #${orderQuery.data.id}`}
            </h2>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div className="muted">{t('order_status')}</div>
                <span className={`status-pill ${orderQuery.data.status}`}>
                  {statusKey ? t(statusKey) : orderQuery.data.status}
                </span>
              </div>
              <div>
                <div className="muted">{t('order_created')}</div>
                <div>{orderQuery.data.createdAt}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t('order_items')}</h3>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>{t('cart_col_price')}</th>
                  <th>{t('cart_col_quantity')}</th>
                  <th>{t('cart_col_subtotal')}</th>
                </tr>
              </thead>
              <tbody>
                {orderQuery.data.items.map((it) => (
                  <tr key={it.id}>
                    <td>#{it.productId}</td>
                    <td>¥ {formatYuan(it.unitPriceCents)}</td>
                    <td>{it.quantity}</td>
                    <td>¥ {formatYuan(it.subtotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t('order_amounts')}</h3>
            <table>
              <tbody>
                <tr>
                  <td>{t('order_subtotal')}</td>
                  <td>¥ {formatYuan(orderQuery.data.subtotalCents)}</td>
                </tr>
                <tr>
                  <td>{t('order_discount')}</td>
                  <td>
                    {orderQuery.data.discountCents > 0
                      ? `- ¥ ${formatYuan(orderQuery.data.discountCents)}`
                      : '-'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('order_total')}</strong>
                  </td>
                  <td>
                    <strong>¥ {formatYuan(orderQuery.data.totalCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
