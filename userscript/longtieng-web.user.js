// ==UserScript==
// @name         Lồng tiếng Việt cho mọi trang web
// @namespace    https://github.com/iamboo98/longtieng
// @version      1.0.0
// @description  Phiên dịch & lồng tiếng Việt trực tiếp cho video trên bất kỳ trang web nào: nghe tiếng video, dịch theo thể loại, đọc bằng giọng nam/nữ/trẻ em khớp người nói và cảm xúc.
// @author       iamboo98
// @match        *://*/*
// @exclude      *://*.youtube.com/*
// @exclude      *://youtube.com/*
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      *
// @icon         https://raw.githubusercontent.com/iamboo98/longtieng/main/logo.svg
// @downloadURL  https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng-web.user.js
// @updateURL    https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng-web.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ltwLoaded) return;
  window.__ltwLoaded = true;
  /* global GM, GM_getValue, GM_setValue, GM_xmlhttpRequest */
  const hasGM = typeof GM !== 'undefined' && GM;

  /* ---------- Cài đặt (dùng chung cho mọi trang nhờ kho của trình quản lý userscript) ---------- */
  const DEF = { srv: '', key: '', groq: '', mode: 'auto', rate: 1, duck: 0.15, sub: true, orig: false, cast: true, voice: 'auto' };
  let cfg = Object.assign({}, DEF);
  async function loadCfg() {
    let raw = null;
    try { raw = hasGM && GM.getValue ? await GM.getValue('cfg') : typeof GM_getValue === 'function' ? GM_getValue('cfg') : null; } catch (e) {}
    if (!raw) try { raw = localStorage.getItem('ltw_cfg'); } catch (e) {}
    try { if (raw) cfg = Object.assign({}, DEF, typeof raw === 'string' ? JSON.parse(raw) : raw); } catch (e) {}
  }
  function saveCfg() {
    const v = JSON.stringify(cfg);
    try { if (hasGM && GM.setValue) GM.setValue('cfg', v); else if (typeof GM_setValue === 'function') GM_setValue('cfg', v); else localStorage.setItem('ltw_cfg', v); } catch (e) {}
  }

  /* ---------- Gọi máy chủ (GM xhr để không vướng CORS của từng trang) ---------- */
  const srvBase = () => cfg.srv.trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  const srvHead = (extra) => { const h = Object.assign({}, extra || {}); if (cfg.key) h['X-Api-Key'] = cfg.key; if (cfg.groq) h['X-Groq-Key'] = cfg.groq; return h; };
  const gmX = (hasGM && GM.xmlHttpRequest) || (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null);
  function http(method, path, body, type) {
    const url = srvBase() + path, headers = srvHead(body ? { 'Content-Type': 'application/json' } : null), data = body ? JSON.stringify(body) : undefined;
    if (!gmX) {
      return fetch(url, { method, headers, body: data }).then(async (r) => ({ status: r.status, body: type === 'blob' ? await r.blob() : await r.text() }));
    }
    return new Promise((res, rej) => {
      const o = { method, url, headers, data, timeout: 180000, responseType: type === 'blob' ? 'blob' : undefined,
        onload: (r) => res({ status: r.status, body: type === 'blob' ? r.response : r.responseText }),
        onerror: () => rej(new Error('Không kết nối được máy chủ.')), ontimeout: () => rej(new Error('Máy chủ phản hồi quá lâu.')) };
      const p = gmX(o); if (p && p.catch) p.catch(rej);
    });
  }
  async function api(method, path, body) {
    const r = await http(method, path, body);
    let j = null; try { j = JSON.parse(r.body); } catch (e) {}
    if (r.status >= 400 || !j) { const e = new Error((j && j.detail) || 'Lỗi máy chủ ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  /* ---------- Tìm video chính trên trang ---------- */
  function mainVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (r.width >= 200 && r.height >= 110 && a > area && getComputedStyle(v).visibility !== 'hidden') { best = v; area = a; }
    }
    return best;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const LANGS = { vietnamese: 'vi', english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', thai: 'th', french: 'fr', spanish: 'es', german: 'de', russian: 'ru', indonesian: 'id', hindi: 'hi', portuguese: 'pt', italian: 'it' };
  const langCode = (l) => { l = String(l || '').toLowerCase(); return LANGS[l] || (l.length <= 3 ? l : null); };

  /* ---------- Âm thanh: nghe tiếng video và hạ âm gốc ---------- */
  let video = null, actx = null, srcNode = null, gainNode = null, graphVideo = null, orig = null;
  function canTap(v) {
    if (v.mediaKeys) return false; // video có DRM: trình duyệt không cho nghe
    const s = v.currentSrc || v.src || '';
    if (s.startsWith('blob:') || s.startsWith('data:')) return true;
    try { if (new URL(s, location.href).origin === location.origin) return true; } catch (e) {}
    return !!v.crossOrigin;
  }
  function ensureGraph() {
    if (graphVideo === video) return true;
    if (!canTap(video)) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      gainNode = actx.createGain(); gainNode.connect(actx.destination);
      srcNode = actx.createMediaElementSource(video); srcNode.connect(gainNode); graphVideo = video;
      return true;
    } catch (e) { return false; }
  }
  function setVol(t) {
    if (gainNode && graphVideo === video) { gainNode.gain.value = Math.min(1, t); return; }
    if (!video || !orig) return;
    if (t >= 0.999) { video.muted = orig.muted; video.volume = orig.volume; return; }
    if (t < 0.03) { video.muted = true; return; }
    video.muted = orig.muted;
    try { video.volume = orig.volume * t; } catch (e) {}
    if (Math.abs(video.volume - orig.volume * t) > 0.02) video.muted = true; // iPhone không cho chỉnh âm lượng
  }

  /* ---------- Giọng đọc ---------- */
  const audioEl = new Audio(); try { audioEl.preservesPitch = true; } catch (e) {}
  const hasSS = 'speechSynthesis' in window;
  let aiTok = 0;
  const viVoice = () => hasSS && speechSynthesis.getVoices().filter((v) => /^vi/i.test(v.lang)).sort((a, b) => (/natural|online|neural|premium|siri/i.test(b.name) ? 1 : 0) - (/natural|online|neural|premium|siri/i.test(a.name) ? 1 : 0))[0];
  function playUrl(url, rate, cb) {
    audioEl.onended = audioEl.onerror = null; audioEl.pause();
    audioEl.src = url; audioEl.playbackRate = Math.max(0.5, Math.min(2, rate || 1));
    audioEl.onended = audioEl.onerror = cb;
    return audioEl.play();
  }
  function speakDevice(text, rate, cb) {
    if (!hasSS) { cb(); return; }
    const u = new SpeechSynthesisUtterance(text); u.lang = 'vi-VN';
    const v = viVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Math.min(2, rate); u.onend = u.onerror = cb;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  const b64ToUrl = (b) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'audio/mpeg' }));
  async function ttsUrl(text, t) {
    const v = cfg.cast && t && t.voice ? t : { voice: cfg.voice === 'auto' ? 'vi-VN-HoaiMyNeural' : cfg.voice, pitch: 0 };
    const r = await http('GET', `/api/tts?voice=${v.voice}&pitch=${v.pitch || 0}&rate=${v.rate || 0}&volume=${v.volume || 0}&text=${encodeURIComponent(text)}`, null, 'blob');
    if (r.status >= 400 || !r.body) throw new Error('tts');
    return URL.createObjectURL(r.body);
  }
  function stopVoice() { aiTok++; try { hasSS && speechSynthesis.cancel(); } catch (e) {} try { audioEl.onended = audioEl.onerror = null; audioEl.pause(); } catch (e) {} }

  /* ---------- Trạng thái chung ---------- */
  let running = false, mode = null, cues = [], timer = 0, sid = '', speaking = false, watch = 0;

  /* ---------- Chế độ 1: phiên dịch tức thời (nghe tiếng video đang phát) ---------- */
  let I = null;
  function startInterp() {
    const proc = actx.createScriptProcessor(4096, 1, 1), mute = actx.createGain(); mute.gain.value = 0;
    srcNode.connect(proc); proc.connect(mute); mute.connect(actx.destination);
    I = { proc, mute, sr: actx.sampleRate, pcm: [], len: 0, t0: 0, silent: 0, seq: 0, next: 0, results: {}, queue: [], prev: [], lang: null };
    proc.onaudioprocess = (e) => onPcm(I, e.inputBuffer.getChannelData(0));
    mode = 'interp'; setStatus('⚡ Đang nghe video…');
  }
  function stopInterp() {
    if (!I) return; const X = I; I = null;
    try { X.proc.onaudioprocess = null; srcNode.disconnect(X.proc); X.proc.disconnect(); X.mute.disconnect(); } catch (e) {}
  }
  function onPcm(X, data) {
    if (I !== X || !video || video.paused || video.seeking) return;
    const r = X.sr / 16000, n = Math.floor(data.length / r), out = new Float32Array(n); let e = 0;
    for (let k = 0; k < n; k++) { const a = Math.floor(k * r), b = Math.min(data.length, Math.floor((k + 1) * r)); let s = 0; for (let j = a; j < b; j++) s += data[j]; const v = s / ((b - a) || 1); out[k] = v; e += v * v; }
    const rms = Math.sqrt(e / (n || 1)), start = video.currentTime - data.length / X.sr;
    if (X.len && Math.abs(start - (X.t0 + X.len / 16000)) > 1.2) { X.pcm = []; X.len = 0; }
    if (!X.len) X.t0 = Math.max(0, start);
    X.pcm.push(out); X.len += n; X.silent = rms < 0.012 ? X.silent + 1 : 0;
    const dur = X.len / 16000;
    if ((dur >= 2.5 && X.silent >= 4) || dur >= 8) flush(X);
  }
  function flush(X) {
    const len = X.len, t0 = X.t0, pcm = X.pcm; X.pcm = []; X.len = 0; X.silent = 0;
    let e = 0; for (const a of pcm) for (let k = 0; k < a.length; k++) e += a[k] * a[k];
    if (!len || Math.sqrt(e / len) < 0.005) return;
    const bytes = new Uint8Array(44 + len * 2), v = new DataView(bytes.buffer), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
    let o = 44; for (const a of pcm) for (let k = 0; k < a.length; k++) { const x = Math.max(-1, Math.min(1, a[k])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    send(X, btoa(bin), t0);
  }
  async function send(X, audio, t0) {
    const seq = X.seq++;
    let items = [];
    try {
      const j = await api('POST', '/api/interpret.json', { audio, lang: X.lang, prev: X.prev.slice(-3), session: sid, title: document.title,
        voice: cfg.cast ? 'auto' : cfg.voice === 'auto' ? 'vi-VN-HoaiMyNeural' : cfg.voice });
      if (j.language && !X.lang) X.lang = langCode(j.language);
      showProfile(j.profile);
      items = (j.items || []).map((x) => ({ start: t0 + x.start, end: t0 + x.end, src: x.src, text: x.vi || x.src, tts: x.tts, audio: x.audio ? b64ToUrl(x.audio) : null }));
    } catch (e) { setStatus('⚡ ' + (e.message || 'Mạng chậm…'), true); }
    if (I !== X) return;
    X.results[seq] = items;
    while (X.results[X.next]) { const it = X.results[X.next]; delete X.results[X.next]; X.next++; for (const x of it) { X.prev.push(x.src); X.queue.push(x); } }
    pump(X);
  }
  function pump(X) {
    if (I !== X || speaking || video.paused) return;
    if (!X.queue.length) { setVol(1); return; }
    let c = X.queue.shift();
    while (X.queue.length && video.currentTime - c.end > 15) c = X.queue.shift();
    const lag = Math.max(0, video.currentTime - c.start), rate = Math.min(1.9, cfg.rate * (1 + 0.15 * X.queue.length + (lag > 7 ? 0.15 : 0)));
    speaking = true; setVol(cfg.duck); showText(c);
    setStatus(`⚡ Phiên dịch tức thời · trễ ~${Math.round(lag)} giây`);
    const next = () => { if (!speaking) return; speaking = false; clearTimeout(watch); if (!X.queue.length) { setVol(1); showText(null); } pump(X); };
    clearTimeout(watch); watch = setTimeout(next, (c.text.length / 14.5 / rate) * 1000 + 4000);
    if (c.audio) playUrl(c.audio, rate, next).catch(() => speakDevice(c.text, rate, next));
    else speakDevice(c.text, rate, next);
  }

  /* ---------- Chế độ 2: máy chủ tự lấy âm thanh từ link trang (video có DRM / chặn nghe) ---------- */
  let L = null, liveWait = false, spoken = new Set(), cur = -1;
  async function startServer() {
    setStatus('Máy chủ đang lấy âm thanh từ trang này… (lần đầu có thể mất ~1 phút)');
    const j = await api('GET', '/api/live/start?url=' + encodeURIComponent(location.href));
    L = { job: j.job, dur: j.duration, next: 0, ready: 0, done: false, lang: null, err: 0 };
    cues = []; mode = 'server'; sid = 'web:' + j.job; loop(L);
  }
  async function loop(X) {
    while (L === X && !X.done) {
      const t = video ? video.currentTime : 0;
      if (t > X.ready + 3) { X.next = Math.max(X.next, Math.floor(t)); X.ready = X.next; }
      if (X.ready > t + 75) { await sleep(800); continue; }
      const len = X.next < 1 ? 25 : X.next < 60 ? 40 : 60;
      try {
        const j = await api('GET', `/api/live/chunk?job=${X.job}&start=${X.next}&dur=${len}${X.lang ? '&lang=' + X.lang : ''}`);
        if (L !== X) return;
        if (j.language && !X.lang) X.lang = langCode(j.language);
        const add = (j.segments || []).map((x) => ({ start: x.start, end: x.end, src: x.text, text: x.text, f0: x.f0, db: x.db }));
        if (add.length && X.lang !== 'vi') {
          const tr = await api('POST', '/api/translate', { items: add.map((c, k) => ({ id: k, sec: +(c.end - c.start).toFixed(1), text: c.src, f0: c.f0, db: c.db })),
            prev: cues.slice(-3).map((c) => c.src), session: sid, title: document.title, direct: cfg.cast ? 'auto' : '' });
          (tr.items || []).forEach((o) => { if (add[o.id] && typeof o.vi === 'string') { add[o.id].text = o.vi.trim(); add[o.id].tts = o.tts; } });
          showProfile(tr.profile);
          if (L !== X) return;
        }
        cues.push(...add); cues.sort((a, b) => a.start - b.start);
        X.next = j.end; X.ready = j.end; X.done = j.done; X.err = 0;
        setStatus(X.done ? `Đã dịch xong cả video · ${cues.length} câu` : `Đã dịch tới ${fmtT(X.ready)} / ${fmtT(X.dur)}`);
        if ((liveWait && X.ready > video.currentTime + 8) || X.done) resume();
      } catch (e) {
        if (e.status === 404) { setStatus(e.message, true); L = null; resume(); return; }
        X.err++; setStatus('Mạng chậm, đang thử lại… ' + (e.message || ''), true);
        if (X.err > 4) { setStatus('Bị gián đoạn. Bấm Dừng rồi Bắt đầu để thử lại.', true); L = null; resume(); return; }
        await sleep(2000 * X.err);
      }
    }
  }
  function resume() { if (liveWait) { liveWait = false; video && video.play().catch(() => {}); } }
  const cueAt = (t) => { let lo = 0, hi = cues.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  function sayCue(i) {
    const c = cues[i], tok = ++aiTok; cur = i; speaking = true; setVol(cfg.duck); showText(c);
    const fin = () => { if (cur !== i) return; cur = -1; speaking = false; setVol(1); if (liveWait) resume(); };
    const nx = cues[i + 1], slot = Math.max(0.6, (nx ? Math.min(nx.start, c.end + 1.2) : c.end + 1.2) - c.start);
    const devRate = Math.min(2, Math.max(cfg.rate, cfg.rate * c.text.length / 14.5 / slot));
    ttsUrl(c.text, c.tts).then((u) => { if (tok === aiTok) return playUrl(u, cfg.rate, fin); })
      .catch(() => { if (tok === aiTok) speakDevice(c.text, devRate, fin); });
  }
  function tickServer() {
    const t = video.currentTime;
    if (L && !L.done && !liveWait && !video.paused && t > L.ready - 1.5) { liveWait = true; video.pause(); setStatus('⏳ Đang dịch tiếp, chờ vài giây…'); }
    const i = cueAt(t);
    if (cur < 0) showText(i >= 0 && t < cues[i].end + 0.3 ? cues[i] : null);
    if (i >= 0 && !spoken.has(i) && t < cues[i].end) {
      spoken.add(i);
      if (speaking) { liveWait = true; video.pause(); const go = () => { if (!speaking) { sayCue(i); } else setTimeout(go, 120); }; go(); return; } // chờ câu trước đọc xong
      sayCue(i);
    }
  }

  /* ---------- Điều khiển ---------- */
  const onSeek = () => { if (!running) return; stopVoice(); speaking = false; cur = -1; setVol(1); showText(null); if (I) { I.queue = []; I.pcm = []; I.len = 0; } spoken = new Set(cues.map((c, i) => (c.start < video.currentTime - 0.25 ? i : -1)).filter((i) => i >= 0)); };
  const onPause = () => { if (running && !liveWait && mode === 'interp') onSeek(); };
  function tick() {
    if (!running || !video) return;
    if (!video.isConnected) { stop(); setStatus('Video đã đổi, bấm Bắt đầu lại.'); return; }
    placeSub();
    if (mode === 'server' && (!video.paused || liveWait)) tickServer();
  }
  async function start() {
    video = mainVideo();
    if (!video) { setStatus('Không thấy video trên trang này.', true); return; }
    if (!cfg.srv.trim()) { setStatus('Nhập địa chỉ Máy chủ ở mục Cài đặt bên dưới trước.', true); adv.open = true; return; }
    try { audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; audioEl.play().catch(() => {}); } catch (e) {}
    btnMain.disabled = true;
    try {
      orig = { volume: video.volume, muted: video.muted };
      sid = 'web:' + location.host + ':' + Date.now(); cues = []; spoken = new Set(); profShown = ''; profEl.textContent = '';
      if (cfg.mode !== 'server' && ensureGraph()) startInterp();
      else if (cfg.mode === 'interp') throw new Error('Trang này không cho nghe tiếng video (có bảo vệ hoặc khác nguồn). Chọn chế độ "Máy chủ lấy từ link trang".');
      else await startServer();
      running = true;
      video.addEventListener('seeking', onSeek); video.addEventListener('pause', onPause);
      clearInterval(timer); timer = setInterval(tick, 100);
      if (video.paused) video.play().catch(() => {});
      fab.classList.add('on'); btnMain.textContent = '■ Dừng lồng tiếng';
    } catch (e) { setStatus(e.message || String(e), true); }
    btnMain.disabled = false;
  }
  function stop() {
    running = false; clearInterval(timer); stopInterp(); L = null; liveWait = false; stopVoice(); speaking = false; cur = -1; clearTimeout(watch);
    setVol(1); showText(null);
    if (video) { video.removeEventListener('seeking', onSeek); video.removeEventListener('pause', onPause); }
    orig = null; mode = null; fab.classList.remove('on'); btnMain.textContent = '▶ Bắt đầu lồng tiếng';
  }

  /* ---------- Phụ đề tiếng Việt nổi trên video ---------- */
  let subBox = null;
  function placeSub() {
    if (!subBox || !video) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const host = fs && fs !== video && fs.contains(video) ? fs : document.body;
    if (subBox.parentNode !== host) host.append(subBox);
    const r = video.getBoundingClientRect();
    subBox.style.left = r.left + r.width * 0.04 + 'px'; subBox.style.width = r.width * 0.92 + 'px';
    subBox.style.top = r.top + r.height * 0.78 + 'px';
  }
  function showText(c) {
    if (!subBox) {
      subBox = document.createElement('div');
      subBox.style.cssText = 'position:fixed;z-index:2147483645;text-align:center;pointer-events:none;font:600 clamp(14px,2.2vw,24px)/1.5 system-ui,sans-serif;transform:translateY(-100%)';
    }
    while (subBox.firstChild) subBox.firstChild.remove();
    if (!c || !cfg.sub) { subBox.style.display = 'none'; return; }
    const line = (t, small) => { const s = document.createElement('span'); s.textContent = t; s.style.cssText = `background:rgba(0,0,0,.75);color:${small ? '#ddd' : '#fff'};padding:2px 10px;border-radius:6px;${small ? 'font-size:.7em;font-weight:500' : ''};-webkit-box-decoration-break:clone;box-decoration-break:clone`; const d = document.createElement('div'); d.append(s); subBox.append(d); };
    line(c.text); if (cfg.orig && c.src && c.src !== c.text) line(c.src, true);
    subBox.style.display = ''; placeSub();
  }

  /* ---------- Giao diện ---------- */
  let root, host, fab, panel, statusEl, profEl, btnMain, adv, profShown = '';
  const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); kids.forEach((k) => e.append(k)); return e; };
  function setStatus(m, err) { if (statusEl) { statusEl.textContent = m; statusEl.style.color = err ? '#ff8a8a' : '#aab2bf'; } }
  function showProfile(p) {
    if (!p || !p.genre || profShown === p.genre + p.tone) return;
    profShown = p.genre + p.tone; profEl.textContent = `🎯 ${p.genre}${p.summary ? ' — ' + p.summary : ''}${p.tone ? ' · ' + p.tone : ''}`;
  }
  function buildUI() {
    host = el('div'); host.style.cssText = 'position:fixed;z-index:2147483646;right:14px;bottom:84px;display:none';
    root = host.attachShadow({ mode: 'open' });
    root.append(el('style', { textContent: `
      *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
      .fab{width:48px;height:48px;border-radius:15px;border:0;cursor:pointer;background:linear-gradient(135deg,#FFB938,#E5481B);box-shadow:0 6px 20px rgba(0,0,0,.35);font-size:24px;padding:0}
      .fab.on{outline:3px solid #3ecf8e;outline-offset:2px}
      .panel{position:absolute;right:0;bottom:58px;width:min(310px,calc(100vw - 28px));max-height:calc(100vh - 150px);overflow:auto;background:#15181f;color:#eceff4;border:1px solid #2a2f3a;border-radius:14px;padding:12px;display:none;flex-direction:column;gap:9px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:13px}
      .panel.open{display:flex}
      .hd{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:14px}
      .x{background:none;border:0;color:#9aa3b2;font-size:18px;cursor:pointer}
      .st{font-size:12px;color:#aab2bf;min-height:16px;line-height:1.35}.pf{color:#f5c56b}
      .main{border:0;border-radius:10px;padding:10px;font-weight:700;font-size:14px;background:#f5a524;color:#1a1000;cursor:pointer}.main:disabled{opacity:.5}
      label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#9aa3b2}
      label.c{flex-direction:row;align-items:flex-start;gap:7px;color:#eceff4}
      select,input[type=text],input[type=password]{width:100%;background:#1e222b;color:#eceff4;border:1px solid #2a2f3a;border-radius:8px;padding:6px;font-size:13px}
      input[type=range]{width:100%;accent-color:#f5a524}
      details{font-size:12px;color:#9aa3b2}summary{cursor:pointer;margin-bottom:6px}details label{margin-top:6px}
    ` }));
    fab = el('button', { className: 'fab', title: 'Lồng tiếng Việt', textContent: '🎙️' });
    statusEl = el('div', { className: 'st' }); profEl = el('div', { className: 'st pf' });
    btnMain = el('button', { className: 'main', textContent: '▶ Bắt đầu lồng tiếng' });
    btnMain.onclick = () => (running ? stop() : start());
    const sel = (opts, k) => { const s = el('select'); opts.forEach(([v, n]) => s.append(new Option(n, v))); s.value = String(cfg[k]); s.onchange = () => { cfg[k] = typeof DEF[k] === 'number' ? +s.value : s.value; saveCfg(); }; return s; };
    const chk = (k) => { const c = el('input', { type: 'checkbox', checked: !!cfg[k] }); c.onchange = () => { cfg[k] = c.checked; saveCfg(); }; return c; };
    const txt = (k, ph, pw) => { const t = el('input', { type: pw ? 'password' : 'text', value: cfg[k], placeholder: ph, autocomplete: 'off' }); t.oninput = () => { cfg[k] = t.value.trim(); saveCfg(); }; return t; };
    const rate = el('input', { type: 'range', min: 0.8, max: 1.5, step: 0.05, value: cfg.rate }), rl = el('span', { textContent: `Tốc độ: ${(+cfg.rate).toFixed(2)}×` });
    rate.oninput = () => { cfg.rate = +rate.value; rl.textContent = `Tốc độ: ${cfg.rate.toFixed(2)}×`; saveCfg(); };
    adv = el('details', {}, el('summary', { textContent: 'Cài đặt máy chủ' }),
      el('label', {}, 'Địa chỉ máy chủ', txt('srv', 'https://longtieng-downloader.onrender.com')),
      el('label', {}, 'Mã truy cập', txt('key', 'API_TOKEN')), el('label', {}, 'Mã Groq', txt('groq', 'gsk_…', true)));
    const close = el('button', { className: 'x', textContent: '✕' });
    panel = el('div', { className: 'panel' },
      el('div', { className: 'hd' }, el('span', { textContent: 'Lồng tiếng Việt' }), close),
      statusEl, profEl, btnMain,
      el('label', {}, 'Cách lấy lời thoại', sel([['auto', 'Tự động'], ['interp', '⚡ Nghe tiếng video đang phát'], ['server', '🌐 Máy chủ lấy từ link trang (khớp nhất)']], 'mode')),
      el('label', { className: 'c' }, chk('cast'), '🎭 Đạo diễn tự động: giọng nam/nữ/trẻ em theo từng người nói, đọc theo cảm xúc và thể loại video'),
      el('label', {}, 'Giọng khi tắt đạo diễn', sel([['auto', 'HoaiMy (nữ)'], ['vi-VN-NamMinhNeural', 'NamMinh (nam)']], 'voice')),
      el('label', {}, rl, rate),
      el('label', {}, 'Âm gốc khi đang đọc', sel([['0', 'Tắt hẳn'], ['0.15', 'Rất nhỏ (15%)'], ['0.3', 'Nhỏ (30%)'], ['0.5', 'Vừa (50%)']], 'duck')),
      el('label', { className: 'c' }, chk('sub'), 'Hiện phụ đề tiếng Việt'),
      el('label', { className: 'c' }, chk('orig'), 'Hiện cả phụ đề gốc'),
      adv);
    close.onclick = () => panel.classList.remove('open');
    fab.onclick = () => { panel.classList.toggle('open'); if (!running) setStatus(cfg.srv ? 'Bấm Bắt đầu để lồng tiếng video trên trang.' : 'Nhập máy chủ trong Cài đặt máy chủ để bắt đầu.'); if (!cfg.srv) adv.open = true; };
    root.append(panel, fab);
    document.documentElement.append(host);
  }
  function scan() { if (host) host.style.display = running || mainVideo() ? '' : 'none'; }

  const init = () => loadCfg().then(() => { buildUI(); scan(); setInterval(scan, 1500); });
  if (document.readyState === 'loading' || !document.body) document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
