/**
 * CityHealth — Voice-First Booking Flow
 * booking.js  (v3 — fully integrated with Agora Conversational AI)
 *
 * LIVE MODE  (CITYHEALTH_CONFIG.LIVE_AGENT = true)
 *   • Opens a dedicated Agora RTC + Conversational AI session when the
 *     booking overlay opens (separate from the widget session).
 *   • Agent uses BOOKING_SYSTEM_PROMPT — a 5-step structured script.
 *   • Agent + user transcripts update the active screen in real time.
 *   • Screens advance automatically after each completed user turn
 *     (turn 1 → step 2, turn 2 → step 3, … turn 4 → step 5).
 *   • Context cards (symptom tags, doctor card, patient profile, slots,
 *     confirmation) appear at the right moment based on turn count.
 *   • Mic button toggles mute / unmute.
 *
 * DEMO MODE  (LIVE_AGENT = false, or Agora not configured)
 *   • Timed auto-play script advances through all 5 steps.
 *   • Tapping the mic fast-forwards the current step.
 */

'use strict';

function chEnsureTranscriptHistory() {
  window.CityHealthTranscriptHistory = window.CityHealthTranscriptHistory || [];
  return window.CityHealthTranscriptHistory;
}

function chLogTranscript(role, step, text) {
  const cleanText = String(text || '').replace(/^"|"$/g, '').trim();
  if (!cleanText) return;
  if (/^(Agent is speaking|Listening|Processing|Connecting to voice agent|Say your mobile number|Describe your symptoms)/i.test(cleanText)) return;

  const normalizeTranscript = (value) => String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  const history = chEnsureTranscriptHistory();
  const cleanNorm = normalizeTranscript(cleanText);
  const last = history[history.length - 1];

  // The Agora transcript callback can deliver the same finalized agent text more than once.
  // It can also deliver a shorter interim version followed by the complete sentence.
  // Keep one stable transcript item instead of adding duplicates.
  if (last && last.role === role) {
    const lastNorm = normalizeTranscript(last.text);
    if (lastNorm === cleanNorm) return;
    if (cleanNorm.startsWith(lastNorm) || cleanNorm.includes(lastNorm)) {
      last.text = cleanText;
      last.step = step;
      window.dispatchEvent(new CustomEvent('cityhealth-transcript-history-updated'));
      return;
    }
    if (lastNorm.startsWith(cleanNorm) || lastNorm.includes(cleanNorm)) return;
  }

  const duplicateIndex = history.findIndex((item) => item.role === role && normalizeTranscript(item.text) === cleanNorm);
  if (duplicateIndex >= 0) return;

  history.push({ role, step, text: cleanText, time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) });
  window.dispatchEvent(new CustomEvent('cityhealth-transcript-history-updated'));
}


/* ============================================================
   Step labels + demo scripts
   ============================================================ */
const STEP_LABELS = [
  '',
  'Step 1 of 5 — Verifying identity',
  'Step 2 of 5 — Describing symptoms',
  'Step 3 of 5 — Doctor recommendation',
  'Step 4 of 5 — Selecting a slot',
  'Step 5 of 5 — Confirming appointment',
];

const DEMO_SCRIPT = {
  1: [
    { who:'agent',  delay:400,   text:'Hi! I\'m HealthBook AI. To get started, please say your registered 10-digit mobile number.' },
    { who:'listen', delay:3200 },
    { who:'user',   delay:5200,  text:'9876543210' },
    { who:'think',  delay:5700 },
    { who:'action', delay:5900,  fn: () => { showVerifyingCard(); document.getElementById('s1VerifyText').textContent = 'Verifying phone number…'; } },
    { who:'agent',  delay:7000,  text:'Got it. Now please say your Medical Record Number.' },
    { who:'listen', delay:9000 },
    { who:'user',   delay:11200, text:'MRN001' },
    { who:'think',  delay:11700 },
    { who:'action', delay:11900, fn: () => { document.getElementById('s1VerifyText').textContent = 'Confirming identity…'; } },
    { who:'agent',  delay:12800, text:'And finally, could you please confirm your full name?' },
    { who:'listen', delay:14800 },
    { who:'user',   delay:16800, text:'Rahul Kumar' },
    { who:'think',  delay:17300 },
    { who:'action', delay:17500, fn: () => populatePatientCard({ id:'CH-2024-00847', name:'Rahul Kumar', phone:'9876543210', mrn:'MRN001', lastVisit:'12 Jan 2026', lastDoctor:'Dr. Mehta', diagnosis:'Seasonal Rhinitis', medication:'Cetirizine 10mg', visits:3 }) },
    { who:'action', delay:17700, fn: () => showProfileCard() },
    { who:'agent',  delay:18400, text:'Welcome back, Rahul! Identity verified. How are you feeling today?' },
    { who:'next',   delay:21000 },
  ],
  2: [
    { who:'agent',  delay:400,   text:'Please describe your symptoms. Also, have you noticed any changes in your daily routine? Any specific food that may have caused this?' },
    { who:'listen', delay:4200 },
    { who:'user',   delay:7000,  text:'I have fever and sore throat for 2 days. I had street food yesterday. I\'ve been sleeping late.' },
    { who:'think',  delay:7500 },
    { who:'action', delay:7800,  fn: () => showSymptomTags(['Fever','Sore throat','Poor sleep','Possible food trigger']) },
    { who:'agent',  delay:8500,  text:'Understood. Fever, sore throat, recent street food and disturbed sleep — that\'s helpful. Let me find the right specialist.' },
    { who:'next',   delay:11000 },
  ],
  3: [
    { who:'action', delay:100,   fn: () => populateDoctorList('General Physician', 0) },
    { who:'agent',  delay:400,   text:'Based on your symptoms I recommend our General Medicine department. Dr. Anil Kumar is our top-rated physician — 4.8 stars, ₹500 fee, 12 years experience. Shall I book with Dr. Kumar?' },
    { who:'listen', delay:6200 },
    { who:'user',   delay:8600,  text:'Yes, Dr. Anil Kumar please.' },
    { who:'think',  delay:9100 },
    { who:'agent',  delay:9900,  text:'Perfect. Now let me show you Dr. Kumar\'s available slots.' },
    { who:'next',   delay:11800 },
  ],
  4: [
    { who:'action', delay:100,   fn: () => renderCalendar() },
    { who:'agent',  delay:400,   text:'Are you looking for an appointment today, or would you prefer a future date? I\'ll show you the available slots.' },
    { who:'listen', delay:4200 },
    { who:'user',   delay:6800,  text:'Tomorrow morning please.' },
    { who:'think',  delay:7300 },
    { who:'action', delay:7600,  fn: () => selectCalendarDay(1) },
    { who:'action', delay:7800,  fn: () => highlightSlot('10:30 AM') },
    { who:'agent',  delay:8500,  text:'10:30 AM tomorrow is available. Shall I confirm that slot?' },
    { who:'listen', delay:10500 },
    { who:'user',   delay:12500, text:'Yes, 10:30 AM works perfectly.' },
    { who:'next',   delay:13800 },
  ],
  5: [
    { who:'agent',  delay:300,   text:'Updating your records now…' },
    { who:'action', delay:600,   fn: () => runDbAnimation() },
  ],
};

/* ============================================================
   State
   ============================================================ */
let currentStep        = 1;
let flowRunning        = false;
let stepTimers         = [];
let waveIntervals      = {};
let bookingAgent       = null;
let liveTurnCount      = 0;
let agentSpeakCount    = 0;  // global (for logging)
let stepSpeakCount     = 0;  // resets each time we advance to a new step
let stepLocked         = false;
let listeningStartTime = 0;
const MIN_USER_LISTEN_MS = 1800;

/*
 * How many user-response turns (agent speaks after user) are needed
 * before advancing from each step:
 *
 *   Step 1 (Verify): phone exchange + MRN exchange + name + final "verified" = 3
 *   Step 2 (Symptoms): symptom description + optional follow-up = 2
 *   Step 3 (Doctors): confirmation = 2
 *   Step 4 (Schedule): slot selection = 2
 */
const STEP_ADVANCE_AT = { 1:3, 2:2, 3:2, 4:2 };

/* ============================================================
   Waveform
   ============================================================ */
const VF_WAVE_H = [4,8,14,20,26,20,14,8,4,7,13,19,26,19,13,7];

function startWave(id, active = true) {
  stopWave(id);
  const el = document.getElementById(id);
  if (!el) return;
  const bars = el.querySelectorAll('.vf-bar');
  if (!bars.length) return;
  let t = 0;
  waveIntervals[id] = setInterval(() => {
    t++;
    bars.forEach((bar, i) => {
      const base   = VF_WAVE_H[(i + t) % VF_WAVE_H.length];
      const amp    = active ? 1 : 0.22;
      const factor = amp * (0.5 + 0.5 * Math.sin(t * 0.32 + i * 0.6));
      bar.style.height = Math.max(2, Math.round(base * factor)) + 'px';
    });
  }, 110);
}

function stopWave(id) {
  if (waveIntervals[id]) { clearInterval(waveIntervals[id]); delete waveIntervals[id]; }
  const el = document.getElementById(id);
  if (el) el.querySelectorAll('.vf-bar').forEach(b => b.style.height = '3px');
}

function stopAllWaves() { Object.keys(waveIntervals).forEach(stopWave); }

/* ============================================================
   Progress + screen navigation
   ============================================================ */
function goToStep(step) {
  stopAllWaves();
  clearAllTimers();

  document.querySelectorAll('.bf-screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('bfScreen' + step);
  if (screen) screen.classList.add('active');

  currentStep = step;
  updateProgress(step);

  const lbl = document.getElementById('bfStepLabel');
  if (lbl) lbl.textContent = STEP_LABELS[step] || '';
}

function updateProgress(step) {
  document.querySelectorAll('.bf-step').forEach(el => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    if (s <  step)  el.classList.add('done');
  });
  document.querySelectorAll('.bf-step-line').forEach((line, i) => {
    line.classList.toggle('done', i + 1 < step);
  });
}

/* ============================================================
   Per-screen UI helpers
   ============================================================ */
function setScreenState(step, state) {
  const pill   = document.getElementById(`s${step}Pill`);
  const label  = document.getElementById(`s${step}PillLabel`);
  const micBtn = document.getElementById(`s${step}MicBtn`);
  const hint   = document.getElementById(`s${step}MicHint`);

  if (pill) {
    pill.className = 'vf-state-pill';
    if (state === 'listening')  pill.classList.add('is-listening');
    if (state === 'thinking')   pill.classList.add('is-thinking');
    if (state === 'confirming') pill.classList.add('is-confirming');
  }

  const labels = { speaking:'Agent speaking…', listening:'Listening…', thinking:'Processing…', confirming:'Confirmed!' };
  if (label) label.textContent = labels[state] || 'Speaking…';

  if (micBtn) {
    micBtn.classList.remove('is-listening', 'is-muted');
    if (state === 'listening') micBtn.classList.add('is-listening');
    if (state === 'thinking')  micBtn.classList.add('is-muted');
  }

  const hints = { speaking:'Agent is speaking…', listening:'Listening — speak now', thinking:'Processing…', confirming:'Appointment confirmed!' };
  if (hint) hint.textContent = hints[state] || '';

  startWave(`s${step}Wave`, state !== 'idle');
}

function setAgentText(step, text) {
  const el = document.getElementById(`s${step}AgentBubble`);
  if (el) {
    el.textContent = `"${text}"`;
    el.dataset.hasTranscript = '1'; // stop state-fallback from overwriting
  }
  chLogTranscript('ai', step, text);
}

function setUserText(step, text, options = {}) {
  const el = document.getElementById(`s${step}UserText`);
  if (el) {
    el.textContent = text ? `"${text}"` : 'Listening for your voice…';
    el.classList.toggle('has-content', !!text);
    if (text) el.dataset.hasTranscript = '1';
  }
  if (text && options.log !== false) chLogTranscript('user', step, text);
}

/* ============================================================
   Context card actions
   ============================================================ */
function showSymptomTags(symptoms) {
  const list = Array.isArray(symptoms) && symptoms.length ? symptoms : ['Symptoms reported'];

  // Show detected symptoms in the Step 2 context card.
  const card = document.getElementById('s2ContextCard');
  const wrap = document.getElementById('s2SymptomTags');
  if (wrap) {
    wrap.innerHTML = '';
    list.forEach((s, i) => {
      const tag = document.createElement('span');
      tag.className = 'vf-symptom-tag';
      tag.style.animationDelay = (i * 80) + 'ms';
      tag.textContent = s;
      wrap.appendChild(tag);
    });
  }
  if (card) card.style.display = '';

  // After symptoms are detected, update the persistent patient card on the left.
  updatePatientCardSymptoms(list);
}

function showVerifyingCard() {
  const v = document.getElementById('s1VerifyingCard');   // now on screen 1
  const p = document.getElementById('s1ProfileCard');
  if (v) v.style.display = '';
  if (p) p.style.display = 'none';
}

function showProfileCard() {
  const v = document.getElementById('s1VerifyingCard');
  const p = document.getElementById('s1ProfileCard');
  if (v) v.style.display = 'none';
  if (p) { p.style.display = ''; }
}

function highlightSlot(time) {
  const normalizedTime = String(time || '').toUpperCase().trim();
  if (selectedCalDay === 0) {
    const slotMinutes = slotTimeToMinutes(normalizedTime);
    const now = new Date();
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    if (slotMinutes !== null && slotMinutes <= nowMinutes) {
      console.warn('[BookingFlow] Ignoring past same-day slot from agent transcript:', normalizedTime);
      return;
    }
  }
  let matchedVisibleSlot = false;
  document.querySelectorAll('#bfScreen4 .vf-slot').forEach(el => {
    const isMatch = el.dataset.time === normalizedTime;
    el.classList.toggle('vf-slot--selected', isMatch);
    if (isMatch) matchedVisibleSlot = true;
  });
  if (!matchedVisibleSlot) return;
  // Build a human-readable date label from the selected calendar day
  const d = new Date();
  d.setDate(d.getDate() + (selectedCalDay ?? 1));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateLabel = (selectedCalDay === 0 ? 'Today' : selectedCalDay === 1 ? 'Tomorrow'
    : `${d.getDate()} ${months[d.getMonth()]}`);
  confirmedDateTime.time = time;
  confirmedDateTime.date = dateLabel + ' ' + d.getFullYear();
  const selEl2 = document.getElementById('s4SelectedText');
  if (selEl2) selEl2.textContent = `${offsetToDateLabel(selectedCalDay ?? 1)} · ${time} selected`;
}

/* ── Populate step 5 confirmation card with real booking data ─ */
function populateConfirmCard() {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };

  // Keep confirmation card synced with the latest spoken appointment details.
  captureAppointmentFromText(lastAgentTranscript || (document.getElementById('s5AgentBubble') || {}).textContent || '');

  // Doctor details — use the latest confirmed doctor, fallback to recommended doctor.
  const recName = document.querySelector('#s3DocList .doc-list-item.is-recommended .doc-list-name');
  const docName = confirmedDoctor.name || (recName && recName.textContent) || 'Dr. Anil Kumar';
  const docSpec = confirmedDoctor.spec || specialtyFromDoctorName(docName) || currentDoctorListSpecialty || 'General Physician';

  set('cDocName', docName);
  set('cDocSpec', docSpec);
  set('cDate',    confirmedDateTime.date || 'Today');
  set('cTime',    confirmedDateTime.time || '—');

  // Patient details from the verified profile card
  const patName = document.getElementById('s1PatientName');
  const patId   = document.getElementById('s1PatientId');
  if (patName && patId) {
    const el = document.getElementById('cPatient');
    if (el) el.textContent = `${patName.textContent} · ${patId.textContent.replace('Patient ID: ','')}`;
  }
}

function runDbAnimation() {
  const fill = document.getElementById('dbBarFill');
  const s1   = document.getElementById('dbStep1');
  const s2   = document.getElementById('dbStep2');
  const s3   = document.getElementById('dbStep3');
  if (fill) fill.style.width = '0%';

  const tick = (ms, fn) => { const t = setTimeout(fn, ms); stepTimers.push(t); return t; };
  tick(100,  () => { if (fill) fill.style.width = '35%'; });
  tick(1200, () => { if (s1) s1.style.opacity='0.6'; if (s2) s2.style.opacity='1'; if (fill) fill.style.width='65%'; });
  tick(2300, () => { if (s2) s2.style.opacity='0.6'; if (s3) s3.style.opacity='1'; if (fill) fill.style.width='92%'; });
  tick(3200, () => {
    if (fill) fill.style.width = '100%';
    [s1,s2,s3].forEach(el => {
      if (!el) return;
      const ico = el.querySelector('i');
      if (ico) { ico.classList.remove('ti-loader-2','spin'); ico.classList.add('ti-circle-check'); ico.style.color='#22c55e'; }
    });
  });
  tick(4000, () => {
    const db = document.getElementById('s5DbCard');
    const cn = document.getElementById('s5ConfirmCard');
    if (db) db.style.display = 'none';
    if (cn) cn.style.display = '';
    setScreenState(5, 'confirming');
    setAgentText(5, 'All done! Your appointment with Dr. Anil Kumar is confirmed for tomorrow at 10:30 AM. You\'ll receive reminders 24 hours, 2 hours, and 30 minutes before your appointment. Is there anything else I can help you with?');
    const row = document.getElementById('s5UserRow');
    if (row) row.style.visibility = 'visible';
    setUserText(5, 'Thank you!');
  });
}

/* ============================================================
   Timer helpers
   ============================================================ */
function clearAllTimers() {
  stepTimers.forEach(clearTimeout);
  stepTimers = [];
}

function after(ms, fn) {
  const t = setTimeout(() => { if (flowRunning) fn(); }, ms);
  stepTimers.push(t);
  return t;
}

/* ============================================================
   Demo auto-play
   ============================================================ */
function runDemoStep(step) {
  const script = DEMO_SCRIPT[step];
  if (!script) return;
  setScreenState(step, 'speaking');

  script.forEach(entry => {
    after(entry.delay, () => {
      switch (entry.who) {
        case 'agent':  setAgentText(step, entry.text); setScreenState(step, 'speaking'); break;
        case 'listen': setScreenState(step, 'listening'); break;
        case 'think':  setScreenState(step, 'thinking'); break;
        case 'user':   setUserText(step, entry.text); break;
        case 'action': entry.fn && entry.fn(); break;
        case 'next':
          if (step < 5) { goToStep(step + 1); runDemoStep(step + 1); }
          break;
      }
    });
  });
}

/* ============================================================
   LIVE MODE — Agora session for the booking flow
   ============================================================ */
function isLiveMode() {
  return !!(
    typeof CITYHEALTH_CONFIG !== 'undefined' &&
    CITYHEALTH_CONFIG.LIVE_AGENT &&
    typeof CityHealthAgora !== 'undefined'
  );
}

async function startBookingAgent() {

  if (!isLiveMode()) return false;

  // Create a fresh agent instance specifically for the booking flow
  const cfg = Object.assign({}, CITYHEALTH_CONFIG, {
    AGENT_SYSTEM_PROMPT: CITYHEALTH_CONFIG.BOOKING_SYSTEM_PROMPT,
    AGENT_GREETING:      CITYHEALTH_CONFIG.BOOKING_GREETING,
  });

  bookingAgent = new CityHealthAgora(cfg);
  liveTurnCount = 0;

  /* ── State → pill + fallback bubble text
     Debounced: UI only updates if state hasn't changed in 350ms.
     Prevents flicker when agent briefly pauses mid-sentence.
  ── */
  let _stateDebounce = null;
  let _lastState     = null;

  bookingAgent.on('state-change', ({ state }) => {
    if (!flowRunning) return;
    _lastState = state;

    clearTimeout(_stateDebounce);
    _stateDebounce = setTimeout(() => {
      if (!flowRunning || _lastState !== state) return;
      const map = { speaking:'speaking', listening:'listening', thinking:'thinking', idle:'listening' };
      setScreenState(currentStep, map[state] || 'speaking');

      // Only restart wave on meaningful state transitions
      const waveActive = state === 'speaking' || state === 'thinking';
      startWave(`s${currentStep}Wave`, waveActive);

      const agentEl = document.getElementById(`s${currentStep}AgentBubble`);
      const userEl  = document.getElementById(`s${currentStep}UserText`);
      if (agentEl && !agentEl.dataset.hasTranscript) {
        if (state === 'speaking')  agentEl.textContent = '"Agent is speaking…"';
        if (state === 'listening') agentEl.textContent = '"Listening for your response…"';
        if (state === 'thinking')  agentEl.textContent = '"Processing your request…"';
      }
      if (userEl && state === 'thinking' && !userEl.dataset.hasTranscript) {
        userEl.textContent = 'Processing your speech…';
      }
    }, 350);
  });

  /* ── UI signals from LLM _publish_message tool ─────────────
     LLM calls _publish_message(content: JSON) at exactly the
     right conversational moment; frontend just executes the action.
  ────────────────────────────────────────────────────────── */
  bookingAgent.on('ui-signal', (signal) => {
    if (!flowRunning) return;
    console.log('[BookingFlow] ui-signal:', signal);
    handleUISignal(signal);
  });

  /* ── Agent transcript → agent bubble on current screen ──
     Only update bubble text when the turn is FINAL (agent finished
     speaking that sentence). Non-final = LLM generating, TTS not
     played yet — showing it early makes the transcript feel ahead
     of the audio and confuses users.
  ── */
  bookingAgent.on('agent-transcript', ({ text, final }) => {
    if (!flowRunning) return;
    if (final) setAgentText(currentStep, text);
    lastAgentTranscript = text; // always store latest
    handleAgentTranscript(text);
    setScreenState(currentStep, 'speaking');
  });

  /* ── User transcript → user row on current screen ── */
  bookingAgent.on('user-transcript', ({ text, final }) => {
    if (!flowRunning) return;
    setUserText(currentStep, text, { log: !!final });
    if (!final) setScreenState(currentStep, 'thinking');
    if (final) {
      if (currentStep === 1) updatePatientDraftFromTranscript(text);
      onUserTurnComplete(text);
    }
  });

  /* ── Connection banner ── */
  bookingAgent.on('connected', () => {
    showBookingBanner('Voice agent connected ✓', 'success');
  });

  bookingAgent.on('error', ({ message }) => {
    console.error('[BookingFlow] Agora error:', message);
    // Only fall back to demo for fatal connection errors, not audio/subscribe issues
    const isFatal = message.includes('AGORA_APP_ID') ||
                    message.includes('Failed to connect') ||
                    message.includes('Connection lost');
    if (!isFatal) {
      showBookingBanner('⚠ ' + message, 'warn');
      return; // keep session alive
    }
    showBookingBanner('⚠ ' + message + ' — switching to demo mode');
    bookingAgent = null;
    // Fall back to demo
    clearAllTimers();
    liveTurnCount = 0;
    goToStep(1);
    runDemoStep(1);
  });

  /* ── Start the session ── */
  setScreenState(1, 'connecting');
  await bookingAgent.start({
    channelName:  CITYHEALTH_CONFIG.CHANNEL_PREFIX + 'booking-' + Date.now(),
    systemPrompt: CITYHEALTH_CONFIG.BOOKING_SYSTEM_PROMPT,
    greeting:     CITYHEALTH_CONFIG.BOOKING_GREETING,
  });

  return true;
}

async function stopBookingAgent() {
  if (bookingAgent) {
    await bookingAgent.stop().catch(() => {});
    bookingAgent = null;
  }
}

/* ============================================================
   Doctor roster — drives dynamic card population
   ============================================================ */
const DOCTOR_ROSTER = {
  'anil kumar':    { name:'Dr. Anil Kumar',   spec:'General Physician',   fee:'₹500',  av:'AK', reason:'Matched for fever, cold & body aches' },
  'sunita rao':    { name:'Dr. Sunita Rao',   spec:'ENT Specialist',      fee:'₹700',  av:'SR', reason:'Matched for throat, ear & sinus symptoms' },
  'meera iyer':    { name:'Dr. Meera Iyer',   spec:'Dermatologist',       fee:'₹800',  av:'MI', reason:'Matched for skin, hair & nail concerns' },
  'rajiv menon':   { name:'Dr. Rajiv Menon',  spec:'Orthopaedic Surgeon', fee:'₹900',  av:'RM', reason:'Matched for joint, bone & muscle pain' },
  'priya nair':    { name:'Dr. Priya Nair',   spec:'Gynaecologist',       fee:'₹900',  av:'PN', reason:'Matched for women\'s health concerns' },
  'suresh pillai': { name:'Dr. Suresh Pillai',spec:'Cardiologist',        fee:'₹1200', av:'SP', reason:'Matched for heart & BP concerns' },
};

let lastUserText       = '';
let lastAgentTranscript = ''; // last agent text, re-checked after step transitions
let patientDraft = { phone:'', mrn:'', name:'' };
let patientCardPopulated = false;
// stepLocked declared in state block above

/* ── Advance screens based on agent speaking turn count ──────
   Turn 1 = greeting (stay on step 1, user answers)
   Turn 2 = agent recommends doctor  → show step 2
   Turn 3 = agent asks for mobile    → show step 3
   Turn 4 = agent offers slots       → show step 4
   Turn 5 = agent confirms booking   → show step 5
   ─────────────────────────────────────────────────────────── */
/* ============================================================
   handleUISignal — dispatches _publish_message actions from LLM
   ============================================================ */
function handleUISignal(signal) {
  if (!signal || signal.type !== 'ui_signal') return;
  const { action } = signal;

  switch (action) {

    case 'phone_received':
      if (signal.phone || signal.value) patientDraft.phone = String(signal.phone || signal.value);
      showVerifyingCard();
      if (document.getElementById('s1VerifyText'))
        document.getElementById('s1VerifyText').textContent = 'Phone number received…';
      break;

    case 'mrn_received':
      if (signal.mrn || signal.value) patientDraft.mrn = String(signal.mrn || signal.value).toUpperCase();
      if (document.getElementById('s1VerifyText'))
        document.getElementById('s1VerifyText').textContent = 'MRN received — confirming name…';
      break;

    case 'identity_verified':
      if (signal.name) patientDraft.name = String(signal.name).trim();
      populatePatientCardFromConversation(signal.name);
      showVerifyingCard();
      after(800, () => showProfileCard());
      after(1800, () => {
        // Reset lastUserText so step 2→3 guard requires SYMPTOMS, not the name just spoken
        lastUserText = '';
        goToStep(2);
        setScreenState(2, 'listening');
        startWave('s2Wave', false);
      });
      break;

    case 'symptoms_collected':
      showSymptomTags(
        Array.isArray(signal.symptoms) && signal.symptoms.length
          ? signal.symptoms
          : extractSymptomKeywords(lastUserText)
      );
      break;

    case 'advance_step': {
      const target = Number(signal.step);
      // Step 1→2 MUST use identity_verified, not advance_step
      if (target === 2) {
        console.warn('[BookingFlow] advance_step step=2 blocked — use identity_verified');
        break;
      }
      // Step 2→3 requires user to have described symptoms first
      if (target === 3 && currentStep === 2 && !lastUserText.trim()) {
        console.warn('[BookingFlow] advance_step step=3 blocked — no symptoms collected yet');
        break;
      }
      // Allow refresh on step 3 (department change) without strict one-step rule
      const isRefresh = target === 3 && currentStep === 3;
      if (!isRefresh && (!target || target !== currentStep + 1 || target > 5)) {
        console.warn('[BookingFlow] advance_step blocked — current:', currentStep, 'target:', target);
        break;
      }
      after(600, async () => {
        if (target === 3) {
          const transcriptText = (document.getElementById('agentTranscript') || {}).textContent || '';
          const specialty = resolveStep3Specialty(signal, transcriptText, {
            allowTranscript: !isRefresh,
            allowSymptomFallback: !isRefresh,
          });
          populateDoctorList(specialty, 0);
          confirmedDoctor.spec = specialty;
          if (isRefresh) return; // just refresh list, don't re-advance
        }
        if (target === 4) {
          // Calendar and agent must use the same doctor-specific slot source.
          // If the UI signal did not include slots, fetch the selected doctor's
          // slots before rendering. This prevents the calendar from showing stale
          // default slots (for example 5:30 PM) while the agent is talking about
          // a different doctor such as Dr. Rajiv Menon.
          if (signal.name) confirmedDoctor.name = signal.name;
          const transcriptText = (document.getElementById('agentTranscript') || {}).textContent || '';
          const spokenDoctor = extractDoctorNameFromText(transcriptText);
          if (!confirmedDoctor.name && spokenDoctor) confirmedDoctor.name = spokenDoctor;
          if (!confirmedDoctor.spec) confirmedDoctor.spec = specialtyFromDoctorName(confirmedDoctor.name || spokenDoctor) || currentDoctorListSpecialty || 'General Physician';

          if (signal.morning_slots || signal.evening_slots) {
            currentDoctorSlots = {
              morning: signal.morning_slots || [],
              evening: signal.evening_slots || [],
            };
          } else {
            await fetchDoctorSlots(confirmedDoctor.name, confirmedDoctor.spec);
          }
          renderCalendar(currentDoctorSlots);
        }
        if (target === 5) {
          populateConfirmCard();
          goToStep(5);
          runDbAnimation();
          return;
        }
        goToStep(target);
        setScreenState(target, target === 2 ? 'listening' : 'speaking');
        startWave(`s${target}Wave`, target !== 2);
      });
      break;
    }

    /* ── Refresh doctor list in-place (specialty changed on step 3) ── */
    case 'update_doctors': {
      const transcriptText = (document.getElementById('agentTranscript') || {}).textContent || '';
      const specialty = resolveStep3Specialty(signal, transcriptText, {
        allowTranscript: currentStep !== 3,
        allowSymptomFallback: currentStep !== 3,
      });
      confirmedDoctor.spec = specialty;
      populateDoctorList(specialty, signal.recommended_index || 0);
      break;
    }

    /* ── Doctor confirmed — capture name + slots ─────────────── */
    case 'doctor_confirmed': {
      if (signal.name) confirmedDoctor.name = signal.name;
      else if (currentRecommendedDoctor?.name) confirmedDoctor.name = currentRecommendedDoctor.name;

      const selectedSpec = signal.name
        ? (specialtyFromDoctorName(signal.name) || normalizeSpecialtyFromText(signal.specialty) || normalizeSpecialtyFromText(signal.name))
        : (currentDoctorListSpecialty || confirmedDoctor.spec || normalizeSpecialtyFromText(signal.specialty));

      if (selectedSpec) {
        confirmedDoctor.spec = selectedSpec;

        // Keep the right-side department card synced with the selected doctor.
        // Example: selecting Dr. Rajiv Menon / Dr. Amit Bose must keep showing
        // Orthopaedic, even if the backend sends stale ENT context during the
        // follow-up "please proceed" turn.
        const deptEl = document.getElementById('s3DeptName');
        if (deptEl) deptEl.textContent = selectedSpec;
        populateDoctorList(selectedSpec, 0);
      }

      if (signal.fee) confirmedDoctor.fee = signal.fee;
      else if (!confirmedDoctor.fee && currentRecommendedDoctor?.fee) confirmedDoctor.fee = currentRecommendedDoctor.fee;
      // Capture slots from signal directly. If slots are not supplied, fetch the
      // selected doctor's real slots immediately so the schedule screen cannot
      // fall back to stale/default slots.
      if (signal.morning_slots || signal.evening_slots) {
        currentDoctorSlots = {
          morning: signal.morning_slots || [],
          evening: signal.evening_slots || [],
        };
      } else {
        fetchDoctorSlots(confirmedDoctor.name, confirmedDoctor.spec);
      }
      break;
    }

    case 'select_date': {
      // Support both numeric offset and day name (e.g. "saturday")
      let offset = Number(signal.offset);
      if (isNaN(offset) || signal.day) {
        offset = dayNameToOffset(signal.day || signal.offset || '');
      }
      selectCalendarDay(isNaN(offset) ? 0 : offset);
      break;
    }

    case 'highlight_slot':
      if (signal.time) highlightSlot(signal.time);
      break;

    default:
      console.warn('[BookingFlow] unknown ui-signal action:', action);
  }
}

/* ── Unlock stepLocked and immediately re-check the last transcript ──
   Fixes the race where a transcript arrived while stepLocked=true
   (during a step transition) and so the next-step keywords were missed.
─────────────────────────────────────────────────────────────────── */
function unlockAndRetry() {
  stepLocked = false;
  if (lastAgentTranscript && flowRunning) {
    handleAgentTranscript(lastAgentTranscript);
  }
}

/* advanceByAgentTurn — kept as DEMO fallback only (not used in live mode) */
function advanceByAgentTurn() {
  /* Uses stepSpeakCount (resets each step) so multi-exchange steps
     like Verify (3 sub-exchanges) don't trigger premature advances. */
  const threshold = STEP_ADVANCE_AT[currentStep];
  if (!threshold || stepSpeakCount < threshold) return;

  stepLocked = true;

  if (currentStep === 1) {
    after(1200, () => {
      stepSpeakCount = 0;
      goToStep(2); setScreenState(2,'listening'); startWave('s2Wave', false);
      unlockAndRetry();
    });

  } else if (currentStep === 2) {
    showSymptomTags(extractSymptomKeywords(lastUserText));
    after(800, () => {
      populateDoctorList(detectSpecialty(lastUserText), 0);
      stepSpeakCount = 0;
      goToStep(3); setScreenState(3,'speaking'); startWave('s3Wave', true);
      unlockAndRetry();
    });

  } else if (currentStep === 3) {
    after(900, () => {
      renderCalendar();
      stepSpeakCount = 0;
      goToStep(1); setScreenState(4,'speaking'); startWave('s4Wave', true);
      unlockAndRetry();
    });

  } else if (currentStep === 4) {
    after(1200, () => {
      stepSpeakCount = 0;
      goToStep(5); runDbAnimation();
      unlockAndRetry();
    });
  }
}

/* ── Populate patient profile card (screen 1) ─────────────── */
function populatePatientCard(p = {}) {
  const safeName = (p.name || patientDraft.name || lastUserText || 'Verified patient').trim();
  const initials = safeName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0,2).toUpperCase() || 'PT';
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('s1PatientAv',    initials);
  set('s1PatientName',  safeName);
  set('s1PatientId',    p.id ? `Patient ID: ${p.id}` : (patientDraft.mrn ? `MRN: ${patientDraft.mrn}` : 'Patient verified from conversation'));
  set('s1LastVisit',    p.lastVisit && p.lastDoctor ? `${p.lastVisit} · ${p.lastDoctor}` : '14 Mar 2026');
  set('s1TotalVisits',  Number.isFinite(Number(p.visits)) ? `${p.visits} consultation${Number(p.visits) !== 1 ? 's' : ''}` : '5 consultations');
  // Current symptoms should only appear after Step 2 captures symptoms.
  // After Verify, the patient card should show only Last visit and Total visits.
  const dx = document.getElementById('s1DiagnosisCard');
  if (dx) dx.style.display = 'none';
  patientCardPopulated = true;
}

function updatePatientCardSymptoms(symptoms) {
  const list = Array.isArray(symptoms) && symptoms.length ? symptoms : ['Symptoms reported'];
  const primary = list[0];
  const rest = list.slice(1).join(', ');

  const symptomEl = document.getElementById('s1Diagnosis');
  const detailEl = document.getElementById('s1Medication');
  const dx = document.getElementById('s1DiagnosisCard');

  if (symptomEl) symptomEl.textContent = primary;
  if (detailEl) detailEl.textContent = rest || primary;
  if (dx) dx.style.display = '';
}

function updatePatientDraftFromTranscript(text) {
  const value = (text || '').replace(/["“”]/g, '').trim();
  if (!value) return;
  const digits = value.replace(/\D/g, '');
  const mrn = value.match(/\bMRN[-\s]*\d+\b/i);
  if (digits.length >= 10 && !patientDraft.phone) {
    patientDraft.phone = digits.slice(-10);
  } else if (mrn && !patientDraft.mrn) {
    patientDraft.mrn = mrn[0].replace(/\s+/g, '').toUpperCase();
  } else if (!/\d{5,}/.test(value) && value.length >= 2) {
    patientDraft.name = value;
  }
}

function populatePatientCardFromConversation(name) {
  if (name) patientDraft.name = String(name).trim();
  if (!patientCardPopulated || name) populatePatientCard({ name: patientDraft.name });
}

/* ── Verify patient via API and populate card ─────────────── */
async function verifyPatient(phone, mrn, name) {
  try {
    const base = (typeof CITYHEALTH_CONFIG !== 'undefined' ? CITYHEALTH_CONFIG.SERVER_URL : '') || '';
    const res  = await fetch(`${base}/api/patients/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, mrn, name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.verified && data.patient) {
      populatePatientCard(data.patient);
      return data.patient;
    }
  } catch (e) { console.warn('[BookingFlow] patient verify error:', e.message); }
  return null;
}

/* ── Populate multi-doctor list (screen 3) ────────────────── */
let doctorListRequestSeq = 0;
let currentDoctorListSpecialty = '';
let currentRecommendedDoctor = null;

function resolveStep3Specialty(signal = {}, transcriptText = '', { allowTranscript = false, allowSymptomFallback = false } = {}) {
  // Prefer explicit doctor names because they uniquely identify the department.
  const doctorText = signal.name || signal.doctor || signal.doctor_name || signal.selected_doctor || '';
  const byDoctor = specialtyFromDoctorName(doctorText);
  if (byDoctor) return byDoctor;

  // Then trust explicit structured specialty/department fields.
  const byStructuredSpecialty = normalizeSpecialtyFromText(signal.specialty || signal.department || signal.dept || '');
  if (byStructuredSpecialty) return byStructuredSpecialty;

  // Some agents put doctor/specialty text in a generic message field.
  const genericText = signal.text || signal.message || signal.transcript || '';
  const byGenericDoctor = specialtyFromDoctorName(genericText);
  if (byGenericDoctor) return byGenericDoctor;
  const byGenericSpecialty = normalizeSpecialtyFromText(genericText);
  if (byGenericSpecialty) return byGenericSpecialty;

  // On step 3, do not let vague follow-up turns like "Please proceed" or
  // stale backend context reset the doctor list back to ENT. Keep the current
  // displayed department unless a new doctor/specialty is explicitly named.
  if (currentStep === 3 && currentDoctorListSpecialty) return currentDoctorListSpecialty;

  if (allowTranscript) {
    const byTranscriptDoctor = specialtyFromDoctorName(transcriptText);
    if (byTranscriptDoctor) return byTranscriptDoctor;
    const byTranscriptSpecialty = normalizeSpecialtyFromText(transcriptText);
    if (byTranscriptSpecialty) return byTranscriptSpecialty;
  }

  if (allowSymptomFallback) return detectSpecialty(lastUserText);
  return confirmedDoctor.spec || currentDoctorListSpecialty || 'General Physician';
}

function populateDoctorList(specialty, recommendedIdx = 0) {
  specialty = normalizeSpecialtyFromText(specialty) || specialty || 'General Physician';
  currentDoctorListSpecialty = specialty;

  // Update department header immediately.
  const deptEl = document.getElementById('s3DeptName');
  if (deptEl) deptEl.textContent = specialty;

  // Prevent a slower, older request (for example ENT) from overwriting the
  // currently selected doctor department (for example Dr. Rajiv Menon → Orthopaedic).
  const requestId = ++doctorListRequestSeq;

  const fallback = {
    'General Physician': [
      { name:'Dr. Anil Kumar', av:'AK', rating:'4.8', fee:'₹500', exp:'12 yrs' },
      { name:'Dr. Priya Sharma', av:'PS', rating:'4.6', fee:'₹450', exp:'8 yrs' },
      { name:'Dr. Rajan Das', av:'RD', rating:'4.7', fee:'₹500', exp:'15 yrs' },
    ],
    'ENT Specialist': [
      { name:'Dr. Sunita Rao', av:'SR', rating:'4.9', fee:'₹700', exp:'18 yrs' },
      { name:'Dr. Vikram Joshi', av:'VJ', rating:'4.5', fee:'₹650', exp:'10 yrs' },
      { name:'Dr. Nandini Pillai', av:'NP', rating:'4.7', fee:'₹700', exp:'14 yrs' },
    ],
    'Orthopaedic': [
      { name:'Dr. Rajiv Menon', av:'RM', rating:'4.9', fee:'₹900', exp:'20 yrs' },
      { name:'Dr. Amit Bose', av:'AB', rating:'4.6', fee:'₹850', exp:'12 yrs' },
      { name:'Dr. Kavya Rao', av:'KR', rating:'4.7', fee:'₹900', exp:'16 yrs' },
      { name:'Dr. Sunil Mathur', av:'SM', rating:'4.5', fee:'₹850', exp:'10 yrs' },
    ],
    'Dermatologist': [
      { name:'Dr. Meera Iyer', av:'MI', rating:'4.8', fee:'₹800', exp:'11 yrs' },
      { name:'Dr. Sanjay Kapoor', av:'SK', rating:'4.6', fee:'₹750', exp:'9 yrs' },
      { name:'Dr. Lakshmi Suresh', av:'LS', rating:'4.7', fee:'₹800', exp:'13 yrs' },
    ],
    'Cardiologist': [
      { name:'Dr. Suresh Pillai', av:'SP', rating:'4.9', fee:'₹1200', exp:'22 yrs' },
      { name:'Dr. Naresh Gupta', av:'NG', rating:'4.7', fee:'₹1100', exp:'18 yrs' },
      { name:'Dr. Vidya Krishnan', av:'VK', rating:'4.8', fee:'₹1200', exp:'15 yrs' },
    ],
    'Gynaecologist': [
      { name:'Dr. Priya Nair', av:'PN', rating:'4.9', fee:'₹900', exp:'14 yrs' },
      { name:'Dr. Rekha Sharma', av:'RS', rating:'4.7', fee:'₹850', exp:'12 yrs' },
      { name:'Dr. Anjali Verma', av:'AV', rating:'4.6', fee:'₹900', exp:'10 yrs' },
    ],
  };

  const base = (typeof CITYHEALTH_CONFIG !== 'undefined' ? CITYHEALTH_CONFIG.SERVER_URL : '') || '';
  fetch(`${base}/api/doctors?specialty=${encodeURIComponent(specialty)}`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('doctor fetch failed')))
    .then(data => {
      if (requestId !== doctorListRequestSeq) return;
      const doctors = Array.isArray(data.doctors) ? data.doctors : fallback[specialty] || [];
      renderDoctorList(doctors, recommendedIdx);
    })
    .catch(() => {
      if (requestId !== doctorListRequestSeq) return;
      renderDoctorList(fallback[specialty] || [], recommendedIdx);
    });
}

/* ── Fetch actual slots for confirmed doctor from server ──── */
async function fetchDoctorSlots(doctorName, specialty) {
  if (!doctorName && !specialty) return false;
  try {
    const base = (typeof CITYHEALTH_CONFIG !== 'undefined' ? CITYHEALTH_CONFIG.SERVER_URL : '') || '';
    const sp   = specialty || confirmedDoctor.spec || 'General Physician';
    const res  = await fetch(`${base}/api/doctors?specialty=${encodeURIComponent(sp)}`);
    if (!res.ok) return false;
    const data = await res.json();
    const doctors = data.doctors || [];
    const name = (doctorName || confirmedDoctor.name || '').toLowerCase();
    const nameWithoutTitle = name.replace(/^dr\.?\s*/i, '').trim();
    const lastToken = nameWithoutTitle.split(/\s+/).filter(Boolean).pop() || '';
    const doc = doctors.find(d => d.name.toLowerCase() === name)
             || doctors.find(d => d.name.toLowerCase().includes(nameWithoutTitle))
             || doctors.find(d => lastToken && d.name.toLowerCase().includes(lastToken))
             || doctors[0];
    if (doc && doc.slots) {
      confirmedDoctor.name = doc.name;
      confirmedDoctor.spec = sp;
      currentDoctorSlots = doc.slots;
      console.log('[BookingFlow] slots for', doc.name, ':', doc.slots);
      if (currentStep === 4) renderCalendar(currentDoctorSlots);
      return true;
    }
  } catch (e) { console.warn('[BookingFlow] fetchDoctorSlots error:', e.message); }
  return false;
}

function renderDoctorList(doctors, recommendedIdx) {
  const list = document.getElementById('s3DocList');
  if (!list) return;
  list.innerHTML = '';
  currentRecommendedDoctor = doctors[recommendedIdx] ? { ...doctors[recommendedIdx], spec: currentDoctorListSpecialty } : null;
  doctors.forEach((doc, i) => {
    const isRec = i === recommendedIdx;
    const item = document.createElement('div');
    item.className = `doc-list-item${isRec ? ' is-recommended' : ''}`;
    item.innerHTML = `
      <div class="doc-list-av">${doc.av}</div>
      <div class="doc-list-info">
        <div class="doc-list-name">${doc.name}</div>
        <div class="doc-list-meta">
          <span>⭐ ${doc.rating}</span>
          <span>${doc.fee}</span>
          <span>${doc.exp}</span>
        </div>
      </div>
      ${isRec ? '<span class="doc-rec-badge">✦ Recommended</span>' : ''}
    `;
    list.appendChild(item);
  });
}

/* ── Legacy single-card helper (kept for keyword-based path) ── */
function populateDoctorCard(doc) {
  populateDoctorList(doc.spec || 'General Physician', 0);
}

/* ── Calendar widget (screen 4) ──────────────────────────── */
let selectedCalDay = null;
let currentDoctorSlots = { morning: ['10:00 AM','10:30 AM','11:00 AM'], evening: ['5:00 PM','5:30 PM'] };

function renderCalendar(doctorSlots) {
  if (doctorSlots) currentDoctorSlots = doctorSlots;
  const wrap = document.getElementById('s4CalDays');
  const monthEl = document.getElementById('s4CalMonth');
  if (!wrap) return;

  wrap.innerHTML = '';
  const today = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (monthEl) monthEl.textContent = `${months[today.getMonth()]} ${today.getFullYear()}`;

  for (let i = 0; i <= 13; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const chip = document.createElement('div');
    chip.className = 'cal-day';
    chip.dataset.offset = i;
    chip.innerHTML = `
      <span class="cal-day-name">${i === 0 ? 'Today' : days[d.getDay()]}</span>
      <span class="cal-day-num">${d.getDate()}</span>
      <span class="cal-day-mon">${months[d.getMonth()]}</span>
    `;
    chip.addEventListener('click', () => selectCalendarDay(i));
    wrap.appendChild(chip);
  }
  // Auto-select today by default. Past slots for today are filtered by renderSlots().
  selectCalendarDay(0);
}

function selectCalendarDay(offset) {
  selectedCalDay = offset;
  // Update chip highlights and scroll selected chip into view
  document.querySelectorAll('.cal-day').forEach(c => {
    const isSelected = parseInt(c.dataset.offset) === offset;
    c.classList.toggle('is-selected', isSelected);
    if (isSelected) {
      // Scroll the chip into view within the horizontal strip
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
  // Render slots for this day
  renderSlots(currentDoctorSlots);
  // Store full date for confirmation card
  const dateLabel = offsetToDateLabel(offset);
  const d = new Date(); d.setDate(d.getDate() + offset);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  confirmedDateTime.date = `${dateLabel} ${d.getFullYear()}`;
  const selEl = document.getElementById('s4SelectedText');
  if (selEl) selEl.textContent = `${dateLabel} — choose a time`;
}

function slotTimeToMinutes(timeText) {
  const match = String(timeText || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'AM') {
    if (hours === 12) hours = 0;
  } else if (hours !== 12) {
    hours += 12;
  }

  return (hours * 60) + minutes;
}

function filterFutureSlotsForSelectedDay(times) {
  if (selectedCalDay !== 0) return times || [];

  const now = new Date();
  const nowMinutes = (now.getHours() * 60) + now.getMinutes();

  return (times || []).filter(timeText => {
    const slotMinutes = slotTimeToMinutes(timeText);
    // Keep unknown formats visible rather than accidentally hiding valid slots.
    return slotMinutes === null || slotMinutes > nowMinutes;
  });
}

function renderSlots(slots) {
  const renderRow = (id, times) => {
    const row = document.getElementById(id);
    if (!row) return;
    row.innerHTML = '';
    filterFutureSlotsForSelectedDay(times).forEach(t => {
      const el = document.createElement('div');
      el.className = 'vf-slot';
      el.dataset.time = t;
      el.textContent = t;
      row.appendChild(el);
    });
  };
  renderRow('s4MorningSlots', slots.morning);
  renderRow('s4EveningSlots', slots.evening);
}

/* ── updateSlotDate is now replaced by renderCalendar ────── */
function updateSlotDate() { renderCalendar(); }

/* ── Screen advancement driven by AGENT transcript keywords ── */

function normalizeSpecialtyFromText(text) {
  const lower = (text || '').toLowerCase();

  // IMPORTANT: return the exact keys used by the server DOCTOR_DB.
  // Returning display fragments such as "ENT" or "Cardiology" makes
  // /api/doctors?specialty=... miss the selected department and leaves the
  // right-side department card stuck on the previous value.
  if (lower.includes('orthopaedic') || lower.includes('orthopedic') || lower.includes('ortho')) return 'Orthopaedic';
  if (lower.includes('ent specialist') || lower.includes('ent') || lower.includes('ear') || lower.includes('nose') || lower.includes('throat')) return 'ENT Specialist';
  if (lower.includes('cardiology') || lower.includes('cardiologist') || lower.includes('heart')) return 'Cardiologist';
  if (lower.includes('dermatology') || lower.includes('dermatologist') || lower.includes('skin')) return 'Dermatologist';
  if (lower.includes('gynaecology') || lower.includes('gynecology') || lower.includes('gynaecologist') || lower.includes('gynecologist')) return 'Gynaecologist';
  if (lower.includes('general physician') || lower.includes('general medicine') || lower.includes('physician')) return 'General Physician';
  return '';
}

function specialtyFromDoctorName(name) {
  const lower = (name || '').toLowerCase();
  const doctorMap = {
    'anil kumar':'General Physician',
    'priya sharma':'General Physician',
    'rajan das':'General Physician',
    'sunita rao':'ENT Specialist',
    'vikram joshi':'ENT Specialist',
    'nandini pillai':'ENT Specialist',
    'meera iyer':'Dermatologist',
    'sanjay kapoor':'Dermatologist',
    'lakshmi suresh':'Dermatologist',
    'rajiv menon':'Orthopaedic',
    'amit bose':'Orthopaedic',
    'kavya rao':'Orthopaedic',
    'sunil mathur':'Orthopaedic',
    'priya nair':'Gynaecologist',
    'rekha sharma':'Gynaecologist',
    'anjali verma':'Gynaecologist',
    'suresh pillai':'Cardiologist',
    'naresh gupta':'Cardiologist',
    'vidya krishnan':'Cardiologist',
  };
  return Object.keys(doctorMap).find(k => lower.includes(k)) ? doctorMap[Object.keys(doctorMap).find(k => lower.includes(k))] : '';
}

function extractDoctorNameFromText(text) {
  const lower = (text || '').toLowerCase();
  const doctorNames = [
    'Dr. Anil Kumar', 'Dr. Priya Sharma', 'Dr. Rajan Das',
    'Dr. Sunita Rao', 'Dr. Vikram Joshi', 'Dr. Nandini Pillai',
    'Dr. Meera Iyer', 'Dr. Sanjay Kapoor', 'Dr. Lakshmi Suresh',
    'Dr. Rajiv Menon', 'Dr. Amit Bose', 'Dr. Kavya Rao', 'Dr. Sunil Mathur',
    'Dr. Priya Nair', 'Dr. Rekha Sharma', 'Dr. Anjali Verma',
    'Dr. Suresh Pillai', 'Dr. Naresh Gupta', 'Dr. Vidya Krishnan'
  ];
  return doctorNames.find(name => lower.includes(name.replace(/^Dr\.\s*/i, '').toLowerCase())) || '';
}

function handleAgentTranscript(agentText) {
  if (!flowRunning) return;
  captureAppointmentFromText(agentText);
  const lower = agentText.toLowerCase();
  const spokenSpecialty = normalizeSpecialtyFromText(agentText);
  if (spokenSpecialty && currentStep === 3) {
    const spokenDoctorSpecialty = specialtyFromDoctorName(agentText);
    const explicitDepartmentChange = /(recommend|suggest|department|specialist|doctor)/i.test(agentText);
    // Ignore stale specialty words during vague follow-up turns after the doctor
    // list is already on screen. Only change departments when a doctor name or a
    // clear recommendation/department change is spoken.
    if (spokenDoctorSpecialty || explicitDepartmentChange || !currentDoctorListSpecialty) {
      const nextSpecialty = spokenDoctorSpecialty || spokenSpecialty;
      populateDoctorList(nextSpecialty, 0);
      confirmedDoctor.spec = nextSpecialty;
    }
  }


  // On schedule screen: detect day name and update calendar, highlight confirmed slot
  if (currentStep === 4) {
    // Calendar day — detect from agent speech (e.g. "slots on Thursday", "for Sunday")
    const DAY_PATTERN = /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
    const dayMatch = agentText.match(DAY_PATTERN);
    if (dayMatch) {
      const offset = dayNameToOffset(dayMatch[1].toLowerCase());
      selectCalendarDay(offset);
    }
    // Slot highlight
    const slotMatch = agentText.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i);
    if (slotMatch) highlightSlot(slotMatch[1].toUpperCase().trim());
  }

  /* ── Transcript-based fallbacks — fire when _publish_message misses ──
     Primary path = ui-signal. stepLocked prevents double-firing.    */
  if (stepLocked) return;

  // Step 2 → 3: Agent recommends a doctor — only after user has described symptoms
  if (currentStep === 2 && lastUserText.trim() &&
      (lower.includes('recommend') ||
       lower.includes('highest-rated') ||
       lower.includes('department') && lower.includes('dr.') ||
       lower.includes('cardiology') || lower.includes('general physician') ||
       lower.includes('ent') || lower.includes('dermatolog') ||
       lower.includes('orthopaed') || lower.includes('gynaecolog') ||
       lower.includes('specialist') && lower.includes('₹'))) {
    stepLocked = true;
    // Detect specialty from the agent text
    const specialty = specialtyFromDoctorName(agentText) || normalizeSpecialtyFromText(agentText) || detectSpecialty(agentText);
    showSymptomTags(extractSymptomKeywords(lastUserText));
    after(900, () => {
      populateDoctorList(specialty, 0);
      confirmedDoctor.spec = specialty;
      goToStep(3);
      setScreenState(3, 'speaking');
      startWave('s3Wave', true);
      stepLocked = false;
    });
    return;
  }

  // Step 3 → 4: Agent asks about scheduling / appointment date
  if (currentStep === 3 &&
      (lower.includes('appointment today') ||
       lower.includes('prefer a future date') ||
       lower.includes('looking for today') ||
       lower.includes('which date') ||
       lower.includes('what date') ||
       lower.includes('morning slots') ||
       lower.includes('evening slots') ||
       (lower.includes('slot') && lower.includes('available')))) {
    stepLocked = true;
    after(800, async () => {
      const spokenDoctor = extractDoctorNameFromText(agentText);
      if (spokenDoctor) {
        confirmedDoctor.name = spokenDoctor;
        confirmedDoctor.spec = specialtyFromDoctorName(spokenDoctor) || confirmedDoctor.spec || currentDoctorListSpecialty;
      }
      await fetchDoctorSlots(confirmedDoctor.name || spokenDoctor, confirmedDoctor.spec || currentDoctorListSpecialty);
      renderCalendar(currentDoctorSlots);
      goToStep(4); setScreenState(4,'speaking'); startWave('s4Wave', true);
      unlockAndRetry();
    });
    return;
  }

  // Step 3 or 4 → 5: Agent confirms the booking
  if ((currentStep === 3 || currentStep === 4) &&
      (lower.includes('appointment is confirmed') ||
       lower.includes('your appointment') && lower.includes('confirmed') ||
       lower.includes('i\'m confirming') ||
       lower.includes('sms and whatsapp') ||
       lower.includes('reminders 24 hours'))) {
    stepLocked = true;
    const slotM = agentText.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i);
    if (slotM) confirmedDateTime.time = slotM[1].toUpperCase().trim();
    const dateM = agentText.match(/\b(june|july|aug|sep|oct|nov|dec|jan|feb|mar|apr|may)\s+(\d{1,2})\b/i);
    if (dateM) {
      const offset = dayNameToOffset(`${dateM[1]} ${dateM[2]}`);
      confirmedDateTime.date = offsetToDateLabel(offset) + ' ' + new Date().getFullYear();
    }
    after(1000, () => {
      populateConfirmCard(); goToStep(5); runDbAnimation();
      unlockAndRetry();
    });
  }
}

/* ── Also advance on USER transcript (backup path) ─────────── */
function onUserTurnComplete(userText) {
  lastUserText = userText;
  liveTurnCount++;
}

/* ── Day name or specific date → calendar offset from today ── */
function dayNameToOffset(dayOrStr) {
  const s = (dayOrStr || '').toLowerCase().trim();
  if (!s) return 1;

  // Named shortcuts
  if (s === 'today')    return 0;
  if (s === 'tomorrow') return 1;

  // Specific date like "june 11", "11 june", "jun 11"
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const dateMatch = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)
                 || s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})/i);
  if (dateMatch) {
    let day, mon;
    if (/^\d/.test(dateMatch[1])) { day = parseInt(dateMatch[1]); mon = dateMatch[2]; }
    else                          { mon = dateMatch[1]; day = parseInt(dateMatch[2]); }
    const monthIdx = months.findIndex(m => mon.toLowerCase().startsWith(m));
    if (monthIdx !== -1) {
      const today = new Date(); today.setHours(0,0,0,0);
      const year  = today.getFullYear();
      const target = new Date(year, monthIdx, day);
      if (target < today) target.setFullYear(year + 1); // next year if past
      const diff = Math.round((target - today) / 86400000);
      return Math.max(0, diff);
    }
  }

  // Day name — find next occurrence
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const targetDay = dayNames.findIndex(n => s.includes(n));
  if (targetDay === -1) return 1;

  const todayDay = new Date().getDay();
  let offset = targetDay - todayDay;
  if (offset <= 0) offset += 7;
  return offset;
}

/* ── Offset → human-readable date label ─────────────────── */
function offsetToDateLabel(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (offset === 0) return `Today, ${d.getDate()} ${months[d.getMonth()]}`;
  if (offset === 1) return `Tomorrow, ${d.getDate()} ${months[d.getMonth()]}`;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

/* ── Track confirmed booking details for step 5 card ─────── */
let confirmedDoctor   = { name:'', spec:'', fee:'' };
let confirmedDateTime = { date:'', time:'' };

function normalizeAppointmentTime(text) {
  const raw = String(text || '').toLowerCase();

  // Numeric times: "9:30 AM", "9 AM"
  const direct = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (direct) {
    const hh = String(parseInt(direct[1], 10));
    const mm = direct[2] || '00';
    return `${hh}:${mm.padStart(2, '0')} ${direct[3].toUpperCase()}`;
  }

  const wordMap = {
    one:1, two:2, three:3, four:4, five:5, six:6,
    seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12
  };
  const minuteMap = {
    zero:0, oh:0, o:0, fifteen:15, quarter:15, thirty:30, half:30, fortyfive:45, 'forty-five':45,
    ten:10, twenty:20, 'twenty-five':25, twentyfive:25, 'twenty five':25,
    forty:40, fifty:50
  };

  // Word times: "nine thirty AM", "nine-thirty in the morning", "nine o'clock AM".
  // This fixes the confirmation card showing 9:00 AM when the transcript says 9:30 AM.
  const word = raw.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[-\s]+(fifteen|quarter|thirty|half|forty[-\s]?five|twenty[-\s]?five|twenty|ten|forty|fifty))?\s*(?:o'?clock)?(?:\s*(am|pm|a\.m\.|p\.m\.))?\b/);
  if (!word) return '';

  let hour = wordMap[word[1]];
  let minuteWord = (word[2] || '').replace(/\s+/g, '-');
  let minutes = 0;
  if (minuteWord) {
    const compact = minuteWord.replace(/-/g, '');
    minutes = minuteMap[minuteWord] ?? minuteMap[compact] ?? 0;
  }

  let period = (word[3] || '').replace(/\./g, '').toUpperCase();
  if (!period) {
    if (/\b(morning|am|a\.m\.)\b/.test(raw)) period = 'AM';
    else if (/\b(afternoon|evening|night|pm|p\.m\.)\b/.test(raw)) period = 'PM';
    else period = hour >= 8 && hour <= 11 ? 'AM' : 'PM';
  }
  return `${hour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function captureAppointmentFromText(text) {
  const t = String(text || '');
  const doctor = extractDoctorNameFromText(t);
  if (doctor) {
    confirmedDoctor.name = doctor;
    confirmedDoctor.spec = specialtyFromDoctorName(doctor) || confirmedDoctor.spec || currentDoctorListSpecialty || normalizeSpecialtyFromText(t);
  }
  const spec = normalizeSpecialtyFromText(t);
  if (spec) confirmedDoctor.spec = spec;
  const time = normalizeAppointmentTime(t);
  if (time) confirmedDateTime.time = time;
  const lower = t.toLowerCase();
  if (lower.includes('today')) {
    confirmedDateTime.date = offsetToDateLabel(0) + ' ' + new Date().getFullYear();
  } else if (lower.includes('tomorrow')) {
    confirmedDateTime.date = offsetToDateLabel(1) + ' ' + new Date().getFullYear();
  } else {
    const dayMatch = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (dayMatch) confirmedDateTime.date = offsetToDateLabel(dayNameToOffset(dayMatch[1])) + ' ' + new Date().getFullYear();
  }
}


/* ── Map symptoms to specialty ───────────────────────────── */
function detectSpecialty(text) {
  const normalized = normalizeSpecialtyFromText(arguments[0]);
  if (normalized) return normalized;

  const t = (text || '').toLowerCase();
  // Check explicit department name mentions first (from agent transcripts)
  if (t.includes('cardiology') || t.includes('cardiologist'))        return 'Cardiologist';
  if (t.includes('dermatology') || t.includes('dermatologist'))      return 'Dermatologist';
  if (t.includes('ent') || t.includes('ear, nose'))                  return 'ENT Specialist';
  if (t.includes('orthopaed') || t.includes('orthopedic'))           return 'Orthopaedic';
  if (t.includes('gynaecolog') || t.includes('gynecolog'))           return 'Gynaecologist';
  if (t.includes('general physician') || t.includes('general medicine')) return 'General Physician';
  // Fall back to symptom matching
  if (t.match(/ear|throat|sinus|nasal|hoars|tonsil/))               return 'ENT Specialist';
  if (t.match(/skin|rash|itch|acne|eczema|hair\sloss/))             return 'Dermatologist';
  if (t.match(/joint|knee|back|shoulder|bone|fracture|arthritis/))  return 'Orthopaedic';
  if (t.match(/period|menstr|pcos|pelvic|pregnancy|women/))         return 'Gynaecologist';
  if (t.match(/chest|heart|palpitat|blood pressure|breathless/))    return 'Cardiologist';
  return 'General Physician';
}

/* ── Simple symptom keyword extractor ───────────────────── */
function extractSymptomKeywords(userText) {
  const keywords = ['fever','sore throat','body ache','body pain','headache','cough','fatigue',
                    'chest pain','ear pain','runny nose','nausea','vomiting'];
  const found = keywords.filter(k => userText.toLowerCase().includes(k));
  if (!found.length) return ['Symptoms reported'];
  return found.map(w => w.charAt(0).toUpperCase() + w.slice(1));
}

/* ── Booking-flow banner ─────────────────────────────────── */
function showBookingBanner(msg, type = 'error') {
  const main = document.querySelector('.bf-main');
  if (!main) return;
  let banner = document.getElementById('bookingBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bookingBanner';
    banner.style.cssText =
      'position:sticky;top:0;z-index:50;padding:8px 20px;font-size:12px;font-weight:600;text-align:center;';
    main.prepend(banner);
  }
  banner.textContent      = msg;
  banner.style.display    = 'block';
  banner.style.background = type === 'error' ? '#fee2e2' : type === 'success' ? '#dcfce7' : '#fef3c7';
  banner.style.color      = type === 'error' ? '#dc2626' : type === 'success' ? '#166534'  : '#92400e';
  if (type !== 'error') setTimeout(() => { if (banner) banner.style.display = 'none'; }, 3000);
}

/* ============================================================
   Mic button — live: toggle mute  /  demo: fast-forward
   ============================================================ */
function onStepMicClick(step) {
  const agent = bookingAgent;

  if (agent && agent.isConnected) {
    const muted = agent.isMicMuted;
    agent.setMicMuted(!muted);
    const btn  = document.getElementById(`s${step}MicBtn`);
    const hint = document.getElementById(`s${step}MicHint`);
    if (btn)  btn.classList.toggle('is-muted', !muted);
    if (hint) hint.textContent = muted ? 'Listening — speak now' : 'Mic muted — tap to unmute';
    return;
  }

  // Demo fast-forward on listening state
  const pill = document.getElementById(`s${step}Pill`);
  if (!pill || !pill.classList.contains('is-listening')) return;
  clearAllTimers();
  let t = 0;
  const rest = (DEMO_SCRIPT[step] || []).filter(e =>
    ['user','think','action','agent','next'].includes(e.who)
  );
  rest.forEach(entry => {
    after(t, () => {
      switch (entry.who) {
        case 'user':   setUserText(step, entry.text); break;
        case 'think':  setScreenState(step, 'thinking'); break;
        case 'action': entry.fn && entry.fn(); break;
        case 'agent':  setAgentText(step, entry.text); setScreenState(step, 'speaking'); break;
        case 'next':
          if (step < 5) { goToStep(step + 1); runDemoStep(step + 1); }
          break;
      }
    });
    t += 700;
  });
}

/* ============================================================
   Open / close overlay
   ============================================================ */
async function openBookingFlow() {
  const overlay = document.getElementById('bookingOverlay');
  if (!overlay) return;

  flowRunning        = true;
  liveTurnCount      = 0;
  agentSpeakCount    = 0;
  stepSpeakCount     = 0;
  stepLocked         = false;
  lastUserText       = '';
  listeningStartTime = Date.now();
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  // Reset all screens to clean state
  resetBookingScreens();
  goToStep(1);

  if (isLiveMode()) {
    setScreenState(1, 'speaking');
    setAgentText(1, 'Connecting to voice agent…');
    const started = await startBookingAgent();
    if (!started) {
      // Fallback to demo
      runDemoStep(1);
    }
  } else {
    runDemoStep(1);
  }
}

async function closeBookingFlow() {
  flowRunning = false;
  clearAllTimers();
  stopAllWaves();
  liveTurnCount = 0;

  await stopBookingAgent();

  const overlay = document.getElementById('bookingOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function resetBookingScreens() {
  patientDraft = { phone:'', mrn:'', name:'' };
  patientCardPopulated = false;
  confirmedDoctor = { name:'', spec:'', fee:'' };
  currentDoctorListSpecialty = '';
  currentRecommendedDoctor = null;

  window.CityHealthTranscriptHistory = [];
  window.dispatchEvent(new CustomEvent('cityhealth-transcript-history-updated'));
  // Clear transcript flags and user texts
  [1,2,3,4,5].forEach(s => {
    setUserText(s, null, { log: false });
    const ab = document.getElementById(`s${s}AgentBubble`);
    const ub = document.getElementById(`s${s}UserText`);
    if (ab) { delete ab.dataset.hasTranscript; }
    if (ub) { delete ub.dataset.hasTranscript; }
  });

  // Hide context cards
  const s1c = document.getElementById('s1ContextCard');
  if (s1c) s1c.style.display = 'none';

  const s3v = document.getElementById('s1VerifyingCard');
  const s3p = document.getElementById('s1ProfileCard');
  if (s3v) s3v.style.display = 'none';
  if (s3p) s3p.style.display = 'none';

  // Reset DB animation
  const fill = document.getElementById('dbBarFill');
  if (fill) fill.style.width = '0%';
  ['dbStep1','dbStep2','dbStep3'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = i === 0 ? '1' : '0.3';
    const ico = el.querySelector('i');
    if (ico) { ico.className = 'ti ti-loader-2 spin'; ico.style.color = ''; }
  });

  const db = document.getElementById('s5DbCard');
  const cn = document.getElementById('s5ConfirmCard');
  if (db) db.style.display = '';
  if (cn) cn.style.display = 'none';

  const s5row = document.getElementById('s5UserRow');
  if (s5row) s5row.style.visibility = 'hidden';

  // Reset slot highlight
  highlightSlot('10:30 AM');
}

/* ============================================================
   DOM ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* Open triggers */
  ['navBookBtn','heroFindBtn','ctaFindBtn','ctaBookBtn','widgetBookBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openBookingFlow);
  });
  document.querySelectorAll('[data-open-booking]').forEach(el =>
    el.addEventListener('click', openBookingFlow)
  );

  /* Close */
  document.getElementById('bfClose')?.addEventListener('click', closeBookingFlow);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const ov = document.getElementById('bookingOverlay');
      if (ov && ov.classList.contains('is-open')) closeBookingFlow();
    }
  });

  /* Done / Back to Home */
  document.getElementById('bfDoneBtn')?.addEventListener('click', closeBookingFlow);

  /* Per-screen mic buttons */
  [1,2,3,4,5].forEach(s => {
    document.getElementById(`s${s}MicBtn`)?.addEventListener('click', () => onStepMicClick(s));
  });
});
