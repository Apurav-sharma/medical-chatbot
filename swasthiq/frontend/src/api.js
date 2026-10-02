// Centralised API helper
// Keep requests same-origin in production. Render rewrites proxy /api, /agent,
// and /health to the backend, so its host is not embedded in the client bundle.
const BASE = ''

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
  health:             () => request('/health'),
  stats:              () => request('/api/stats'),
  handoffs:           () => request('/api/handoffs'),
  conversations:      () => request('/api/conversations'),
  conversation:       (id) => request(`/api/conversations/${id}`),
  resolveHandoff:     (id) => request(`/api/handoffs/${id}/resolve`, { method: 'POST' }),
  runAgent:           (body) => request('/agent/run', { method: 'POST', body: JSON.stringify(body) }),
  searchSlots:        (doctorId, date) => request(`/api/slots?doctor_id=${doctorId}&date=${date}`),
  appointments:       (params = {}) => {
    const q = new URLSearchParams()
    if (params.status && params.status !== 'all') q.append('status', params.status)
    if (params.doctor_id && params.doctor_id !== 'all') q.append('doctor_id', params.doctor_id)
    if (params.date) q.append('date', params.date)
    if (params.q) q.append('q', params.q)
    const qs = q.toString() ? `?${q}` : ''
    return request(`/api/appointments${qs}`)
  },
  cancelAppointment:     (id) => request(`/api/appointments/${id}/cancel`, { method: 'POST' }),
  lookupCancellations:   (data) => request('/api/cancellations/lookup', { method: 'POST', body: JSON.stringify(data) }),
  confirmCancellation:   (id, data) => request(`/api/cancellations/${id}/confirm`, { method: 'POST', body: JSON.stringify(data) }),
  doctors:               () => request('/api/doctors'),
  confirmBooking:        (data) => request('/api/appointments/confirm', { method: 'POST', body: JSON.stringify(data) }),
  rescheduleAppointment: (id, data) => request(`/api/appointments/${id}/reschedule`, { method: 'POST', body: JSON.stringify(data) }),
}
