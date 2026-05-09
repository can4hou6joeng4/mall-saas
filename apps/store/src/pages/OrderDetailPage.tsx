import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api, type StoreOrderDetail } from '../api/client.js'

const STATUS_DISPLAY: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

function formatYuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

function formatDiscount(coupon: NonNullable<StoreOrderDetail['coupon']>): string {
  if (coupon.discountType === 'PERCENT') return `${coupon.discountValue}% off`
  return `¥${formatYuan(coupon.discountValue)} off`
}

export function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)
  const queryClient = useQueryClient()
  const orderQuery = useQuery({
    queryKey: ['store-order', id],
    queryFn: () => api.getStoreOrder(id),
    enabled: Number.isFinite(id) && id > 0,
  })
  const shipMutation = useMutation({
    mutationFn: () => api.shipOrder(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-order', id] })
      void queryClient.invalidateQueries({ queryKey: ['store-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="panel">
        <p className="error">无效订单 ID</p>
        <Link to="/orders">← 返回订单列表</Link>
      </div>
    )
  }

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/orders">← 返回订单列表</Link>
        {orderQuery.data?.status === 'paid' && (
          <button
            onClick={() => shipMutation.mutate()}
            disabled={shipMutation.isPending}
          >
            {shipMutation.isPending ? '发货中…' : '发货'}
          </button>
        )}
      </div>

      {orderQuery.error instanceof ApiError && (
        <div className="error">{orderQuery.error.message}</div>
      )}
      {shipMutation.error instanceof ApiError && (
        <div className="error">发货失败：{shipMutation.error.message}</div>
      )}

      {orderQuery.data && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>订单 #{orderQuery.data.id}</h2>
            <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div className="muted">状态</div>
                <span className={`status-pill ${orderQuery.data.status}`}>
                  {STATUS_DISPLAY[orderQuery.data.status] ?? orderQuery.data.status}
                </span>
              </div>
              <div>
                <div className="muted">用户</div>
                <div>
                  #{orderQuery.data.user.id} {orderQuery.data.user.email}
                </div>
              </div>
              <div>
                <div className="muted">创建时间</div>
                <div>{orderQuery.data.createdAt}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>商品</h3>
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
                {orderQuery.data.items.map((it) => (
                  <tr key={it.id}>
                    <td>#{it.productId}</td>
                    <td>¥{formatYuan(it.unitPriceCents)}</td>
                    <td>{it.quantity}</td>
                    <td>¥{formatYuan(it.subtotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>金额</h3>
            <table>
              <tbody>
                <tr>
                  <td>商品小计</td>
                  <td>¥{formatYuan(orderQuery.data.subtotalCents)}</td>
                </tr>
                <tr>
                  <td>
                    优惠券折扣
                    {orderQuery.data.coupon && (
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {orderQuery.data.coupon.code}（{formatDiscount(orderQuery.data.coupon)}）
                      </span>
                    )}
                  </td>
                  <td>-¥{formatYuan(orderQuery.data.discountCents)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>实付</strong>
                  </td>
                  <td>
                    <strong>¥{formatYuan(orderQuery.data.totalCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>支付记录</h3>
            {orderQuery.data.payments.length === 0 ? (
              <p className="muted">暂无支付记录</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>渠道</th>
                    <th>外部单号</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {orderQuery.data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.providerName}</td>
                      <td className="muted">{p.providerRef}</td>
                      <td>¥{formatYuan(p.amountCents)}</td>
                      <td>{p.status}</td>
                      <td className="muted">{p.createdAt}</td>
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
