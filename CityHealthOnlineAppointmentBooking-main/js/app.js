/**
 * CityHealth — AI Health Support Portal
 * app.js
 *
 * Handles:
 *  - Voice widget open / close / FAB toggle
 *  - Tab switching (Find a Doctor / Book Appointment)
 *  - Animated waveform
 *  - Mic button: LIVE = toggle mute; DEMO = cycle simulated states
 *  - Agora RTC + Conversational AI integration (via agora.js + config.js)
 *  - Falls back gracefully to demo mode when LIVE_AGENT = false or unconfigured
 *  - Confirm / other-slots button actions
 *  - Nav active link on scroll
 */

'use strict';

/* ============================================================
   Waveform
   ============================================================ */
const WAVE_HEIGHTS = [5,13,21,29,21,33,19,27,15,31,23,35,19,27,11,21,29,15,23,7];
const BAR_COUNT    = WAVE_HEIGHTS.length;

function buildWaveform() {
  const container = document.getElementById('waveform');
  if (!container) return;
  container.innerHTML = '';
  WAVE_HEIGHTS.forEach(h => {
    const bar = document.createElement('div');
    bar.className    = 'bar';
    bar.style.height = h + 'px';
    container.appendChild(bar);
  });
}

function animateWaveform() {
  const bars = document.querySelectorAll('#waveform .bar');
  if (!bars.length) return;
  let tick = 0;
  setInterval(() => {
    tick++;
    bars.forEach((bar, i) => {
      const base   = WAVE_HEIGHTS[(i + tick) % BAR_COUNT];
      const factor = 0.55 + 0.45 * Math.sin(tick * 0.28 + i * 0.55);
      bar.style.height = Math.max(3, Math.round(base * factor)) + 'px';
    });
  }, 110);
}

/* ============================================================
   Demo-mode script lines (used when LIVE_AGENT = false)
   ============================================================ */
const AGENT_LINES = {
  find: [
    '"Hi! I\'m your AI health assistant. How can I help you today?"',
    '"Could you describe your symptoms so I can find the right doctor for you?"',
    '"Based on your symptoms, I recommend Dr. Anil Kumar — General Physician, available today at 10:30 AM. Shall I confirm?"',
  ],
  book: [
    '"Hi! I can help you book an appointment. Which doctor or department are you looking for?"',
    '"Dr. Anil Kumar has slots at 10:00 AM, 10:30 AM, and 11:00 AM tomorrow. Which works best?"',
    '"Great — booking confirmed for Dr. Anil Kumar at 10:30 AM tomorrow. You\'ll receive an SMS confirmation shortly."',
  ],
};
const USER_LINES = {
  find: '"I have fever, sore throat, and body pain for two days."',
  book: '"I need to see a general physician as soon as possible."',
};

/* ============================================================
   Widget state machine
   States: idle | connecting | listening | speaking | thinking
   ============================================================ */
let widgetState  = 'idle';
let activeTab    = 'find';
let agentLineIdx = 0;
let isWidgetOpen = false;

/* DOM refs (populated after DOMContentLoaded) */
let widgetCard, fabBtn, fabBadge, widgetClose, openWidgetBtn, tabBtns;

function setWidgetState(state) {
  widgetState = state;

  const dot   = document.getElementById('statusDot');
  const sText = document.getElementById('statusText');
  const pill  = document.getElementById('statePill');
  const label = document.getElementById('stateLabel');
  const btn   = document.getElementById('micBtn');
  const hint  = document.getElementById('micHint');
  const ring  = document.getElementById('micRing');
  if (!dot) return;

  dot.className  = 'wc-dot';
  pill.className = 'state-pill';
  btn.className  = 'mic-inner';
  ring.className = 'mic-ring';

  switch (state) {
    case 'connecting':
      sText.textContent  = 'Connecting…';
      pill.classList.add('is-thinking');
      label.textContent  = 'Connecting to agent…';
      hint.textContent   = 'Please wait…';
      break;

    case 'speaking':
      dot.classList.add('is-speaking');
      sText.textContent  = 'Agent speaking';
      pill.classList.add('is-speaking');
      label.textContent  = 'Agent speaking…';
      hint.textContent   = 'Tap mic to interrupt';
      break;

    case 'listening':
      sText.textContent  = 'Listening · Ready to help';
      pill.classList.add('is-listening');
      label.textContent  = 'Listening…';
      btn.classList.add('is-active');
      ring.classList.add('is-listening');
      hint.textContent   = 'Listening — speak now';
      break;

    case 'thinking':
      sText.textContent  = 'Processing your request';
      pill.classList.add('is-thinking');
      label.textContent  = 'AI thinking…';
      hint.textContent   = 'Please wait…';
      break;

    default: // idle
      sText.textContent  = 'Ready to help';
      label.textContent  = 'Tap mic to start';
      hint.textContent   = 'Tap to speak';
  }
}

/* ── Connection status banner (inside widget card) ── */
function showConnectionBanner(msg, type = 'error') {
  let banner = document.getElementById('agoraBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'agoraBanner';
    banner.style.cssText =
      'position:absolute;top:56px;left:0;right:0;padding:7px 14px;font-size:12px;' +
      'font-weight:600;text-align:center;z-index:20;';
    widgetCard && widgetCard.appendChild(banner);
  }
  banner.textContent      = msg;
  banner.style.display    = 'block';
  banner.style.background = type === 'error'   ? '#fee2e2' :
                            type === 'success'  ? '#dcfce7' : '#fef3c7';
  banner.style.color      = type === 'error'   ? '#dc2626' :
                            type === 'success'  ? '#166534' : '#92400e';
  if (type !== 'error') setTimeout(() => { banner.style.display = 'none'; }, 3500);
}

/* ============================================================
   Agora integration (live mode)
   ============================================================ */
// Exposed on window so booking.js can access the same instance
window.cityHealthAgent = null;

function initAgoraAgent() {
  if (typeof CityHealthAgora  === 'undefined') return;
  if (typeof CITYHEALTH_CONFIG === 'undefined') return;
  if (!CITYHEALTH_CONFIG.LIVE_AGENT)            return;

  window.cityHealthAgent = new CityHealthAgora(CITYHEALTH_CONFIG);

  /* Agent state → widget UI state */
  window.cityHealthAgent.on('state-change', ({ state }) => setWidgetState(state));

  /* Agent transcript → transcript box (only on final turn) */
  window.cityHealthAgent.on('agent-transcript', ({ text, final }) => {
    if (!final) return;
    const el = document.getElementById('agentTranscript');
    if (el) el.textContent = `"${text}"`;
  });

  /* User transcript → transcript box */
  window.cityHealthAgent.on('user-transcript', ({ text }) => {
    const el = document.getElementById('userTranscript');
    if (el) el.textContent = `"${text}"`;
  });

  /* Session connected */
  window.cityHealthAgent.on('connected', () => {
    showConnectionBanner('Voice agent connected ✓', 'success');
  });

  /* Session disconnected */
  window.cityHealthAgent.on('disconnected', () => setWidgetState('idle'));

  /* Error → fall back to demo mode */
  window.cityHealthAgent.on('error', ({ message }) => {
    console.error('[CityHealth] Agora error:', message);
    showConnectionBanner('⚠ ' + message);
    setWidgetState('idle');
    window.cityHealthAgent = null; // switch to demo mode
  });

  /* Network quality warning */
  window.cityHealthAgent.on('network-quality', ({ uplink, downlink }) => {
    if (uplink >= 4 || downlink >= 4) {
      showConnectionBanner('⚠ Poor network — audio may be affected', 'warn');
    }
  });
}

/* ============================================================
   Mic button
   Live  → toggle mute / unmute
   Demo  → cycle simulated states
   ============================================================ */
function onMicClick() {
  /* ── LIVE mode ── */
  if (window.cityHealthAgent && window.cityHealthAgent.isConnected) {
    const nowMuted = window.cityHealthAgent.isMicMuted;
    window.cityHealthAgent.setMicMuted(!nowMuted);
    const micBtn = document.getElementById('micBtn');
    const hint   = document.getElementById('micHint');
    if (micBtn) micBtn.classList.toggle('is-muted', !nowMuted);
    if (hint)   hint.textContent = nowMuted ? 'Listening — speak now' : 'Mic muted — tap to unmute';
    return;
  }

  /* ── DEMO mode ── */
  switch (widgetState) {
    case 'idle':
    case 'speaking':
      setWidgetState('listening');
      setTimeout(() => {
        document.getElementById('userTranscript').textContent = USER_LINES[activeTab];
        setWidgetState('thinking');
        setTimeout(() => { advanceDemoLine(); setWidgetState('speaking'); }, 1500);
      }, 2000);
      break;

    case 'listening':
      setWidgetState('thinking');
      setTimeout(() => { advanceDemoLine(); setWidgetState('speaking'); }, 1500);
      break;

    case 'thinking':
      break; // ignore while thinking
  }
}

function advanceDemoLine() {
  const lines = AGENT_LINES[activeTab];
  agentLineIdx = (agentLineIdx + 1) % lines.length;
  document.getElementById('agentTranscript').textContent = lines[agentLineIdx];
}

/* ============================================================
   Open / close widget
   ============================================================ */
async function openWidget() {
  isWidgetOpen = true;
  widgetCard.classList.add('is-open');
  fabBadge.style.display = 'none';

  agentLineIdx = 0;
  document.getElementById('agentTranscript').textContent = AGENT_LINES[activeTab][0];
  document.getElementById('userTranscript').textContent  = USER_LINES[activeTab];

  /* Live mode — start RTC session */
  if (typeof CITYHEALTH_CONFIG !== 'undefined' &&
      CITYHEALTH_CONFIG.LIVE_AGENT && window.cityHealthAgent) {
    setWidgetState('connecting');
    window.cityHealthAgent.start(); // async — events update state
  } else {
    setWidgetState('speaking');
  }
}

async function closeWidget() {
  isWidgetOpen = false;
  widgetCard.classList.remove('is-open');

  if (window.cityHealthAgent && window.cityHealthAgent.isConnected) {
    window.cityHealthAgent.stop();
  } else {
    setWidgetState('idle');
  }
}

/* ============================================================
   Tab switching
   ============================================================ */
function switchTab(tab) {
  activeTab    = tab;
  agentLineIdx = 0;

  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.getElementById('agentTranscript').textContent = AGENT_LINES[tab][0];
  document.getElementById('userTranscript').textContent  = USER_LINES[tab];
  setWidgetState('speaking');
}

/* ============================================================
   Widget: Confirm booking
   ============================================================ */
function onConfirm() {
  document.getElementById('agentTranscript').textContent =
    '"Your appointment with Dr. Anil Kumar at 10:30 AM has been confirmed. ' +
    'You will receive an SMS reminder 24 hours before. Is there anything else I can help you with?"';
  setWidgetState('listening');

  const badge = document.querySelector('.rc-rating');
  if (badge) badge.style.background = '#EAF3DE';

  const confirmBtn = document.getElementById('confirmBtn');
  if (confirmBtn) {
    confirmBtn.textContent      = '✓ Booked!';
    confirmBtn.style.background = '#3B6D11';
    confirmBtn.disabled         = true;
  }
}

/* ============================================================
   Widget: Other slots
   ============================================================ */
function onOtherSlots() {
  document.getElementById('agentTranscript').textContent =
    '"Dr. Anil Kumar also has slots at 11:00 AM and 5:30 PM tomorrow. ' +
    'Would you prefer morning or evening?"';
  setWidgetState('listening');
}

/* ============================================================
   Scroll: active nav link
   ============================================================ */
function updateActiveNav() {
  const sections = document.querySelectorAll('section[id], div[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  let current    = '';
  sections.forEach(sec => {
    if (window.scrollY >= sec.offsetTop - 80) current = sec.id;
  });
  navLinks.forEach(link => {
    const href = link.getAttribute('href').replace('#', '');
    link.classList.toggle('active', href === current);
  });
}



/* ============================================================
   Home page navigation: department tiles
   ============================================================ */
function scrollToElementById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToDepartmentDoctors(deptKey) {
  const target = document.querySelector(`[data-dept-card="${deptKey}"]`);
  if (!target) return;

  document.querySelectorAll('.doctor-dept-card.is-selected').forEach(card => {
    card.classList.remove('is-selected');
  });

  target.classList.add('is-selected');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.focus({ preventScroll: true });

  window.clearTimeout(window.__cityHealthDeptHighlightTimer);
  window.__cityHealthDeptHighlightTimer = window.setTimeout(() => {
    target.classList.remove('is-selected');
  }, 2600);
}

/* ============================================================
   Initialise
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  widgetCard    = document.getElementById('widgetCard');
  fabBtn        = document.getElementById('fabBtn');
  fabBadge      = document.getElementById('fabBadge');
  widgetClose   = document.getElementById('widgetClose');
  openWidgetBtn = document.getElementById('openWidgetBtn');
  tabBtns       = document.querySelectorAll('.wc-tab');

  buildWaveform();
  animateWaveform();

  /* Initialise Agora agent instance (no connection until widget opens) */
  initAgoraAgent();

  /* FAB toggle */
  fabBtn.addEventListener('click', () => {
    if (typeof CityHealthAgora !== 'undefined') CityHealthAgora.resumeAudioContext();
    if (isWidgetOpen) closeWidget();
    else              openWidget();
  });

  /* Close widget */
  widgetClose.addEventListener('click', closeWidget);

  /* CTA "Open Voice Agent" */
  if (openWidgetBtn) {
    openWidgetBtn.addEventListener('click', () => {
      openWidget();
      widgetCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  /* Hero "Call AI Agent" button */
  const callBtn = document.getElementById('callBtn');
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      alert('Connecting to CityHealth AI Agent…\n\nDial: 1800 267 4400');
    });
  }

  /* Mic button */
  document.getElementById('micBtn').addEventListener('click', onMicClick);

  /* Tab buttons */
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* Booking actions */
  document.getElementById('confirmBtn')?.addEventListener('click', onConfirm);
  document.getElementById('otherSlotsBtn')?.addEventListener('click', onOtherSlots);

  /* Active nav on scroll */
  window.addEventListener('scroll', updateActiveNav, { passive: true });

  /* Home page tile navigation */
  document.getElementById('scrollDoctorsTile')?.addEventListener('click', () => scrollToElementById('departments'));
  document.getElementById('scrollLabTile')?.addEventListener('click', () => scrollToElementById('lab-tests'));
  document.getElementById('viewAllDepartmentsBtn')?.addEventListener('click', () => scrollToElementById('departments'));
  document.querySelectorAll('[data-dept-target]').forEach(tile => {
    tile.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      scrollToDepartmentDoctors(tile.dataset.deptTarget);
    });
  });

  /* Initial state */
  setWidgetState('idle');
});
