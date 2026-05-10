import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'
import { useT } from '../i18n/index.js'

export function ProductsPage() {
  const queryClient = useQueryClient()
  const t = useT()
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
        <h2 style={{ marginTop: 0 }}>{t('products_title')}</h2>
        {productsQuery.isLoading && <p className="muted">{t('products_loading')}</p>}
        {productsQuery.error instanceof ApiError && (
          <div className="error">{productsQuery.error.message}</div>
        )}
        {addMutation.error instanceof ApiError && (
          <div className="error">
            {t('products_add_failed')}
            {addMutation.error.message}
          </div>
        )}
        {productsQuery.data && productsQuery.data.items.length === 0 && (
          <p className="muted">{t('products_empty')}</p>
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
                    {t('products_stock')} {available}{' '}
                    {soldOut && (
                      <span style={{ color: '#dc2626' }}>· {t('products_sold_out')}</span>
                    )}
                  </div>
                  <button
                    onClick={() => addMutation.mutate({ productId: p.id })}
                    disabled={soldOut || addMutation.isPending}
                  >
                    {addMutation.isPending ? t('products_adding') : t('products_add')}
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
