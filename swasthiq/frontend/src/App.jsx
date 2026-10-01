import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import LiveChat from './pages/LiveChat'
import HandoffQueue from './pages/HandoffQueue'
import ConversationDetail from './pages/ConversationDetail'
import './App.css'

export default function App() {
  return (
    <div className="app-shell">
      {/* Soft Light Ambient Orbs */}
      <div className="bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <Sidebar />

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<LiveChat />} />
          <Route path="/handoffs" element={<HandoffQueue />} />
          <Route path="/conversations" element={<ConversationDetail />} />
          <Route path="/conversations/:id" element={<ConversationDetail />} />
        </Routes>
      </main>
    </div>
  )
}
