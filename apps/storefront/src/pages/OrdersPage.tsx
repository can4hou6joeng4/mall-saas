import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client.js'
import { useT, type TKey } from '../i18n/index.js'

const STATUS_KEY: Record<string, TKey> = {
  pending: 'status_pending',
  paid: 'status_paid',
  shipped: 'status_shipped',
  cancelled: 'status_cancelled',
}

export function OrdersPage() {
  const t = useT()
  const ordersQuery = useQuery({
    queryKey: ['storefront-orders'],
    queryFn: () => api.listOrders(),
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t('orders_title')}</h2>
        {ordersQuery.isLoading && <p className="muted">{t('orders_loading')}</p>}
        {ordersQuery.error instanceof ApiError && (
          <div className="error">{ordersQuery.error.message}</div>
        )}
        {ordersQuery.data && ordersQuery.data.items.length === 0 && (
          <p className="muted">{t('orders_empty')}</p>
        )}
        {ordersQuery.data && ordersQuery.data.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t('orders_col_id')}</th>
                <th>{t('orders_col_status')}</th>
                <th>{t('orders_col_count')}</th>
                <th>{t('orders_col_subtotal')}</th>
                <th>{t('orders_col_discount')}</th>
                <th>{t('orders_col_total')}</th>
                <th>{t('orders_col_created')}</th>
              </tr>
            </thead>
            <tbody>
              {ordersQuery.data.items.map((o) => {
                const statusKey = STATUS_KEY[o.status]
                return (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/orders/${o.id}`}>#{o.id}</Link>
                    </td>
                    <td>
                      <span className={`status-pill ${o.status}`}>
                        {statusKey ? t(statusKey) : o.status}
                      </span>
                    </td>
                    <td>{o.items.length}</td>
                    <td>¥ {(o.subtotalCents / 100).toFixed(2)}</td>
                    <td>{o.discountCents > 0 ? `- ¥ ${(o.discountCents / 100).toFixed(2)}` : '-'}</td>
                    <td>¥ {(o.totalCents / 100).toFixed(2)}</td>
                    <td className="muted">{o.createdAt}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
