import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function OrderDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const queryClient = useQueryClient()
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
        <p className="error">无效订单 ID</p>
        <Link to="/orders">← 返回我的订单</Link>
      </div>
    )
  }

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/orders">← 返回我的订单</Link>
        {orderQuery.data?.status === 'pending' && (
          <button
            onClick={() => payMutation.mutate()}
            disabled={payMutation.isPending || payMutation.isSuccess}
          >
            {payMutation.isPending
              ? '调起支付中…'
              : payMutation.isSuccess
                ? '支付已发起，等待回调…'
                : '去支付'}
          </button>
        )}
      </div>

      {orderQuery.error instanceof ApiError && (
        <div className="error">{orderQuery.error.message}</div>
      )}
      {payMutation.error instanceof ApiError && (
        <div className="error">支付失败：{payMutation.error.message}</div>
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
                <div className="muted">下单时间</div>
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
                    <td>¥ {formatYuan(it.unitPriceCents)}</td>
                    <td>{it.quantity}</td>
                    <td>¥ {formatYuan(it.subtotalCents)}</td>
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
                  <td>¥ {formatYuan(orderQuery.data.subtotalCents)}</td>
                </tr>
                <tr>
                  <td>优惠券折扣</td>
                  <td>
                    {orderQuery.data.discountCents > 0
                      ? `- ¥ ${formatYuan(orderQuery.data.discountCents)}`
                      : '-'}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>实付</strong>
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
