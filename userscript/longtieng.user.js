// ==UserScript==
// @name         Lồng tiếng Việt cho YouTube
// @namespace    https://github.com/iamboo98/longtieng
// @version      1.5.0
// @description  Tự lồng tiếng Việt video YouTube: lấy phụ đề (tự dịch sang tiếng Việt nếu cần) và đọc bằng giọng Việt khớp theo video.
// @author       iamboo98
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// @icon         https://raw.githubusercontent.com/iamboo98/longtieng/main/logo.svg
// @downloadURL  https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng.user.js
// @updateURL    https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ltvLoaded) return;
  window.__ltvLoaded = true;

  /* ---------- Bắt link phụ đề mà trình phát YouTube tự tải (có kèm mã xác thực) ---------- */
  const ttUrls = [];
  const note = (u) => {
    try {
      u = String(u);
      if (u.includes('/api/timedtext')) ttUrls.push(new URL(u, location.href).href);
    } catch (e) {}
  };
  const oOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { note(u); return oOpen.apply(this, arguments); };
  const oFetch = window.fetch.bind(window);
  window.fetch = function (i, o) { note(typeof i === 'string' ? i : i && i.url); return oFetch(i, o); };

  /* ---------- Cài đặt ---------- */
  const STYLES = [
    ['tn', 'Tự nhiên', 1.0, 1.0], ['nt', 'Nam trầm', 0.55, 0.95], ['nm', 'Nam trẻ', 0.8, 1.05],
    ['nu', 'Nữ trong trẻo', 1.3, 1.05], ['nd', 'Nữ dịu dàng', 1.15, 0.9], ['te', 'Trẻ em', 1.7, 1.1],
    ['gi', 'Người già', 0.7, 0.82], ['tt', 'Tin tức', 1.0, 1.12], ['kc', 'Kể chuyện', 0.9, 0.88],
    ['hh', 'Hào hứng', 1.25, 1.2], ['ht', 'Hoạt hình', 1.95, 1.15],
  ];
  const DEF = { voice: 'auto', style: 'tn', rate: 1, duck: 0.1, sub: true, wait: true, source: 'auto', srv: '', key: '', groq: '', ai: true, cast: true };
  let cfg = DEF;
  try { cfg = Object.assign({}, DEF, JSON.parse(localStorage.getItem('ltv_yt') || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem('ltv_yt', JSON.stringify(cfg)); } catch (e) {} };

  /* ---------- Trạng thái ---------- */
  let cues = [], vid = null, video = null, timer = 0, running = false;
  let spoken = new Set(), speaking = -1, pending = -1, holdPause = false;
  let orig = null; // âm lượng gốc của người xem
  const CPS = 14.5;

  const videoId = () => {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]{11})/) || [])[1] || null;
    } catch (e) { return null; }
  };
  const getVideo = () => document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video, .html5-video-player video, video');
  const getPlayer = () => document.getElementById('movie_player') || (getVideo() && getVideo().closest('.html5-video-player'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Lấy danh sách phụ đề ---------- */
  function extractJSON(html, key) {
    let i = html.indexOf(key + ' = {');
    if (i < 0) i = html.indexOf(key + '={');
    if (i < 0) i = html.indexOf('"' + key + '":{');
    if (i < 0) return null;
    i = html.indexOf('{', i);
    let d = 0, inS = false, esc = false;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inS = false; continue; }
      if (c === '"') inS = true;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (!d) { try { return JSON.parse(html.slice(i, j + 1)); } catch (e) { return null; } } }
    }
    return null;
  }
  async function playerResponse(id) {
    const p = getPlayer();
    try {
      const r = p && p.getPlayerResponse && p.getPlayerResponse();
      if (r && r.videoDetails && r.videoDetails.videoId === id) return r;
    } catch (e) {}
    const w = window.ytInitialPlayerResponse;
    if (w && w.videoDetails && w.videoDetails.videoId === id) return w;
    const html = await (await oFetch(location.origin + '/watch?v=' + id, { credentials: 'include' })).text();
    return extractJSON(html, 'ytInitialPlayerResponse');
  }
  function chooseTrack(tracks) {
    const isVi = (t) => /^vi/i.test(t.languageCode);
    const manual = tracks.filter((t) => t.kind !== 'asr'), asr = tracks.filter((t) => t.kind === 'asr');
    const viM = manual.find(isVi); if (viM) return { t: viM, tl: false };
    const viA = asr.find(isVi);
    if (manual.length) { const t = manual.find((x) => /^en/i.test(x.languageCode)) || manual[0]; if (t.isTranslatable !== false) return { t, tl: true }; }
    if (viA) return { t: viA, tl: false };
    if (asr.length) return { t: asr[0], tl: true };
    return manual.length ? { t: manual[0], tl: false } : null;
  }
  async function getJSON3(url, tl) {
    const u = new URL(url, location.href);
    u.searchParams.set('fmt', 'json3');
    if (tl) u.searchParams.set('tlang', 'vi'); else u.searchParams.delete('tlang');
    const r = await oFetch(u.href, { credentials: 'include' });
    const t = await r.text();
    if (!t.trim()) return null;
    try { const j = JSON.parse(t); return j && j.events && j.events.length ? j : null; } catch (e) { return null; }
  }
  async function viaPlayer(id, track, tl) {
    // Bật phụ đề trên trình phát để YouTube tự tải (kèm mã xác thực), rồi dùng lại link đó
    const p = getPlayer(), before = ttUrls.length;
    let clicked = null;
    try { p.loadModule && p.loadModule('captions'); p.setOption && p.setOption('captions', 'track', { languageCode: track.languageCode, kind: track.kind }); } catch (e) {}
    const b = document.querySelector('.ytp-subtitles-button');
    if (b && b.getAttribute('aria-pressed') === 'false') { b.click(); clicked = b; }
    let url = null;
    for (let k = 0; k < 40 && !url; k++) {
      await sleep(150);
      url = ttUrls.slice(before).reverse().find((u) => u.includes('v=' + id)) || null;
    }
    if (!url) url = ttUrls.slice().reverse().find((u) => u.includes('v=' + id)) || null;
    // Tắt lại phụ đề của YouTube để không chồng lên phụ đề tiếng Việt
    try { if (clicked) clicked.click(); else if (p.setOption) p.setOption('captions', 'track', {}); } catch (e) {}
    if (!url) return null;
    const u = new URL(url); u.searchParams.set('lang', track.languageCode);
    if (track.kind === 'asr') u.searchParams.set('kind', 'asr'); else u.searchParams.delete('kind');
    return getJSON3(u.href, tl);
  }
  function toCues(data) {
    const raw = [];
    for (const e of data.events || []) {
      if (!e.segs) continue;
      const t = e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!t || /^\[.*\]$/.test(t)) continue;
      const s = (e.tStartMs || 0) / 1000;
      raw.push({ start: s, end: s + (e.dDurationMs || 2000) / 1000, text: t });
    }
    raw.sort((a, b) => a.start - b.start);
    const out = []; let cur = null;
    for (const c of raw) {
      if (cur && c.start - cur.end < 0.6 && cur.text.length < 110 && !/[.!?…。]$/.test(cur.text)) {
        cur.text += ' ' + c.text; cur.end = Math.max(cur.end, c.end);
      } else { if (cur) out.push(cur); cur = Object.assign({}, c); }
    }
    if (cur) out.push(cur);
    for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
    return out.filter((c) => c.end - c.start > 0.15);
  }
  async function loadCaptions(id) {
    setStatus('Đang lấy phụ đề…');
    const pr = await playerResponse(id);
    const tracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    if (!tracks.length) throw new Error('Video này không có phụ đề nên chưa lồng tiếng được.');
    const ch = chooseTrack(tracks);
    if (!ch) throw new Error('Không chọn được phụ đề phù hợp.');
    let data = null;
    try { data = await getJSON3(ch.t.baseUrl, ch.tl); } catch (e) {}
    if (!data) data = await viaPlayer(id, ch.t, ch.tl);
    if (!data) throw new Error('YouTube không cho lấy phụ đề video này. Thử bật phụ đề (CC) một lần rồi bấm lại.');
    const list = toCues(data);
    if (!list.length) throw new Error('Phụ đề bị trống.');
    const nm = (ch.t.name && (ch.t.name.simpleText || (ch.t.name.runs || []).map((r) => r.text).join(''))) || ch.t.languageCode;
    return { list, label: ch.tl ? `${nm} → tiếng Việt (YouTube dịch)` : nm };
  }

  /* ---------- Giọng đọc ---------- */
  const hasSS = 'speechSynthesis' in window;
  let voices = [];
  const loadVoices = () => { if (hasSS) voices = speechSynthesis.getVoices().filter((v) => /^vi/i.test(v.lang)); fillVoices(); };
  const score = (v) => (/natural|online|neural|enhanced|premium|siri/i.test(v.name) ? 5 : 0) + (/google/i.test(v.name) ? 2 : 0);
  const pickVoice = () => cfg.voice === 'auto' ? voices.slice().sort((a, b) => score(b) - score(a))[0] : voices.find((v) => v.voiceURI === cfg.voice);
  const styleOf = () => STYLES.find((s) => s[0] === cfg.style) || STYLES[0];

  function rateFor(i) {
    const c = cues[i], base = cfg.rate * styleOf()[3];
    const nx = cues[i + 1], slot = Math.max(0.6, (nx ? Math.min(nx.start, c.end + 1.2) : c.end + 1.2) - c.start);
    const need = c.text.length / CPS / base;
    return Math.min(2, need > slot ? base * need / slot : base);
  }
  function setVol(target) {
    if (gainNode && graphVideo === video) { gainNode.gain.value = Math.min(1, target); return; }
    if (!video || !orig) return;
    if (target >= 0.999) { video.muted = orig.muted; video.volume = orig.volume; return; }
    if (target < 0.03) { video.muted = true; return; }
    video.muted = orig.muted;
    const want = orig.volume * target;
    try { video.volume = want; } catch (e) {}
    if (Math.abs(video.volume - want) > 0.02) video.muted = true; // iPhone không cho chỉnh âm lượng: tắt tiếng gốc
  }
  const audioEl = new Audio(); try { audioEl.preservesPitch = true; } catch (e) {}
  let aiTok = 0;
  const MALE = ['nt', 'nm', 'gi', 'tt', 'kc'];
  const aiVoice = () => (cfg.ai && cfg.srv.trim() ? { voice: MALE.includes(cfg.style) ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural', pitch: Math.round(Math.max(-50, Math.min(50, (styleOf()[2] - 1) * 45))) } : null);
  function playUrl(url, rate, cb) {
    audioEl.onended = audioEl.onerror = null; audioEl.pause();
    audioEl.src = url; audioEl.playbackRate = Math.max(0.5, Math.min(2, rate || 1));
    audioEl.onended = audioEl.onerror = cb;
    return audioEl.play();
  }
  const castOn = () => cfg.cast && cfg.ai && cfg.srv.trim() && cfg.style === 'tn';
  function speakText(text, rate, cb, direct) {
    const a = direct && direct.voice && castOn() ? direct : aiVoice();
    if (a) {
      const tok = ++aiTok;
      if (a === direct) rate = cfg.rate; // máy chủ đã tính tốc độ vừa khung câu
      oFetch(`${srvBase()}/api/tts?voice=${a.voice}&pitch=${a.pitch}&rate=${a.rate || 0}&volume=${a.volume || 0}&text=${encodeURIComponent(text)}`, { headers: srvHead() })
        .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
        .then((b) => { if (tok === aiTok) return playUrl(URL.createObjectURL(b), rate, cb); })
        .catch(() => { if (tok === aiTok) speakDevice(text, rate, cb); });
      return;
    }
    speakDevice(text, rate, cb);
  }
  function speakDevice(text, rate, cb) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN'; const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Math.min(2, rate); u.pitch = styleOf()[2];
    u.onend = u.onerror = cb;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  function say(i) {
    speaking = i; setVol(cfg.duck); showSub(i);
    speakText(cues[i].text, rateFor(i), () => done(i), cues[i].tts);
  }
  function done(i) {
    if (speaking !== i) return;
    speaking = -1;
    if (pending >= 0) { const n = pending; pending = -1; say(n); if (holdPause) { holdPause = false; video && video.play().catch(() => {}); } }
    else setVol(1);
  }
  function stopSpeech(keep) {
    speaking = -1; if (!keep) { pending = -1; holdPause = false; }
    try { hasSS && speechSynthesis.cancel(); } catch (e) {}
    aiTok++; try { audioEl.onended = audioEl.onerror = null; audioEl.pause(); } catch (e) {}
    setVol(1);
  }
  function onCue(i) {
    if (speaking >= 0) {
      if (cfg.wait) { pending = i; holdPause = true; video.pause(); return; }
      stopSpeech(true);
    }
    say(i);
  }

  /* ---------- Dịch trực tiếp qua máy chủ (video không có phụ đề) ---------- */
  let live = null, liveWait = false;
  const srvBase = () => cfg.srv.trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  const srvHead = () => { const h = {}; if (cfg.key) h['X-Api-Key'] = cfg.key; if (cfg.groq) h['X-Groq-Key'] = cfg.groq; return h; };
  async function srvJSON(path, opt) {
    const r = await oFetch(srvBase() + path, Object.assign({ headers: srvHead() }, opt || {}));
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error((j && j.detail) || 'Lỗi máy chủ ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const LANGS = { vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', thai: 'th', french: 'fr', spanish: 'es', german: 'de', russian: 'ru', indonesian: 'id', hindi: 'hi' };
  const isViText = (t) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t);
  async function startLive(id) {
    if (!cfg.srv.trim()) throw new Error('Video không có phụ đề. Nhập Máy chủ ở mục Cài đặt bên dưới để tự nghe & dịch.');
    setStatus('Máy chủ đang lấy âm thanh video… (lần đầu có thể mất ~1 phút)');
    const j = await srvJSON('/api/live/start?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    cues = []; vid = id;
    live = { job: j.job, dur: j.duration, next: 0, ready: 0, done: false, lang: null, err: 0 };
    liveLoop(live);
  }
  async function liveLoop(L) {
    while (live === L && !L.done) {
      const t = video ? video.currentTime : 0;
      if (t > L.ready + 3) { L.next = Math.max(L.next, Math.floor(t)); L.ready = L.next; }
      if (L.ready > t + 75) { await sleep(800); continue; }
      const len = L.next < 1 ? 25 : L.next < 60 ? 40 : 60;
      try {
        const j = await srvJSON(`/api/live/chunk?job=${L.job}&start=${L.next}&dur=${len}${L.lang ? '&lang=' + L.lang : ''}`);
        if (live !== L) return;
        if (j.language && !L.lang) L.lang = LANGS[String(j.language).toLowerCase()] || null;
        const add = (j.segments || []).map((x) => ({ start: x.start, end: x.end, text: x.text, src: x.text, f0: x.f0, db: x.db }));
        if (add.length && L.lang !== 'vi' && !add.every((c) => isViText(c.text))) {
          const prev = cues.slice(-3).map((c) => c.src);
          const items = add.map((c, k) => ({ id: k, sec: +(c.end - c.start).toFixed(1), text: c.src, f0: c.f0, db: c.db }));
          const tr = await srvJSON('/api/translate', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, srvHead()),
            body: JSON.stringify({ items, prev, session: 'yt:' + L.job, title: document.title, direct: castOn() ? 'auto' : '' }) });
          (tr.items || []).forEach((o) => { if (add[o.id] && typeof o.vi === 'string') { add[o.id].text = o.vi.trim(); add[o.id].tts = o.tts; } });
          showProfile(tr.profile);
          if (live !== L) return;
        }
        cues.push(...add); cues.sort((a, b) => a.start - b.start);
        L.next = j.end; L.ready = j.end; L.done = j.done; L.err = 0;
        setStatus(L.done ? `Dịch trực tiếp: xong cả video · ${cues.length} câu` : `Dịch trực tiếp: đã dịch tới ${fmtT(L.ready)} / ${fmtT(L.dur)}`);
        if ((liveWait && L.ready > video.currentTime + 8) || L.done) liveResume();
      } catch (e) {
        if (e.status === 404) { setStatus(e.message, true); live = null; liveResume(); return; }
        L.err++; setStatus('Mạng chậm, đang thử lại… ' + (e.message || ''), true);
        if (L.err > 4) { setStatus('Dịch trực tiếp bị gián đoạn. Bấm Dừng rồi Bắt đầu để thử lại.', true); live = null; liveResume(); return; }
        await sleep(2000 * L.err);
      }
    }
  }
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function liveCheck(t) {
    if (!live || live.done || liveWait || video.paused) return;
    if (t > live.ready - 1.5) { liveWait = true; video.pause(); setStatus('⏳ Đang dịch tiếp, chờ vài giây…'); }
  }
  function liveResume() { if (liveWait) { liveWait = false; video && video.play().catch(() => {}); } }

  /* ---------- Phiên dịch tức thời: nghe tiếng video YouTube đang phát ---------- */
  let actx = null, srcNode = null, gainNode = null, graphVideo = null, interp = null, iSpeaking = false, iWatch = 0;
  function ensureGraph() {
    if (graphVideo === video) return true;
    if (!String(video.src).startsWith('blob:')) return false; // chỉ an toàn với luồng phát của chính YouTube
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      if (!actx) { actx = new AC(); gainNode = actx.createGain(); gainNode.connect(actx.destination); }
      if (actx.state === 'suspended') actx.resume();
      srcNode = actx.createMediaElementSource(video); srcNode.connect(gainNode); graphVideo = video;
      return true;
    } catch (e) { return false; }
  }
  function startInterp() {
    if (!cfg.srv.trim()) throw new Error('Phiên dịch tức thời cần Máy chủ: nhập ở mục Máy chủ cuối bảng.');
    if (!ensureGraph()) throw new Error('Trình duyệt không cho nghe tiếng video này. Chọn nguồn "Phụ đề YouTube" hoặc "Tự nghe bằng máy chủ".');
    stopInterp();
    const proc = actx.createScriptProcessor(4096, 1, 1), mute = actx.createGain(); mute.gain.value = 0;
    srcNode.connect(proc); proc.connect(mute); mute.connect(actx.destination);
    const I = { proc, mute, sr: actx.sampleRate, pcm: [], len: 0, t0: 0, silent: 0, seq: 0, next: 0, results: {}, queue: [], prev: [], lang: null, sid: 'yt:' + videoId() + ':' + Date.now() };
    proc.onaudioprocess = (e) => onPcm(I, e.inputBuffer.getChannelData(0));
    interp = I; cues = []; vid = videoId();
    setStatus('⚡ Phiên dịch tức thời: đang nghe…');
  }
  function stopInterp() {
    if (!interp) return; const I = interp; interp = null;
    try { I.proc.onaudioprocess = null; srcNode.disconnect(I.proc); I.proc.disconnect(); I.mute.disconnect(); } catch (e) {}
    iSpeaking = false; clearTimeout(iWatch);
  }
  function onPcm(I, data) {
    if (interp !== I || !video || video.paused || video.seeking) return;
    const pl = getPlayer(); if (pl && pl.classList && pl.classList.contains('ad-showing')) { I.pcm = []; I.len = 0; return; }
    const r = I.sr / 16000, n = Math.floor(data.length / r), out = new Float32Array(n); let e = 0;
    for (let k = 0; k < n; k++) { const a = Math.floor(k * r), b = Math.min(data.length, Math.floor((k + 1) * r)); let s2 = 0; for (let j = a; j < b; j++) s2 += data[j]; const v = s2 / ((b - a) || 1); out[k] = v; e += v * v; }
    const rms = Math.sqrt(e / (n || 1)), start = video.currentTime - data.length / I.sr;
    if (I.len && Math.abs(start - (I.t0 + I.len / 16000)) > 1.2) { I.pcm = []; I.len = 0; }
    if (!I.len) I.t0 = Math.max(0, start);
    I.pcm.push(out); I.len += n; I.silent = rms < 0.012 ? I.silent + 1 : 0;
    const dur = I.len / 16000;
    if ((dur >= 2.5 && I.silent >= 4) || dur >= 8) flushInterp(I);
  }
  function flushInterp(I) {
    const len = I.len, t0 = I.t0, pcm = I.pcm; I.pcm = []; I.len = 0; I.silent = 0;
    let e = 0; for (const a of pcm) for (let k = 0; k < a.length; k++) e += a[k] * a[k];
    if (!len || Math.sqrt(e / len) < 0.005) return;
    const b = new ArrayBuffer(44 + len * 2), v = new DataView(b), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    let o = 44; for (const a of pcm) for (let k = 0; k < a.length; k++) { const x = Math.max(-1, Math.min(1, a[k])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    sendInterp(I, new Blob([b], { type: 'audio/wav' }), t0);
  }
  async function sendInterp(I, wav, t0) {
    const seq = I.seq++, fd = new FormData();
    fd.append('file', wav, 'clip.wav'); if (I.lang) fd.append('lang', I.lang);
    fd.append('prev', JSON.stringify(I.prev.slice(-3)));
    fd.append('session', I.sid); fd.append('title', document.title.replace(/ - YouTube$/, ''));
    const av = aiVoice(); if (castOn()) fd.append('voice', 'auto'); else if (av) { fd.append('voice', av.voice); fd.append('pitch', av.pitch); }
    let items = [];
    try {
      const j = await srvJSON('/api/interpret', { method: 'POST', body: fd });
      if (j.language && !I.lang) I.lang = LANGS[String(j.language).toLowerCase()] || null;
      showProfile(j.profile);
      items = (j.items || []).map((x) => ({ start: t0 + x.start, end: t0 + x.end, src: x.src, text: x.vi || x.src, audio: x.audio ? URL.createObjectURL(new Blob([Uint8Array.from(atob(x.audio), (ch) => ch.charCodeAt(0))], { type: 'audio/mpeg' })) : null }));
    } catch (e) { setStatus('⚡ ' + (e.message || 'Mạng chậm…'), true); }
    if (interp !== I) return;
    I.results[seq] = items;
    while (I.results[I.next]) { const it = I.results[I.next]; delete I.results[I.next]; I.next++; for (const x of it) { I.prev.push(x.src); cues.push(x); I.queue.push(x); } }
    pumpInterp(I);
  }
  function pumpInterp(I) {
    if (interp !== I || iSpeaking || video.paused) return;
    if (!I.queue.length) { setVol(1); return; }
    let c = I.queue.shift();
    while (I.queue.length && video.currentTime - c.end > 15) c = I.queue.shift();
    const lag = Math.max(0, video.currentTime - c.start), rate = Math.min(1.9, cfg.rate * (c.audio && castOn() ? 1 : styleOf()[3]) * (1 + 0.15 * I.queue.length + (lag > 7 ? 0.15 : 0)));
    iSpeaking = true; setVol(cfg.duck); showText(c.text);
    setStatus(`⚡ Phiên dịch tức thời · giọng Việt trễ khoảng ${Math.round(lag)} giây`);
    const next = () => { if (!iSpeaking) return; iSpeaking = false; clearTimeout(iWatch); if (!I.queue.length) { setVol(1); showText(''); } pumpInterp(I); };
    clearTimeout(iWatch); iWatch = setTimeout(next, (c.text.length / CPS / rate) * 1000 + 4000);
    if (c.audio) playUrl(c.audio, rate, next).catch(() => speakDevice(c.text, rate, next));
    else speakText(c.text, rate, next);
  }
  function interpPause() { if (interp) { interp.queue = []; interp.pcm = []; interp.len = 0; iSpeaking = false; try { speechSynthesis.cancel(); audioEl.pause(); } catch (e) {} setVol(1); showText(''); } }

  /* ---------- Đồng bộ theo video ---------- */
  const cueAt = (t) => { let lo = 0, hi = cues.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  const resetFrom = (t) => { stopSpeech(); interpPause(); spoken = new Set(cues.map((c, i) => (c.start < t - 0.25 ? i : -1)).filter((i) => i >= 0)); };
  const onSeek = () => { if (running) resetFrom(video.currentTime); };
  const onPause = () => { if (running && !holdPause && !liveWait) { stopSpeech(); interpPause(); } };
  function tick() {
    if (!running || !video) return;
    const pl = getPlayer();
    if (pl && pl.classList && pl.classList.contains('ad-showing')) { showSub(-1); return; }
    if (video.paused && !holdPause) return;
    liveCheck(video.currentTime);
    if (interp) return;
    const t = video.currentTime, i = cueAt(t), inside = i >= 0 && t < cues[i].end + 0.3;
    showSub(speaking >= 0 ? speaking : inside ? i : -1);
    if (i >= 0 && !spoken.has(i) && t < cues[i].end) { spoken.add(i); onCue(i); }
  }
  async function start() {
    const id = videoId();
    video = getVideo();
    if (!id || !video) { setStatus('Hãy mở một video YouTube trước.', true); return; }
    if (!hasSS) { setStatus('Trình duyệt này không hỗ trợ đọc văn bản.', true); return; }
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} // mở khoá âm thanh trên iPhone
    try { audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().catch(() => {}); } catch (e) {}
    btnMain.disabled = true;
    try {
      if (vid !== id || (!cues.length && !live && !interp)) {
        live = null;
        if (cfg.source === 'interp') startInterp();
        else if (cfg.source === 'server') await startLive(id);
        else {
          try { const r = await loadCaptions(id); cues = r.list; vid = id; setStatus(`${r.label} · ${cues.length} câu`); }
          catch (e) {
            if (!cfg.srv.trim()) throw e;
            try { startInterp(); } catch (e2) { setStatus(e.message + ' → chuyển sang tự nghe bằng máy chủ…'); await startLive(id); }
          }
        }
      }
      orig = { volume: video.volume, muted: video.muted };
      video.addEventListener('seeking', onSeek); video.addEventListener('pause', onPause);
      running = true; resetFrom(video.currentTime);
      clearInterval(timer); timer = setInterval(tick, 100);
      if (video.paused) video.play().catch(() => {});
      fab.classList.add('on'); btnMain.textContent = '■ Dừng lồng tiếng';
      if (!voices.length) setStatus('Thiết bị chưa có giọng tiếng Việt — xem hướng dẫn cài giọng trong README.', true);
    } catch (e) { setStatus(e.message || String(e), true); }
    btnMain.disabled = false;
  }
  function stop(silent) {
    running = false; clearInterval(timer); liveWait = false; stopInterp(); stopSpeech(); showSub(-1); showText('');
    if (video) { video.removeEventListener('seeking', onSeek); video.removeEventListener('pause', onPause); }
    orig = null; fab && fab.classList.remove('on');
    if (btnMain) btnMain.textContent = '▶ Bắt đầu lồng tiếng';
    if (!silent) setStatus(cues.length ? 'Đã dừng.' : '');
  }

  /* ---------- Phụ đề tiếng Việt trên video ---------- */
  let subBox = null, subText = null, lastSub = -2;
  function showText(t) { lastSub = -3; if (!subBox || !subBox.isConnected) { showSub(-1); } if (!subBox) return; subBox.style.display = t && cfg.sub ? '' : 'none'; subText.textContent = t || ''; }
  function showSub(i) {
    if (i === lastSub && subBox && subBox.isConnected) return;
    lastSub = i;
    const host = getPlayer() || (video && video.parentElement);
    if (!host) return;
    if (!subBox || !subBox.isConnected) {
      subBox = document.createElement('div');
      subBox.style.cssText = 'position:absolute;left:4%;right:4%;bottom:14%;z-index:60;text-align:center;pointer-events:none;font-family:system-ui,sans-serif';
      subText = document.createElement('span');
      subText.style.cssText = 'background:rgba(0,0,0,.75);color:#fff;padding:3px 10px;border-radius:6px;font-size:clamp(14px,2.4vw,24px);font-weight:600;line-height:1.6;-webkit-box-decoration-break:clone;box-decoration-break:clone';
      subBox.appendChild(subText);
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(subBox);
    }
    const show = i >= 0 && cfg.sub && running;
    subBox.style.display = show ? '' : 'none';
    subText.textContent = show ? cues[i].text : '';
  }

  /* ---------- Giao diện (không dùng innerHTML vì YouTube chặn) ---------- */
  let root, fab, panel, statusEl, btnMain, voiceSel, profEl;
  const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); kids.forEach((k) => e.append(k)); return e; };
  let profShown = '';
  function showProfile(p) {
    if (!p || !p.genre || profShown === p.genre + p.tone) return;
    profShown = p.genre + p.tone; if (profEl) profEl.textContent = `🎯 ${p.genre}${p.summary ? ' — ' + p.summary : ''}`;
  }
  function setStatus(m, err) { if (statusEl) { statusEl.textContent = m; statusEl.style.color = err ? '#ff8a8a' : '#aab2bf'; } }
  function fillVoices() {
    if (!voiceSel) return;
    while (voiceSel.firstChild) voiceSel.firstChild.remove();
    voiceSel.append(new Option('Giọng Việt tự động', 'auto'));
    voices.slice().sort((a, b) => score(b) - score(a)).forEach((v) => voiceSel.append(new Option(v.name + (score(v) >= 5 ? ' ★' : ''), v.voiceURI)));
    voiceSel.value = [...voiceSel.options].some((o) => o.value === cfg.voice) ? cfg.voice : 'auto';
  }
  function buildUI() {
    if (root) return;
    const host = el('div'); host.id = 'ltv-host';
    host.style.cssText = 'position:fixed;z-index:2147483646;right:14px;bottom:84px';
    root = host.attachShadow({ mode: 'open' });
    root.append(el('style', { textContent: `
      *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
      .fab{width:52px;height:52px;border-radius:16px;border:0;cursor:pointer;background:linear-gradient(135deg,#FFB938,#E5481B);box-shadow:0 6px 20px rgba(0,0,0,.35);display:grid;place-items:center;padding:0}
      .fab svg{width:30px;height:30px}.fab.on{outline:3px solid #3ecf8e;outline-offset:2px}
      .panel{position:absolute;right:0;bottom:62px;width:min(300px,calc(100vw - 28px));background:#15181f;color:#eceff4;border:1px solid #2a2f3a;border-radius:14px;padding:12px;display:none;flex-direction:column;gap:9px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:13px}
      .panel.open{display:flex}
      .hd{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:14px}
      .x{background:none;border:0;color:#9aa3b2;font-size:18px;cursor:pointer}
      .st{font-size:12px;color:#aab2bf;min-height:16px;line-height:1.35}
      .main{border:0;border-radius:10px;padding:10px;font-weight:700;font-size:14px;background:#f5a524;color:#1a1000;cursor:pointer}
      .main:disabled{opacity:.5}
      label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#9aa3b2}
      label.c{flex-direction:row;align-items:center;gap:7px;color:#eceff4}
      select,input[type=range]{width:100%}
      input[type=text],input[type=password]{background:#1e222b;color:#eceff4;border:1px solid #2a2f3a;border-radius:8px;padding:6px;font-size:13px;width:100%}
      details{font-size:12px;color:#9aa3b2}summary{cursor:pointer;margin-bottom:6px}details label{margin-top:6px}
      .panel{max-height:calc(100vh - 160px);overflow:auto}
      select{background:#1e222b;color:#eceff4;border:1px solid #2a2f3a;border-radius:8px;padding:6px;font-size:13px}
      input[type=range]{accent-color:#f5a524}
      .two{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    ` }));
    fab = el('button', { className: 'fab', title: 'Lồng tiếng Việt' });
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 512 512');
    [['M96 150c0-30 24-54 54-54h170c30 0 54 24 54 54v130c0 30-24 54-54 54H214l-68 58c-8 7-20 1-20-9v-49c-17-9-30-28-30-54z', '#1A1000'],
     ['M203 160c0-11 12-18 22-12l100 56c10 6 10 20 0 26l-100 56c-10 6-22-1-22-12z', '#FFD27A']].forEach(([d, f]) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', f); svg.append(p); });
    const w = document.createElementNS(NS, 'path'); w.setAttribute('d', 'M398 176c22 22 34 50 34 80s-12 58-34 80'); w.setAttribute('fill', 'none'); w.setAttribute('stroke', '#1A1000'); w.setAttribute('stroke-width', '26'); w.setAttribute('stroke-linecap', 'round'); svg.append(w);
    fab.append(svg);

    statusEl = el('div', { className: 'st' });
    profEl = el('div', { className: 'st' }); profEl.style.color = '#f5c56b';
    btnMain = el('button', { className: 'main', textContent: '▶ Bắt đầu lồng tiếng' });
    btnMain.onclick = () => (running ? stop() : start());

    voiceSel = el('select'); voiceSel.onchange = () => { cfg.voice = voiceSel.value; saveCfg(); };
    const styleSel = el('select'); STYLES.forEach((s) => styleSel.append(new Option(s[1], s[0]))); styleSel.value = cfg.style;
    styleSel.onchange = () => { cfg.style = styleSel.value; saveCfg(); };
    const rate = el('input', { type: 'range', min: 0.7, max: 1.5, step: 0.05, value: cfg.rate });
    const rateLb = el('span', { textContent: `Tốc độ: ${(+cfg.rate).toFixed(2)}×` });
    rate.oninput = () => { cfg.rate = +rate.value; rateLb.textContent = `Tốc độ: ${cfg.rate.toFixed(2)}×`; saveCfg(); };
    const duck = el('select'); [['0', 'Tắt hẳn'], ['0.1', 'Rất nhỏ (10%)'], ['0.3', 'Nhỏ (30%)'], ['0.5', 'Vừa (50%)']].forEach(([v, n]) => duck.append(new Option(n, v)));
    duck.value = String(cfg.duck); duck.onchange = () => { cfg.duck = +duck.value; saveCfg(); };
    const sub = el('input', { type: 'checkbox', checked: cfg.sub }); sub.onchange = () => { cfg.sub = sub.checked; saveCfg(); lastSub = -2; };
    const wait = el('input', { type: 'checkbox', checked: cfg.wait }); wait.onchange = () => { cfg.wait = wait.checked; saveCfg(); };
    const ai = el('input', { type: 'checkbox', checked: cfg.ai }); ai.onchange = () => { cfg.ai = ai.checked; saveCfg(); };
    const cast = el('input', { type: 'checkbox', checked: cfg.cast }); cast.onchange = () => { cfg.cast = cast.checked; saveCfg(); };
    const close = el('button', { className: 'x', textContent: '✕' });
    const source = el('select'); [['auto', 'Phụ đề YouTube (không cần máy chủ)'], ['interp', '⚡ Phiên dịch tức thời (nghe tiếng video)'], ['server', 'Dịch trước bằng máy chủ (khớp nhất)']].forEach(([v, n]) => source.append(new Option(n, v)));
    source.value = cfg.source; source.onchange = () => { cfg.source = source.value; saveCfg(); if (running) stop(true); cues = []; vid = null; live = null; stopInterp(); };
    const srv = el('input', { type: 'text', value: cfg.srv, placeholder: 'https://longtieng-downloader.onrender.com' });
    srv.oninput = () => { cfg.srv = srv.value.trim(); saveCfg(); };
    const key = el('input', { type: 'text', value: cfg.key, placeholder: 'API_TOKEN' });
    key.oninput = () => { cfg.key = key.value.trim(); saveCfg(); };
    const groq = el('input', { type: 'password', value: cfg.groq, placeholder: 'gsk_…', autocomplete: 'off' });
    groq.oninput = () => { cfg.groq = groq.value.replace(/\s+/g, ''); saveCfg(); };
    const adv = el('details', {}, el('summary', { textContent: 'Máy chủ (cho video không có phụ đề)' }),
      el('label', {}, 'Địa chỉ máy chủ', srv), el('label', {}, 'Mã truy cập', key), el('label', {}, 'Mã Groq', groq));

    panel = el('div', { className: 'panel' },
      el('div', { className: 'hd' }, el('span', { textContent: 'Lồng tiếng Việt' }), close),
      statusEl, profEl, btnMain,
      el('div', { className: 'two' }, el('label', {}, 'Giọng', voiceSel), el('label', {}, 'Phong cách', styleSel)),
      el('label', {}, 'Nguồn lời thoại', source),
      el('label', {}, rateLb, rate),
      el('label', {}, 'Âm gốc khi đang đọc', duck),
      el('label', { className: 'c' }, ai, '🤖 Giọng AI tự nhiên (cần máy chủ)'),
      el('label', { className: 'c' }, cast, '🎭 Đạo diễn tự động: giọng nam/nữ/trẻ em theo người nói, đọc theo cảm xúc (phong cách Tự nhiên)'),
      el('label', { className: 'c' }, sub, 'Hiện phụ đề tiếng Việt'),
      el('label', { className: 'c' }, wait, 'Tạm dừng video khi chưa đọc xong câu'),
      adv);
    close.onclick = () => panel.classList.remove('open');
    fab.onclick = () => panel.classList.toggle('open');
    root.append(panel, fab);
    document.documentElement.append(host);
    loadVoices();
    if (hasSS) speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 800);
  }

  /* ---------- Theo dõi chuyển video (YouTube là trang một trang) ---------- */
  let lastId = null;
  function onNav() {
    const id = videoId();
    const host = document.getElementById('ltv-host');
    if (host) host.style.display = id ? '' : 'none';
    if (id === lastId) return;
    lastId = id;
    if (running) stop(true);
    cues = []; vid = null; lastSub = -2; live = null; liveWait = false; stopInterp();
    profShown = ''; if (profEl) profEl.textContent = '';
    setStatus(id ? 'Bấm Bắt đầu để lồng tiếng video này.' : '');
  }
  function init() { buildUI(); onNav(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('yt-navigate-finish', onNav);
  setInterval(onNav, 1000);
})();
