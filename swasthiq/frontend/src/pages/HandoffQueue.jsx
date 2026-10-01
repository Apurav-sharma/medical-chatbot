import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import styles from './HandoffQueue.module.css'

const REASON_LABELS = {
  clinical_urgent:   { label: 'Clinical Urgent',    color: '#f43f5e' },
  medical_advice:    { label: 'Medical Advice',     color: '#f59e0b' },
  not_authorised:    { label: 'Not Authorised',     color: '#8b5cf6' },
  ambiguous_patient: { label: 'Ambiguous Patient',  color: '#06b6d4' },
  out_of_scope:      { label: 'Out of Scope',       color: '#64748b' },
}

function Counter({ label, value, color }) {
  return (
    <div className={styles.counter}>
      <span className={styles.counterValue} style={{ color }}>{value}</span>
      <span className={styles.counterLabel}>{label}</span>
    </div>
  )
}

function HandoffCard({ handoff, onResolve }) {
  const [resolving, setResolving] = useState(false)
  const reason = REASON_LABELS[handoff.reason] || { label: handoff.reason, color: '#64748b' }

  const handleResolve = async () => {
    setResolving(true)
    try {
      await onResolve(handoff.conversation_id)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className={`${styles.card} ${handoff.resolved ? styles.resolved : ''}`}>
      {/* Coloured left stripe */}
      <div className={styles.stripe} style={{ background: reason.color }} />

      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <span className={styles.convId}>{handoff.conversation_id}</span>
          <span className={styles.reasonTag} style={{
            background: reason.color + '22',
            color: reason.color,
            border: `1px solid ${reason.color}44`
          }}>
            {reason.label}
          </span>
          {handoff.resolved && <span className={styles.resolvedTag}>Resolved</span>}
        </div>

        {/* What the caller said */}
        {handoff.caller_said && (
          <blockquote className={styles.callerSaid}>
            "{handoff.caller_said.slice(0, 200)}{handoff.caller_said.length > 200 ? '…' : ''}"
          </blockquote>
        )}

        {/* Summary / escalation reason */}
        <p className={styles.summary}>{handoff.summary || '—'}</p>

        <div className={styles.meta}>
          {handoff.patient_id && (
            <span className={styles.metaItem}>
              <MetaIcon type="patient" /> {handoff.patient_id}
            </span>
          )}
          {handoff.appointment_id && (
            <span className={styles.metaItem}>
              <MetaIcon type="appt" /> {handoff.appointment_id}
            </span>
          )}
          <span className={styles.metaItem}>
            <MetaIcon type="time" /> {formatTime(handoff.timestamp)}
          </span>
        </div>

        {!handoff.resolved && (
          <button
            className={styles.resolveBtn}
            onClick={handleResolve}
            disabled={resolving}
          >
            {resolving ? 'Resolving…' : '✓ Mark Resolved'}
          </button>
        )}
      </div>
    </div>
  )
}

function MetaIcon({ type }) {
  if (type === 'patient') return <span>👤</span>
  if (type === 'appt')   return <span>📅</span>
  return <span>🕐</span>
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: true
    })
  } catch { return ts }
}

export default function HandoffQueue() {
  const [data, setData]       = useState(null)
  const [filter, setFilter]   = useState('open')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toast, setToast]     = useState(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await api.handoffs()
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const handleResolve = async (id) => {
    try {
      await api.resolveHandoff(id)
      showToast('Handoff marked as resolved', 'success')
      load()
    } catch (e) {
      showToast(`Failed: ${e.message}`, 'error')
    }
  }

  const showToast = (msg, type) => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handoffs = data?.handoffs || []
  const counts   = data?.counts || {}

  const filtered = filter === 'all'      ? handoffs
                 : filter === 'open'     ? handoffs.filter(h => !h.resolved)
                 : handoffs.filter(h =>  h.resolved)

  // Compute per-reason counts for open handoffs
  const reasonCounts = {}
  handoffs.filter(h => !h.resolved).forEach(h => {
    reasonCounts[h.reason] = (reasonCounts[h.reason] || 0) + 1
  })

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle}>Handoff Queue</h1>
          <p className={styles.pageSub}>Escalations that need human attention</p>
        </div>
        <button className={styles.refreshBtn} onClick={load} title="Refresh">
          <RefreshIcon />
        </button>
      </div>

      {/* ─── Counters ─── */}
      <div className={styles.counters}>
        <Counter label="Total"    value={counts.total    ?? 0} color="var(--text-1)" />
        <Counter label="Open"     value={counts.open     ?? 0} color="var(--rose)" />
        <Counter label="Resolved" value={counts.resolved ?? 0} color="var(--emerald)" />
        <div className={styles.counterDivider} />
        {Object.entries(REASON_LABELS).map(([key, { label, color }]) => (
          <Counter key={key} label={label} value={reasonCounts[key] || 0} color={color} />
        ))}
      </div>

      {/* ─── Filter tabs ─── */}
      <div className={styles.tabs}>
        {['all', 'open', 'resolved'].map(f => (
          <button
            key={f}
            className={`${styles.tab} ${filter === f ? styles.activeTab : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'open' && counts.open > 0 && (
              <span className={styles.tabBadge}>{counts.open}</span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Content ─── */}
      {loading && (
        <div className={styles.centerState}>
          <div className="spinner" />
          <span>Loading handoffs…</span>
        </div>
      )}

      {error && !loading && (
        <div className={styles.centerState}>
          <span className={styles.errorText}>⚠ {error} — is the backend running?</span>
          <button className={styles.retryBtn} onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={styles.centerState}>
          <span style={{ fontSize: 40 }}>
            {filter === 'open' ? '🎉' : '📭'}
          </span>
          <span className={styles.emptyText}>
            {filter === 'open' ? 'No open handoffs' : `No ${filter} handoffs`}
          </span>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className={styles.grid}>
          {filtered.map(h => (
            <HandoffCard key={h.conversation_id} handoff={h} onResolve={handleResolve} />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
    </svg>
  )
}
