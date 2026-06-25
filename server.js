/**
 * CityHealth — Token + Agent Proxy Server
 * server.js
 *
 * Endpoints:
 *   GET  /api/token                → generates an Agora RTC token
 *   POST /api/agent/start          → starts an Agora Conversational AI agent
 *   POST /api/agent/stop           → stops a running agent
 *   GET  /api/health               → health check
 *
 * Setup:
 *   cp .env.example .env           ← fill in your credentials
 *   npm install
 *   node server.js
 *
 * The server also serves the cityhealth-portal folder as static files,
 * so opening http://localhost:3000 shows the full app.
 */

'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fetch    = require('node-fetch');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

/* ============================================================
   Environment variables
   ============================================================ */
const {
  AGORA_APP_ID,
  AGORA_APP_CERTIFICATE,
  AGORA_CUSTOMER_ID,        // REST API credentials (Agora Console → RESTful API)
  AGORA_CUSTOMER_SECRET,
  OPENAI_API_KEY,
  PORT = 3000,
  NODE_ENV = 'development',
} = process.env;

/* Validate required vars */
const REQUIRED = ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE', 'AGORA_CUSTOMER_ID', 'AGORA_CUSTOMER_SECRET', 'OPENAI_API_KEY'];
REQUIRED.forEach(k => {
  if (!process.env[k]) {
    console.error(`[server] ⚠️  Missing env var: ${k}  — set it in .env`);
  }
});

/* ============================================================
   Patient database  (10 patients for demo)
   ============================================================ */
const PATIENT_DB = [
  { id:'CH-2024-00847', name:'Rahul Kumar',    phone:'9876543210', mrn:'MRN001', lastVisit:'12 Jan 2026', lastDoctor:'Dr. Mehta',         diagnosis:'Seasonal Rhinitis',       medication:'Cetirizine 10mg',       visits:3  },
  { id:'CH-2024-01023', name:'Priya Singh',    phone:'9123456789', mrn:'MRN002', lastVisit:'3 Mar 2026',  lastDoctor:'Dr. Sunita Rao',     diagnosis:'Sinusitis',               medication:'Amoxicillin 500mg',     visits:5  },
  { id:'CH-2024-01156', name:'Arjun Mehta',    phone:'9234567890', mrn:'MRN003', lastVisit:'28 Feb 2026', lastDoctor:'Dr. Anil Kumar',     diagnosis:'Viral Fever',             medication:'Paracetamol 500mg',     visits:2  },
  { id:'CH-2024-01289', name:'Sunita Patel',   phone:'9345678901', mrn:'MRN004', lastVisit:'15 Apr 2026', lastDoctor:'Dr. Rajiv Menon',    diagnosis:'Knee Osteoarthritis',     medication:'Ibuprofen 400mg',       visits:7  },
  { id:'CH-2024-01412', name:'Vikram Nair',    phone:'9456789012', mrn:'MRN005', lastVisit:'20 May 2026', lastDoctor:'Dr. Suresh Pillai',  diagnosis:'Hypertension',            medication:'Amlodipine 5mg',        visits:12 },
  { id:'CH-2024-01535', name:'Meena Iyer',     phone:'9567890123', mrn:'MRN006', lastVisit:'5 Jan 2026',  lastDoctor:'Dr. Meera Iyer',     diagnosis:'Eczema',                  medication:'Hydrocortisone cream',  visits:4  },
  { id:'CH-2024-01658', name:'Rohan Gupta',    phone:'9678901234', mrn:'MRN007', lastVisit:'22 Apr 2026', lastDoctor:'Dr. Priya Nair',     diagnosis:'Hormonal Imbalance',      medication:'Vitamin D 60K IU',     visits:6  },
  { id:'CH-2024-01781', name:'Kavitha Reddy',  phone:'9789012345', mrn:'MRN008', lastVisit:'10 May 2026', lastDoctor:'Dr. Sunita Rao',     diagnosis:'Tonsillitis',             medication:'Azithromycin 250mg',    visits:8  },
  { id:'CH-2024-01904', name:'Suresh Babu',    phone:'9890123456', mrn:'MRN009', lastVisit:'1 Feb 2026',  lastDoctor:'Dr. Anil Kumar',     diagnosis:'Influenza',               medication:'Oseltamivir 75mg',      visits:1  },
  { id:'CH-2024-02027', name:'Anita Desai',    phone:'9901234567', mrn:'MRN010', lastVisit:'18 Mar 2026', lastDoctor:'Dr. Rajiv Menon',    diagnosis:'Lumbar Spondylosis',      medication:'Diclofenac 50mg',       visits:9  },
];

/* ============================================================
   Doctor database  (3–4 per specialty)
   ============================================================ */
const DOCTOR_DB = {
  'General Physician': [
    { name:'Dr. Anil Kumar',   av:'AK', rating:'4.8', fee:'₹500',  exp:'12 yrs', slots:{ morning:['9:00 AM','9:30 AM','10:00 AM','10:30 AM'], evening:['5:00 PM','5:30 PM'] } },
    { name:'Dr. Priya Sharma', av:'PS', rating:'4.6', fee:'₹450',  exp:'8 yrs',  slots:{ morning:['8:30 AM','9:00 AM','11:00 AM'],           evening:['4:30 PM','5:00 PM'] } },
    { name:'Dr. Rajan Das',    av:'RD', rating:'4.7', fee:'₹500',  exp:'15 yrs', slots:{ morning:['10:30 AM','11:00 AM','11:30 AM'],         evening:['6:00 PM','6:30 PM'] } },
  ],
  'ENT Specialist': [
    { name:'Dr. Sunita Rao',     av:'SR', rating:'4.9', fee:'₹700', exp:'18 yrs', slots:{ morning:['9:00 AM','9:30 AM','10:00 AM'],           evening:['4:00 PM','4:30 PM'] } },
    { name:'Dr. Vikram Joshi',   av:'VJ', rating:'4.5', fee:'₹650', exp:'10 yrs', slots:{ morning:['10:00 AM','10:30 AM','11:00 AM'],         evening:['5:00 PM','5:30 PM'] } },
    { name:'Dr. Nandini Pillai', av:'NP', rating:'4.7', fee:'₹700', exp:'14 yrs', slots:{ morning:['8:00 AM','8:30 AM','9:00 AM'],            evening:['3:30 PM','4:00 PM'] } },
  ],
  'Dermatologist': [
    { name:'Dr. Meera Iyer',      av:'MI', rating:'4.8', fee:'₹800', exp:'11 yrs', slots:{ morning:['11:00 AM','11:30 AM','12:00 PM'],        evening:['3:00 PM','3:30 PM'] } },
    { name:'Dr. Sanjay Kapoor',   av:'SK', rating:'4.6', fee:'₹750', exp:'9 yrs',  slots:{ morning:['9:30 AM','10:00 AM'],                    evening:['5:30 PM','6:00 PM'] } },
    { name:'Dr. Lakshmi Suresh',  av:'LS', rating:'4.7', fee:'₹800', exp:'13 yrs', slots:{ morning:['10:00 AM','10:30 AM','11:00 AM'],        evening:['4:00 PM','4:30 PM'] } },
  ],
  'Orthopaedic': [
    { name:'Dr. Rajiv Menon',    av:'RM', rating:'4.9', fee:'₹900',  exp:'20 yrs', slots:{ morning:['9:00 AM','9:30 AM'],                    evening:['2:00 PM','2:30 PM','3:00 PM'] } },
    { name:'Dr. Amit Bose',      av:'AB', rating:'4.6', fee:'₹850',  exp:'12 yrs', slots:{ morning:['10:00 AM','10:30 AM','11:00 AM'],       evening:['4:00 PM','4:30 PM'] } },
    { name:'Dr. Kavya Rao',      av:'KR', rating:'4.7', fee:'₹900',  exp:'16 yrs', slots:{ morning:['8:30 AM','9:00 AM','9:30 AM'],          evening:['5:00 PM','5:30 PM'] } },
    { name:'Dr. Sunil Mathur',   av:'SM', rating:'4.5', fee:'₹850',  exp:'10 yrs', slots:{ morning:['11:00 AM','11:30 AM'],                  evening:['3:30 PM','4:00 PM'] } },
  ],
  'Gynaecologist': [
    { name:'Dr. Priya Nair',    av:'PN', rating:'4.9', fee:'₹900', exp:'14 yrs', slots:{ morning:['10:00 AM','10:30 AM','11:00 AM'],       evening:['4:00 PM','4:30 PM'] } },
    { name:'Dr. Rekha Sharma',  av:'RS', rating:'4.7', fee:'₹850', exp:'12 yrs', slots:{ morning:['9:00 AM','9:30 AM'],                   evening:['5:00 PM','5:30 PM'] } },
    { name:'Dr. Anjali Verma',  av:'AV', rating:'4.6', fee:'₹900', exp:'10 yrs', slots:{ morning:['11:00 AM','11:30 AM'],                 evening:['3:00 PM','3:30 PM'] } },
  ],
  'Cardiologist': [
    { name:'Dr. Suresh Pillai',  av:'SP', rating:'4.9', fee:'₹1200', exp:'22 yrs', slots:{ morning:['9:00 AM','9:30 AM','10:00 AM'],      evening:['5:00 PM','5:30 PM'] } },
    { name:'Dr. Naresh Gupta',   av:'NG', rating:'4.7', fee:'₹1100', exp:'18 yrs', slots:{ morning:['10:00 AM','10:30 AM'],              evening:['4:30 PM','5:00 PM'] } },
    { name:'Dr. Vidya Krishnan', av:'VK', rating:'4.8', fee:'₹1200', exp:'15 yrs', slots:{ morning:['11:00 AM','11:30 AM'],              evening:['3:30 PM','4:00 PM'] } },
  ],
};

function slotTimeToMinutesForServer(timeText) {
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
  return hours * 60 + minutes;
}

function buildTodayAvailabilityContext(clientNow, clientLocalHour, clientLocalMinute) {
  let nowMinutes = null;

  // Use the browser's local clock components. Do not derive local appointment
  // availability from an ISO timestamp on the server because the server may run
  // in UTC while the patient is in IST/SGT/etc. That was causing the agent to
  // think 2:00 PM / 2:30 PM / 3:00 PM were still available after they had passed.
  if (clientLocalHour !== undefined && clientLocalMinute !== undefined) {
    const h = Number(clientLocalHour);
    const m = Number(clientLocalMinute);
    if (!Number.isNaN(h) && !Number.isNaN(m)) nowMinutes = (h * 60) + m;
  }

  if (nowMinutes === null) {
    if (!clientNow) return '';
    const now = new Date(clientNow);
    if (Number.isNaN(now.getTime())) return '';
    nowMinutes = now.getHours() * 60 + now.getMinutes();
  }
  const lines = [];
  Object.entries(DOCTOR_DB).forEach(([specialty, doctors]) => {
    doctors.forEach(doc => {
      const allSlots = [...(doc.slots?.morning || []), ...(doc.slots?.evening || [])];
      const remaining = allSlots.filter(t => {
        const mins = slotTimeToMinutesForServer(t);
        return mins !== null && mins > nowMinutes;
      });
      lines.push(`${doc.name} (${specialty}): ${remaining.length ? remaining.join(', ') : 'NO REMAINING SLOTS TODAY'}`);
    });
  });
  return '\n\nTODAY SLOT AVAILABILITY AFTER CURRENT LOCAL TIME (source of truth for same-day scheduling):\n' + lines.join('\n') + '\nIf the selected doctor line says NO REMAINING SLOTS TODAY, tell the patient: "Sorry, today\'s slots are over. Would you prefer a future date instead?" in the patient\'s current language, and do not list old slots.';
}

/* ============================================================
   Agora REST API base
   ============================================================ */
// Primary region — change to 'https://api.sd-rtn.com' if you get 404s
const AGORA_API_BASE = process.env.AGORA_API_BASE || 'https://api.agora.io';

/** Basic-auth header for Agora REST calls */
function agoraAuthHeader() {
  const creds = Buffer.from(`${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

/* ============================================================
   Token helper
   ============================================================ */
/**
 * Build an Agora RTC token.
 * Returns null when App Certificate is not configured — Agora allows
 * joining with a null/empty token when certificate auth is disabled.
 * @param {string} channelName
 * @param {number} uid            0 = wildcard (for agent tokens)
 * @param {number} [expireSecs]   defaults to 3600 (1 hour)
 */
function buildRtcToken(channelName, uid, expireSecs = 3600) {
  if (!AGORA_APP_ID || AGORA_APP_ID === 'YOUR_AGORA_APP_ID') {
    throw new Error('AGORA_APP_ID is not set in .env');
  }

  // No App Certificate → token auth is disabled for this project → use null
  if (!AGORA_APP_CERTIFICATE || AGORA_APP_CERTIFICATE === 'YOUR_AGORA_APP_CERTIFICATE') {
    console.warn('[token] App Certificate not set — joining without token (certificate auth disabled)');
    return null;
  }

  // agora-token v2.x uses relative seconds (not absolute timestamp)
  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expireSecs,
    expireSecs
  );
}

/* ============================================================
   Express app
   ============================================================ */
const app = express();

app.use(cors());
app.use(express.json());

/* Serve the portal UI from the same directory as this file */
app.use(express.static(path.join(__dirname)));

/* ── Frontend config (App ID only — safe to expose) ─────── */
app.get('/api/config', (_req, res) => {
  res.json({ appId: AGORA_APP_ID || '' });
});

/* ── Health check ────────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    appId: AGORA_APP_ID ? AGORA_APP_ID.slice(0, 6) + '…' : 'not set',
    time:  new Date().toISOString(),
  });
});

/* ── Patient verification ────────────────────────────────── */
app.post('/api/patients/verify', (req, res) => {
  const { phone, mrn, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const clean = s => (s || '').toLowerCase().replace(/\s+/g,'');
  const patient = PATIENT_DB.find(p =>
    p.phone === phone.replace(/\D/g,'') &&
    (!mrn  || clean(p.mrn)  === clean(mrn)) &&
    (!name || clean(p.name).includes(clean(name)))
  );
  if (!patient) return res.status(404).json({ verified: false, error: 'Patient not found' });
  res.json({ verified: true, patient });
});

/* ── Patient lookup by phone only (partial match) ────────── */
app.get('/api/patients/lookup', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const patient = PATIENT_DB.find(p => p.phone === phone.replace(/\D/g,''));
  if (!patient) return res.status(404).json({ found: false });
  res.json({ found: true, patient });
});

/* ── Doctors by specialty ────────────────────────────────── */
app.get('/api/doctors', (req, res) => {
  const { specialty } = req.query;
  if (specialty && DOCTOR_DB[specialty]) {
    return res.json({ specialty, doctors: DOCTOR_DB[specialty] });
  }
  res.json({ doctors: DOCTOR_DB });
});

/* ── RTC Token ───────────────────────────────────────────── */
/**
 * GET /api/token?channel=<name>&uid=<number>
 * Returns { token: "…" }
 */
app.get('/api/token', (req, res) => {
  const { channel, uid } = req.query;

  if (!channel || !uid) {
    return res.status(400).json({ error: 'channel and uid are required' });
  }

  try {
    const token = buildRtcToken(channel, parseInt(uid, 10));
    // token may be null when certificate auth is disabled — that is valid
    res.json({ token: token || null });
  } catch (err) {
    console.error('[/api/token] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Start Agora Conversational AI Agent ─────────────────── */
/**
 * POST /api/agent/start
 * Body: { channelName, uid, systemPrompt?, greeting? }
 * Returns: { agent_id, … }
 */
app.post('/api/agent/start', async (req, res) => {
  const {
    channelName,
    uid,
    systemPrompt,
    greeting,
    clientNow,
    clientLocalNow,
    clientLocalHour,
    clientLocalMinute,
    clientTimeZone,
  } = req.body;

  if (!channelName || !uid) {
    return res.status(400).json({ error: 'channelName and uid are required' });
  }

  /* Generate a dedicated token for the agent (uid 0 = any slot).
     Returns null when App Certificate is disabled — Agora accepts null. */
  let agentToken;
  try {
    agentToken = buildRtcToken(channelName, 0, 3600);
  } catch (err) {
    return res.status(500).json({ error: `Token build failed: ${err.message}` });
  }

  const agentName = `cityhealth-${Date.now()}`;

  const payload = {
    name: agentName,
    properties: {
      channel:         channelName,
      token:           agentToken || '',  // empty string = no token (cert disabled)
      agent_rtc_uid:   '0',              // auto-assign UID for agent
      remote_rtc_uids: [String(uid)],    // only subscribe to this user
      idle_timeout:    30,

      

      /* LLM — GPT-4o with _publish_message tool for UI control */
      llm: {
        url:     'https://api.openai.com/v1/chat/completions',
        api_key: OPENAI_API_KEY,
        predefined_tools: ['_publish_message'],
        system_messages: [
          {
            role:    'system',
            content: (systemPrompt || 'You are a helpful health assistant.') +
              (clientLocalNow ? ('\n\nCURRENT USER LOCAL DATE/TIME: ' + clientLocalNow + (clientTimeZone ? ('; time zone: ' + clientTimeZone) : '') + '. Use this browser local time as the ONLY source of truth for today and same-day appointment slots.') : (clientNow ? ('\n\nCURRENT USER LOCAL DATE/TIME: ' + clientNow + (clientTimeZone ? ('; time zone: ' + clientTimeZone) : '') + '. Use this as the source of truth for today and for filtering same-day appointment slots.') : '')) +
              buildTodayAvailabilityContext(clientNow, clientLocalHour, clientLocalMinute) +
              '\n\nSAME-DAY SLOT RULE: When the user asks for today, available slots today, or an appointment today, you MUST use the TODAY SLOT AVAILABILITY section above. Do not use the static roster for today. Mention only slots listed as remaining in that section. If the selected doctor has NO REMAINING SLOTS TODAY, say that today\'s slots are over and ask whether the patient prefers a future date.' +
              '\n\nCRITICAL VOICE RULE: This output goes directly to text-to-speech. ' +
              'NEVER use markdown: no **bold**, no *italic*, no # headers, no bullet points (-), no numbered lists (1. 2. 3.). ' +
              'Speak in plain natural conversational sentences only. ' +
              'Say "Doctor Vikram Joshi, fee 650 rupees" not "**Dr. Vikram Joshi**: ₹650".',
          },
        ],
        greeting_message: greeting || 'Hello! How can I help you today?',
        params: {
          model:       'gpt-4o',
          temperature: 0.7,
          max_tokens:  512,
        },
      },

      /* TTS — ElevenLabs */
      tts: {
        vendor: 'cartesia',
        params: {
          api_key: process.env.CARTESIA_API_KEY,
          model_id: 'sonic-3',
          voice: {
            mode: 'id',
            id: '638efaaa-4d0c-442e-b701-3fae16aad012'
          },
          output_format: {
            container: 'raw',
            sample_rate: 16000
          },
          language: 'en'
        },
      },

      /* Force RTC datastream for transcripts (default but explicit) */
      parameters: {
        data_channel: 'datastream',
      },

      /* Enable tool invocation so _publish_message works */
      advanced_features: {
        enable_tools: true,
        enable_rtm: false,
      },
    },
  };

  console.log('[/api/agent/start] Payload:', JSON.stringify(payload, null, 2));

  try {
    const url  = `${AGORA_API_BASE}/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/join`;
    console.log(`[/api/agent/start] POST ${url}`);
    console.log(`[/api/agent/start] Channel: ${channelName}, UID: ${uid}`);

    const resp = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': agoraAuthHeader(),
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error(`[/api/agent/start] Agora ${resp.status} error:`, JSON.stringify(data, null, 2));
      if (resp.status === 404) {
        console.error('[/api/agent/start] 404 usually means:');
        console.error('  1. Conversational AI is not enabled for this project in Agora Console');
        console.error('  2. Wrong region — try setting AGORA_API_BASE=https://api.sd-rtn.com in .env');
      }
      return res.status(resp.status).json({ error: data });
    }

    console.log(`[/api/agent/start] Agent started: ${data.agent_id} on channel ${channelName}`);
    res.json(data);

  } catch (err) {
    console.error('[/api/agent/start] fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Stop Agora Conversational AI Agent ──────────────────── */
/**
 * POST /api/agent/stop
 * Body: { agent_id }
 */
app.post('/api/agent/stop', async (req, res) => {
  const { agent_id } = req.body;

  if (!agent_id) {
    return res.status(400).json({ error: 'agent_id is required' });
  }

  try {
    const url  = `${AGORA_API_BASE}/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/agents/${agent_id}/leave`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': agoraAuthHeader() },
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      console.error('[/api/agent/stop] Agora API error:', data);
      return res.status(resp.status).json({ error: data });
    }

    console.log(`[/api/agent/stop] Agent ${agent_id} stopped.`);
    res.json({ success: true, agent_id });

  } catch (err) {
    console.error('[/api/agent/stop] fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Query agent status ──────────────────────────────────── */
app.get('/api/agent/status/:agentId', async (req, res) => {
  const { agentId } = req.params;
  try {
    const url  = `${AGORA_API_BASE}/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/agents/${agentId}`;
    const resp = await fetch(url, { headers: { 'Authorization': agoraAuthHeader() } });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Query conversation turns (transcriptions) ───────────── */
/**
 * GET /api/agent/turns/:agentId
 * Proxies the Agora ConvoAI turns endpoint — used for transcription polling.
 */
app.get('/api/agent/turns/:agentId', async (req, res) => {
  const { agentId } = req.params;
  try {
    const url  = `${AGORA_API_BASE}/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/agents/${agentId}/turns`;
    const resp = await fetch(url, { headers: { 'Authorization': agoraAuthHeader() } });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Start server
   ============================================================ */
app.listen(PORT, () => {
  console.log(`\n✅  CityHealth server running at http://localhost:${PORT}`);
  console.log(`   App ID : ${AGORA_APP_ID ? AGORA_APP_ID.slice(0, 8) + '…' : '⚠️  NOT SET'}`);
  console.log(`   Mode   : ${NODE_ENV}`);
  console.log(`\n   Open http://localhost:${PORT} to view the portal\n`);
});
