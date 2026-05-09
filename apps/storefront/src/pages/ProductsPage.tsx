import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function ProductsPage() {
  const queryClient = useQueryClient()
  const productsQuery = useQuery({
    queryKey: ['storefront-products'],
    queryFn: () => api.listProducts({ page: 1, pageSize: 50 }),
  })
  const addMutation = useMutation({
    mutationFn: ({ productId }: { productId: number }) => api.addCartItem(productId, 1),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storefront-cart'] })
    },
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>所有商品</h2>
        {productsQuery.isLoading && <p className="muted">加载中…</p>}
        {productsQuery.error instanceof ApiError && (
          <div className="error">{productsQuery.error.message}</div>
        )}
        {addMutation.error instanceof ApiError && (
          <div className="error">加购物车失败：{addMutation.error.message}</div>
        )}
        {productsQuery.data && productsQuery.data.items.length === 0 && (
          <p className="muted">暂无在售商品</p>
        )}
        {productsQuery.data && productsQuery.data.items.length > 0 && (
          <div className="product-grid">
            {productsQuery.data.items.map((p) => {
              const available = p.stock - p.reservedStock
              const soldOut = available <= 0
              return (
                <div key={p.id} className="product-card">
                  <h3>{p.name}</h3>
                  <div className="price">¥ {(p.priceCents / 100).toFixed(2)}</div>
                  <div className="meta">
                    库存可售 {available}{' '}
                    {soldOut && <span style={{ color: '#dc2626' }}>· 已售罄</span>}
                  </div>
                  <button
                    onClick={() => addMutation.mutate({ productId: p.id })}
                    disabled={soldOut || addMutation.isPending}
                  >
                    加入购物车
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
