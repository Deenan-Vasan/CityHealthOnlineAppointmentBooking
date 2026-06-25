/**
 * CityHealth — Agora RTC + Conversational AI Client
 * agora.js
 *
 * Wraps:
 *   • Agora Web RTC SDK v4.x  (AgoraRTC global, loaded via CDN)
 *   • Agora Conversational AI REST API (proxied through server.js)
 *
 * Usage:
 *   const agent = new CityHealthAgora(CITYHEALTH_CONFIG);
 *   agent.on('state-change',      ({ state })        => setWidgetState(state));
 *   agent.on('agent-transcript',  ({ text, final })  => updateAgentBubble(text));
 *   agent.on('user-transcript',   ({ text, final })  => updateUserBubble(text));
 *   agent.on('connected',         ()                 => showConnectedUI());
 *   agent.on('disconnected',      ()                 => showIdleUI());
 *   agent.on('error',             ({ message })      => showError(message));
 *
 *   await agent.start();   // joins channel + starts AI agent
 *   agent.setMicMuted(true/false);
 *   await agent.stop();    // stops agent + leaves channel
 */

'use strict';

class CityHealthAgora {

  /* ============================================================
     Constructor
     ============================================================ */
  constructor(config) {
    this._cfg         = config;
    this._client      = null;
    this._localTrack  = null;
    this._remoteTrack = null;
    this._agentId     = null;      // Agora Conversational AI agent instance ID
    this._channelName = null;
    this._uid         = null;
    this._agentUid    = null;      // remote UID published by the AI agent
    this._volInterval    = null;
    this._pollInterval   = null;
    this._silenceCount   = 0;
    this._pendingChunks  = new Map();  // for reassembling multi-part stream messages
    this._state       = 'idle';    // idle | connecting | listening | speaking | thinking
    this._handlers    = {};
    this._micMuted    = false;
    this._connected   = false;
  }

  /* ============================================================
     Minimal event emitter
     ============================================================ */
  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;
  }

  off(event, fn) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== fn);
  }

  _emit(event, data = {}) {
    (this._handlers[event] || []).forEach(fn => {
      try { fn(data); } catch (e) { console.error('[CityHealthAgora] handler error:', e); }
    });
  }

  /* ============================================================
     Public API
     ============================================================ */

  /**
   * Start a session: join RTC channel, publish mic, launch AI agent.
   * @param {object} [opts]
   * @param {string} [opts.channelName]  Override channel name
   * @param {number} [opts.uid]          Override local user UID (random if omitted)
   */
  async start(opts = {}) {
    if (this._connected) return;

    // Sanity-check SDK
    if (typeof AgoraRTC === 'undefined') {
      this._emit('error', { message: 'Agora RTC SDK not loaded. Check the <script> tag in index.html.' });
      return;
    }

    this._setState('connecting');

    try {
      // ── 0. Wait for App ID to finish loading from /api/config ─
      //       (prevents race when user clicks widget before fetch completes)
      if (!this._cfg.AGORA_APP_ID && this._cfg._appIdReady) {
        await this._cfg._appIdReady;
      }
      if (!this._cfg.AGORA_APP_ID || this._cfg.AGORA_APP_ID === 'YOUR_AGORA_APP_ID') {
        this._emit('error', { message: 'AGORA_APP_ID is not configured. Make sure your .env has AGORA_APP_ID set and the server is running.' });
        return;
      }

      // ── 1. Request microphone permission FIRST (before anything else)
      //       This triggers the browser's "Allow microphone" prompt.
      console.log('[CityHealthAgora] Requesting microphone permission…');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop()); // release immediately; Agora opens its own
        console.log('[CityHealthAgora] Microphone permission granted ✓');
      } catch (permErr) {
        this._emit('error', { message: 'Microphone access denied. Please allow microphone access and try again.' });
        return;
      }

      // ── 2. Derive channel name and UID ──────────────────────
      this._uid         = opts.uid         || Math.floor(Math.random() * 100000) + 10000;
      this._channelName = opts.channelName || this._cfg.CHANNEL_PREFIX + this._uid;

      // ── 3. Fetch RTC token from backend ────────────────────
      const tokenRes = await this._fetchJSON(
        `${this._cfg.SERVER_URL}/api/token?channel=${this._channelName}&uid=${this._uid}`
      );

      // ── 4. Create Agora RTC client ──────────────────────────
      this._client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this._bindClientEvents();

      // ── 5. Join channel ─────────────────────────────────────
      // token may be null when App Certificate is disabled — Agora accepts null
      await this._client.join(
        this._cfg.AGORA_APP_ID,
        this._channelName,
        tokenRes.token || null,
        this._uid
      );

      // ── 6. Create + publish local microphone track ──────────
      this._localTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: {
          sampleRate: this._cfg.AUDIO.SAMPLE_RATE,
          stereo: false,
        },
      });
      await this._client.publish([this._localTrack]);
      console.log('[CityHealthAgora] Mic published to channel ✓');

      // ── 7. Start Agora Conversational AI agent via backend ──
      const agentRes = await this._fetchJSON(
        `${this._cfg.SERVER_URL}/api/agent/start`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelName:  this._channelName,
            uid:          this._uid,
            systemPrompt: opts.systemPrompt || this._cfg.AGENT_SYSTEM_PROMPT,
            greeting:     opts.greeting     || this._cfg.AGENT_GREETING,
            clientNow:    new Date().toISOString(),
            clientLocalNow: new Date().toString(),
            clientLocalHour: new Date().getHours(),
            clientLocalMinute: new Date().getMinutes(),
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          }),
        }
      );
      this._agentId = agentRes.agent_id;
      console.log('[CityHealthAgora] Agent started, id:', this._agentId);

      this._connected = true;
      this._setState('listening');
      this._emit('connected', { channelName: this._channelName, uid: this._uid });

      // Transcript polling disabled — /api/agent/turns is not available on all plans.
      // Transcriptions come via stream-message events instead.
      // this._startTranscriptPolling();

      // Warn if agent hasn't published audio after 8 seconds
      setTimeout(() => {
        if (!this._agentUid) {
          console.warn('[CityHealthAgora] ⚠ Agent has not published audio after 8s.');
        }
      }, 8000);

    } catch (err) {
      console.error('[CityHealthAgora] start() failed:', err);
      this._emit('error', { message: err.message || 'Failed to connect to voice agent.' });
      await this._cleanup();
    }
  }

  /**
   * Stop the session: tell the agent to leave, then leave RTC channel.
   */
  async stop() {
    if (!this._connected && this._state === 'idle') return;
    try {
      if (this._agentId) {
        await this._fetchJSON(
          `${this._cfg.SERVER_URL}/api/agent/stop`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: this._agentId }),
          }
        ).catch(e => console.warn('[CityHealthAgora] agent stop warning:', e.message));
      }
    } finally {
      await this._cleanup();
      this._emit('disconnected', {});
    }
  }

  /**
   * Mute or unmute the local microphone.
   * @param {boolean} muted
   */
  setMicMuted(muted) {
    this._micMuted = muted;
    if (this._localTrack) this._localTrack.setMuted(muted);
    this._emit('mic-muted', { muted });
  }

  /** Current mic mute state */
  get isMicMuted() { return this._micMuted; }

  /** Current agent interaction state */
  get state() { return this._state; }

  /** Whether an active session is running */
  get isConnected() { return this._connected; }

  /* ============================================================
     Resume AudioContext after a user gesture (autoplay policy)
     Call this once the user has clicked/tapped anything.
     ============================================================ */
  static resumeAudioContext() {
    CityHealthAgora._resumeCtxStatic();
  }

  static _resumeCtxStatic() {
    try {
      // Try Agora's internal context first
      const agoraCtx = AgoraRTC.getAudioContext ? AgoraRTC.getAudioContext() : null;
      if (agoraCtx && agoraCtx.state === 'suspended') agoraCtx.resume();
    } catch {}
    try {
      // Also resume the global AudioContext used by the browser
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        if (ctx.state === 'suspended') ctx.resume();
      }
    } catch {}
  }

  _showEnableAudioBtn() {
    if (document.getElementById('_ch_audio_btn_')) return;
    const btn = document.createElement('button');
    btn.id = '_ch_audio_btn_';
    btn.textContent = '🔊 Tap to enable agent audio';
    btn.style.cssText =
      'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
      'background:#1d4ed8;color:#fff;border:none;border-radius:24px;' +
      'padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer;z-index:9999;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);';
    btn.onclick = async () => {
      await this._resumeAudioCtx();
      if (this._remoteTrack) {
        try { this._remoteTrack.setVolume(100); this._remoteTrack.play(); } catch {}
      }
      btn.remove();
    };
    document.body.appendChild(btn);
    // Auto-remove after 30s
    setTimeout(() => btn.remove(), 30000);
  }

  async _resumeAudioCtx() {
    // Try every known AudioContext path
    const paths = [
      () => AgoraRTC.getAudioContext && AgoraRTC.getAudioContext(),
    ];
    for (const getter of paths) {
      try {
        const ctx = getter();
        if (ctx && ctx.state === 'suspended') await ctx.resume();
      } catch {}
    }
    // Also create+resume a fresh AudioContext to unlock the browser
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();
        else ctx.close();
      }
    } catch {}
  }

  /* ============================================================
     RTC client event bindings
     ============================================================ */
  _bindClientEvents() {
    const c = this._client;

    // Handle browsers that block autoplay
    AgoraRTC.onAutoplayFailed = () => {
      console.warn('[CityHealthAgora] Autoplay blocked — showing enable-audio button');
      this._showEnableAudioBtn();
    };

    // Remote user (agent) published audio
    c.on('user-published', async (user, mediaType) => {
      console.log('[CityHealthAgora] user-published uid:', user.uid, 'mediaType:', mediaType);
      if (mediaType !== 'audio') return;
      try {
        await c.subscribe(user, 'audio');
        this._agentUid = user.uid;

        // Retry up to 3 times if audioTrack isn't ready yet
        for (let i = 0; i < 3; i++) {
          this._remoteTrack = user.audioTrack;
          if (this._remoteTrack) break;
          await new Promise(r => setTimeout(r, 400));
        }
        if (!this._remoteTrack) {
          console.warn('[CityHealthAgora] audioTrack unavailable — audio may not play');
          this._startVolumeMonitor();
          return;
        }

        console.log('[CityHealthAgora] Subscribed to agent audio track ✓');

        // ── Approach 1: Direct MediaStream → <audio> element ──────────
        // Most reliable — bypasses AudioContext autoplay policy entirely.
        let audioEl = document.getElementById('_ch_agent_audio_');
        if (!audioEl) {
          audioEl              = document.createElement('audio');
          audioEl.id           = '_ch_agent_audio_';
          audioEl.autoplay     = true;
          audioEl.playsInline  = true;
          audioEl.controls     = false;
          audioEl.style.cssText = 'position:fixed;bottom:-1px;left:-1px;width:1px;height:1px;opacity:.01;';
          document.body.appendChild(audioEl);
        }
        try {
          const mediaTrack = this._remoteTrack.getMediaStreamTrack();
          if (mediaTrack) {
            audioEl.srcObject = new MediaStream([mediaTrack]);
            await audioEl.play();
            console.log('[CityHealthAgora] Audio playing via <audio>.srcObject ✓');
          }
        } catch (e) {
          console.warn('[CityHealthAgora] srcObject play failed, falling back to Agora play():', e.message);
        }

        // ── Approach 2: Agora's built-in play() as fallback ───────────
        await this._resumeAudioCtx();
        this._remoteTrack.setVolume(400);   // 0–1000, boost to ensure audible
        this._remoteTrack.play();
        console.log('[CityHealthAgora] Agent audio play() called ✓ vol=400');

        this._startVolumeMonitor();
      } catch (err) {
        console.error('[CityHealthAgora] Failed to subscribe to agent audio:', err);
      }
    });

    // Agent unpublished audio (TTS chunk ended)
    c.on('user-unpublished', (user) => {
      if (user.uid === this._agentUid) {
        this._stopVolumeMonitor();
        this._remoteTrack = null;
        // Keep agentUid — agent will re-publish for the next TTS chunk
        console.log('[CityHealthAgora] Agent unpublished audio (TTS chunk end).');
      }
    });

    c.on('user-left', (user) => {
      if (user.uid === this._agentUid) {
        this._stopVolumeMonitor();
        console.log('[CityHealthAgora] Agent left channel.');
      }
    });

    // Stream messages — agent transcripts + state signals
    c.on('stream-message', (uid, data) => {
      console.log('[CityHealthAgora] RAW stream-message from uid:', uid, 'length:', data?.length);
      if (uid === this._uid) return; // ignore our own echoed messages
      if (this._agentUid === null) this._agentUid = uid; // latch first remote sender
      this._handleStreamMessage(data);
    });

    // Connection state changes
    c.on('connection-state-change', (curState, prevState) => {
      console.log(`[CityHealthAgora] Connection: ${prevState} → ${curState}`);
      if (curState === 'DISCONNECTED' && this._connected) {
        this._emit('error', { message: 'Connection lost. Please try again.' });
        this._cleanup();
      }
    });

    // Network quality indicator
    c.on('network-quality', (stats) => {
      this._emit('network-quality', {
        uplink:   stats.uplinkNetworkQuality,   // 0=unknown,1=excellent…6=very bad
        downlink: stats.downlinkNetworkQuality,
      });
    });
  }

  /* ============================================================
     Volume-based agent state detection
     ============================================================ */
  _startVolumeMonitor() {
    this._stopVolumeMonitor();
    const { VOLUME_THRESHOLD, SILENCE_FRAMES, CHECK_INTERVAL_MS } = this._cfg.AUDIO;

    // TTS delivers audio in chunks with brief inter-sentence gaps.
    // Use hysteresis: require sustained sound to enter 'speaking' and
    // sustained silence to leave it — prevents rapid flickering.
    const MIN_SPEAKING_FRAMES = 4;   // 400ms of sound needed to enter speaking
    const HOLD_FRAMES         = 20;  // hold speaking 2s after last audio — bridges TTS chunk gaps
    let   speakingFrames      = 0;
    let   lastSoundTime       = 0;

    this._volInterval = setInterval(() => {
      if (!this._remoteTrack) return;
      const vol = this._remoteTrack.getVolumeLevel();  // 0.0 – 1.0

      if (vol > VOLUME_THRESHOLD) {
        this._silenceCount = 0;
        speakingFrames     = Math.min(speakingFrames + 1, MIN_SPEAKING_FRAMES + 1);
        lastSoundTime      = Date.now();

        if (speakingFrames >= MIN_SPEAKING_FRAMES && this._state !== 'speaking') {
          this._setState('speaking');
        }
      } else {
        speakingFrames = Math.max(0, speakingFrames - 1); // decay slowly
        this._silenceCount++;

        // Hold speaking state for HOLD_FRAMES after last sound (TTS chunk gaps)
        const msInSilence = Date.now() - lastSoundTime;
        const holdExpired = msInSilence >= HOLD_FRAMES * CHECK_INTERVAL_MS;

        if (this._silenceCount >= SILENCE_FRAMES &&
            holdExpired &&
            this._state === 'speaking') {
          this._setState('listening');
        }
      }
    }, CHECK_INTERVAL_MS);
  }

  _stopVolumeMonitor() {
    if (this._volInterval) {
      clearInterval(this._volInterval);
      this._volInterval = null;
    }
    this._silenceCount = 0;
  }

  /* ============================================================
     Stream message parser
     Agora Conversational AI sends JSON encoded as UTF-8 bytes
     ============================================================ */
  /* ============================================================
     Chunked datastream reassembly
     Agora sends messages as: messageId|partIndex|total|base64Part
     Once all chunks arrive, decode and parse.
     ============================================================ */
  _acceptDatastreamChunk(raw) {
    const sep = raw.indexOf('|');
    if (sep === -1) return null;                       // not chunked format
    const parts = raw.split('|');
    if (parts.length !== 4) return null;

    const [messageId, partIndexRaw, totalRaw, base64Part] = parts;
    const partIndex = Number(partIndexRaw) - 1;        // 1-based → 0-based
    const total     = Number(totalRaw);

    if (!messageId || isNaN(partIndex) || isNaN(total)) return null;

    const chunks = this._pendingChunks.get(messageId) ?? new Array(total).fill('');
    chunks[partIndex] = base64Part;
    this._pendingChunks.set(messageId, chunks);

    if (chunks.some(c => !c)) return null;             // still waiting for parts

    this._pendingChunks.delete(messageId);
    try {
      const bytes = Uint8Array.from(atob(chunks.join('')), c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return null; }
  }

  _handleStreamMessage(rawData) {
    const raw = new TextDecoder('utf-8').decode(rawData);
    console.log('[CityHealthAgora] RAW stream:', raw.slice(0, 160));

    // Try chunked format first; fall back to direct JSON
    let msg = this._acceptDatastreamChunk(raw);
    if (!msg) {
      try { msg = JSON.parse(raw); } catch { return; }
    }

    console.log('[CityHealthAgora] parsed message:', JSON.stringify(msg).slice(0, 200));

    const obj = msg.object || msg.data_type || msg.type || '';

    /* ── _publish_message UI signal from LLM tool call ── */
    if (obj === 'message.user') {
      try {
        const content = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        if (content && content.type === 'ui_signal') {
          console.log('[CityHealthAgora] ui-signal:', content);
          this._emit('ui-signal', content);
          return;
        }
      } catch {}
    }

    /* ── Agent transcript ─────────────────────────────── */
    if (obj === 'agent.transcription' || obj === 'assistant.transcription' || obj === 'agent_text') {
      const text  = msg.text || msg.content || '';
      const final = msg.quiet !== true && msg.final !== false;
      if (text) {
        this._emit('agent-transcript', { text, final, turnId: msg.turn_id });
        if (this._state !== 'speaking') this._setState('speaking');
      }
    }

    /* ── User transcript ──────────────────────────────── */
    if (obj === 'user.transcription' || obj === 'user_text') {
      const text  = msg.text || msg.content || '';
      const final = msg.final === true;
      if (text) {
        this._emit('user-transcript', { text, final, turnId: msg.turn_id });
        if (!final && this._state !== 'thinking') this._setState('thinking');
        if (final) this._setState('listening');
      }
    }

    /* ── Agent state signals ──────────────────────────── */
    if (obj === 'agent.state' || obj === 'assistant.state') {
      const s = msg.state;
      if (['idle','listening','speaking','thinking'].includes(s)) this._setState(s);
    }

    /* ── Interrupt / barge-in ─────────────────────────── */
    if (obj === 'agent.interrupted' || obj === 'assistant.interrupted') {
      this._setState('listening');
      this._emit('agent-interrupted', {});
    }

    /* ── Turn end ─────────────────────────────────────── */
    if (obj === 'agent.turn_end' || obj === 'assistant.turn_end') {
      this._setState('listening');
      this._emit('turn-end', { turnId: msg.turn_id });
    }
  }

  /* ============================================================
     State management
     ============================================================ */
  _setState(newState) {
    if (this._state === newState) return;
    const prev = this._state;
    this._state = newState;
    console.log(`[CityHealthAgora] state: ${prev} → ${newState}`);
    this._emit('state-change', { state: newState, prev });
  }

  /* ============================================================
     Transcription polling via /api/agent/turns
     Polls every 1 second as fallback when stream-message isn't fired.
     ============================================================ */
  _startTranscriptPolling() {
    if (this._pollInterval) return;

    const seen         = new Set();
    let   lastAgent    = '';
    let   lastUser     = '';
    let   failCount    = 0;
    const MAX_FAILS    = 5;   // stop polling after 5 consecutive failures

    this._pollInterval = setInterval(async () => {
      if (!this._agentId || !this._connected) return;
      try {
        const base = this._cfg.SERVER_URL || '';
        const res  = await fetch(`${base}/api/agent/turns/${this._agentId}`);

        if (!res.ok) {
          failCount++;
          // Silently stop polling on repeated failures — don't emit errors
          if (failCount >= MAX_FAILS) {
            console.warn('[CityHealthAgora] Transcript polling stopped after', failCount, 'failures (status', res.status, ')');
            this._stopTranscriptPolling();
          }
          return;
        }

        failCount = 0; // reset on success
        const raw   = await res.json();
        const turns = raw.turns || raw.items || raw.data || (Array.isArray(raw) ? raw : []);
        if (!turns.length) return;

        turns.forEach(turn => {
          const role    = (turn.role || turn.speaker || '').toLowerCase();
          const content = (turn.content || turn.text || turn.message || '').trim();
          const status  = (turn.status || 'complete').toLowerCase();
          const key     = `${role}:${content}`;
          if (!content || seen.has(key)) return;
          seen.add(key);
          const final = !status.includes('progress') && !status.includes('speaking');
          if (role === 'assistant' || role === 'agent') {
            if (content !== lastAgent) {
              lastAgent = content;
              this._emit('agent-transcript', { text: content, final });
            }
          } else if (role === 'user') {
            if (content !== lastUser) {
              lastUser = content;
              this._emit('user-transcript', { text: content, final });
            }
          }
        });

      } catch (e) {
        // silently ignore network errors — don't break the session
      }
    }, 1500); // poll every 1.5s to reduce load
  }

  _stopTranscriptPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  /* ============================================================
     Cleanup
     ============================================================ */
  async _cleanup() {
    this._stopTranscriptPolling();
    this._stopVolumeMonitor();
    this._pendingChunks.clear();

    if (this._localTrack) {
      this._localTrack.stop();
      this._localTrack.close();
      this._localTrack = null;
    }
    if (this._remoteTrack) {
      this._remoteTrack.stop();
      this._remoteTrack = null;
    }
    if (this._client) {
      try { await this._client.leave(); } catch {}
      this._client = null;
    }

    this._agentId     = null;
    this._agentUid    = null;
    this._connected   = false;
    this._micMuted    = false;
    this._channelName = null;
    this._setState('idle');
  }

  /* ============================================================
     Fetch helper with timeout
     ============================================================ */
  async _fetchJSON(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
