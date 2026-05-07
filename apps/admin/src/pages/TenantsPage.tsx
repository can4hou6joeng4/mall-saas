import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function TenantsPage() {
  const queryClient = useQueryClient()
  const tenantsQuery = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.listTenants(),
  })
  const [name, setName] = useState('')
  const createMutation = useMutation({
    mutationFn: (newName: string) => api.createTenant(newName),
    onSuccess: () => {
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate(name.trim())
  }

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>新建租户</h2>
        <form className="row" onSubmit={onSubmit}>
          <input
            placeholder="租户名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={createMutation.isPending || !name.trim()}>
            {createMutation.isPending ? '创建中…' : '创建'}
          </button>
        </form>
        {createMutation.error instanceof ApiError && (
          <div className="error">{createMutation.error.message}</div>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>所有租户</h2>
        {tenantsQuery.isLoading && <p className="muted">加载中…</p>}
        {tenantsQuery.error instanceof ApiError && (
          <div className="error">{tenantsQuery.error.message}</div>
        )}
        {tenantsQuery.data && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {tenantsQuery.data.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.name}</td>
                  <td className="muted">{t.createdAt}</td>
                </tr>
              ))}
              {tenantsQuery.data.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    暂无租户
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
