import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import styles from './Appointments.module.css'

export default function Appointments() {
  const [appointments, setAppointments] = useState([])
  const [counts, setCounts] = useState({ total: 0, booked: 0, cancelled: 0 })
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [toast, setToast] = useState(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('all') // all | booked | cancelled
  const [doctorFilter, setDoctorFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [viewMode, setViewMode] = useState('table') // 'table' | 'cards'

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [apptData, docData] = await Promise.all([
        api.appointments({
          status: statusFilter,
          doctor_id: doctorFilter,
          date: dateFilter,
          q: searchQuery,
        }),
        api.doctors().catch(() => ({ doctors: [] })),
      ])
      setAppointments(apptData.appointments || [])
      setCounts(apptData.counts || { total: 0, booked: 0, cancelled: 0 })
      if (docData.doctors && docData.doctors.length > 0) {
        setDoctors(docData.doctors)
      }
    } catch (err) {
      setError(err.message || 'Failed to load appointments from database.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [statusFilter, doctorFilter, dateFilter])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData()
    }, 280)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleCancel = async (id, patientName) => {
    if (!window.confirm(`Are you sure you want to cancel appointment ${id} for ${patientName}? This will free the slot in the database.`)) {
      return
    }
    setCancellingId(id)
    try {
      await api.cancelAppointment(id)
      showToast(`Appointment ${id} was successfully cancelled and slot released.`, 'success')
      await loadData()
    } catch (err) {
      showToast(err.message || `Failed to cancel appointment ${id}`, 'error')
    } finally {
      setCancellingId(null)
    }
  }

  // Format date nicely (e.g. 2026-10-01 -> Thu, 1 Oct 2026)
  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    try {
      const parts = dateStr.split('-')
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        return d.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      }
    } catch {}
    return dateStr
  }

  return (
    <div className={styles.page}>
      {/* Toast Alert */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          <span className={styles.toastIcon}>{toast.type === 'error' ? '⚠️' : '✅'}</span>
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Top Header */}
      <div className={styles.topbar}>
        <div>
          <div className={styles.titleBadge}>
            <span className={styles.pulseDot} />
            SQLite Database View
          </div>
          <h1 className={styles.pageTitle}>Appointments & Schedule</h1>
          <p className={styles.pageSub}>
            Live meetings, patient bookings, and consultations stored in the database.
          </p>
        </div>

        <div className={styles.topActions}>
          <button
            className={styles.refreshBtn}
            onClick={loadData}
            title="Refresh Database"
            disabled={loading}
          >
            <svg
              className={`${styles.refreshIcon} ${loading ? styles.spinning : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>Refresh</span>
          </button>

          <Link to="/chat" className={styles.bookChatBtn}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Book via AI Agent</span>
          </Link>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className={styles.metricsRow}>
        <div className={styles.metricCard}>
          <div className={styles.metricIconWrap} style={{ background: '#ecfdf5', color: '#059669' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <div className={styles.metricValue} style={{ color: '#059669' }}>{counts.booked}</div>
            <div className={styles.metricLabel}>Active Bookings</div>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIconWrap} style={{ background: '#fff1f2', color: '#e11d48' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div>
            <div className={styles.metricValue} style={{ color: '#e11d48' }}>{counts.cancelled}</div>
            <div className={styles.metricLabel}>Cancelled Slots</div>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIconWrap} style={{ background: '#eef2ff', color: '#4f46e5' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <div className={styles.metricValue} style={{ color: '#4f46e5' }}>{counts.total}</div>
            <div className={styles.metricLabel}>Total Database Records</div>
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricIconWrap} style={{ background: '#f0f9ff', color: '#0284c7' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <div className={styles.metricValue} style={{ color: '#0284c7' }}>
              {doctors.length || 2}
            </div>
            <div className={styles.metricLabel}>Practicing Doctors</div>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className={styles.filterSection}>
        {/* Status Tabs */}
        <div className={styles.statusTabs}>
          <button
            className={`${styles.statusTab} ${statusFilter === 'all' ? styles.statusTabActive : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All Appointments
            <span className={styles.tabBadge}>{counts.total}</span>
          </button>
          <button
            className={`${styles.statusTab} ${statusFilter === 'booked' ? styles.statusTabActive : ''}`}
            onClick={() => setStatusFilter('booked')}
          >
            <span className={styles.greenDot} />
            Booked (Active)
            <span className={styles.tabBadge}>{counts.booked}</span>
          </button>
          <button
            className={`${styles.statusTab} ${statusFilter === 'cancelled' ? styles.statusTabActive : ''}`}
            onClick={() => setStatusFilter('cancelled')}
          >
            <span className={styles.redDot} />
            Cancelled
            <span className={styles.tabBadge}>{counts.cancelled}</span>
          </button>
        </div>

        {/* Search & Secondary Filters */}
        <div className={styles.controlsRow}>
          {/* Live Search */}
          <div className={styles.searchBox}>
            <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by patient name, phone, or appointment ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className={styles.searchClear} onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>

          {/* Doctor Filter */}
          <div className={styles.selectWrapper}>
            <label className={styles.filterLabel}>Doctor:</label>
            <select
              className={styles.filterSelect}
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
            >
              <option value="all">All Doctors</option>
              <option value="dr_rao">Dr. Anjali Rao (General Physician)</option>
              <option value="dr_sethi">Dr. Vikram Sethi (Pediatrician)</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className={styles.selectWrapper}>
            <label className={styles.filterLabel}>Date:</label>
            <input
              type="date"
              className={styles.dateInput}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
            {dateFilter && (
              <button
                className={styles.clearDateBtn}
                onClick={() => setDateFilter('')}
                title="Clear date filter"
              >
                ✕
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'table' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('table')}
              title="Table view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('cards')}
              title="Card grid view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {error ? (
        <div className={styles.errorCard}>
          <div className={styles.errorIcon}>⚠️</div>
          <div className={styles.errorTitle}>Failed to load database records</div>
          <div className={styles.errorText}>{error}</div>
          <button className={styles.retryBtn} onClick={loadData}>Retry</button>
        </div>
      ) : loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <div className={styles.loadingText}>Fetching appointments from database...</div>
        </div>
      ) : appointments.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📅</div>
          <h3 className={styles.emptyTitle}>No Appointments Found</h3>
          <p className={styles.emptyText}>
            {searchQuery || dateFilter || doctorFilter !== 'all' || statusFilter !== 'all'
              ? 'No appointments matched your search criteria. Try clearing the filters.'
              : 'There are currently no appointments registered in the database.'}
          </p>
          <div className={styles.emptyActions}>
            {(searchQuery || dateFilter || doctorFilter !== 'all' || statusFilter !== 'all') && (
              <button
                className={styles.clearFiltersBtn}
                onClick={() => {
                  setSearchQuery('')
                  setDateFilter('')
                  setDoctorFilter('all')
                  setStatusFilter('all')
                }}
              >
                Reset All Filters
              </button>
            )}
            <Link to="/chat" className={styles.bookChatBtn}>
              Book an Appointment via AI Agent
            </Link>
          </div>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View */
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Patient Details</th>
                <th>Doctor & Speciality</th>
                <th>Date & Schedule</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((ap) => (
                <tr key={ap.id} className={ap.status === 'cancelled' ? styles.cancelledRow : ''}>
                  {/* Appointment ID */}
                  <td>
                    <span className={styles.apptIdBadge}>{ap.id}</span>
                  </td>

                  {/* Patient Info */}
                  <td>
                    <div className={styles.patientCell}>
                      <div className={styles.patientAvatar}>
                        {(ap.patient_name || 'P')[0].toUpperCase()}
                      </div>
                      <div>
                        <div className={styles.patientName}>{ap.patient_name || 'Unknown Patient'}</div>
                        <div className={styles.patientMeta}>
                          <span>📞 {ap.patient_phone || 'No phone'}</span>
                          {ap.patient_dob && <span className={styles.dotSep}>•</span>}
                          {ap.patient_dob && <span>DOB: {ap.patient_dob}</span>}
                          <span className={styles.dotSep}>•</span>
                          <span className={styles.subtleId}>{ap.patient_id}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Doctor Info */}
                  <td>
                    <div className={styles.doctorCell}>
                      <div className={styles.docName}>{ap.doctor_name || ap.doctor_id}</div>
                      <span className={`${styles.specBadge} ${ap.doctor_id === 'dr_sethi' ? styles.pediatricBadge : styles.physicianBadge}`}>
                        {ap.doctor_speciality || (ap.doctor_id === 'dr_sethi' ? 'Pediatrician' : 'General Physician')}
                      </span>
                    </div>
                  </td>

                  {/* Date & Time */}
                  <td>
                    <div className={styles.scheduleCell}>
                      <div className={styles.scheduleDate}>{formatDate(ap.date)}</div>
                      <div className={styles.scheduleTime}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>{ap.start_time} - {ap.end_time}</span>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td>
                    {ap.status === 'booked' ? (
                      <span className={styles.statusBooked}>
                        <span className={styles.bookedDot} />
                        Booked
                      </span>
                    ) : (
                      <span className={styles.statusCancelled}>
                        <span className={styles.cancelledDot} />
                        Cancelled
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ textAlign: 'right' }}>
                    {ap.status === 'booked' ? (
                      <button
                        className={styles.cancelActionBtn}
                        onClick={() => handleCancel(ap.id, ap.patient_name || ap.patient_id)}
                        disabled={cancellingId === ap.id}
                        title="Cancel this appointment and free slot"
                      >
                        {cancellingId === ap.id ? 'Cancelling...' : 'Cancel Slot'}
                      </button>
                    ) : (
                      <span className={styles.slotFreedLabel}>Slot Freed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Cards View */
        <div className={styles.cardsGrid}>
          {appointments.map((ap) => (
            <div
              key={ap.id}
              className={`${styles.card} ${ap.status === 'cancelled' ? styles.cardCancelled : ''}`}
            >
              <div className={styles.cardHeader}>
                <span className={styles.apptIdBadge}>{ap.id}</span>
                {ap.status === 'booked' ? (
                  <span className={styles.statusBooked}>
                    <span className={styles.bookedDot} /> Booked
                  </span>
                ) : (
                  <span className={styles.statusCancelled}>
                    <span className={styles.cancelledDot} /> Cancelled
                  </span>
                )}
              </div>

              {/* Time and Date Banner */}
              <div className={styles.cardTimeBanner}>
                <div className={styles.timeMain}>{ap.start_time} - {ap.end_time}</div>
                <div className={styles.dateSub}>{formatDate(ap.date)}</div>
              </div>

              {/* Doctor Row */}
              <div className={styles.cardSection}>
                <div className={styles.sectionLabel}>DOCTOR</div>
                <div className={styles.cardDocName}>{ap.doctor_name || ap.doctor_id}</div>
                <div className={styles.cardDocSpec}>{ap.doctor_speciality || 'General Medicine'}</div>
              </div>

              {/* Patient Row */}
              <div className={styles.cardSection}>
                <div className={styles.sectionLabel}>PATIENT</div>
                <div className={styles.cardPatientName}>{ap.patient_name || 'Patient'}</div>
                <div className={styles.cardPatientContact}>
                  <span>📞 {ap.patient_phone || 'No phone'}</span>
                  <span>ID: {ap.patient_id}</span>
                </div>
              </div>

              {/* Action Button */}
              <div className={styles.cardFooter}>
                {ap.status === 'booked' ? (
                  <button
                    className={styles.cancelCardBtn}
                    onClick={() => handleCancel(ap.id, ap.patient_name || ap.patient_id)}
                    disabled={cancellingId === ap.id}
                  >
                    {cancellingId === ap.id ? 'Cancelling...' : 'Cancel Appointment'}
                  </button>
                ) : (
                  <div className={styles.cardFreedNote}>
                    <span>Cancelled & Slot Released</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
