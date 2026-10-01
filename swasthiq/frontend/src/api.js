// Centralised API helper — uses Vite proxy in dev, full URL in prod
const BASE = import.meta.env.VITE_API_URL || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  health:               () => request('/health'),
  stats:                () => request('/api/stats'),
  handoffs:             () => request('/api/handoffs'),
  conversations:        () => request('/api/conversations'),
  conversation:         (id) => request(`/api/conversations/${id}`),
  resolveHandoff:       (id) => request(`/api/handoffs/${id}/resolve`, { method: 'POST' }),
  runAgent:             (body) => request('/agent/run', { method: 'POST', body: JSON.stringify(body) }),
  appointments:         (params = {}) => {
    const query = new URLSearchParams()
    if (params.status && params.status !== 'all') query.append('status', params.status)
    if (params.doctor_id && params.doctor_id !== 'all') query.append('doctor_id', params.doctor_id)
    if (params.date) query.append('date', params.date)
    if (params.q) query.append('q', params.q)
    const qs = query.toString() ? `?${query.toString()}` : ''
    return request(`/api/appointments${qs}`)
  },
  cancelAppointment:    (id) => request(`/api/appointments/${id}/cancel`, { method: 'POST' }),
  doctors:              () => request('/api/doctors'),
}
