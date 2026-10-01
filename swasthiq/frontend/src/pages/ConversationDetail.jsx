import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import styles from './ConversationDetail.module.css'

/* ── helpers ── */
const STATE_COLORS = {
  booked:      '#10b981', rescheduled: '#818cf8', cancelled: '#f43f5e',
  escalated:   '#f59e0b', refused:     '#8b5cf6', abandoned: '#64748b',
}

const TOOL_COLORS = {
  search_slots:          '#06b6d4',
  book_appointment:      '#10b981',
  reschedule_appointment:'#818cf8',
  cancel_appointment:    '#f43f5e',
  lookup_patient:        '#f59e0b',
  escalate_to_human:     '#ef4444',
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
    })
  } catch { return ts }
}

/* ── Conversation list (left panel) ── */
function ConvList({ conversations, selectedId, onSelect, loading, error }) {
  if (loading) return <div className={styles.listState}><div className="spinner" /></div>
  if (error)   return <div className={styles.listState}><span className={styles.err}>{error}</span></div>
  if (!conversations.length) return (
    <div className={styles.listState}>
      <span>No conversations yet.</span>
      <span className={styles.hint}>Run the agent to see results here.</span>
    </div>
  )

  return (
    <div className={styles.convList}>
      {conversations.map(c => {
        const color = STATE_COLORS[c.terminal_state] || '#64748b'
        return (
          <button
            key={c.conversation_id}
            className={`${styles.convRow} ${selectedId === c.conversation_id ? styles.selected : ''}`}
            onClick={() => onSelect(c.conversation_id)}
          >
            <div className={styles.convDot} style={{ background: color }} />
            <span className={styles.convId}>{c.conversation_id}</span>
            <span className={styles.convState} style={{ color, background: color + '22' }}>
              {c.terminal_state}
            </span>
            <span className={styles.convTs}>{formatTime(c.created_at)}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Inline tool call block ── */
function ToolCallBlock({ call, index }) {
  const [open, setOpen] = useState(true)
  const color = TOOL_COLORS[call.name] || '#818cf8'
  return (
    <div className={styles.toolBlock} style={{ borderLeftColor: color }}>
      <button className={styles.toolHeader} onClick={() => setOpen(o => !o)}>
        <div className={styles.toolNum} style={{ background: color + '22', color }}>
          {index + 1}
        </div>
        <span className={styles.toolName} style={{ color }}>{call.name}</span>
        <span className={styles.toolChevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <pre className={styles.toolArgs}>
          {JSON.stringify(call.arguments, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ── Detail panel (right) ── */
function DetailPanel({ convId, onClose }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!convId) return
    setLoading(true)
    setError(null)
    api.conversation(convId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [convId])

  if (loading) return (
    <div className={styles.detailPanel}>
      <div className={styles.detailCenter}><div className="spinner" /></div>
    </div>
  )

  if (error) return (
    <div className={styles.detailPanel}>
      <div className={styles.detailCenter}>
        <span className={styles.err}>Failed to load: {error}</span>
      </div>
    </div>
  )

  if (!data) return null

  const result = data.result || {}
  const state  = result.terminal_state || 'abandoned'
  const color  = STATE_COLORS[state] || '#64748b'
  const calls  = result.tool_calls || []

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailTitle}>{convId}</h2>
          <span className={styles.detailTs}>{formatTime(data.created_at)}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* ── Outcome panel ── */}
      <div className={styles.outcomePanel}>
        <div className={styles.outcomePanelTitle}>Outcome</div>
        <div className={styles.outcomeGrid}>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Terminal State</span>
            <span className={styles.outcomeVal} style={{ color, background: color + '22', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
              {state}
            </span>
          </div>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Escalation Reason</span>
            <span className={styles.outcomeVal} style={{ color: result.escalation_reason ? '#f59e0b' : 'var(--text-3)' }}>
              {result.escalation_reason || 'null'}
            </span>
          </div>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Patient ID</span>
            <span className={styles.outcomeVal}>{result.patient_id || 'null'}</span>
          </div>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Appointment ID</span>
            <span className={styles.outcomeVal}>{result.appointment_id || 'null'}</span>
          </div>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Tokens</span>
            <span className={styles.outcomeVal}>{result.metrics?.tokens ?? '—'}</span>
          </div>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeKey}>Latency</span>
            <span className={styles.outcomeVal}>
              {result.metrics?.latency_ms != null ? `${result.metrics.latency_ms} ms` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tool call trace (inline, per PDF spec) ── */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Tool Call Trace
          <span className={styles.sectionCount}>{calls.length} calls</span>
        </div>
        {calls.length === 0 ? (
          <p className={styles.noTools}>No tool calls were made.</p>
        ) : (
          <div className={styles.toolTimeline}>
            {calls.map((c, i) => (
              <ToolCallBlock key={i} call={c} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* ── Agent's final reply ── */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Agent Reply</div>
        <div className={styles.replyBubble}>{result.reply || '—'}</div>
      </div>

      {/* ── Turns snapshot ── */}
      {result.turns_snapshot?.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Caller Turns</div>
          <div className={styles.turns}>
            {result.turns_snapshot.map((t, i) => (
              <div key={i} className={styles.turnRow}>
                <div className={styles.turnNum}>{i + 1}</div>
                <div className={styles.turnText}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Page root ── */
export default function ConversationDetail() {
  const { id }           = useParams()
  const navigate         = useNavigate()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)
  const [selectedId, setSelectedId]       = useState(id || null)

  const load = useCallback(async () => {
    try {
      const res = await api.conversations()
      setConversations(res.conversations || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelect = (convId) => {
    setSelectedId(convId)
    navigate(`/conversations/${convId}`, { replace: true })
  }

  const handleClose = () => {
    setSelectedId(null)
    navigate('/conversations', { replace: true })
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle}>Conversations</h1>
          <p className={styles.pageSub}>All processed conversations — click to inspect</p>
        </div>
        <button className={styles.refreshBtn} onClick={load} title="Refresh">
          <RefreshIcon />
        </button>
      </div>

      <div className={styles.layout}>
        {/* Left: list */}
        <div className={styles.leftPanel}>
          <ConvList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={handleSelect}
            loading={loading}
            error={error}
          />
        </div>

        {/* Right: detail */}
        {selectedId ? (
          <DetailPanel convId={selectedId} onClose={handleClose} />
        ) : (
          <div className={styles.emptyDetail}>
            <span style={{ fontSize: 40 }}>📋</span>
            <p>Select a conversation to inspect it</p>
            <span>Tool calls are shown inline exactly where they fired</span>
          </div>
        )}
      </div>
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
