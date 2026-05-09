import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../api/client.js'

const ORDER_STATUS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function PaymentDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const paymentQuery = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.getPayment(id),
    enabled: Number.isFinite(id) && id > 0,
  })

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="panel">
        <p className="error">无效支付 ID</p>
        <Link to="/payments">← 返回支付流水</Link>
      </div>
    )
  }

  return (
    <div className="col">
      <Link to="/payments">← 返回支付流水</Link>
      {paymentQuery.error instanceof ApiError && (
        <div className="error">{paymentQuery.error.message}</div>
      )}
      {paymentQuery.data && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>支付 #{paymentQuery.data.id}</h2>
            <table>
              <tbody>
                <tr>
                  <td>状态</td>
                  <td>
                    <span className={`status-pill ${paymentQuery.data.status}`}>
                      {paymentQuery.data.status}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>渠道</td>
                  <td>{paymentQuery.data.providerName}</td>
                </tr>
                <tr>
                  <td>外部单号</td>
                  <td className="muted">{paymentQuery.data.providerRef}</td>
                </tr>
                <tr>
                  <td>金额</td>
                  <td>¥ {formatYuan(paymentQuery.data.amountCents)}</td>
                </tr>
                <tr>
                  <td>创建</td>
                  <td className="muted">{paymentQuery.data.createdAt}</td>
                </tr>
                <tr>
                  <td>更新</td>
                  <td className="muted">{paymentQuery.data.updatedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>关联租户</h3>
            <div>
              <Link to={`/tenants/${paymentQuery.data.tenant.id}`}>
                #{paymentQuery.data.tenant.id} {paymentQuery.data.tenant.name}
              </Link>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>关联订单</h3>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div className="muted">订单号</div>
                <div>#{paymentQuery.data.order.id}</div>
              </div>
              <div>
                <div className="muted">订单状态</div>
                <span className={`status-pill ${paymentQuery.data.order.status}`}>
                  {ORDER_STATUS[paymentQuery.data.order.status] ?? paymentQuery.data.order.status}
                </span>
              </div>
              <div>
                <div className="muted">实付</div>
                <div>¥ {formatYuan(paymentQuery.data.order.totalCents)}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>订单商品</h3>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>单价</th>
                  <th>数量</th>
                  <th>小计</th>
                </tr>
              </thead>
              <tbody>
                {paymentQuery.data.order.items.map((it) => (
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
        </>
      )}
    </div>
  )
}
