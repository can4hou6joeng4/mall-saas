import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function CouponsPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'disabled'>('')
  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT'>('AMOUNT')
  const [discountValue, setDiscountValue] = useState('')
  const [minOrderCents, setMinOrderCents] = useState('0')
  const [maxUsage, setMaxUsage] = useState('0')

  const couponsQuery = useQuery({
    queryKey: ['coupons', statusFilter],
    queryFn: () =>
      api.listCoupons(
        statusFilter ? { page: 1, pageSize: 50, status: statusFilter } : { page: 1, pageSize: 50 },
      ),
  })

  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.createCoupon>[0]) => api.createCoupon(input),
    onSuccess: () => {
      setCode('')
      setDiscountValue('')
      setMinOrderCents('0')
      setMaxUsage('0')
      void queryClient.invalidateQueries({ queryKey: ['coupons'] })
    },
  })

  const disableMutation = useMutation({
    mutationFn: (id: number) => api.disableCoupon(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['coupons'] })
    },
  })

  function onCreate(e: FormEvent): void {
    e.preventDefault()
    const value = Number(discountValue)
    if (!Number.isInteger(value) || value <= 0) return
    if (discountType === 'PERCENT' && value > 100) return
    createMutation.mutate({
      code: code.trim(),
      discountType,
      discountValue: value,
      minOrderCents: Number(minOrderCents) || 0,
      maxUsage: Number(maxUsage) || 0,
    })
  }

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>新建优惠券</h2>
        <form className="row" style={{ gap: 12, flexWrap: 'wrap' }} onSubmit={onCreate}>
          <label>
            Code
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="SAVE10"
            />
          </label>
          <label>
            类型
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'AMOUNT')}
            >
              <option value="AMOUNT">满减（分）</option>
              <option value="PERCENT">折扣（%）</option>
            </select>
          </label>
          <label>
            数值
            <input
              type="number"
              min={1}
              max={discountType === 'PERCENT' ? 100 : undefined}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              required
            />
          </label>
          <label>
            最低订单金额（分，0=不限）
            <input
              type="number"
              min={0}
              value={minOrderCents}
              onChange={(e) => setMinOrderCents(e.target.value)}
            />
          </label>
          <label>
            最大使用次数（0=不限）
            <input
              type="number"
              min={0}
              value={maxUsage}
              onChange={(e) => setMaxUsage(e.target.value)}
            />
          </label>
          <button type="submit" disabled={createMutation.isPending || !code.trim()}>
            {createMutation.isPending ? '创建中…' : '创建'}
          </button>
        </form>
        {createMutation.error instanceof ApiError && (
          <div className="error">{createMutation.error.message}</div>
        )}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>优惠券列表</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'disabled')}
          >
            <option value="">全部状态</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        {couponsQuery.error instanceof ApiError && (
          <div className="error">{couponsQuery.error.message}</div>
        )}
        {disableMutation.error instanceof ApiError && (
          <div className="error">停用失败：{disableMutation.error.message}</div>
        )}
        {couponsQuery.data && (
          <>
            <p className="muted">共 {couponsQuery.data.total} 条</p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Code</th>
                  <th>类型</th>
                  <th>数值</th>
                  <th>最低订单</th>
                  <th>使用</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {couponsQuery.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>
                      <code>{c.code}</code>
                    </td>
                    <td>{c.discountType}</td>
                    <td>
                      {c.discountType === 'PERCENT'
                        ? `${c.discountValue}%`
                        : `¥${(c.discountValue / 100).toFixed(2)}`}
                    </td>
                    <td>
                      {c.minOrderCents > 0 ? `¥${(c.minOrderCents / 100).toFixed(2)}` : '-'}
                    </td>
                    <td>
                      {c.usageCount}
                      {c.maxUsage > 0 ? ` / ${c.maxUsage}` : ''}
                    </td>
                    <td>{c.status}</td>
                    <td>
                      {c.status === 'active' && (
                        <button
                          className="secondary"
                          onClick={() => disableMutation.mutate(c.id)}
                          disabled={disableMutation.isPending}
                        >
                          停用
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {couponsQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      暂无优惠券
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
