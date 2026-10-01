/* =====================================================
   SwasthiQ Frontend — app.js
   ===================================================== */

const API_BASE = 'http://127.0.0.1:8000';

// ─── State ───────────────────────────────────────────
let currentSection = 'dashboard';
let allHandoffs = [];
let handoffFilter = 'all';

// ─── Boot ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  startClock();
  checkServerHealth();
  loadDashboard();
  setInterval(checkServerHealth, 15000);
});

// ─── Clock ────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('datetime-display');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  }
  tick(); setInterval(tick, 1000);
}

function setTodayDate() {
  const d = document.getElementById('today-date');
  if (d) {
    const today = new Date().toISOString().slice(0, 10);
    d.value = today;
  }
}

// ─── Server health ────────────────────────────────────
async function checkServerHealth() {
  const pill = document.getElementById('server-status');
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      pill.className = 'status-pill online';
      pill.querySelector('span').textContent = 'Server Online';
    } else throw new Error();
  } catch {
    pill.className = 'status-pill offline';
    pill.querySelector('span').textContent = 'Server Offline';
  }
}

// ─── Navigation ───────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`section-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');

  const titles = {
    dashboard: ['Dashboard', 'Sunrise Clinic, Dehradun'],
    agent:     ['Agent Chat', 'Test the AI front-desk agent'],
    handoffs:  ['Handoff Queue', 'Escalations requiring human attention'],
    conversations: ['Conversations', 'All processed conversations'],
  };
  document.getElementById('page-title').textContent = titles[name][0];
  document.getElementById('page-sub').textContent   = titles[name][1];
  currentSection = name;

  if (name === 'handoffs') loadHandoffs();
  if (name === 'conversations') loadConversations();
}

function refreshCurrentSection() {
  if (currentSection === 'dashboard') loadDashboard();
  if (currentSection === 'handoffs') loadHandoffs();
  if (currentSection === 'conversations') loadConversations();
}

// ─── Dashboard ────────────────────────────────────────
async function loadDashboard() {
  try {
    const [statsRes, handoffsRes] = await Promise.all([
      fetch(`${API_BASE}/api/stats`).then(r => r.json()).catch(() => ({ stats: {} })),
      fetch(`${API_BASE}/api/handoffs`).then(r => r.json()).catch(() => ({ handoffs: [], counts: {} })),
    ]);

    const stats = statsRes.stats || {};
    const keys = ['booked', 'rescheduled', 'cancelled', 'escalated', 'refused', 'abandoned'];
    keys.forEach(k => {
      const el = document.getElementById(`stat-${k}`);
      if (el) el.textContent = stats[k] ?? 0;
    });

    renderPieChart(stats);
    renderMiniHandoffs(handoffsRes.handoffs || []);

    const open = (handoffsRes.counts || {}).open || 0;
    const badge = document.getElementById('handoff-count');
    badge.textContent = open;
    badge.style.display = open > 0 ? 'inline' : 'none';

    const pc = document.getElementById('pending-count');
    if (pc) pc.textContent = open;
  } catch (e) {
    console.error('Dashboard load error:', e);
  }
}

function renderPieChart(stats) {
  const canvas = document.getElementById('outcomeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const legend = document.getElementById('chart-legend');

  const data = [
    { label: 'Booked',      value: stats.booked || 0,      color: '#10b981' },
    { label: 'Rescheduled', value: stats.rescheduled || 0,  color: '#818cf8' },
    { label: 'Cancelled',   value: stats.cancelled || 0,    color: '#f43f5e' },
    { label: 'Escalated',   value: stats.escalated || 0,    color: '#f59e0b' },
    { label: 'Refused',     value: stats.refused || 0,      color: '#8b5cf6' },
    { label: 'Abandoned',   value: stats.abandoned || 0,    color: '#475569' },
  ];

  const total = data.reduce((s, d) => s + d.value, 0);
  const W = 160, cx = W / 2, cy = W / 2, r = 65, inner = 38;
  canvas.width = W; canvas.height = W;
  ctx.clearRect(0, 0, W, W);

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = '#080b14';
    ctx.fill();
  } else {
    let start = -Math.PI / 2;
    data.forEach(d => {
      if (!d.value) return;
      const angle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      start += angle;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = '#080b14';
    ctx.fill();

    // Total label
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 22px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy - 6);
    ctx.font = '11px Inter';
    ctx.fillStyle = '#64748b';
    ctx.fillText('total', cx, cy + 12);
  }

  legend.innerHTML = data.map(d => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${d.color}"></div>
      <span>${d.label}</span>
      <span class="legend-val">${d.value}</span>
    </div>
  `).join('');
}

function renderMiniHandoffs(handoffs) {
  const el = document.getElementById('handoff-list-mini');
  const open = handoffs.filter(h => !h.resolved);
  if (!open.length) {
    el.innerHTML = '<div class="empty-state-mini">✅ No pending handoffs</div>';
    return;
  }
  const reasonColors = {
    clinical_urgent: '#f43f5e', medical_advice: '#f59e0b',
    not_authorised: '#8b5cf6', ambiguous_patient: '#06b6d4', out_of_scope: '#64748b'
  };
  el.innerHTML = open.slice(0, 5).map(h => `
    <div class="handoff-item-mini" onclick="showSection('handoffs')">
      <div class="handoff-reason-dot" style="background:${reasonColors[h.reason] || '#64748b'}"></div>
      <div style="min-width:0">
        <div class="mini-id">${h.conversation_id}</div>
        <div class="mini-reason">${h.reason}</div>
        <div class="mini-summary">${h.summary || h.caller_said || '—'}</div>
      </div>
    </div>
  `).join('');
}

// ─── Agent Chat ───────────────────────────────────────
let turnCount = 1;

function addTurn() {
  turnCount++;
  const list = document.getElementById('turns-list');
  const row = document.createElement('div');
  row.className = 'turn-row';
  row.innerHTML = `
    <span class="turn-num">${turnCount}</span>
    <input type="text" class="form-input turn-input" placeholder="Enter caller's message..." />
    <button class="remove-turn-btn" onclick="removeTurn(this)">×</button>
  `;
  list.appendChild(row);
  row.querySelector('.turn-input').focus();
  renumberTurns();
}

function removeTurn(btn) {
  const rows = document.querySelectorAll('.turn-row');
  if (rows.length <= 1) { showToast('Need at least one turn', 'error'); return; }
  btn.closest('.turn-row').remove();
  renumberTurns();
}

function renumberTurns() {
  document.querySelectorAll('.turn-row').forEach((row, i) => {
    row.querySelector('.turn-num').textContent = i + 1;
  });
  turnCount = document.querySelectorAll('.turn-row').length;
}

async function runAgent() {
  const convId = document.getElementById('conv-id').value.trim();
  const today  = document.getElementById('today-date').value;
  const turns  = [...document.querySelectorAll('.turn-input')].map(i => i.value.trim()).filter(Boolean);

  if (!convId) { showToast('Please enter a Conversation ID', 'error'); return; }
  if (!today)  { showToast('Please set Today\'s Date', 'error'); return; }
  if (!turns.length) { showToast('Please enter at least one turn', 'error'); return; }

  const btn = document.getElementById('run-btn');
  const btnText = document.getElementById('run-btn-text');
  btn.disabled = true;
  btnText.textContent = 'Running...';

  // Show spinner in result area
  document.getElementById('empty-result-panel').style.display = 'none';
  document.getElementById('result-panel').style.display = 'none';

  try {
    const start = Date.now();
    const res = await fetch(`${API_BASE}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convId, today, turns }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    renderResult(data);
    showToast(`Agent replied in ${((Date.now()-start)/1000).toFixed(1)}s`, 'success');

    // Auto-increment conversation ID
    const match = convId.match(/^(.*?)(\d+)$/);
    if (match) {
      document.getElementById('conv-id').value = match[1] + String(Number(match[2]) + 1).padStart(match[2].length, '0');
    }

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    document.getElementById('empty-result-panel').style.display = 'block';
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Run Agent';
  }
}

function renderResult(data) {
  document.getElementById('result-panel').style.display = 'block';
  document.getElementById('empty-result-panel').style.display = 'none';

  const state = data.terminal_state || 'abandoned';

  // State badge
  const badge = document.getElementById('result-state-badge');
  badge.textContent = state.toUpperCase();
  badge.className = `result-state-badge badge-${state}`;

  document.getElementById('result-reply').textContent = data.reply || '—';

  document.getElementById('meta-terminal').textContent    = state;
  document.getElementById('meta-terminal').className      = `meta-val state-${state}`;
  document.getElementById('meta-escalation').textContent  = data.escalation_reason || 'null';
  document.getElementById('meta-patient').textContent     = data.patient_id || 'null';
  document.getElementById('meta-appointment').textContent = data.appointment_id || 'null';
  document.getElementById('meta-tokens').textContent      = data.metrics?.tokens ?? '—';
  document.getElementById('meta-latency').textContent     = data.metrics?.latency_ms ? `${data.metrics.latency_ms}ms` : '—';

  // Tool timeline
  const timeline = document.getElementById('tool-timeline');
  const calls = data.tool_calls || [];
  if (!calls.length) {
    timeline.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:8px 0">No tool calls made</div>';
  } else {
    timeline.innerHTML = calls.map((c, i) => `
      <div class="tool-call-item">
        <div class="tool-call-num">${i+1}</div>
        <div>
          <div class="tool-name">${c.name}</div>
          <div class="tool-args">${JSON.stringify(c.arguments)}</div>
        </div>
      </div>
    `).join('');
  }

  document.getElementById('raw-json').textContent = JSON.stringify(data, null, 2);

  // Scroll result into view
  document.getElementById('result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Sample conversations ─────────────────────────────
function loadSampleAndGo(type) {
  const samples = {
    book: {
      id: 'cv_sample_book',
      turns: [
        'Namaste, Dr. Rao ke saath appointment chahiye tha.',
        'Kal subah ho jayega? Mera naam Priya Sharma hai.',
      ]
    },
    cancel: {
      id: 'cv_sample_cancel',
      turns: [
        'Hello, mujhe apni appointment cancel karni hai.',
        'Mera naam Rahul Verma hai, phone number 9876543210.',
      ]
    },
    emergency: {
      id: 'cv_sample_emergency',
      turns: [
        'Mujhe bahut seene mein dard ho raha hai, saans lene mein problem hai.',
        'Haan, chest mein bahut zyada dard hai aur paseena aa raha hai.',
      ]
    },
    hinglish: {
      id: 'cv_sample_hinglish',
      turns: [
        'Dr. Sethi ke saath kal ka appointment book karna tha.',
        'Mera naam Amit Kumar hai. Shaam ko available hai kya?',
      ]
    },
  };

  const sample = samples[type];
  if (!sample) return;

  showSection('agent');
  document.getElementById('conv-id').value = sample.id;
  document.getElementById('today-date').value = new Date().toISOString().slice(0, 10);

  // Clear existing turns
  document.getElementById('turns-list').innerHTML = '';
  turnCount = 0;
  sample.turns.forEach(t => {
    addTurn();
    document.querySelectorAll('.turn-input')[turnCount - 1].value = t;
  });
}

// ─── Handoffs ─────────────────────────────────────────
async function loadHandoffs() {
  const grid = document.getElementById('handoffs-grid');
  grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading handoffs...</span></div>';
  try {
    const res = await fetch(`${API_BASE}/api/handoffs`);
    const data = await res.json();
    allHandoffs = data.handoffs || [];
    renderHandoffs();
  } catch {
    grid.innerHTML = '<div class="loading-state"><span style="color:var(--rose)">Failed to load handoffs. Is the server running?</span></div>';
  }
}

function filterHandoffs(filter, btn) {
  handoffFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHandoffs();
}

function renderHandoffs() {
  const grid = document.getElementById('handoffs-grid');
  let list = allHandoffs;
  if (handoffFilter === 'open')     list = list.filter(h => !h.resolved);
  if (handoffFilter === 'resolved') list = list.filter(h =>  h.resolved);

  if (!list.length) {
    grid.innerHTML = `
      <div class="loading-state" style="grid-column:1/-1">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-3)"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        <span>${handoffFilter === 'open' ? 'No open handoffs 🎉' : handoffFilter === 'resolved' ? 'No resolved handoffs' : 'No handoffs yet'}</span>
      </div>`;
    return;
  }

  const stripeColors = {
    clinical_urgent: '#f43f5e', medical_advice: '#f59e0b',
    not_authorised: '#8b5cf6', ambiguous_patient: '#06b6d4', out_of_scope: '#475569'
  };

  grid.innerHTML = list.map(h => `
    <div class="handoff-card ${h.resolved ? 'resolved' : ''}">
      <div class="handoff-stripe" style="background:${stripeColors[h.reason]||'#475569'}"></div>
      <div style="padding-left:8px">
        <div class="handoff-card-top">
          <span class="handoff-id">${h.conversation_id}</span>
          <span class="reason-tag reason-${h.reason}">${h.reason.replace(/_/g,' ')}</span>
        </div>
        <div class="handoff-summary">${h.summary || '—'}</div>
        ${h.caller_said ? `<div class="handoff-caller">"${h.caller_said.slice(0,120)}${h.caller_said.length>120?'...':''}"</div>` : ''}
        <div class="handoff-meta">
          ${h.patient_id ? `<span>👤 ${h.patient_id}</span>` : ''}
          ${h.appointment_id ? `<span>📅 ${h.appointment_id}</span>` : ''}
          <span>🕐 ${formatTime(h.timestamp)}</span>
        </div>
        <div class="handoff-actions">
          ${!h.resolved ? `
            <button class="resolve-btn" onclick="resolveHandoff('${h.conversation_id}', this)">
              ✓ Mark Resolved
            </button>
          ` : `
            <button class="resolve-btn" disabled style="opacity:0.4">✓ Resolved</button>
          `}
        </div>
      </div>
    </div>
  `).join('');
}

async function resolveHandoff(convId, btn) {
  btn.disabled = true;
  btn.textContent = 'Resolving...';
  try {
    const res = await fetch(`${API_BASE}/api/handoffs/${convId}/resolve`, { method: 'POST' });
    if (!res.ok) throw new Error();
    showToast('Handoff marked as resolved', 'success');
    await loadHandoffs();
    loadDashboard();
  } catch {
    showToast('Failed to resolve handoff', 'error');
    btn.disabled = false;
    btn.textContent = '✓ Mark Resolved';
  }
}

// ─── Conversations ────────────────────────────────────
async function loadConversations() {
  const list = document.getElementById('conversations-list');
  list.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>';
  try {
    const res = await fetch(`${API_BASE}/api/conversations`);
    const data = await res.json();
    renderConversations(data.conversations || []);
  } catch {
    list.innerHTML = '<div class="loading-state"><span style="color:var(--rose)">Failed to load. Is the server running?</span></div>';
  }
}

function renderConversations(convs) {
  const list = document.getElementById('conversations-list');
  if (!convs.length) {
    list.innerHTML = `
      <div class="loading-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-3)"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>No conversations yet. Run the agent to see results.</span>
      </div>`;
    return;
  }
  list.innerHTML = convs.map(c => `
    <div class="conversation-row" onclick="loadConversationDetail('${c.conversation_id}', this)">
      <div class="conv-state-dot dot-${c.terminal_state}"></div>
      <span class="conv-id">${c.conversation_id}</span>
      <span class="conv-state-tag badge-${c.terminal_state}">${c.terminal_state}</span>
      <span class="conv-ts">${formatTime(c.created_at)}</span>
    </div>
  `).join('');
}

async function loadConversationDetail(convId, row) {
  document.querySelectorAll('.conversation-row').forEach(r => r.classList.remove('selected'));
  row.classList.add('selected');

  const detail = document.getElementById('conversation-detail');
  const content = document.getElementById('detail-content');
  const title = document.getElementById('detail-title');

  detail.style.display = 'block';
  title.textContent = convId;
  content.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API_BASE}/api/conversations/${convId}`);
    const data = await res.json();
    const r = data.result || {};
    const state = r.terminal_state || 'abandoned';

    content.innerHTML = `
      <div class="detail-section">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
          <span class="conv-state-tag badge-${state}" style="font-size:12px">${state.toUpperCase()}</span>
          ${r.escalation_reason ? `<span class="reason-tag reason-${r.escalation_reason}">${r.escalation_reason}</span>` : ''}
        </div>
        <div class="detail-section-label">Agent Reply</div>
        <div class="detail-reply">${r.reply || '—'}</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-label">Identifiers</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="meta-item"><span class="meta-key">Patient</span><span class="meta-val">${r.patient_id || 'null'}</span></div>
          <div class="meta-item"><span class="meta-key">Appointment</span><span class="meta-val">${r.appointment_id || 'null'}</span></div>
          <div class="meta-item"><span class="meta-key">Tokens</span><span class="meta-val">${r.metrics?.tokens ?? '—'}</span></div>
          <div class="meta-item"><span class="meta-key">Latency</span><span class="meta-val">${r.metrics?.latency_ms ? r.metrics.latency_ms+'ms' : '—'}</span></div>
        </div>
      </div>
      ${(r.tool_calls||[]).length ? `
        <div class="detail-section">
          <div class="detail-section-label">Tool Calls (${r.tool_calls.length})</div>
          ${r.tool_calls.map((tc, i) => `
            <div class="detail-tool-row">
              <div class="tool-call-num">${i+1}</div>
              <div>
                <div class="tool-name">${tc.name}</div>
                <div class="tool-args">${JSON.stringify(tc.arguments)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  } catch (e) {
    content.innerHTML = '<div style="color:var(--rose);padding:20px;font-size:13px">Failed to load conversation detail.</div>';
  }
}

function closeDetail() {
  document.getElementById('conversation-detail').style.display = 'none';
  document.querySelectorAll('.conversation-row').forEach(r => r.classList.remove('selected'));
}

// ─── Utilities ────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch { return ts; }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
