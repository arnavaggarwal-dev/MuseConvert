/* ============================================================
   AudioEngine — Web Audio API stem playback
   Loaded before controller.js. Exposes window.AudioEngine.
   ============================================================ */
const AudioEngine = (() => {
  let ctx = null;
  // id -> { buffer: AudioBuffer, gain: GainNode, source: AudioBufferSourceNode|null }
  const stems = {};
  let _startCtxTime = 0;   // ctx.currentTime when play() was called
  let _startOffset  = 0;   // audio offset (secs) when play() was called
  let _playing      = false;

  function _ensureCtx() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Load one stem WAV from URL → stores decoded buffer
  async function loadStem(id, url) {
    const ac = _ensureCtx();
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
      const raw = await resp.arrayBuffer();
      const buf = await ac.decodeAudioData(raw);
      if (!stems[id]) stems[id] = { gain: ac.createGain() };
      stems[id].buffer = buf;
      stems[id].gain.connect(ac.destination);
      stems[id].source = null;
      return true;
    } catch (e) {
      console.warn('[AudioEngine] loadStem failed:', id, e);
      return false;
    }
  }

  // Load all stems from an API session result
  async function loadFromSession(sessionStems, onProgress) {
    let done = 0;
    // clear old
    stop();
    for (const k of Object.keys(stems)) delete stems[k];

    const tasks = sessionStems
      .filter(s => s.audio_url)
      .map(s => loadStem(s.id, s.audio_url).then(ok => {
        done++;
        if (onProgress) onProgress(done / sessionStems.length, s.id, ok);
      }));
    await Promise.all(tasks);
  }

  // Start playback from offsetSecs into the audio
  function start(offsetSecs = 0) {
    const ac = _ensureCtx();
    _stop_sources();
    _startCtxTime = ac.currentTime;
    _startOffset  = offsetSecs;
    _playing = true;

    for (const [id, stem] of Object.entries(stems)) {
      if (!stem.buffer) continue;
      const src = ac.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      const safeOffset = offsetSecs % stem.buffer.duration;
      src.start(0, safeOffset);
      src.onended = () => { stem.source = null; };
      stem.source = src;
    }
  }

  function stop() {
    _playing = false;
    _stop_sources();
  }

  function _stop_sources() {
    for (const stem of Object.values(stems)) {
      try { stem.source?.stop(); } catch (_) {}
      stem.source = null;
    }
  }

  // Current playback position in seconds (relative to audio start)
  function currentSecs() {
    if (!_playing || !ctx) return _startOffset;
    return _startOffset + (ctx.currentTime - _startCtxTime);
  }

  // Mute/unmute a stem by id
  function setMute(id, muted) {
    if (!stems[id]) return;
    stems[id].gain.gain.setTargetAtTime(muted ? 0 : 1, ctx?.currentTime || 0, 0.02);
  }

  // Solo: silence all stems not in the soloSet; restore if soloSet empty
  function setSolo(soloSet) {
    const hasSolo = soloSet.length > 0;
    for (const [id, stem] of Object.entries(stems)) {
      const active = !hasSolo || soloSet.includes(id);
      stem.gain.gain.setTargetAtTime(active ? 1 : 0, ctx?.currentTime || 0, 0.02);
    }
  }

  // Set gain (0..1) for a stem — used for future mixer sliders
  function setGain(id, value) {
    if (stems[id]) stems[id].gain.gain.setTargetAtTime(value, ctx?.currentTime || 0, 0.02);
  }

  function isLoaded() { return Object.values(stems).some(s => s.buffer); }
  function hasStem(id) { return !!(stems[id]?.buffer); }

  return { loadStem, loadFromSession, start, stop, currentSecs,
           setMute, setSolo, setGain, isLoaded, hasStem };
})();
