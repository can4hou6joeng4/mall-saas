import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

const STATUS_DISPLAY: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  shipped: '已发货',
  cancelled: '已取消',
}

export function OrdersPage() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const ordersQuery = useQuery({
    queryKey: ['store-orders', status],
    queryFn: () => {
      const query: { page: number; pageSize: number; status?: string } = {
        page: 1,
        pageSize: 50,
      }
      if (status) query.status = status
      return api.listStoreOrders(query)
    },
  })
  const shipMutation = useMutation({
    mutationFn: (orderId: number) => api.shipOrder(orderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>过滤</h2>
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All status</option>
            <option value="pending">待支付</option>
            <option value="paid">已支付</option>
            <option value="shipped">已发货</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>订单（本租户全部）</h2>
        {ordersQuery.error instanceof ApiError && (
          <div className="error">{ordersQuery.error.message}</div>
        )}
        {shipMutation.error instanceof ApiError && (
          <div className="error">发货失败：{shipMutation.error.message}</div>
        )}
        {ordersQuery.data && (
          <>
            <p className="muted">共 {ordersQuery.data.total} 条</p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>用户</th>
                  <th>状态</th>
                  <th>金额（元）</th>
                  <th>SKU 数</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ordersQuery.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.userId}</td>
                    <td>
                      <span className={`status-pill ${o.status}`}>
                        {STATUS_DISPLAY[o.status] ?? o.status}
                      </span>
                    </td>
                    <td>{(o.totalCents / 100).toFixed(2)}</td>
                    <td>{o.items.length}</td>
                    <td className="muted">{o.createdAt}</td>
                    <td>
                      {o.status === 'paid' && (
                        <button
                          onClick={() => shipMutation.mutate(o.id)}
                          disabled={shipMutation.isPending}
                        >
                          发货
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {ordersQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      暂无订单
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
