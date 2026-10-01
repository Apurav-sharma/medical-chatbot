import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api'
import styles from './Sidebar.module.css'

const Logo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="6" fill="url(#brandGrad)" />
    <path d="M12 6v12M6 12h12" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
    <defs>
      <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4f46e5" />
        <stop offset="100%" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
  </svg>
)

const IconChat = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  </svg>
)

const IconHandoffs = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </svg>
)

const IconConversations = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)

export default function Sidebar() {
  const [online, setOnline] = useState(null)
  const [openCount, setOpenCount] = useState(0)

  useEffect(() => {
    const checkHealth = async () => {
      try {
        await api.health()
        setOnline(true)
      } catch {
        setOnline(false)
      }
    }
    checkHealth()
    const t1 = setInterval(checkHealth, 15000)

    const loadCounts = async () => {
      try {
        const data = await api.handoffs()
        setOpenCount((data.counts || {}).open || 0)
      } catch {}
    }
    loadCounts()
    const t2 = setInterval(loadCounts, 15000)

    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <Logo />
          </div>
          <div>
            <span className={styles.logoName}>SwasthiQ</span>
            <span className={styles.logoSub}>Clinic Front Desk Agent</span>
          </div>
        </div>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navSectionLabel}>EXPERIENCE & SIMULATOR</div>

        <NavLink
          to="/chat"
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
        >
          <div className={styles.navIconWrapper}>
            <IconChat />
          </div>
          <span className={styles.navText}>Live Agent Chat</span>
          <span className={styles.liveTag}>LIVE</span>
        </NavLink>

        <div className={styles.navSectionLabel}>EVALUATION SCREENS</div>

        <NavLink
          to="/handoffs"
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
        >
          <div className={styles.navIconWrapper}>
            <IconHandoffs />
          </div>
          <span className={styles.navText}>Handoff Queue</span>
          {openCount > 0 && (
            <span className={styles.badge}>{openCount}</span>
          )}
        </NavLink>

        <NavLink
          to="/conversations"
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
        >
          <div className={styles.navIconWrapper}>
            <IconConversations />
          </div>
          <span className={styles.navText}>Conversations</span>
        </NavLink>
      </nav>

      <div className={styles.footer}>
        <div className={`${styles.statusPill} ${online === true ? styles.online : online === false ? styles.offline : ''}`}>
          <div className={styles.statusDot} />
          <span className={styles.statusText}>
            {online === null ? 'Checking...' : online ? 'Backend Connected' : 'Backend Offline'}
          </span>
        </div>
        <div className={styles.clinicInfo}>
          <div className={styles.clinicBadge}>🏥 Dr. Rao & Dr. Sethi</div>
          <div className={styles.clinicName}>Sunrise Clinic, Dehradun</div>
        </div>
      </div>
    </aside>
  )
}
