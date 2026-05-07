import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function OrdersPage() {
  const [tenantId, setTenantId] = useState('')
  const [status, setStatus] = useState('')
  const ordersQuery = useQuery({
    queryKey: ['orders', tenantId, status],
    queryFn: () => {
      const query: { page: number; pageSize: number; tenantId?: number; status?: string } = {
        page: 1,
        pageSize: 50,
      }
      if (tenantId) query.tenantId = Number(tenantId)
      if (status) query.status = status
      return api.listOrders(query)
    },
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>过滤</h2>
        <div className="row">
          <input
            placeholder="tenantId"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All status</option>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>订单（跨租户只读）</h2>
        {ordersQuery.error instanceof ApiError && (
          <div className="error">{ordersQuery.error.message}</div>
        )}
        {ordersQuery.data && (
          <>
            <p className="muted">共 {ordersQuery.data.total} 条</p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tenant</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Items</th>
                  <th>CreatedAt</th>
                </tr>
              </thead>
              <tbody>
                {ordersQuery.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.tenantId}</td>
                    <td>{o.userId}</td>
                    <td>
                      <span className={`status-pill ${o.status}`}>{o.status}</span>
                    </td>
                    <td>{(o.totalCents / 100).toFixed(2)}</td>
                    <td>{o.items.length}</td>
                    <td className="muted">{o.createdAt}</td>
                  </tr>
                ))}
                {ordersQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      没有匹配的订单
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
