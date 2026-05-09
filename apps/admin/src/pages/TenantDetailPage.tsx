import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../api/client.js'

const STATUS_DISPLAY: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function TenantDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const tenantQuery = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => api.getTenant(id),
    enabled: Number.isFinite(id) && id > 0,
  })

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="panel">
        <p className="error">无效租户 ID</p>
        <Link to="/tenants">← 返回租户列表</Link>
      </div>
    )
  }

  return (
    <div className="col">
      <Link to="/tenants">← 返回租户列表</Link>
      {tenantQuery.error instanceof ApiError && (
        <div className="error">{tenantQuery.error.message}</div>
      )}
      {tenantQuery.data && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>
              {tenantQuery.data.name}（#{tenantQuery.data.id}）
            </h2>
            <div className="muted">创建时间：{tenantQuery.data.createdAt}</div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>资源计数</h3>
            <table>
              <tbody>
                <tr>
                  <td>商品数</td>
                  <td>{tenantQuery.data.productCount}</td>
                </tr>
                <tr>
                  <td>用户数（含 admin）</td>
                  <td>{tenantQuery.data.userCount}</td>
                </tr>
                <tr>
                  <td>
                    <strong>累计 paid 营收</strong>
                  </td>
                  <td>
                    <strong>¥ {formatYuan(tenantQuery.data.paidRevenueCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>订单状态分桶</h3>
            {Object.keys(tenantQuery.data.ordersByStatus).length === 0 ? (
              <p className="muted">尚无订单</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>数量</th>
                    <th>总金额</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(tenantQuery.data.ordersByStatus).map(([status, b]) => (
                    <tr key={status}>
                      <td>
                        <span className={`status-pill ${status}`}>
                          {STATUS_DISPLAY[status] ?? status}
                        </span>
                      </td>
                      <td>{b.count}</td>
                      <td>¥ {formatYuan(b.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
