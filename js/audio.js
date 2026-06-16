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
  async function start(offsetSecs = 0) {
    const ac = _ensureCtx();
    // Set offset immediately so currentSecs() returns correct position during any async gap
    _startOffset = offsetSecs;
    // Await resume — critical: sources started in a suspended context may replay
    // when context finally resumes, making stop() appear to have no effect
    if (ac.state !== 'running') {
      try { await ac.resume(); } catch (_) {}
    }
    _stop_sources();
    _startCtxTime = ac.currentTime;
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
    if (_playing && ctx) _startOffset = _startOffset + (ctx.currentTime - _startCtxTime);
    _playing = false;
    _stop_sources();
    // Suspend context — guarantees silence even if browser hasn't fully processed source.stop()
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
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

  // Compute peak amplitudes at PEAK_RES points (cached on stem object)
  const PEAK_RES = 512;
  function getPeaks(id) {
    const stem = stems[id];
    if (!stem?.buffer) return null;
    if (stem._peaks) return stem._peaks;
    const buf = stem.buffer;
    const total = buf.length;
    const nCh = buf.numberOfChannels;
    const blockSize = Math.ceil(total / PEAK_RES);
    const peaks = new Float32Array(PEAK_RES);
    for (let c = 0; c < nCh; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < PEAK_RES; i++) {
        const start = i * blockSize;
        const end = Math.min(start + blockSize, total);
        let max = 0;
        for (let j = start; j < end; j += 4) { // sample every 4th — 4× faster, negligible quality loss
          const a = Math.abs(data[j]);
          if (a > max) max = a;
        }
        if (max > peaks[i]) peaks[i] = max;
      }
    }
    stem._peaks = peaks;
    return peaks;
  }

  function isLoaded() { return Object.values(stems).some(s => s.buffer); }
  function hasStem(id) { return !!(stems[id]?.buffer); }

  return { loadStem, loadFromSession, start, stop, currentSecs,
           setMute, setSolo, setGain, isLoaded, hasStem, getPeaks };
})();

/* ============================================================
   MidiEngine — Web Audio API synthesiser for MIDI note playback
   Schedules notes ~800 ms ahead in a rolling setTimeout loop.
   ============================================================ */
const MidiEngine = (() => {
  let ctx = null;
  let _notes = [];          // [{start,end,pitch,velocity,drum,stemId}] sorted by start
  let _nodes = [];          // active AudioNodes for cleanup
  let _startCtxTime = 0;
  let _startOffset  = 0;
  let _playing      = false;
  let _nextIdx      = 0;
  let _schedTimer   = null;
  const AHEAD   = 0.8;   // schedule up to 800 ms ahead
  const TICK_MS = 200;   // re-check every 200 ms
  const _mutedStems  = new Set();
  const _soloedStems = new Set();

  function _ensureCtx(){
    if(!ctx) ctx = new AudioContext();
    if(ctx.state==='suspended') ctx.resume();
    return ctx;
  }

  function load(stems){
    _notes = [];
    for(const s of stems){
      if(!s.midiNotes?.length) continue;
      for(const n of s.midiNotes) _notes.push({...n, stemId:s.id});
    }
    _notes.sort((a,b)=>a.start-b.start);
  }

  function _noteOn(ac, n, atTime){
    const hasSolo = _soloedStems.size > 0;
    if(_mutedStems.has(n.stemId)) return;
    if(hasSolo && !_soloedStems.has(n.stemId)) return;

    const dur = Math.max(0.04, n.end - n.start);
    const vel = (n.velocity || 70) / 127;

    if(n.drum){
      const bufSize = Math.ceil(ac.sampleRate * Math.min(dur, 0.14));
      const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<bufSize;i++) d[i] = Math.random()*2-1;
      const src = ac.createBufferSource(); src.buffer = buf;
      const filt = ac.createBiquadFilter(); filt.type='bandpass';
      filt.frequency.value = n.pitch<=36? 80 : n.pitch<=39? 220 : 7000;
      filt.Q.value = 2;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.55*vel, atTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, atTime+Math.min(dur,0.14));
      src.connect(filt); filt.connect(gain); gain.connect(ac.destination);
      src.start(atTime); src.stop(atTime+Math.min(dur,0.15));
      _nodes.push(src, gain, filt);
      return;
    }

    const freq = 440 * Math.pow(2, (n.pitch-69)/12);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ac.createGain();
    const v = vel * 0.38;
    const att = 0.015, rel = Math.min(0.18, dur*0.3);
    gain.gain.setValueAtTime(0, atTime);
    gain.gain.linearRampToValueAtTime(v, atTime+att);
    gain.gain.setValueAtTime(v*0.7, atTime+Math.max(att+0.001, dur-rel));
    gain.gain.exponentialRampToValueAtTime(0.0001, atTime+dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(atTime); osc.stop(atTime+dur+0.02);
    _nodes.push(osc, gain);
  }

  function _schedule(){
    if(!_playing || !ctx) return;
    const ac = ctx;
    const nowAudio = _startOffset + (ac.currentTime - _startCtxTime);
    const schedEnd = nowAudio + AHEAD;
    while(_nextIdx < _notes.length && _notes[_nextIdx].start <= schedEnd){
      const n = _notes[_nextIdx++];
      if(n.start < nowAudio - 0.05) continue; // already past
      const atTime = _startCtxTime + (n.start - _startOffset);
      _noteOn(ac, n, Math.max(atTime, ac.currentTime + 0.001));
    }
    if(_nextIdx < _notes.length) _schedTimer = setTimeout(_schedule, TICK_MS);
  }

  async function start(offsetSecs=0){
    const ac = _ensureCtx();
    _startOffset = offsetSecs;
    if(ac.state!=='running'){ try{ await ac.resume(); }catch(_){} }
    _stop_nodes();
    _startCtxTime = ac.currentTime;
    _playing = true;
    _nextIdx = 0;
    // seek to first note at/after offset
    while(_nextIdx < _notes.length && _notes[_nextIdx].start < offsetSecs - 0.05) _nextIdx++;
    _schedule();
  }

  function stop(){
    if(_playing && ctx) _startOffset += ctx.currentTime - _startCtxTime;
    _playing = false;
    clearTimeout(_schedTimer); _schedTimer = null;
    _stop_nodes();
    if(ctx?.state==='running') ctx.suspend().catch(()=>{});
  }

  function _stop_nodes(){
    const t = ctx?.currentTime || 0;
    for(const n of _nodes){
      try{ if(n.stop) n.stop(t+0.01); }catch(_){}
      try{ n.disconnect(); }catch(_){}
    }
    _nodes = [];
  }

  function currentSecs(){
    if(!_playing || !ctx) return _startOffset;
    return _startOffset + (ctx.currentTime - _startCtxTime);
  }

  function isLoaded(){ return _notes.length > 0; }

  function setMute(id, muted){
    if(muted) _mutedStems.add(id); else _mutedStems.delete(id);
  }
  function setSolo(soloSet){
    _soloedStems.clear();
    for(const id of soloSet) _soloedStems.add(id);
  }
  // Reload stems into engine (called after midiNotes fetch completes)
  function reload(stems){ if(stems) load(stems); }

  return { load, reload, start, stop, currentSecs, isLoaded, setMute, setSolo };
})();
