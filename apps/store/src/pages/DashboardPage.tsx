import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

const STATUS_DISPLAY: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

export function DashboardPage() {
  const dashQuery = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() })

  if (dashQuery.error instanceof ApiError) {
    return <div className="panel error">{dashQuery.error.message}</div>
  }
  if (!dashQuery.data) {
    return <p className="muted">加载中…</p>
  }
  const d = dashQuery.data

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>店铺总览</h2>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="label">商品总数</div>
            <div className="value">{d.productCount}</div>
          </div>
          <div className="stat-card">
            <div className="label">
              低库存（≤{d.lowStockThreshold}）
            </div>
            <div className="value">{d.lowStockProducts}</div>
          </div>
          <div className="stat-card">
            <div className="label">在途预占</div>
            <div className="value">{d.reservedStockTotal}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>订单分桶</h2>
        {Object.keys(d.ordersByStatus).length === 0 ? (
          <p className="muted">暂无订单</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>状态</th>
                <th>笔数</th>
                <th>金额（元）</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.ordersByStatus).map(([status, info]) => (
                <tr key={status}>
                  <td>
                    <span className={`status-pill ${status}`}>
                      {STATUS_DISPLAY[status] ?? status}
                    </span>
                  </td>
                  <td>{info.count}</td>
                  <td>{(info.totalCents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
