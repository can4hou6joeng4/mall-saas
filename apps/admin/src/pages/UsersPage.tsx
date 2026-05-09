import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client.js'

export function UsersPage() {
  const queryClient = useQueryClient()
  const [tenantId, setTenantId] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'' | 'admin' | 'user'>('')
  const [locked, setLocked] = useState<'' | 'true' | 'false'>('')

  const usersQuery = useQuery({
    queryKey: ['admin-users', tenantId, email, role, locked],
    queryFn: () => {
      const query: Parameters<typeof api.listUsers>[0] = { page: 1, pageSize: 50 }
      if (tenantId) query.tenantId = Number(tenantId)
      if (email) query.email = email
      if (role) query.role = role
      if (locked) query.locked = locked
      return api.listUsers(query)
    },
  })

  const lockMutation = useMutation({
    mutationFn: ({ id, locked }: { id: number; locked: boolean }) =>
      api.setUserLocked(id, locked),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  return (
    <div className="col">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>过滤</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <input
            placeholder="tenantId"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <input
            placeholder="email contains..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as '' | 'admin' | 'user')}>
            <option value="">All roles</option>
            <option value="admin">admin</option>
            <option value="user">user</option>
          </select>
          <select
            value={locked}
            onChange={(e) => setLocked(e.target.value as '' | 'true' | 'false')}
          >
            <option value="">All</option>
            <option value="false">active</option>
            <option value="true">locked</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>用户（跨租户只读 + 锁定/解锁）</h2>
        {usersQuery.error instanceof ApiError && (
          <div className="error">{usersQuery.error.message}</div>
        )}
        {lockMutation.error instanceof ApiError && (
          <div className="error">操作失败：{lockMutation.error.message}</div>
        )}
        {usersQuery.data && (
          <>
            <p className="muted">共 {usersQuery.data.total} 人</p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tenant</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.tenantId}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>
                      {u.locked ? (
                        <span className="status-pill cancelled">locked</span>
                      ) : (
                        <span className="status-pill paid">active</span>
                      )}
                    </td>
                    <td className="muted">{u.createdAt}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => lockMutation.mutate({ id: u.id, locked: !u.locked })}
                        disabled={lockMutation.isPending}
                      >
                        {u.locked ? '解锁' : '锁定'}
                      </button>
                    </td>
                  </tr>
                ))}
                {usersQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      没有匹配的用户
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
