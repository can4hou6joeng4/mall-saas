import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

const LOW_STOCK_THRESHOLD = 5

export function ProductsPage() {
  const queryClient = useQueryClient()
  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts({ page: 1, pageSize: 50 }),
  })
  const [name, setName] = useState('')
  const [priceYuan, setPriceYuan] = useState('')
  const [stock, setStock] = useState('')
  const createMutation = useMutation({
    mutationFn: (input: { name: string; priceCents: number; stock: number }) =>
      api.createProduct(input),
    onSuccess: () => {
      setName('')
      setPriceYuan('')
      setStock('')
      void queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    const priceCents = Math.round(Number(priceYuan) * 100)
    const stockNum = Number(stock)
    if (!name.trim() || !Number.isFinite(priceCents) || priceCents < 0) return
    if (!Number.isInteger(stockNum) || stockNum < 0) return
    createMutation.mutate({ name: name.trim(), priceCents, stock: stockNum })
  }

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>新建商品</h2>
        <form className="row" onSubmit={onSubmit}>
          <input
            placeholder="商品名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="价格（元）"
            inputMode="decimal"
            value={priceYuan}
            onChange={(e) => setPriceYuan(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <input
            placeholder="库存"
            inputMode="numeric"
            value={stock}
            onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? '创建中…' : '创建'}
          </button>
        </form>
        {createMutation.error instanceof ApiError && (
          <div className="error">{createMutation.error.message}</div>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>所有商品</h2>
        {productsQuery.isLoading && <p className="muted">加载中…</p>}
        {productsQuery.error instanceof ApiError && (
          <div className="error">{productsQuery.error.message}</div>
        )}
        {productsQuery.data && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>价格（元）</th>
                <th>库存</th>
                <th>预占</th>
                <th>可售</th>
              </tr>
            </thead>
            <tbody>
              {productsQuery.data.items.map((p) => {
                const available = p.stock - p.reservedStock
                const low = p.stock <= LOW_STOCK_THRESHOLD
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.name}</td>
                    <td>{(p.priceCents / 100).toFixed(2)}</td>
                    <td>
                      {p.stock} {low && <span className="warning-pill">低库存</span>}
                    </td>
                    <td>{p.reservedStock}</td>
                    <td>{available}</td>
                  </tr>
                )
              })}
              {productsQuery.data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无商品
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
