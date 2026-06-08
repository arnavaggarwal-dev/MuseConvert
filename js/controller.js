/* ============================================================
   OVERTONE — application controller
   ============================================================ */
/* v2 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ICONS = {
  drums:'<path d="M3 9c0 1.7 4 3 9 3s9-1.3 9-3-4-3-9-3-9 1.3-9 3Z"/><path d="M3 9v5c0 1.7 4 3 9 3s9-1.3 9-3V9"/><path d="M7 12l-3 8M17 12l3 8"/>',
  bass:'<circle cx="6" cy="18" r="3"/><path d="M9 18V4l11-2v3L9 7"/>',
  guitar:'<circle cx="7" cy="16" r="4"/><path d="M7 16 18 5l3 1-1 3"/><path d="m14 9 1 1"/>',
  synth:'<rect x="2" y="6" width="20" height="12" rx="1.5"/><path d="M6 6v8M10 6v8M14 6v8M18 6v8"/>',
  keys:'<rect x="2" y="5" width="20" height="14" rx="1.5"/><path d="M7 5v9M12 5v9M17 5v9M2 14h20"/>',
  vocal:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  strings:'<path d="M11 2c-1 4-1 14 0 20M13 2c1 4 1 14 0 20"/><path d="M9 6h6M9 18h6"/><circle cx="12" cy="12" r="9"/>',
  brass:'<circle cx="7" cy="12" r="5"/><path d="M12 12h6l2-3v6l-2-3M12 9v6"/>',
  wood:'<path d="M5 4v16a2 2 0 0 0 4 0V4Z"/><circle cx="7" cy="9" r="1"/><circle cx="7" cy="13" r="1"/><circle cx="7" cy="17" r="1"/>',
  perc:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  harp:'<path d="M4 3v18M20 3C12 3 6 9 6 21"/><path d="M9 5v12M13 7v9M17 9v6"/>',
};
function iconFor(stem){
  const id=stem.id, f=(stem.family||"")+id;
  if(/drum|perc/.test(id))return ICONS.drums;
  if(/timp/.test(id))return ICONS.perc;
  if(/bass|^cb$/.test(id))return ICONS.bass;
  if(/guitar/.test(id))return ICONS.guitar;
  if(/synth/.test(id))return ICONS.synth;
  if(/key|pno|piano|pad/.test(id))return ICONS.keys;
  if(/vocal/.test(id))return ICONS.vocal;
  if(/vln|vla|vc|string/.test(id))return ICONS.strings;
  if(/hn|tpt|tbn|brass/.test(id))return ICONS.brass;
  if(/fl|ob|cl|bsn|wood/.test(id))return ICONS.wood;
  if(/harp/.test(id))return ICONS.harp;
  return ICONS.synth;
}
function svgIco(path,cls){ return `<svg viewBox="0 0 24 24" class="${cls||'ico-stroke'}">${path}</svg>`; }

/* ---------------- STATE ---------------- */
const STATE = {
  pkey:"band", scene:"success", sel:"synth",
  playing:false, pos:0 /*bars*/, muted:new Set(), solo:new Set(),
  itab:"instrument", zoom:1, barPx:16, showWave:true, showGrid:true,
  url:"", liveProject:null, liveSid:null,
};
let raf=null, lastT=0;
const P = ()=>STATE.liveProject || PROJECTS[STATE.pkey];
function totalBars(){ const p=P(); return Math.ceil(p.duration*p.tempo/60/p.timeSig[0]); }

/* ---------------- TOP / SUB META ---------------- */
function renderMeta(){
  const p=P();
  if(document.activeElement!==$("#omni-input")) $("#omni-input").value = p.source?.startsWith("http") ? p.source : "https://"+p.source;
  $("#crumb-title").textContent = p.title;
  $("#gpu-bar").style.width=p.gpu.util+"%"; $("#gpu-val").textContent=p.gpu.util+"%";
  const vr=p.gpu.vramTotal>0?Math.round(p.gpu.vram/p.gpu.vramTotal*100):0;
  $("#vram-bar").style.width=vr+"%"; $("#vram-val").textContent=p.gpu.vramTotal>0?p.gpu.vram.toFixed(1)+"G":"—";
  $("#gpu-bar").style.background = p.gpu.util>60?"linear-gradient(90deg,var(--warn),var(--play))":"linear-gradient(90deg,var(--acc),var(--acc-bright))";
  $("#sub-meta").innerHTML =
    `<span><span class="k">tempo</span> <b>${p.tempo}</b></span>`+
    `<span><span class="k">key</span> <b>${p.key}</b></span>`+
    `<span><span class="k">sig</span> <b>${p.timeSig.join("/")}</b></span>`+
    `<span><span class="k">stems</span> <b>${p.stems.length}</b></span>`+
    `<span><span class="k">dur</span> <b>${fmtTime(p.duration)}</b></span>`;
  $("#st-tempo").innerHTML=`${p.tempo} <small>BPM</small>`;
  $("#st-sig").textContent=p.timeSig.join("/");
  $("#st-key").textContent=p.key.replace(" minor"," min").replace(" major"," maj");
  $("#sbar-model").textContent=p.sepModel.split(" · ")[0];
  const midiTot=p.stems.reduce((a,s)=>a+s.midi,0);
  $("#sbar-stems").textContent=p.stems.length+" stems";
  $("#sbar-midi").textContent=midiTot.toLocaleString()+" MIDI events";
  $(".status .sb.right").textContent=`${(p.sampleRate/1000)} kHz · ${p.bitDepth}-bit`;
}

/* ---------------- LEFT ---------------- */
function renderLeft(){
  const p=P();
  // navigator: projects as expandable; current expanded showing stems
  const projs=Object.values(PROJECTS);
  $("#nav-count").textContent=projs.length;
  $("#nav-tree").innerHTML = projs.map(pr=>{
    const open=pr.id===STATE.pkey;
    const head=`<div class="trow ${open?'active':''}" data-load="${pr.id}">
      <span class="tw">${svgIco(open?'<path d="M6 9l6 6 6-6"/>':'<path d="M9 6l6 6-6 6"/>')}</span>
      <span class="nm">${pr.title}</span><span class="meta">${pr.stems.length}</span></div>`;
    let kids="";
    if(open){ kids=pr.stems.map(s=>`<div class="trow indent" data-stem="${s.id}">
       <span class="swatch" style="background:var(${s.color})"></span>
       <span class="nm">${s.name}</span><span class="meta">${Math.round(s.confidence)}%</span></div>`).join(""); }
    return head+kids;
  }).join("");
  // files
  $("#file-tree").innerHTML = [
    {t:"📁 source.wav",m:fmtSize(p),f:1},
    {t:"📁 stems/",m:p.stems.length,f:1},
  ].map(()=>"").join("") +
  `<div class="trow"><span class="tw">${svgIco('<path d="M14 2v6h6"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>')}</span><span class="nm">source_master.wav</span><span class="meta">${fmtSize(p)}</span></div>`+
  p.stems.map(s=>`<div class="trow indent"><span class="tw" style="color:var(${s.color})">${svgIco('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="16" r="2.5"/>')}</span><span class="nm">${s.id}.mid</span><span class="meta">${s.midi||'—'}</span></div>`).join("")+
  `<div class="trow"><span class="tw">${svgIco('<path d="M14 2v6h6"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>')}</span><span class="nm">${p.id}_score.musicxml</span><span class="meta">XML</span></div>`;
  // history
  const hist=[
    {p:"band",t:"2m ago"},{p:"orchestra",t:"1h ago"},{p:"piano",t:"3h ago"},
    {p:"band",t:"yesterday",alt:"Saffron Light — Loom"},{p:"orchestra",t:"2d ago",alt:"Concerto in E — Aria"},
  ];
  $("#hist-count").textContent=hist.length;
  $("#hist-list").innerHTML=hist.map(h=>{const pr=PROJECTS[h.p];return `<div class="hist-item" data-load="${h.p}">
    <div class="thumb" style="background:${pr.thumb}"></div>
    <div class="hi-main"><div class="hi-t">${h.alt||pr.title}</div><div class="hi-s">${pr.stems.length} stems · ${pr.key}</div></div>
    <div class="hi-time">${h.t}</div></div>`;}).join("");
}

/* ---------------- SCORE ---------------- */
function renderScore(){
  const p=P();
  $("#score-title").innerHTML=`<h1>${p.title}</h1>
    <div class="sub"><span><b>${p.artist}</b></span><span>${p.key}</span><span>♩ = ${p.tempo}</span><span>${p.timeSig.join("/")}</span><span>bars ${p.barOffset}–${p.barOffset+p.bars-1}</span><span>${p.transModel}</span></div>`;
  const wrap=$("#score-systems"); wrap.innerHTML="";
  const solo=STATE.solo.size>0;
  p.stems.forEach(s=>{
    const row=document.createElement("div");
    row.className="staff-row"+(s.id===STATE.sel?" sel":"");
    row.dataset.stem=s.id;
    const dim = s.removed || STATE.muted.has(s.id) || (solo && !STATE.solo.has(s.id));
    row.style.opacity = dim? .34 : 1;
    const cc = confColor(s.confidence);
    row.innerHTML=`<div class="staff-label">
        <div class="sl-top"><span class="sl-dot" style="background:var(${s.color})"></span><span class="sl-name">${s.name}</span></div>
        <div class="sl-sub"><span>${clefName(s.clef)}</span><span class="conf-mini"><i style="background:${cc}"></i>${s.confidence.toFixed(1)}%</span>${s.removed?'<span style="color:var(--bad)">muted</span>':''}</div>
      </div><div class="staff-svg-wrap"></div>`;
    const svg=renderStaff(s,p,{salt:0});
    row.querySelector(".staff-svg-wrap").appendChild(svg);
    wrap.appendChild(row);
  });
  applyZoom();
}
function clefName(c){return {treble:"Treble",bass:"Bass",alto:"Alto",perc:"Perc"}[c]||c;}

/* ---------------- TIMELINE ---------------- */
function renderTimeline(){
  const p=P(); const beats=p.timeSig[0]; const tb=totalBars(); const bpx=STATE.barPx;
  // gutter
  const solo=STATE.solo.size>0;
  $("#gutter").innerHTML=p.stems.map(s=>{
    const m=STATE.muted.has(s.id), so=STATE.solo.has(s.id);
    return `<div class="gutter-track" data-stem="${s.id}">
      <div class="gt-color" style="background:var(${s.color})"></div>
      <div class="gt-main"><div class="gt-name">${s.name}${s.removed?' <span style="font-size:9px;color:var(--bad);font-family:var(--mono)">REMOVED</span>':''}</div>
        <div class="gt-sub">${s.midi?s.midi+' notes':'—'} · ${Math.round(s.confidence)}%</div></div>
      <div class="gt-btns"><span class="smbtn m ${m?'on':''}" data-mute="${s.id}">M</span><span class="smbtn s ${so?'on':''}" data-solo="${s.id}">S</span></div>
    </div>`;
  }).join("");
  // ruler + grid
  buildRuler($("#ruler"), tb, bpx, beats);
  const laneH=46;
  const grid=$("#grid-canvas");
  drawGrid(grid, tb, bpx, beats, p.stems.length*laneH);
  grid.style.display=STATE.showGrid?"block":"none";
  // lanes
  const lanes=$("#lanes"); lanes.innerHTML="";
  const W=tb*bpx;
  $("#lanes-wrap").style.width=W+"px";
  $("#ruler").style.width=W+"px";
  $("#lane-col").style.width=W+"px";
  // reserve gutter footer = horizontal scrollbar height so rows stay aligned at bottom
  const sb=$("#lane-scroll").offsetHeight-$("#lane-scroll").clientHeight;
  $("#gutter-foot").style.height=Math.max(0,sb)+"px";
  p.stems.forEach(s=>{
    const lane=document.createElement("div"); lane.className="lane"; lane.dataset.stem=s.id;
    const cv=document.createElement("canvas"); lane.appendChild(cv);
    lanes.appendChild(lane);
    if(STATE.showWave) drawWaveform(cv, {...s, muted:STATE.muted.has(s.id)||(solo&&!STATE.solo.has(s.id))}, {width:W,height:laneH,beatPx:bpx/beats});
    else cv.style.display="none";
  });
  positionPlayhead();
}

/* ---------------- INSPECTOR ---------------- */
function renderInspector(){
  const p=P(); const s=p.stems.find(x=>x.id===STATE.sel)||p.stems[0];
  const body=$("#insp-body");
  if(STATE.itab==="instrument") body.innerHTML=inspInstrument(p,s);
  else if(STATE.itab==="quality") body.innerHTML=inspQuality(p,s);
  else body.innerHTML=inspExport(p,s);
}
function inspInstrument(p,s){
  const cc=confColor(s.confidence), ct=confTag(s.confidence);
  const q=s.quality||{snr:24+ (s.confidence-80)*0.4, bleed:100-s.confidence, artifacts:(100-s.confidence)/3, separation:s.confidence};
  return `
  <div class="isec">
    <div class="inst-card">
      <div class="inst-top">
        <div class="inst-ico" style="background:var(${s.color})">${svgIco(iconFor(s),'')}</div>
        <div><div class="inst-name">${s.name}</div><div class="inst-fam">${s.family}</div></div>
      </div>
      <div class="bigconf"><span class="num" style="color:${cc}">${s.confidence.toFixed(1)}</span><span class="pct">% match</span>
        <span class="tag" style="color:${cc};background:${cc}1f">${ct}</span></div>
      <div style="font-size:11.5px;color:var(--t-2);line-height:1.5">${s.note}</div>
    </div>
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M3 12h4l3-9 4 18 3-9h4"/>')}</span>Stem quality</div>
    ${metric("Source separation",q.separation,"%",confColor(q.separation))}
    ${metric("Signal-to-noise",Math.min(100,q.snr/40*100),q.snr.toFixed(1)+" dB",'var(--good)')}
    ${metric("Spectral bleed",q.bleed,q.bleed.toFixed(1)+"%",'var(--warn)',true)}
    ${metric("Artifacts",q.artifacts*5,q.artifacts.toFixed(1)+"%",'var(--bad)',true)}
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>')}</span>Transcription</div>
    <div class="metric"><div class="ml"><span class="k">MIDI events</span><span class="v">${s.midi.toLocaleString()}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Register</span><span class="v">${regName(s)}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Polyphony</span><span class="v">${/key|pno|pad|harp|guitar/.test(s.id)?'poly':'mono'}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Role</span><span class="v">${s.role||'—'}</span></div></div>
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico" style="color:var(--acc-bright)">${svgIco('<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>')}</span>AI Diagnostics<span class="more">${p.stems.length} sources</span></div>
    <div class="diag">${p.diagnostics.map(d=>diagRow(d)).join("")}</div>
  </div>`;
}
function inspQuality(p,s){
  const bars=p.spectrum.map((h,i)=>`<div class="fb" style="height:${Math.max(4,h)}%;opacity:${0.55+h/160}"></div>`).join("");
  const overall=p.stems.reduce((a,x)=>a+x.confidence,0)/p.stems.length;
  return `
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M2 12h2l3-8 4 16 3-12 2 6h6"/>')}</span>Spectral content<span class="more">FFT 4096</span></div>
    <div class="spectrum">${bars}</div>
    <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--t-3);margin-top:4px"><span>20 Hz</span><span>1 kHz</span><span>20 kHz</span></div>
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}</span>Separation summary</div>
    ${metric("Overall confidence",overall,overall.toFixed(1)+"%",confColor(overall))}
    ${metric("Phase coherence",94.2,"94.2%",'var(--good)')}
    ${metric("Reconstruction error",8,"−24.1 dB",'var(--acc)',true)}
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="13" y="6" width="3" height="12"/>')}</span>Per-stem confidence</div>
    ${p.stems.map(x=>`<div class="metric" data-stem="${x.id}" style="cursor:default">
      <div class="ml"><span class="k" style="display:flex;align-items:center;gap:6px"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:var(${x.color})"></span>${x.name}</span><span class="v" style="color:${confColor(x.confidence)}">${x.confidence.toFixed(1)}%</span></div>
      <div class="track"><i style="width:${x.confidence}%;background:${confColor(x.confidence)}"></i></div></div>`).join("")}
  </div>`;
}
function inspExport(p,s){
  const fmts=[["MIDI",".mid","All stems · type 1"],["MusicXML",".xml","Notation · score"],["PDF",".pdf","Engraved sheet"],["WAV",".wav","Stem bounce"],["Stems","ZIP","6× isolated"],["Ableton",".als","Live set"]];
  return `
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>')}</span>Export format</div>
    <div class="exp-formats">${fmts.map((f,i)=>`<div class="exp-fmt ${i===0?'sel':''}" data-fmt="${f[0]}">
      ${i===0?`<span class="ef-check">${svgIco('<path d="M20 6 9 17l-5-5"/>')}</span>`:''}
      <span class="ef-ext">${f[1]}</span><span class="ef-d">${f[2]}</span></div>`).join("")}</div>
  </div>
  <div class="isec">
    <div class="isec-h">Options</div>
    <div class="metric"><div class="ml"><span class="k">Quantize to grid</span><span class="v" style="color:var(--good)">1/16 · on</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Include velocity</span><span class="v" style="color:var(--good)">on</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Tempo map</span><span class="v">${p.tempoMap.length} points</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Range</span><span class="v">Full · bars 1–${totalBars()}</span></div></div>
  </div>
  <div class="isec">
    <div class="isec-h">Stems to include</div>
    ${p.stems.map(x=>`<div class="metric" style="margin-bottom:8px"><div class="ml"><span class="k" style="display:flex;align-items:center;gap:7px">
      <span style="width:14px;height:14px;border-radius:4px;border:1px solid var(--acc-line);background:${x.removed?'transparent':'var(--acc)'};display:grid;place-items:center">${x.removed?'':svgIco('<path d="M20 6 9 17l-5-5"/>')}</span>${x.name}</span>
      <span class="v">${x.midi||'—'}</span></div></div>`).join("")}
    <button class="exp-btn" id="do-export">Export ${p.stems.filter(x=>!x.removed).length} stems <span class="kbd">⌘E</span></button>
  </div>`;
}
function metric(k,pct,v,col,inverse){
  return `<div class="metric"><div class="ml"><span class="k">${k}</span><span class="v">${v}</span></div>
    <div class="track"><i style="width:${Math.max(2,Math.min(100,pct))}%;background:${col}"></i></div></div>`;
}
function diagRow(d){
  const ic={ok:'<path d="M20 6 9 17l-5-5"/>',warn:'<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',err:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'}[d.sev];
  const col={ok:'var(--good)',warn:'var(--warn)',err:'var(--bad)',info:'var(--acc-bright)'}[d.sev];
  return `<div class="diag-row"><span class="diag-ic" style="color:${col}">${svgIco(ic)}</span>
    <div class="diag-main"><div class="dt">${d.t}</div><div class="ds">${d.s}</div></div>
    <div class="diag-val" style="color:${col}">${d.v}</div></div>`;
}

/* ---------------- helpers ---------------- */
function confColor(c){ return c>=90?'var(--good)':c>=78?'var(--warn)':'var(--bad)'; }
function confTag(c){ return c>=95?'Certain':c>=88?'High':c>=78?'Probable':'Ambiguous'; }
function regName(s){ if(!s.reg)return'—'; const names=["C","D","E","F","G","A","B"]; const f=d=>names[((d%7)+7)%7]+(Math.floor(d/7)); return f(s.reg[0])+"–"+f(s.reg[1]); }
function fmtTime(sec){ const m=Math.floor(sec/60),s=Math.floor(sec%60); return m+":"+String(s).padStart(2,"0"); }
function fmtSize(p){ return ((p.duration*p.sampleRate*p.bitDepth*2)/8/1e6).toFixed(0)+"MB"; }

/* ---------------- ZOOM ---------------- */
function applyZoom(){
  $("#score-paper").style.transform=`scale(${STATE.zoom})`;
  $("#score-paper").style.transformOrigin="top left";
  $("#zoom-val").textContent=Math.round(STATE.zoom*100)+"%";
  $("#sbar-zoom").textContent=Math.round(STATE.zoom*100)+"%";
}

/* ---------------- PLAYBACK ---------------- */
function positionPlayhead(){
  const bpx=STATE.barPx;
  $("#playhead").style.left=(STATE.pos*bpx)+"px";
  // timecode
  const p=P(); const beats=p.timeSig[0];
  const bar=Math.floor(STATE.pos)+1, beat=Math.floor((STATE.pos%1)*beats)+1, tick=Math.floor(((STATE.pos%1)*beats%1)*100);
  $("#tc-bars").textContent=String(bar).padStart(3,"0");
  $("#tc-beat").textContent=beat;
  $("#tc-tick").textContent=String(tick).padStart(2,"0");
  const secs=STATE.pos*beats*60/p.tempo;
  $("#tc-time").textContent=fmtTime(secs)+"."+String(Math.floor((secs%1)*10));
}
function tick(t){
  if(!STATE.playing){ raf=null; return; }
  if(!lastT)lastT=t; const dt=(t-lastT)/1000; lastT=t;
  const p=P(); const barsPerSec=p.tempo/60/p.timeSig[0];
  STATE.pos+=barsPerSec*dt;
  if(STATE.pos>=totalBars()){ STATE.pos=0; }
  positionPlayhead();
  // autoscroll lane
  const sc=$("#lane-scroll"); const x=STATE.pos*STATE.barPx;
  if(x>sc.scrollLeft+sc.clientWidth-120||x<sc.scrollLeft) sc.scrollLeft=x-120;
  raf=requestAnimationFrame(tick);
}
function barsToSecs(bars){ const p=P(); return bars*p.timeSig[0]*60/p.tempo; }
function setPlaying(v){
  STATE.playing=v; lastT=0;
  $("#play-ico").innerHTML = v?'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>':'<path d="M7 4l13 8-13 8z"/>';
  if(v){ if(AudioEngine.isLoaded()) AudioEngine.start(barsToSecs(STATE.pos)); if(!raf) raf=requestAnimationFrame(tick); }
  else { AudioEngine.stop(); }
}

/* ---------------- SELECTION ---------------- */
function selectStem(id){
  STATE.sel=id; const s=P().stems.find(x=>x.id===id);
  $$(".staff-row").forEach(r=>r.classList.toggle("sel",r.dataset.stem===id));
  $$(".gutter-track").forEach(r=>r.style.background=r.dataset.stem===id?"var(--bg-3)":"");
  $$('#nav-tree .trow.indent').forEach(r=>r.classList.toggle("active",r.dataset.stem===id));
  $("#sbar-sel").textContent=(s?s.name:"")+" selected";
  if(STATE.itab!=="export") renderInspector();
}

/* ---------------- SCENES ---------------- */
const SCENES={
  empty:{pill:["","Ready — no project"],ovr:"ov-empty",sbar:"Idle"},
  loading:{pill:["work","Opening…"],ovr:"ov-load",sbar:"Loading"},
  processing:{pill:["work","Processing…"],ovr:"ov-proc",sbar:"Analyzing"},
  error:{pill:["err","Analysis failed"],ovr:"ov-error",sbar:"Error"},
  success:{pill:["ok","Analysis complete"],ovr:null,sbar:"Ready"},
};
function setScene(scene){
  STATE.scene=scene; document.body.dataset.scene=scene;
  $$(".overlay").forEach(o=>o.classList.remove("show"));
  const cfg=SCENES[scene];
  if(cfg.ovr) $("#"+cfg.ovr).classList.add("show");
  const pill=$("#scene-pill"); pill.className="pill "+(cfg.pill[0]||"");
  $("#scene-pill-t").textContent=cfg.pill[1];
  $("#crumb-dot").style.background = scene==="error"?"var(--bad)":scene==="success"?"var(--good)":"var(--warn)";
  $("#sbar-scene").textContent=cfg.sbar;
  if(scene==="processing") runProcessing();
  if(scene==="error") fillErrorLog();
  if(scene==="loading"){ setTimeout(()=>{ if(STATE.scene==="loading") setScene("success"); },900); }
}
function loadProject(key,scene){
  STATE.pkey=key; const p=P();
  STATE.sel=p.stems.find(s=>!s.removed)?.id||p.stems[0].id;
  STATE.muted=new Set(); STATE.solo=new Set(); STATE.pos=p.barOffset||5;
  document.body.dataset.project=key;
  $("#proc-tt").textContent=p.title; $("#proc-ts").textContent=`${p.artist} · ${fmtTime(p.duration)} · ${p.sampleRate/1000} kHz/${p.bitDepth}-bit`;
  $("#proc-thumb").style.background=p.thumb;
  renderAll();
  setScene(scene||"success");
  selectStem(STATE.sel);
}
function renderAll(){ renderMeta(); renderLeft(); renderScore(); renderTimeline(); renderInspector(); positionPlayhead(); }

/* processing animation */
const PSTAGES=[
  {n:"Fetch & decode audio",ic:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'},
  {n:"Source separation (Demucs)",ic:'<path d="M3 12h4l3-9 4 18 3-9h4"/>'},
  {n:"Instrument identification",ic:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'},
  {n:"MIDI transcription",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M11 4v16M15 4v16"/>'},
  {n:"Notation engraving",ic:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>'},
];
let procTimer=null;
function _renderProcStages(prog, stageIdx){
  $$("#proc-stages .pstage").forEach((ps,i)=>{
    ps.className="pstage "+(i<stageIdx?"done":i===stageIdx?"active":"pending");
    const meta=ps.querySelector(".pst-meta");
    const ic=ps.querySelector(".pst-ic");
    if(i<stageIdx){ ic.innerHTML=svgIco('<path d="M20 6 9 17l-5-5"/>'); meta.textContent="done"; }
    else if(i===stageIdx){ ic.innerHTML='<span class="spinner"></span>'; meta.textContent=["48kHz","6 sources","12 classes","quantizing","layout"][i]||"…"; }
    else { ic.innerHTML=svgIco(PSTAGES[i].ic); meta.textContent="queued"; }
  });
  const pct=Math.round(prog*100);
  $("#proc-pct").textContent=pct+"%";
  $("#proc-bar-i").style.width=pct+"%";
}
async function runProcessing(){
  const host=$("#proc-stages");
  host.innerHTML=PSTAGES.map((s,i)=>`<div class="pstage pending" data-i="${i}">
    <span class="pst-ic">${svgIco(s.ic)}</span><span class="pst-name">${s.n}</span><span class="pst-meta"></span></div>`).join("");
  clearInterval(procTimer);

  // Try real backend; fall back to demo simulation if unavailable
  if(STATE.url && STATE.url.startsWith("http")){
    try {
      const r = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:STATE.url})});
      if(!r.ok) throw new Error("Server "+r.status);
      const {session_id} = await r.json();
      flash("Analyzing…  session "+session_id.slice(0,8));

      const poll = setInterval(async ()=>{
        if(STATE.scene!=="processing"){ clearInterval(poll); return; }
        let job;
        try { job = await fetch(`/api/status/${session_id}`).then(x=>x.json()); }
        catch(_){ return; }

        const prog = job.progress||0;
        const si   = job.stage>=0 ? job.stage : 0;
        _renderProcStages(prog, si);
        $("#proc-eta").textContent = prog>=1?"Finalizing…":"Processing locally…";
        $("#proc-gpu").textContent = job.meta?.gpu ? `GPU ${job.meta.gpu.util}% · ${job.meta.gpu.model}` : "GPU — local";

        if(job.status==="done"){
          clearInterval(poll);
          const m = job.meta||{};
          const stems = (job.stems||[]).map(s=>({
            ...s,
            density: s.density||2,
            seed: typeof s.seed==='number' ? s.seed : (s.id.split('').reduce((a,c)=>a*31+c.charCodeAt(0),1)&0x7fffffff)%50000,
            reg: s.reg||null,
          }));
          STATE.liveProject = {
            id:"live", kind:"live",
            title: m.title||"Untitled", artist: m.artist||"", album:"", source: STATE.url,
            thumb: m.thumb ? `url("${m.thumb}") center/cover` : "linear-gradient(135deg,oklch(0.4 0.12 260),oklch(0.5 0.1 200))",
            duration: m.duration||180, tempo: m.tempo||120, tempoMap:[[0,m.tempo||120]],
            key: m.key||"A minor", timeSig: m.timeSig||[4,4],
            sampleRate: m.sampleRate||44100, bitDepth: m.bitDepth||24,
            sepModel: m.sepModel||"HT-Demucs v4", transModel: m.transModel||"librosa-pyin",
            gpu: m.gpu||{model:"CPU",util:0,vram:0,vramTotal:0},
            bars:8, barOffset:0,
            stems, diagnostics:[], spectrum:[],
          };
          STATE.pkey="live";
          STATE.liveSid=session_id;
          if(stems.length){
            flash("Loading stems…");
            await Promise.all([
              AudioEngine.loadFromSession(stems, (p,id,ok)=>{ if(!ok) flash("Failed: "+id); }),
              _loadMidiNotes(session_id, STATE.liveProject.stems),
            ]);
            flash("Stems + MIDI loaded — press Space to play");
          }
          renderAll();
          setTimeout(()=>{ if(STATE.scene==="processing") setScene("success"); },300);
        } else if(job.status==="error"){
          clearInterval(poll);
          fillErrorLog(job.error||"Unknown error");
          setScene("error");
        }
      }, 800);
      return;
    } catch(e){
      flash("Server not reachable — demo mode");
    }
  }

  // Demo simulation (no server)
  const dur=[1.0,2.6,1.2,1.8,1.0]; const tot=dur.reduce((a,b)=>a+b);
  const t0=performance.now();
  const tickP=()=>{
    if(STATE.scene!=="processing"){clearInterval(procTimer);return;}
    const el=(performance.now()-t0)/1000;
    const prog=Math.min(1,el/tot);
    let acc=0,active=0;
    for(let i=0;i<dur.length;i++){ acc+=dur[i]; if(el<acc){active=i;break;} active=dur.length; }
    _renderProcStages(prog,active);
    $("#proc-eta").textContent= prog>=1?"Finalizing…":("~"+Math.ceil((tot-el))+"s remaining");
    $("#proc-gpu").textContent=`GPU ${Math.round(40+Math.random()*55)}% · RTX 4090`;
    if(prog>=1){ clearInterval(procTimer); setTimeout(()=>{ if(STATE.scene==="processing") setScene("success"); },650); }
  };
  procTimer=setInterval(tickP,80); tickP();
}
function fillErrorLog(msg){
  const ts=new Date().toTimeString().slice(0,8);
  $("#err-log").innerHTML=[
    `<span style="color:var(--t-3)">${ts}</span> yt-extract: resolving stream manifest…`,
    `<span style="color:var(--t-3)">${ts}</span> <span class="ln-warn">WARN</span> 3 of 4 formats unavailable`,
    `<span style="color:var(--t-3)">${ts}</span> <span class="ln-err">ERROR</span> ${msg||"HTTP 403 — signature cipher rejected"}`,
    `<span style="color:var(--t-3)">${ts}</span> pipeline halted · 0 stems written`,
  ].join("<br/>");
}

/* ---------------- CONTEXT MENU ---------------- */
function showCtx(x,y,items){
  const ctx=$("#ctx");
  ctx.innerHTML=items.map(it=>{
    if(it.sep)return'<div class="ctx-sep"></div>';
    if(it.label)return`<div class="ctx-label">${it.label}</div>`;
    return`<div class="ctx-item ${it.danger?'danger':''}" data-act="${it.act||''}"><span class="ci-ic">${it.ic?svgIco(it.ic):''}</span>${it.t}${it.k?`<span class="ci-k">${it.k}</span>`:''}</div>`;
  }).join("");
  ctx.style.left=Math.min(x,innerWidth-230)+"px"; ctx.style.top=Math.min(y,innerHeight-260)+"px";
  ctx.classList.add("show");
}
function hideCtx(){ $("#ctx").classList.remove("show"); }

/* ---------------- COMMAND PALETTE ---------------- */
const CMDS=[
  {g:"Projects",t:"Open · Midnight Cartography",s:"band",ic:ICONS.synth,act:()=>loadProject("band")},
  {g:"Projects",t:"Open · Aurora Borealis Suite",s:"14 stems",ic:ICONS.strings,act:()=>loadProject("orchestra")},
  {g:"Projects",t:"Open · Gymnopédie No. 1",s:"solo piano",ic:ICONS.keys,act:()=>loadProject("piano")},
  {g:"States",t:"Show empty state",ic:'<rect x="3" y="3" width="18" height="18" rx="2"/>',act:()=>setScene("empty")},
  {g:"States",t:"Simulate new analysis (processing)",ic:'<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',act:()=>setScene("processing")},
  {g:"States",t:"Show error state",ic:'<path d="M12 9v4M12 17h.01"/>',act:()=>setScene("error")},
  {g:"Transport",t:"Play / Pause",k:"Space",ic:'<path d="M7 4l13 8-13 8z"/>',act:()=>setPlaying(!STATE.playing)},
  {g:"Transport",t:"Return to start",ic:'<path d="M19 5v14L8 12z"/>',act:()=>{STATE.pos=0;positionPlayhead();}},
  {g:"Export",t:"Export all stems as MIDI",k:"⌘E",ic:'<path d="M21 15v4M7 10l5 5 5-5M12 15V3"/>',act:()=>flash("Exported "+P().stems.length+" stems → MIDI")},
  {g:"View",t:"Toggle waveforms",ic:'<path d="M2 12h2l3-8 4 16 3-12 2 6h6"/>',act:()=>{$("#tg-wave").click();}},
];
function openCmdk(){ $("#cmdk").classList.add("show"); $("#cmdk-input").value=""; renderCmdk(""); $("#cmdk-input").focus(); }
function closeCmdk(){ $("#cmdk").classList.remove("show"); }
let cmdkSel=0, cmdkFiltered=[];
function renderCmdk(q){
  cmdkFiltered=CMDS.filter(c=>(c.t+c.g).toLowerCase().includes(q.toLowerCase()));
  cmdkSel=0;
  const groups={};
  cmdkFiltered.forEach(c=>{(groups[c.g]=groups[c.g]||[]).push(c);});
  let html="",idx=0;
  for(const g in groups){ html+=`<div class="cmdk-grp">${g}</div>`;
    groups[g].forEach(c=>{ html+=`<div class="cmdk-item ${idx===0?'sel':''}" data-idx="${idx}"><span class="cmi-ic">${svgIco(c.ic)}</span><span class="cmi-t">${c.t}</span>${c.s?`<span class="cmi-s">${c.s}</span>`:''}${c.k?`<span class="kbd">${c.k}</span>`:''}</div>`; idx++; }); }
  $("#cmdk-list").innerHTML=html||'<div class="cmdk-grp">No results</div>';
}
function runCmdk(i){ const c=cmdkFiltered[i]; if(c){ closeCmdk(); c.act(); } }

/* ---------------- FLASH ---------------- */
let flashT=null;
function flash(msg){ $("#flash-t").textContent=msg; $("#flash").classList.add("show"); clearTimeout(flashT); flashT=setTimeout(()=>$("#flash").classList.remove("show"),2200); }

/* ---------------- MIDI NOTE LOADER ---------------- */
async function _loadMidiNotes(sid, stems){
  await Promise.allSettled(stems.map(async s => {
    if(!s.midi_url || s.clef==="perc") return;
    try {
      const r = await fetch(`/api/midi/${sid}/${s.id}`);
      if(r.ok){ const d=await r.json(); s.midiNotes=d.notes||[]; }
    } catch(_){}
  }));
}

/* ---------------- LOCAL FILE UPLOAD ---------------- */
async function submitLocalFile(file){
  STATE.liveProject=null;
  STATE.url="local:"+file.name;
  setScene("processing");
  $("#proc-tt").textContent=file.name;
  $("#proc-ts").textContent=(file.size/1e6).toFixed(1)+" MB · local file";

  const fd=new FormData();
  fd.append("file",file);
  let sid;
  try {
    const r=await fetch("/api/upload",{method:"POST",body:fd});
    if(!r.ok) throw new Error("Upload failed "+r.status);
    ({session_id:sid}=await r.json());
  } catch(e) {
    fillErrorLog("Upload failed: "+e.message);
    setScene("error");
    return;
  }

  flash("Uploading… session "+sid.slice(0,8));
  const poll=setInterval(async()=>{
    if(STATE.scene!=="processing"){clearInterval(poll);return;}
    let job;
    try{job=await fetch(`/api/status/${sid}`).then(x=>x.json());}catch(_){return;}
    const prog=job.progress||0, si=job.stage>=0?job.stage:0;
    _renderProcStages(prog,si);
    $("#proc-eta").textContent=prog>=1?"Finalizing…":"Processing locally…";
    $("#proc-gpu").textContent=job.meta?.gpu?`${job.meta.gpu.model}`:"CPU · local";
    if(job.status==="done"){
      clearInterval(poll);
      const m=job.meta||{};
      const stems=(job.stems||[]).map(s=>({
        ...s,
        density:s.density||2,
        seed:typeof s.seed==='number'?s.seed:(s.id.split('').reduce((a,c)=>a*31+c.charCodeAt(0),1)&0x7fffffff)%50000,
        reg:s.reg||null,
      }));
      STATE.liveProject={
        id:"live",kind:"live",
        title:m.title||file.name,artist:m.artist||"Local file",album:"",source:file.name,
        thumb:"linear-gradient(135deg,oklch(0.4 0.12 260),oklch(0.5 0.1 200))",
        duration:m.duration||0,tempo:m.tempo||120,tempoMap:[[0,m.tempo||120]],
        key:m.key||"A minor",timeSig:m.timeSig||[4,4],
        sampleRate:m.sampleRate||44100,bitDepth:m.bitDepth||24,
        sepModel:m.sepModel||"HT-Demucs v4",transModel:m.transModel||"librosa-pyin",
        gpu:m.gpu||{model:"CPU",util:0,vram:0,vramTotal:0},
        bars:8,barOffset:0,stems,diagnostics:[],spectrum:[],
      };
      STATE.pkey="live";
      STATE.liveSid=sid;
      if(stems.length){
        flash("Loading stems…");
        await Promise.all([
          AudioEngine.loadFromSession(stems,(p,id,ok)=>{if(!ok)flash("Failed: "+id);}),
          _loadMidiNotes(sid, STATE.liveProject.stems),
        ]);
        flash("Stems + MIDI loaded — press Space to play");
      }
      renderAll();
      setTimeout(()=>{if(STATE.scene==="processing")setScene("success");},300);
    } else if(job.status==="error"){
      clearInterval(poll);
      fillErrorLog(job.error||"Unknown error");
      setScene("error");
    }
  },800);
}

/* ---------------- EVENTS ---------------- */
function bind(){
  // File picker wired to hidden input
  $("#file-picker").addEventListener("change",e=>{
    const f=e.target.files?.[0];
    if(f) submitLocalFile(f);
    e.target.value="";
  });

  // Drag-drop audio — visual feedback + handler
  let _dragLeaveTimer = null;
  document.addEventListener("dragenter", e=>{ e.preventDefault(); document.body.classList.add("drag-over"); clearTimeout(_dragLeaveTimer); });
  document.addEventListener("dragover",  e=>{ e.preventDefault(); e.dataTransfer.dropEffect="copy"; clearTimeout(_dragLeaveTimer); });
  document.addEventListener("dragleave", e=>{ _dragLeaveTimer=setTimeout(()=>document.body.classList.remove("drag-over"),80); });
  document.addEventListener("drop",e=>{
    e.preventDefault();
    document.body.classList.remove("drag-over");
    const f=e.dataTransfer.files?.[0];
    if(!f) return;
    if(f.type.startsWith("audio/")||f.type.startsWith("video/")||/\.(mp3|wav|flac|aac|ogg|m4a|mp4|webm)$/i.test(f.name)){
      submitLocalFile(f);
    } else {
      flash("Drop an audio or video file");
    }
  });

  document.addEventListener("click",e=>{
    const t=e.target;
    const load=t.closest("[data-load]"); if(load){ loadProject(load.dataset.load, load.dataset.load && SCENES[load.dataset.load]?undefined:undefined); return; }
    const stemEl=t.closest("[data-stem]");
    const mute=t.closest("[data-mute]"); if(mute){ e.stopPropagation(); toggleMute(mute.dataset.mute); return; }
    const solo=t.closest("[data-solo]"); if(solo){ e.stopPropagation(); toggleSolo(solo.dataset.solo); return; }
    if(stemEl&&!t.closest(".gt-btns")){ selectStem(stemEl.dataset.stem); return; }
    // tabs
    const tab=t.closest(".tab"); if(tab){ $$(".tab").forEach(x=>x.classList.toggle("active",x===tab)); if(tab.dataset.tab!=="score") flash(tab.textContent.trim()+" view — score is the active mock"); return; }
    const itab=t.closest(".insp-tab"); if(itab){ STATE.itab=itab.dataset.itab; $$(".insp-tab").forEach(x=>x.classList.toggle("active",x===itab)); renderInspector(); return; }
    const stool=t.closest(".stool"); if(stool&&stool.dataset.tool){ $$(".stool").forEach(x=>x.classList.remove("active")); stool.classList.add("active"); return; }
    const fmt=t.closest(".exp-fmt"); if(fmt){ $$(".exp-fmt").forEach(x=>x.classList.remove("sel")); fmt.classList.add("sel"); return; }
    if(t.closest("#do-export")){
      const p=P(); const fmt=($(".exp-fmt.sel .ef-ext")||{}).textContent||".mid";
      const activeSt=p.stems.filter(s=>!s.removed);
      if(fmt===".mid" && STATE.liveSid && activeSt.some(s=>s.midi_url)){
        activeSt.filter(s=>s.midi_url).forEach((s,i)=>{
          setTimeout(()=>{ const a=document.createElement("a"); a.href=s.midi_url; a.download=s.id+".mid"; document.body.appendChild(a); a.click(); document.body.removeChild(a); }, i*250);
        });
        flash("Downloading "+activeSt.filter(s=>s.midi_url).length+" MIDI files…");
      } else if(fmt===".wav" && STATE.liveSid && activeSt.some(s=>s.audio_url)){
        activeSt.filter(s=>s.audio_url).forEach((s,i)=>{
          setTimeout(()=>{ const a=document.createElement("a"); a.href=s.audio_url; a.download=s.id+".wav"; document.body.appendChild(a); a.click(); document.body.removeChild(a); }, i*250);
        });
        flash("Downloading "+activeSt.filter(s=>s.audio_url).length+" stem WAVs…");
      } else {
        flash("Exported "+activeSt.length+" stems → "+(fmt||".mid"));
      }
      return;
    }
    // ctx actions
    const ca=t.closest(".ctx-item"); if(ca){ handleCtxAct(ca.dataset.act); hideCtx(); return; }
    // cmdk item
    const ci=t.closest(".cmdk-item"); if(ci&&ci.dataset.idx!=null){ runCmdk(+ci.dataset.idx); return; }
    if(t.closest("#btn-cmdk")){ openCmdk(); return; }
    if(t.id==="cmdk"){ closeCmdk(); return; }
    // scene pill menu
    if(t.closest("#scene-pill")){ const r=t.closest("#scene-pill").getBoundingClientRect(); showCtx(r.left,r.bottom+4,[
      {label:"Application states"},
      {t:"Success / loaded",ic:'<path d="M20 6 9 17l-5-5"/>',act:"sc:success"},
      {t:"Empty",ic:'<rect x="3" y="3" width="18" height="18" rx="2"/>',act:"sc:empty"},
      {t:"Processing",ic:'<path d="M12 2v4M2 12h4"/>',act:"sc:processing"},
      {t:"Error",ic:'<path d="M12 9v4M12 17h.01"/>',act:"sc:error"},
      {sep:1},{label:"Projects"},
      {t:"Solo piano (small)",ic:ICONS.keys,act:"pj:piano"},
      {t:"Orchestral (massive)",ic:ICONS.strings,act:"pj:orchestra"},
    ]); return; }
    hideCtx();
    // transport
    if(t.closest("#tp-play")) setPlaying(!STATE.playing);
    if(t.closest("#tp-stop")){ setPlaying(false); STATE.pos=P().barOffset||0; positionPlayhead(); }
    if(t.closest("#tp-start")){ STATE.pos=0; positionPlayhead(); $("#lane-scroll").scrollLeft=0; }
    if(t.closest("#tp-loop")) t.closest("#tp-loop").classList.toggle("on");
    // toggles
    if(t.closest("#tg-wave")){ STATE.showWave=!STATE.showWave; $("#tg-wave").classList.toggle("on",STATE.showWave); renderTimeline(); }
    if(t.closest("#tg-beat")){ STATE.showGrid=!STATE.showGrid; $("#tg-beat").classList.toggle("on",STATE.showGrid); $("#grid-canvas").style.display=STATE.showGrid?"block":"none"; }
    if(t.closest("#tg-tempo")){ t.closest("#tg-tempo").classList.toggle("on"); flash("Tempo map "+(t.closest("#tg-tempo").classList.contains("on")?"shown":"hidden")); }
    if(t.closest("#zoom-in")){ STATE.zoom=Math.min(2,STATE.zoom+0.1); applyZoom(); }
    if(t.closest("#zoom-out")){ STATE.zoom=Math.max(0.6,STATE.zoom-0.1); applyZoom(); }
    if(t.closest("#err-retry")){ setScene("processing"); }
    if(t.closest("#err-dismiss")){ setScene("success"); }
    if(t.closest("#err-file")){ $("#file-picker").click(); }
    if(t.closest(".er")){ const er=t.closest(".er"); loadProject(er.dataset.load,"processing"); return; }
    if(t.closest("#empty-go")){ const v=$("#empty-input").value.trim(); if(v){ submitUrl(v); } return; }
  });
  // lane seek
  $("#lane-scroll").addEventListener("mousedown",e=>{
    if(e.target.closest(".playhead"))return;
    const wrap=$("#lanes-wrap"); const rect=wrap.getBoundingClientRect();
    const x=e.clientX-rect.left; STATE.pos=Math.max(0,x/STATE.barPx); positionPlayhead();
    if(STATE.playing){ AudioEngine.stop(); AudioEngine.start(barsToSecs(STATE.pos)); }
  });
  // ruler seek
  $("#ruler").addEventListener("mousedown",e=>{ const r=e.currentTarget.getBoundingClientRect(); STATE.pos=Math.max(0,(e.clientX-r.left)/STATE.barPx); positionPlayhead(); });
  // synced vertical scroll between gutter & lanes
  const gv=$("#gutter-scroll"), lv=$("#lanes-vscroll"); let syncing=false;
  lv.addEventListener("scroll",()=>{ if(syncing)return; syncing=true; gv.scrollTop=lv.scrollTop; syncing=false; });
  gv.addEventListener("scroll",()=>{ if(syncing)return; syncing=true; lv.scrollTop=gv.scrollTop; syncing=false; });
  // context menus
  document.addEventListener("contextmenu",e=>{
    const g=e.target.closest("[data-stem]");
    if(g){ e.preventDefault(); const id=g.dataset.stem; const s=P().stems.find(x=>x.id===id); selectStem(id);
      showCtx(e.clientX,e.clientY,[
        {label:s.name},
        {t:"Solo this stem",ic:'<circle cx="12" cy="12" r="3"/>',k:"S",act:"solo:"+id},
        {t:STATE.muted.has(id)?"Unmute":"Mute",ic:'<path d="M11 5 6 9H2v6h4l5 4z"/>',k:"M",act:"mute:"+id},
        {sep:1},
        {t:"Open in piano roll",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/>',act:"flash:Piano roll"},
        {t:"Re-identify instrument",ic:'<path d="M21 12a9 9 0 1 1-3-6.7"/>',act:"flash:Re-running identification…"},
        {t:"Export stem…",ic:'<path d="M12 3v12M7 10l5 5 5-5"/>',k:"⌘E",act:"flash:Export "+s.name},
        {sep:1},
        {t:"Delete stem",ic:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',danger:1,act:"flash:Stem removed"},
      ]); return; }
    if(e.target.closest(".staff-row")||e.target.closest("#score-paper")){ e.preventDefault();
      showCtx(e.clientX,e.clientY,[
        {label:"Score"},
        {t:"Insert note",ic:'<circle cx="7" cy="18" r="3"/><path d="M10 18V4l9-2"/>',k:"N",act:"flash:Note input"},
        {t:"Change clef",ic:'<path d="M9 18V5l12-2"/>',act:"flash:Clef menu"},
        {t:"Add dynamic",ic:'<path d="M3 12h18"/>',act:"flash:Dynamic"},
        {sep:1},
        {t:"Toggle concert pitch",ic:'<path d="M12 2v20"/>',act:"flash:Concert pitch"},
        {t:"Print score…",ic:'<rect x="6" y="9" width="12" height="7"/><path d="M6 9V3h12v6"/>',k:"⌘P",act:"flash:Printing…"},
      ]); return; }
  });
  // omnibox enter
  function submitUrl(url){ STATE.url=(url||"").trim(); STATE.liveProject=null; setScene("processing"); }
  $("#omni-input").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.target.blur(); submitUrl(e.target.value); }});
  $("#omni-input").addEventListener("blur",e=>{ STATE.url=(e.target.value||"").trim(); });
  $("#empty-input").addEventListener("keydown",e=>{ if(e.key==="Enter") submitUrl(e.target.value); });
  // cmdk input
  $("#cmdk-input").addEventListener("input",e=>renderCmdk(e.target.value));
  $("#cmdk-input").addEventListener("keydown",e=>{
    const items=$$(".cmdk-item");
    if(e.key==="ArrowDown"){ e.preventDefault(); cmdkSel=Math.min(items.length-1,cmdkSel+1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); cmdkSel=Math.max(0,cmdkSel-1); }
    else if(e.key==="Enter"){ runCmdk(cmdkSel); return; }
    else return;
    items.forEach((it,i)=>it.classList.toggle("sel",i===cmdkSel));
    items[cmdkSel]?.scrollIntoView({block:"nearest"});
  });
  // global keys
  document.addEventListener("keydown",e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); openCmdk(); return; }
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="e"){ e.preventDefault(); flash("Exported "+P().stems.filter(s=>!s.removed).length+" stems → MIDI"); return; }
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="l"){ e.preventDefault(); $("#omni-input").focus(); $("#omni-input").select(); return; }
    if(e.key==="Escape"){ closeCmdk(); hideCtx(); }
    if(e.target.tagName==="INPUT")return;
    if(e.code==="Space"){ e.preventDefault(); setPlaying(!STATE.playing); }
    if(e.key==="m"&&STATE.sel) toggleMute(STATE.sel);
    if(e.key==="s"&&STATE.sel) toggleSolo(STATE.sel);
    if(e.key==="+"||e.key==="="){ STATE.zoom=Math.min(2,STATE.zoom+0.1); applyZoom(); }
    if(e.key==="-"){ STATE.zoom=Math.max(0.6,STATE.zoom-0.1); applyZoom(); }
    // arrow select stem
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){ const st=P().stems; let i=st.findIndex(s=>s.id===STATE.sel); i=(i+(e.key==="ArrowDown"?1:-1)+st.length)%st.length; selectStem(st[i].id); }
  });
  // hover hints on transport
  document.addEventListener("mouseover",e=>{ const h=e.target.closest("[title]"); });
}
function handleCtxAct(act){
  if(!act)return;
  if(act.startsWith("sc:")) setScene(act.slice(3));
  else if(act.startsWith("pj:")) loadProject(act.slice(3));
  else if(act.startsWith("solo:")) toggleSolo(act.slice(5));
  else if(act.startsWith("mute:")) toggleMute(act.slice(5));
  else if(act.startsWith("flash:")) flash(act.slice(6));
}
function toggleMute(id){ STATE.muted.has(id)?STATE.muted.delete(id):STATE.muted.add(id); AudioEngine.setMute(id, STATE.muted.has(id)); renderScore(); renderTimeline(); selectStem(STATE.sel); }
function toggleSolo(id){ STATE.solo.has(id)?STATE.solo.delete(id):STATE.solo.add(id); AudioEngine.setSolo([...STATE.solo]); renderScore(); renderTimeline(); }

/* ---------------- INIT ---------------- */
function boot(){ bind(); loadProject("band","success"); }
document.fonts && document.fonts.ready.then(()=>{ renderScore(); });
boot();
