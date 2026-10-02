import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api'
import styles from './LiveChat.module.css'

const TODAY_STR = new Date().toISOString().slice(0, 10)

const REASON_META = {
  clinical_urgent:  { label: 'Clinical Emergency',     color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  medical_advice:   { label: 'Medical Advice Request',  color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  not_authorised:   { label: 'Unauthorised Request',    color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  ambiguous_patient:{ label: 'Ambiguous Patient',       color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
  out_of_scope:     { label: 'Out of Scope',            color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
}

function fmt12h(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour   = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`
}

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
  } catch { return d }
}

function genId() {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

// ─── Unified Appointment Booking Card ─────────────────────────
function AppointmentBookingCard({
  defaultDoctorId = 'dr_rao',
  defaultDate,
  prefill,
  onConfirm,
  onClose,
  busy,
  serverError,
}) {
  const [doctorId,     setDoctorId]     = useState(defaultDoctorId)
  const [date,         setDate]         = useState(defaultDate || TODAY_STR)
  const [slot,         setSlot]         = useState(null)
  const [slots,        setSlots]        = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotNotice,   setSlotNotice]   = useState(null)

  const [name,         setName]         = useState(prefill?.name || '')
  const [phone,        setPhone]        = useState(prefill?.phone || '')
  const [forSelf,      setForSelf]      = useState(true)
  const [patientName,  setPatientName]  = useState('')
  const [relation,     setRelation]     = useState('')
  const [errs,         setErrs]         = useState({})

  // Update prefill if user mentions name or phone later
  useEffect(() => {
    if (prefill?.name && !name)   setName(prefill.name)
    if (prefill?.phone && !phone) setPhone(prefill.phone)
  }, [prefill])

  // Sync props if changed
  useEffect(() => {
    if (defaultDoctorId) setDoctorId(defaultDoctorId)
  }, [defaultDoctorId])

  useEffect(() => {
    if (defaultDate) setDate(defaultDate)
  }, [defaultDate])

  // Fetch slots whenever doctorId or date changes
  const fetchSlots = useCallback(async (docId, dt) => {
    if (!docId || !dt) return
    setLoadingSlots(true)
    setSlotNotice(null)
    setSlot(null)
    try {
      const res = await api.searchSlots(docId, dt)
      if (res.status === 'ok') {
        const avail = res.slots || []
        setSlots(avail)
        if (res.note === 'clinic_holiday') {
          setSlotNotice(res.message || 'The clinic is closed on this day (public holiday).')
        } else if (res.note === 'doctor_on_leave') {
          setSlotNotice(res.message || 'The doctor is on leave on this date.')
        } else if (res.note === 'no_schedule') {
          setSlotNotice(res.message || 'The doctor does not practice on this day.')
        } else if (avail.length === 0) {
          setSlotNotice('No available slots for this date. Please select another day.')
        }
      } else {
        setSlots([])
        setSlotNotice(res.message || 'Unable to check slot availability.')
      }
    } catch {
      setSlots([])
      setSlotNotice('Unable to load slots. Please check your connection.')
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  useEffect(() => {
    fetchSlots(doctorId, date)
  }, [doctorId, date, fetchSlots])

  function validate() {
    const e = {}
    if (!slot)         e.slot  = 'Please select an appointment time slot'
    if (!name.trim())  e.name  = 'Your full name is required'
    if (!phone.trim()) e.phone = 'Phone number is required'
    else if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) e.phone = 'Enter a valid 10-digit phone number'
    if (!forSelf) {
      if (!patientName.trim()) e.patientName = 'Patient name is required'
      if (!relation.trim())    e.relation    = 'Relationship is required'
    }
    setErrs(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate() || busy) return
    onConfirm({
      doctorId,
      date,
      slot,
      name: name.trim(),
      phone: phone.trim().replace(/\D/g, '').slice(-10),
      forSelf,
      patientName: forSelf ? name.trim() : patientName.trim(),
      relation: forSelf ? 'self' : relation.trim(),
    })
  }

  const todayVal = TODAY_STR
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrowVal = tomorrowDate.toISOString().slice(0, 10)

  return (
    <form className={styles.appointmentCard} onSubmit={handleSubmit} noValidate>
      <div className={styles.appointmentCardHeader}>
        <div>
          <div className={styles.appointmentCardTitle}>Book Appointment</div>
          <div className={styles.appointmentCardSub}>Select doctor, date, slot and confirm details</div>
        </div>
        {onClose && (
          <button type="button" className={styles.cardCloseBtn} onClick={onClose} aria-label="Close form">✕</button>
        )}
      </div>

      {/* 1. Doctor Selection */}
      <div className={styles.cardSection}>
        <div className={styles.cardSectionLabel}>Doctor</div>
        <div className={styles.doctorPills}>
          <button
            type="button"
            className={`${styles.doctorPill} ${doctorId === 'dr_rao' ? styles.doctorPillActive : ''}`}
            onClick={() => setDoctorId('dr_rao')}
            disabled={busy}
          >
            <span className={styles.doctorPillName}>Dr. Anjali Rao</span>
            <span className={styles.doctorPillSpec}>General Physician</span>
          </button>
          <button
            type="button"
            className={`${styles.doctorPill} ${doctorId === 'dr_sethi' ? styles.doctorPillActive : ''}`}
            onClick={() => setDoctorId('dr_sethi')}
            disabled={busy}
          >
            <span className={styles.doctorPillName}>Dr. Vikram Sethi</span>
            <span className={styles.doctorPillSpec}>Pediatrician</span>
          </button>
        </div>
      </div>

      {/* 2. Date Selection */}
      <div className={styles.cardSection}>
        <div className={styles.cardSectionLabel}>Date ({fmtDate(date)})</div>
        <div className={styles.dateRow}>
          <button
            type="button"
            className={`${styles.quickDateBtn} ${date === todayVal ? styles.quickDateBtnActive : ''}`}
            onClick={() => setDate(todayVal)}
            disabled={busy}
          >
            Today
          </button>
          <button
            type="button"
            className={`${styles.quickDateBtn} ${date === tomorrowVal ? styles.quickDateBtnActive : ''}`}
            onClick={() => setDate(tomorrowVal)}
            disabled={busy}
          >
            Tomorrow
          </button>
          <input
            type="date"
            className={styles.cardDateInput}
            value={date}
            min={todayVal}
            onChange={e => setDate(e.target.value)}
            disabled={busy}
            aria-label="Appointment date"
          />
        </div>
      </div>

      {/* 3. Slot Selection */}
      <div className={styles.cardSection}>
        <div className={styles.cardSectionLabel}>
          Available Slots {slot && <span style={{ color: 'var(--indigo)' }}>· Selected: {fmt12h(slot)}</span>}
        </div>
        {loadingSlots ? (
          <div className={styles.slotLoading}>
            <span className={styles.btnSpinner} style={{ borderColor: 'rgba(79,70,229,0.3)', borderTopColor: 'var(--indigo)' }} />
            <span>Checking available slots…</span>
          </div>
        ) : slotNotice ? (
          <div className={styles.slotNotice}>{slotNotice}</div>
        ) : (
          <div className={styles.slotGrid}>
            {slots.map(s => (
              <button
                key={s}
                type="button"
                className={`${styles.slotBtn} ${slot === s ? styles.slotBtnSel : ''}`}
                onClick={() => { setSlot(s); if (errs.slot) setErrs(p => ({ ...p, slot: '' })) }}
                disabled={busy}
              >
                {fmt12h(s)}
              </button>
            ))}
          </div>
        )}
        {errs.slot && <span className={styles.fe}>{errs.slot}</span>}
      </div>

      {/* 4. Patient Information */}
      <div className={styles.fg}>
        <label className={styles.fl} htmlFor="ap_name">Your Name</label>
        <input
          id="ap_name"
          className={`${styles.fi} ${errs.name ? styles.fie : ''}`}
          value={name}
          onChange={e => { setName(e.target.value); if (errs.name) setErrs(p => ({ ...p, name: '' })) }}
          placeholder="e.g. Rajesh Sharma"
          disabled={busy}
          autoComplete="name"
        />
        {errs.name && <span className={styles.fe}>{errs.name}</span>}
      </div>

      <div className={styles.fg}>
        <label className={styles.fl} htmlFor="ap_phone">Phone Number</label>
        <input
          id="ap_phone"
          className={`${styles.fi} ${errs.phone ? styles.fie : ''}`}
          type="tel"
          value={phone}
          onChange={e => { setPhone(e.target.value); if (errs.phone) setErrs(p => ({ ...p, phone: '' })) }}
          placeholder="10-digit mobile number"
          disabled={busy}
          autoComplete="tel"
          maxLength={15}
        />
        {errs.phone && <span className={styles.fe}>{errs.phone}</span>}
      </div>

      <div className={styles.fg}>
        <label className={styles.fl}>Appointment for</label>
        <div className={styles.radioGroup}>
          <label className={styles.radio}>
            <input type="radio" checked={forSelf} onChange={() => setForSelf(true)} disabled={busy} /> Myself
          </label>
          <label className={styles.radio}>
            <input type="radio" checked={!forSelf} onChange={() => setForSelf(false)} disabled={busy} /> Someone else
          </label>
        </div>
      </div>

      {!forSelf && (
        <>
          <div className={styles.fg}>
            <label className={styles.fl} htmlFor="ap_pname">Patient Full Name</label>
            <input
              id="ap_pname"
              className={`${styles.fi} ${errs.patientName ? styles.fie : ''}`}
              value={patientName}
              onChange={e => { setPatientName(e.target.value); if (errs.patientName) setErrs(p => ({ ...p, patientName: '' })) }}
              placeholder="Patient's name"
              disabled={busy}
            />
            {errs.patientName && <span className={styles.fe}>{errs.patientName}</span>}
          </div>
          <div className={styles.fg}>
            <label className={styles.fl} htmlFor="ap_rel">Relationship</label>
            <input
              id="ap_rel"
              className={`${styles.fi} ${errs.relation ? styles.fie : ''}`}
              value={relation}
              onChange={e => { setRelation(e.target.value); if (errs.relation) setErrs(p => ({ ...p, relation: '' })) }}
              placeholder="e.g. Parent, Child, Spouse"
              disabled={busy}
            />
            {errs.relation && <span className={styles.fe}>{errs.relation}</span>}
          </div>
        </>
      )}

      {serverError && (
        <div className={styles.formErr}>{serverError}</div>
      )}

      <button type="submit" className={styles.confirmBtn} disabled={busy || !slot}>
        {busy ? <><span className={styles.btnSpinner} /> Confirming Appointment…</> : 'Confirm Appointment'}
      </button>
    </form>
  )
}

// ─── SuccessCard ──────────────────────────────────────────────
function SuccessCard({ doctorName, date, slot, patientName, apptId, onDone }) {
  return (
    <div className={styles.successCard}>
      <div className={styles.successCheck}>✓</div>
      <div className={styles.successTitle}>Appointment confirmed</div>
      <div className={styles.successRows}>
        <div className={styles.successRow}><span>Doctor</span><strong>{doctorName}</strong></div>
        <div className={styles.successRow}><span>Date</span><strong>{fmtDate(date)}</strong></div>
        <div className={styles.successRow}><span>Time</span><strong>{fmt12h(slot)}</strong></div>
        {patientName && <div className={styles.successRow}><span>Patient</span><strong>{patientName}</strong></div>}
        {apptId && <div className={styles.successRow}><span>ID</span><code className={styles.apptId}>{apptId}</code></div>}
      </div>
      <button className={styles.doneBtn} onClick={onDone}>Done</button>
    </div>
  )
}

// ─── CancelConfirmCard ────────────────────────────────────────
function AppointmentIdentityForm({ title, onSubmit, busy, error }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <form className={styles.appointmentCard} onSubmit={e => { e.preventDefault(); onSubmit({ name: name.trim(), phone: phone.replace(/\D/g, '').slice(-10) }) }}>
      <div className={styles.appointmentCardHeader}><div><div className={styles.appointmentCardTitle}>{title}</div><div className={styles.appointmentCardSub}>Enter the patient’s full name and phone number.</div></div></div>
      <div className={styles.fg}><label className={styles.fl}>Full name</label><input className={styles.fi} value={name} onChange={e => setName(e.target.value)} autoComplete="name" required /></div>
      <div className={styles.fg}><label className={styles.fl}>Phone number</label><input className={styles.fi} type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" required /></div>
      {error && <div className={styles.formErr}>{error}</div>}
      <button className={styles.confirmBtn} type="submit" disabled={busy || !name.trim() || phone.replace(/\D/g, '').length < 10}>{busy ? 'Looking up appointments…' : 'Find appointments'}</button>
    </form>
  )
}

function RescheduleAppointmentPicker({ appointments, selectedId, onSelect, onContinue }) {
  return (
    <div className={styles.cancelCard}>
      <div className={styles.cancelTitle}>Choose the appointment to reschedule</div>
      {appointments.map(appt => (
        <label key={appt.id} className={styles.cancelInfo} style={{ display: 'flex', gap: 10, cursor: 'pointer', border: appt.id === selectedId ? '1px solid var(--indigo)' : undefined }}>
          <input type="radio" name="rescheduleAppointment" checked={appt.id === selectedId} onChange={() => onSelect(appt.id)} />
          <span><strong>{appt.patient_name}</strong> · {appt.doctor_name}<br />{fmtDate(appt.date)} · {fmt12h(appt.start_time)} · {appt.id}</span>
        </label>
      ))}
      <button className={styles.confirmBtn} type="button" onClick={onContinue} disabled={!selectedId}>Choose appointment</button>
    </div>
  )
}

function CancelConfirmCard({ appointments, selectedId, onSelect, onKeep, onConfirm, busy }) {
  const selected = appointments.find(a => a.id === selectedId)
  return (
    <div className={styles.cancelCard}>
      <div className={styles.cancelTitle}>Choose an appointment to cancel</div>
      {appointments.map(appt => (
        <label key={appt.id} className={styles.cancelInfo} style={{ display: 'flex', gap: 10, cursor: 'pointer', border: appt.id === selectedId ? '1px solid var(--indigo)' : undefined }}>
          <input type="radio" name="cancelAppointment" checked={appt.id === selectedId} onChange={() => onSelect(appt.id)} />
          <span><strong>{appt.patient_name}</strong> · {appt.doctor_name}<br />{fmtDate(appt.date)} · {fmt12h(appt.start_time)} · {appt.id}</span>
        </label>
      ))}
      <div className={styles.cancelActions}>
        <button className={styles.keepBtn} onClick={onKeep} disabled={busy}>Keep appointments</button>
        <button className={styles.cancelBtn2} onClick={() => selected && onConfirm(selected)} disabled={busy || !selected}>
          {busy ? <><span className={styles.btnSpinner} /> Cancelling…</> : 'Confirm cancellation'}
        </button>
      </div>
    </div>
  )
}

function RescheduleForm({ appointment, onSubmit, busy, error }) {
  const [date, setDate] = useState(TODAY_STR)
  const [selectedSlot, setSelectedSlot] = useState('')
  const [slots, setSlots] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotError, setSlotError] = useState('')

  useEffect(() => {
    let active = true
    setLoadingSlots(true)
    setSlotError('')
    setSelectedSlot('')
    api.searchSlots(appointment.doctor_id, date)
      .then(result => {
        if (!active) return
        const available = result.status === 'ok' ? (result.slots || []) : []
        setSlots(available)
        if (!available.length) setSlotError(result.message || 'No available slots on this date. Choose another date.')
      })
      .catch(err => { if (active) { setSlots([]); setSlotError(err.message || 'Could not load available slots.') } })
      .finally(() => { if (active) setLoadingSlots(false) })
    return () => { active = false }
  }, [appointment.doctor_id, date])

  return (
    <form onSubmit={e => { e.preventDefault(); if (date && selectedSlot) onSubmit(appointment, date, selectedSlot) }} className={styles.appointmentCard}>
      <div className={styles.appointmentCardHeader}><div><div className={styles.appointmentCardTitle}>Reschedule Appointment</div><div className={styles.appointmentCardSub}>Choose a new date and time</div></div></div>
      {appointment && <div className={styles.cancelInfo}>{appointment.doctor_name} · {fmtDate(appointment.date)} at {fmt12h(appointment.start_time)} · {appointment.id}</div>}
      <div className={styles.fg}><label className={styles.fl}>New date</label><input className={styles.fi} type="date" min={TODAY_STR} value={date} onChange={e => setDate(e.target.value)} required /></div>
      <div className={styles.fg}>
        <label className={styles.fl}>Available times</label>
        {loadingSlots ? <div className={styles.slotLoading}>Checking available times…</div> : slotError ? <div className={styles.slotNotice}>{slotError}</div> : <div className={styles.slotGrid}>{slots.map(slot => <button key={slot} type="button" className={`${styles.slotBtn} ${selectedSlot === slot ? styles.slotBtnSel : ''}`} onClick={() => setSelectedSlot(slot)}>{fmt12h(slot)}</button>)}</div>}
      </div>
      {error && <div className={styles.formErr}>{error}</div>}
      <button className={styles.confirmBtn} type="submit" disabled={busy || loadingSlots || !date || !selectedSlot}>{busy ? 'Rescheduling…' : 'Confirm reschedule'}</button>
    </form>
  )
}

// ─── EscalationCard ───────────────────────────────────────────
function EscalationCard({ reason }) {
  const meta = REASON_META[reason] || { label: reason, color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' }
  const urgent = reason === 'clinical_urgent'
  return (
    <div className={styles.escalCard} style={{ background: meta.bg, borderColor: meta.border }}>
      {urgent && <div className={styles.escalUrgentTag}>Emergency</div>}
      <div className={styles.escalTitle} style={{ color: meta.color }}>
        {urgent ? 'Connecting you with clinic staff now' : 'Connecting you with our team'}
      </div>
      <div className={styles.escalReason} style={{ color: meta.color }}>{meta.label}</div>
      {urgent && (
        <div className={styles.escalNote}>
          If this is a medical emergency, call <strong>112</strong> immediately.
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────
export default function LiveChat() {
  const [today,               setToday]               = useState(TODAY_STR)
  const [turns,               setTurns]               = useState([])
  const [messages,            setMessages]            = useState([])
  const [input,               setInput]               = useState('')
  const [loading,             setLoading]             = useState(false)
  const [convId]                                      = useState(genId)

  // Booking Card state
  const [showBooking,         setShowBooking]         = useState(false)
  const [bookDoctor,          setBookDoctor]          = useState('dr_rao')
  const [bookDate,            setBookDate]            = useState(TODAY_STR)
  const [bookingBusy,         setBookingBusy]         = useState(false)
  const [bookingServerError,  setBookingServerError]  = useState(null)
  const [bookResult,          setBookResult]          = useState(null)
  const [prefill,             setPrefill]             = useState({})

  // Cancellation state
  const [showCancelIdentity,  setShowCancelIdentity]  = useState(false)
  const [cancelIdentity,      setCancelIdentity]      = useState(null)
  const [cancelAppointments,   setCancelAppointments]   = useState([])
  const [selectedCancelId,    setSelectedCancelId]     = useState('')
  const [cancelLookupBusy,    setCancelLookupBusy]     = useState(false)
  const [cancelLookupError,   setCancelLookupError]   = useState('')
  const [showRescheduleIdentity, setShowRescheduleIdentity] = useState(false)
  const [rescheduleIdentity,  setRescheduleIdentity]  = useState(null)
  const [rescheduleAppointments, setRescheduleAppointments] = useState([])
  const [selectedRescheduleId, setSelectedRescheduleId] = useState('')
  const [rescheduleLookupBusy, setRescheduleLookupBusy] = useState(false)
  const [rescheduleLookupError, setRescheduleLookupError] = useState('')
  const [rescheduleBusy,     setRescheduleBusy]        = useState(false)
  const [rescheduleError,    setRescheduleError]       = useState('')
  const [showReschedule,      setShowReschedule]      = useState(false)
  const [rescheduleTarget,    setRescheduleTarget]    = useState(null)
  const appointmentsRef = useRef([])
  const [cancelBusy,          setCancelBusy]          = useState(false)

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, showBooking, showCancelIdentity, cancelAppointments, showReschedule, showRescheduleIdentity, rescheduleAppointments])
  useEffect(() => { inputRef.current?.focus() }, [])

  function push(msg) { setMessages(p => [...p, msg]) }

  function parsePrefill(text) {
    const ph = text.match(/\b(\d{10})\b/)
    const nm = text.match(/(?:my name is|naam hai|i am|this is)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i)
            || text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/)
    return { name: nm?.[1] || '', phone: ph?.[1] || '' }
  }

  const runAgent = useCallback(async (allTurns, assistantReplies = []) => {
    setLoading(true)
    try {
      const resp = await api.runAgent({ conversation_id: convId, today, turns: allTurns, assistant_replies: assistantReplies, ui_mode: true })
      const calls = resp.tool_calls || []
      const state = resp.terminal_state
      const action = resp.ui_action

      setPrefill(parsePrefill(allTurns.join(' ')))

      // Check if slot search happened → update booking card doctor & date
      const ssCall = calls.find(c => c.name === 'search_slots')
      if (ssCall && state !== 'booked') {
        const { doctor_id, date: slotDate } = ssCall.arguments || {}
        if (doctor_id) setBookDoctor(doctor_id)
        if (slotDate)  setBookDate(slotDate)
      }

      // Check for cancellation candidate
      const lpCall = calls.find(c => c.name === 'lookup_patient')
      if (lpCall?.result?.status === 'found') {
        appointmentsRef.current = (lpCall.result.patient?.appointments || []).filter(a => a.status === 'booked')
      }
      if (state === 'escalated') {
        setShowBooking(false)
        push({ type: 'agent', text: resp.reply })
        push({ type: 'escalation', reason: resp.escalation_reason })
        return
      }

      if (state === 'booked') {
        setShowBooking(false)
        push({ type: 'agent', text: resp.reply })
        return
      }

      if (state === 'cancelled') {
        push({ type: 'agent', text: resp.reply })
        return
      }

      if (resp.reply) push({ type: 'agent', text: resp.reply })

      // The agent may refer back to a form in a follow-up without repeating its
      // patient lookup. Reuse the previously verified appointment list so that
      // the requested confirmation card is actually present in the chat.
      const latestCallerTurn = (allTurns.at(-1) || '').toLowerCase()
      const namesCancellationForm = /cancellation form|cancel(?:lation)? form/i.test(resp.reply || '')
      if (action?.type === 'open_cancel' || namesCancellationForm) setShowCancelIdentity(true)
      if (action?.type === 'open_reschedule' || /reschedule form/i.test(resp.reply || '')) setShowRescheduleIdentity(true)

      if (action?.type === 'open_booking') {
        setBookDoctor(action.doctor_id || 'dr_rao')
        setShowBooking(true)
      } else if (action?.type === 'open_cancel') {
        setShowBooking(false)
      } else if (action?.type === 'open_reschedule') {
        setShowBooking(false)
        setShowRescheduleIdentity(true)
      }

    } catch {
      push({ type: 'agent', text: 'Unable to reach the clinic system. Please try again.', err: true })
    } finally {
      setLoading(false)
    }
  }, [convId, today])

  async function send(e) {
    e?.preventDefault()
    const t = input.trim()
    if (!t || loading) return
    const next = [...turns, t]
    const priorAssistantReplies = messages.filter(m => m.type === 'agent').map(m => m.text)
    setTurns(next)
    setInput('')
    push({ type: 'caller', text: t })

    if (/\b(cancel|cancellation|cancel my|cancel the|hatao|radd)\b/i.test(t)) {
      setShowRescheduleIdentity(false)
      setShowReschedule(false)
      setRescheduleAppointments([])
      setRescheduleTarget(null)
      setCancelAppointments([])
      setSelectedCancelId('')
      setCancelIdentity(null)
      setCancelLookupError('')
      setShowCancelIdentity(true)
      push({ type: 'agent', text: 'I can help cancel an appointment. Please enter the patient’s full name and phone number below so I can find the active appointments.' })
      return
    }

    if (/\b(reschedule|rescheduling|change my appointment|move (?:my )?appointment|postpone my appointment)\b/i.test(t)) {
      setShowCancelIdentity(false)
      setCancelAppointments([])
      setCancelIdentity(null)
      setRescheduleAppointments([])
      setSelectedRescheduleId('')
      setRescheduleIdentity(null)
      setRescheduleLookupError('')
      setRescheduleError('')
      setRescheduleTarget(null)
      setShowReschedule(false)
      setShowRescheduleIdentity(true)
      push({ type: 'agent', text: 'I can help reschedule an appointment. Please enter the patient’s full name and phone number below so I can find the active appointments.' })
      return
    }

    await runAgent(next, priorAssistantReplies)
  }

  // Authoritative structured booking submission
  async function handleBookingConfirm(formData) {
    setBookingBusy(true)
    setBookingServerError(null)
    try {
      const res = await api.confirmBooking({
        conversation_id: convId,
        doctor_id: formData.doctorId,
        date: formData.date,
        slot: formData.slot,
        name: formData.name,
        phone: formData.phone,
        for_self: formData.forSelf,
        patient_name: formData.patientName,
        relationship: formData.relation,
      })

      if (res.status === 'ok') {
        setShowBooking(false)
        setBookResult({
          doctorName: res.doctor_name,
          date: res.date,
          slot: res.slot,
          patientName: res.patient_name,
          apptId: res.appointment_id,
        })
        push({
          type: 'agent',
          text: `Your appointment with ${res.doctor_name} on ${fmtDate(res.date)} at ${fmt12h(res.slot)} is confirmed! Appointment ID: ${res.appointment_id}.`,
        })
      } else if (res.code === 'slot_unavailable') {
        setBookingServerError(res.message || 'That slot was just booked. Please choose another available slot.')
      } else {
        setBookingServerError(res.message || 'Unable to complete booking. Please check your information.')
      }
    } catch (err) {
      setBookingServerError(err.message || 'Server error while booking. Please try again.')
    } finally {
      setBookingBusy(false)
    }
  }

  async function handleRescheduleLookup(identity) {
    setRescheduleLookupBusy(true)
    setRescheduleLookupError('')
    try {
      const result = await api.lookupReschedules(identity)
      if (result.status !== 'ok') {
        setRescheduleLookupError(result.status === 'ambiguous'
          ? 'I found more than one matching patient record. Please check the full name and phone number.'
          : 'I could not find a matching patient record. Check the name and phone number and try again.')
        return
      }
      if (!result.appointments?.length) {
        setRescheduleLookupError('No active appointments were found for this patient.')
        return
      }
      setRescheduleIdentity(identity)
      setRescheduleAppointments(result.appointments)
      setSelectedRescheduleId(result.appointments.length === 1 ? result.appointments[0].id : '')
      appointmentsRef.current = result.appointments
      setShowRescheduleIdentity(false)
      push({ type: 'agent', text: result.appointments.length === 1
        ? 'I found one active appointment. Select it below, then choose a new available date and time.'
        : `I found ${result.appointments.length} active appointments. Select the exact appointment you want to reschedule.` })
    } catch (err) {
      setRescheduleLookupError(err.message || 'Unable to look up appointments. Please try again.')
    } finally {
      setRescheduleLookupBusy(false)
    }
  }

  function chooseRescheduleAppointment() {
    const target = rescheduleAppointments.find(item => item.id === selectedRescheduleId)
    if (!target) return
    setRescheduleTarget(target)
    setRescheduleError('')
    setShowReschedule(true)
  }

  async function handleRescheduleSubmit(appointment, date, time) {
    if (!rescheduleIdentity) return
    setRescheduleBusy(true)
    setRescheduleError('')
    try {
      await api.confirmReschedule(appointment.id, {
        ...rescheduleIdentity,
        new_date: date,
        new_start: time,
      })
      setRescheduleAppointments(current => current.filter(item => item.id !== appointment.id))
      appointmentsRef.current = appointmentsRef.current.filter(item => item.id !== appointment.id)
      setRescheduleTarget(null)
      setShowReschedule(false)
      setSelectedRescheduleId('')
      push({ type: 'agent', text: `Appointment ${appointment.id} with ${appointment.doctor_name} has been rescheduled to ${fmtDate(date)} at ${fmt12h(time)}.` })
    } catch (err) {
      setRescheduleError(err.message || 'Rescheduling failed. Please try another available time.')
    } finally {
      setRescheduleBusy(false)
    }
  }

  async function handleCancellationLookup(identity) {
    setCancelLookupBusy(true)
    setCancelLookupError('')
    try {
      const result = await api.lookupCancellations(identity)
      if (result.status !== 'ok') {
        setCancelLookupError(result.status === 'ambiguous'
          ? 'I found more than one matching patient record. Please check the full name and phone number.'
          : 'I could not find a matching patient record. Check the name and phone number and try again.')
        return
      }
      if (!result.appointments?.length) {
        setCancelLookupError('No active appointments were found for this patient.')
        return
      }
      setCancelIdentity(identity)
      setCancelAppointments(result.appointments)
      appointmentsRef.current = result.appointments
      setSelectedCancelId(result.appointments.length === 1 ? result.appointments[0].id : '')
      setShowCancelIdentity(false)
      push({ type: 'agent', text: result.appointments.length === 1
        ? 'I found one active appointment. Select it below and confirm the cancellation.'
        : `I found ${result.appointments.length} active appointments. Select the exact appointment you want to cancel.` })
    } catch (err) {
      setCancelLookupError(err.message || 'Unable to look up appointments. Please try again.')
    } finally {
      setCancelLookupBusy(false)
    }
  }

  async function handleCancelConfirm(appointment) {
    if (!cancelIdentity || !appointment) return
    setCancelBusy(true)
    try {
      const result = await api.confirmCancellation(appointment.id, cancelIdentity)
      setCancelAppointments(current => current.filter(item => item.id !== appointment.id))
      appointmentsRef.current = appointmentsRef.current.filter(item => item.id !== appointment.id)
      setSelectedCancelId('')
      push({ type: 'agent', text: `Appointment ${appointment.id} with ${appointment.doctor_name} on ${fmtDate(appointment.date)} has been cancelled.` })
    } catch (err) {
      setCancelLookupError(err.message || 'Cancellation failed. Please try again.')
    } finally {
      setCancelBusy(false)
    }
  }

  function onCancelKeep() {
    setShowCancelIdentity(false)
    setCancelAppointments([])
    setCancelIdentity(null)
    setSelectedCancelId('')
    setCancelLookupError('')
    push({ type: 'agent', text: 'Understood. I left your appointments unchanged.' })
  }

  function handleStarterPick(s) {
    if (s.toLowerCase().includes('book')) {
      setBookDoctor('dr_rao')
      setShowBooking(true)
      const next = [...turns, s]
      setTurns(next)
      push({ type: 'caller', text: s })
      push({ type: 'agent', text: 'I would be happy to help you book an appointment! Please choose your preferred date and slot below and confirm your details.' })
    } else {
      setInput(s)
      inputRef.current?.focus()
    }
  }

  function reset() {
    setTurns([])
    setMessages([])
    setInput('')
    setShowBooking(false)
    setBookResult(null)
    setShowCancelIdentity(false)
    setCancelAppointments([])
    setCancelIdentity(null)
    setSelectedCancelId('')
    setCancelLookupError('')
    appointmentsRef.current = []
    setShowReschedule(false)
    setRescheduleTarget(null)
    setShowRescheduleIdentity(false)
    setRescheduleIdentity(null)
    setRescheduleAppointments([])
    setSelectedRescheduleId('')
    setRescheduleLookupError('')
    setRescheduleError('')
    setBookingServerError(null)
    setPrefill({})
    inputRef.current?.focus()
  }

  function renderMsg(msg, idx) {
    if (msg.type === 'caller')     return <CallerMsg key={idx} text={msg.text} />
    if (msg.type === 'agent')      return <AgentMsg  key={idx} text={msg.text} err={msg.err} />
    if (msg.type === 'escalation') return <EscalationCard key={idx} reason={msg.reason} />
    return null
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.pageTitle}>Front Desk</h1>
          <p className={styles.pageSub}>Sunrise Clinic, Dehradun</p>
        </div>
        <div className={styles.topbarRight}>
          <label className={styles.datePicker}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <input
              type="date"
              className={styles.dateInput}
              value={today}
              onChange={e => { setToday(e.target.value); setBookDate(e.target.value) }}
              aria-label="Reference date"
            />
          </label>
          <button className={styles.newCallBtn} onClick={reset}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3" />
            </svg>
            New Call
          </button>
        </div>
      </div>

      <div className={styles.chatCard}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderLeft}>
            <div className={styles.agentDot} />
            <div>
              <div className={styles.agentName}>Sunrise Clinic</div>
              <div className={styles.agentStatus}>
                {loading ? 'Processing your request…' : 'Front desk · Ready'}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.chatBody} role="log" aria-live="polite">
          {messages.length === 0
            ? <EmptyState onPick={handleStarterPick} />
            : (
              <>
                {messages.map(renderMsg)}

                {showBooking && !bookResult && (
                  <AppointmentBookingCard
                    defaultDoctorId={bookDoctor}
                    defaultDate={bookDate}
                    prefill={prefill}
                    onConfirm={handleBookingConfirm}
                    onClose={() => setShowBooking(false)}
                    busy={bookingBusy}
                    serverError={bookingServerError}
                  />
                )}

                {bookResult && (
                  <SuccessCard
                    doctorName={bookResult.doctorName}
                    date={bookResult.date}
                    slot={bookResult.slot}
                    patientName={bookResult.patientName}
                    apptId={bookResult.apptId}
                    onDone={() => { setBookResult(null); setShowBooking(false) }}
                  />
                )}

                {showCancelIdentity && (
                  <AppointmentIdentityForm title="Find appointments to cancel" onSubmit={handleCancellationLookup} busy={cancelLookupBusy} error={cancelLookupError} />
                )}
                {cancelAppointments.length > 0 && (
                  <CancelConfirmCard
                    appointments={cancelAppointments}
                    selectedId={selectedCancelId}
                    onSelect={setSelectedCancelId}
                    onKeep={onCancelKeep}
                    onConfirm={handleCancelConfirm}
                    busy={cancelBusy}
                  />
                )}
                {showRescheduleIdentity && <AppointmentIdentityForm title="Find appointments to reschedule" onSubmit={handleRescheduleLookup} busy={rescheduleLookupBusy} error={rescheduleLookupError} />}
                {rescheduleAppointments.length > 0 && !showReschedule && (
                  <RescheduleAppointmentPicker appointments={rescheduleAppointments} selectedId={selectedRescheduleId} onSelect={setSelectedRescheduleId} onContinue={chooseRescheduleAppointment} />
                )}
                {showReschedule && rescheduleTarget && <RescheduleForm appointment={rescheduleTarget} onSubmit={handleRescheduleSubmit} busy={rescheduleBusy} error={rescheduleError} />}
              </>
            )
          }
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <form className={styles.inputBar} onSubmit={send}>
          <input
            ref={inputRef}
            className={styles.inputField}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your message…"
            disabled={loading}
            aria-label="Message"
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}

function CallerMsg({ text }) {
  return (
    <div className={`${styles.row} ${styles.rowCaller}`}>
      <div className={styles.bubble}>{text}</div>
    </div>
  )
}

function AgentMsg({ text, err }) {
  return (
    <div className={`${styles.row} ${styles.rowAgent}`}>
      <div className={`${styles.bubble} ${styles.bubbleAgent} ${err ? styles.bubbleErr : ''}`}>{text}</div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className={`${styles.row} ${styles.rowAgent}`}>
      <div className={styles.typing}>
        <span /><span /><span />
      </div>
    </div>
  )
}

function EmptyState({ onPick }) {
  const starters = [
    'Book an appointment with Dr. Rao',
    'I need to reschedule my appointment',
    'I want to cancel my appointment',
  ]
  return (
    <div className={styles.empty}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <div className={styles.emptyTitle}>How can we help you today?</div>
      <div className={styles.emptyDesc}>
        Book, reschedule, or cancel an appointment with Dr. Anjali Rao or Dr. Vikram Sethi.
      </div>
      <div className={styles.starters}>
        {starters.map((s, i) => (
          <button key={i} className={styles.starterBtn} onClick={() => onPick(s)}>{s}</button>
        ))}
      </div>
    </div>
  )
}
