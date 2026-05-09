import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

const STATUS_DISPLAY: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

export function OrdersPage() {
  const ordersQuery = useQuery({
    queryKey: ['storefront-orders'],
    queryFn: () => api.listOrders(),
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>我的订单</h2>
        {ordersQuery.isLoading && <p className="muted">加载中…</p>}
        {ordersQuery.error instanceof ApiError && (
          <div className="error">{ordersQuery.error.message}</div>
        )}
        {ordersQuery.data && ordersQuery.data.items.length === 0 && (
          <p className="muted">还没有订单</p>
        )}
        {ordersQuery.data && ordersQuery.data.items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>订单号</th>
                <th>状态</th>
                <th>商品数</th>
                <th>原价</th>
                <th>折扣</th>
                <th>实付</th>
                <th>下单时间</th>
              </tr>
            </thead>
            <tbody>
              {ordersQuery.data.items.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>
                    <span className={`status-pill ${o.status}`}>
                      {STATUS_DISPLAY[o.status] ?? o.status}
                    </span>
                  </td>
                  <td>{o.items.length}</td>
                  <td>¥ {(o.subtotalCents / 100).toFixed(2)}</td>
                  <td>{o.discountCents > 0 ? `- ¥ ${(o.discountCents / 100).toFixed(2)}` : '-'}</td>
                  <td>¥ {(o.totalCents / 100).toFixed(2)}</td>
                  <td className="muted">{o.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
