import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function PaymentsPage() {
  const [tenantId, setTenantId] = useState('')
  const [status, setStatus] = useState('')
  const paymentsQuery = useQuery({
    queryKey: ['payments', tenantId, status],
    queryFn: () => {
      const query: { page: number; pageSize: number; tenantId?: number; status?: string } = {
        page: 1,
        pageSize: 50,
      }
      if (tenantId) query.tenantId = Number(tenantId)
      if (status) query.status = status
      return api.listPayments(query)
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
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
          </select>
        </div>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>支付流水（跨租户只读）</h2>
        {paymentsQuery.error instanceof ApiError && (
          <div className="error">{paymentsQuery.error.message}</div>
        )}
        {paymentsQuery.data && (
          <>
            <p className="muted">共 {paymentsQuery.data.total} 条</p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tenant</th>
                  <th>Order</th>
                  <th>Provider</th>
                  <th>ProviderRef</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentsQuery.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/payments/${p.id}`}>#{p.id}</Link>
                    </td>
                    <td>{p.tenantId}</td>
                    <td>{p.orderId}</td>
                    <td>{p.providerName}</td>
                    <td className="muted">{p.providerRef}</td>
                    <td>
                      <span className={`status-pill ${p.status}`}>{p.status}</span>
                    </td>
                    <td>{(p.amountCents / 100).toFixed(2)}</td>
                  </tr>
                ))}
                {paymentsQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      没有匹配的支付
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
