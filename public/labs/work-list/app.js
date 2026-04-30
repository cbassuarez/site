const TAB_KEYS = ['details', 'cues', 'playback', 'score'];
const HASH_WORK_KEY = 'work';
const HASH_TAB_KEY = 'tab';
const PRAE_THEME_STORAGE_KEY = 'wc.theme';
const PRAE_THEME_CLASSNAMES = ['prae-theme-light', 'prae-theme-dark'];
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const HEROICONS_BASE = './lib/heroicons/24/outline';
const HUD_IDLE_TITLE = 'Now playing — Idle';
const HUD_IDLE_SUBTITLE = 'No playback selected';

const HEROICON_FILE_MAP = Object.freeze({
  sun: 'sun',
  moon: 'moon',
  play: 'play',
  pause: 'pause',
  link: 'link',
  eye: 'eye',
  document: 'document-text',
  arrowUpRight: 'arrow-up-right',
  sparkles: 'sparkles',
  xMark: 'x-mark'
});

function icon(name, className = 'ct-icon') {
  const file = HEROICON_FILE_MAP[name] || HEROICON_FILE_MAP.sparkles;
  return `<img class="${className}" src="${HEROICONS_BASE}/${file}.svg" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch (_) {
    return false;
  }
}

function ready(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function praeNormalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

function praeReadStoredTheme() {
  try {
    const docTheme = document.documentElement?.getAttribute('data-theme');
    if (docTheme === 'light' || docTheme === 'dark') return docTheme;
    const bodyTheme = document.body?.getAttribute('data-theme');
    if (bodyTheme === 'light' || bodyTheme === 'dark') return bodyTheme;
  } catch (_) {}
  try {
    let saved = localStorage.getItem(PRAE_THEME_STORAGE_KEY);
    if (!saved) return 'dark';
    if (saved.trim().charAt(0) === '{') {
      const parsed = JSON.parse(saved);
      return praeNormalizeTheme(parsed?.mode);
    }
    return praeNormalizeTheme(saved);
  } catch (_) {
    return 'dark';
  }
}

function praeSyncThemeOnDom(mode) {
  const eff = praeNormalizeTheme(mode);
  const body = document.body;
  const doc = document.documentElement;
  const host = document.getElementById('works-console');
  if (doc) {
    doc.setAttribute('data-theme', eff);
    doc.style.colorScheme = eff === 'dark' ? 'dark' : 'light';
  }
  if (body) {
    body.classList.remove(...PRAE_THEME_CLASSNAMES);
    body.classList.add(eff === 'light' ? PRAE_THEME_CLASSNAMES[0] : PRAE_THEME_CLASSNAMES[1]);
    body.setAttribute('data-theme', eff);
  }
  if (host) {
    host.classList.remove(...PRAE_THEME_CLASSNAMES);
    host.classList.add(eff === 'light' ? PRAE_THEME_CLASSNAMES[0] : PRAE_THEME_CLASSNAMES[1]);
    host.setAttribute('data-theme', eff);
  }
  return eff;
}

function praeApplyTheme(mode, opts) {
  const eff = praeSyncThemeOnDom(mode);
  try {
    if (window.PRAE && typeof window.PRAE.applyAppearanceMode === 'function') {
      window.PRAE.applyAppearanceMode(eff, { persist: false });
    }
  } catch (_) {}
  if (!opts || opts.persist !== false) {
    try { localStorage.setItem(PRAE_THEME_STORAGE_KEY, eff); } catch (_) {}
  }
  const btn = document.getElementById('wc-theme-toggle');
  if (btn) {
    btn.setAttribute('aria-checked', String(eff === 'dark'));
    btn.dataset.mode = eff;
    btn.innerHTML = eff === 'dark' ? icon('sun') : icon('moon');
    btn.title = eff === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }
  return eff;
}

function praeCurrentTheme() {
  const attr = document.body?.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return praeReadStoredTheme();
}

function praeCycleTheme() {
  const next = praeCurrentTheme() === 'dark' ? 'light' : 'dark';
  praeApplyTheme(next);
}

if (typeof window.praeApplyTheme !== 'function') {
  window.praeApplyTheme = praeApplyTheme;
}
if (typeof window.praeCurrentTheme !== 'function') {
  window.praeCurrentTheme = praeCurrentTheme;
}
if (typeof window.praeCycleTheme !== 'function') {
  window.praeCycleTheme = praeCycleTheme;
}

const PRAE = (window.PRAE = window.PRAE || {});
const PRAE_DATA = window.__PRAE_DATA__ || {};
const works = Array.isArray(PRAE_DATA.works)
  ? PRAE_DATA.works
  : (Array.isArray(PRAE.works) ? PRAE.works : []);
const praeMedia = PRAE && PRAE.media ? PRAE.media : null;
function setEmbedFrameMode(frame, mode) {
  if (!frame || typeof frame.setAttribute !== 'function') return;
  if (praeMedia && typeof praeMedia.setEmbedFrameMode === 'function') {
    try {
      praeMedia.setEmbedFrameMode(frame, mode);
      return;
    } catch (_) {}
  }
  frame.setAttribute('referrerpolicy', String(mode || '').toLowerCase() === 'youtube'
    ? 'strict-origin-when-cross-origin'
    : 'no-referrer');
}

const pfMap = PRAE_DATA.pageFollowMaps || PRAE.pageFollowMaps || {};

let selectedId = works[0]?.id ?? null;
let activeTab = 'details';
const hudState = { last: { id: selectedId, at: 0 } };

const state = {
  worksById: new Map(),
  audioDurations: new Map(),
  playbackContext: new Map(),
  durationTotal: 0,
  tablist: null,
  tabIndicator: null,
  actionRail: null,
  hud: null,
  pdf: {
    shell: null,
    pane: null,
    title: null,
    close: null,
    frame: null,
    currentSlug: null,
    viewerReady: false,
    pendingGoto: null,
    backdrop: null,
    focusHandler: null,
    restoreFocus: null,
  },
  pageFollow: { audio: null, slug: null, lastPrinted: null, on: null }
};
state.pageFollow.token = null;
state.pageFollow.sourceKind = 'audio';
state.youtube = { controller: null, workId: null };

function ensureHudRoot() {
  const HUD_ID = 'wc-hud';
  let root = document.getElementById(HUD_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = HUD_ID;
    root.className = 'wc-hud';
    const anchor = document.querySelector(".ct-header");
    if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", root);
    else document.body.prepend(root);
  } else {
    root.id = HUD_ID;
    root.classList.add('wc-hud');
  }
  root.setAttribute('data-component', 'prae-hud');
  return root;
}

function ensureHudDom() {
  const root = ensureHudRoot();
  if (root.dataset.hudBound === '1' && state.hud) return state.hud;
  root.innerHTML = `
    <div class="hud-left">
      <div class="hud-title" data-part="title"></div>
      <div class="hud-sub" data-part="subtitle"></div>
    </div>
    <div class="hud-meter" data-part="meter"><span></span></div>
    <div class="hud-actions">
      <button class="hud-btn" type="button" data-part="toggle" data-hud="toggle" aria-label="Play" data-icon="play">
        ${icon('play', 'ct-icon icon-play')}
        ${icon('pause', 'ct-icon icon-pause')}
      </button>
    </div>`;
  const refs = {
    root,
    title: root.querySelector('[data-part="title"]'),
    sub: root.querySelector('[data-part="subtitle"]'),
    meter: root.querySelector('[data-part="meter"]'),
    fill: root.querySelector('[data-part="meter"] span'),
    btn: root.querySelector('[data-part="toggle"]')
  };
  state.hud = refs;
  root.dataset.hudBound = '1';
  return refs;
}

function hudSetSubtitle(text) {
  const refs = ensureHudDom();
  if (refs?.sub) refs.sub.textContent = String(text ?? '');
}

function hudSetTitle(text) {
  const refs = ensureHudDom();
  if (refs?.title) refs.title.textContent = String(text ?? '');
}

function hudSetPlaying(on) {
  const refs = ensureHudDom();
  if (!refs?.btn) return;
  refs.btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  refs.btn.dataset.icon = on ? 'pause' : 'play';
}

function hudSetProgress(ratio) {
  const refs = ensureHudDom();
  if (!refs?.fill) return;
  const pct = Math.max(0, Math.min(1, Number(ratio) || 0));
  refs.fill.style.width = `${pct * 100}%`;
}

function hudSetIdle() {
  hudSetTitle(HUD_IDLE_TITLE);
  hudSetSubtitle(HUD_IDLE_SUBTITLE);
  hudSetProgress(0);
  hudSetPlaying(false);
}

function formatTime(sec) {
  const clamped = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(clamped / 60);
  const s = (clamped % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function labelForCue(t, label) {
  if (label && /^@?\d+:\d{2}$/.test(label)) return label.replace(/^@?/, '@');
  return `@${formatTime(t)}`;
}

function normalizeSrc(url) {
  if (!url) return '';
  const match = String(url).match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  return url;
}

function resolveWorkMedia(work) {
  if (praeMedia && typeof praeMedia.resolveWorkMedia === 'function') {
    try { return praeMedia.resolveWorkMedia(work || {}); } catch (_) {}
  }
  return {
    kind: 'score',
    audioUrl: work?.audioUrl || work?.audio || '',
    pdfUrl: work?.pdfUrl || work?.pdf || '',
    pageFollow: work?.pageFollow || work?.score || null,
    startAtSec: 0
  };
}

function resolveScorePdfMode(work) {
  if (praeMedia && typeof praeMedia.resolveScorePdfMode === 'function') {
    try { return praeMedia.resolveScorePdfMode(work || {}); } catch (_) {}
  }
  return 'interactive';
}

function hasPlayableMedia(work) {
  const media = resolveWorkMedia(work);
  return media.kind === 'youtube' || !!media.audioUrl;
}

function normalizePdfUrl(url) {
  if (praeMedia && typeof praeMedia.normalizePdfUrl === 'function') {
    try { return praeMedia.normalizePdfUrl(url); } catch (_) {}
  }
  if (!url) return '';
  const match = String(url).match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
  if (match) return `https://drive.google.com/file/d/${match[1]}/view?usp=drivesdk`;
  return url;
}

function getPdfSourceForWork(work) {
  const media = resolveWorkMedia(work);
  return normalizePdfUrl(media.pdfUrl || work?.pdf || '');
}

function hasPdfForWork(work) {
  return !!getPdfSourceForWork(work);
}

function choosePdfViewer(url) {
  if (praeMedia && typeof praeMedia.choosePdfViewer === 'function') {
    try {
      const chosen = praeMedia.choosePdfViewer(url);
      if (chosen) return chosen;
    } catch (_) {}
  }
  let resolved = String(url || '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(resolved) && !/^\/\//.test(resolved)) {
    try { resolved = new URL(resolved, location.href).toString(); } catch (_) {}
  }
  const match = resolved.match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
  const file = match ? `https://drive.google.com/uc?export=download&id=${match[1]}` : resolved;
  return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(file)}#page=1&zoom=page-width&toolbar=0&sidebar=0`;
}

function applyPdfFramePolicy(frame, work, options = {}) {
  if (!frame) return 'interactive';
  if (praeMedia && typeof praeMedia.applyPdfFramePolicy === 'function') {
    try {
      return praeMedia.applyPdfFramePolicy(frame, work || {}, options);
    } catch (_) {}
  }
  const mode = options.mode === 'clean'
    ? 'clean'
    : (options.mode === 'interactive' ? 'interactive' : resolveScorePdfMode(work));
  const clean = mode === 'clean';
  frame.setAttribute('data-prae-score-pdf-mode', mode);
  frame.style.pointerEvents = clean ? 'none' : '';
  if (clean) frame.setAttribute('tabindex', '-1');
  else frame.removeAttribute('tabindex');
  if (options.container && typeof options.container.setAttribute === 'function') {
    options.container.setAttribute('data-prae-score-pdf-mode', mode);
  }
  return mode;
}

function ensureAudioFor(work) {
  let el = document.getElementById('wc-a' + work.id);
  if (!el) {
    el = document.createElement('audio');
    el.id = 'wc-a' + work.id;
    el.preload = 'none';
    el.playsInline = true;
    if (work.audio) el.setAttribute('data-audio', work.audio);
    document.body.appendChild(el);
  }
  return el;
}

function findWorkById(id) {
  const num = Number(id);
  if (Number.isNaN(num)) return null;
  if (state.worksById.has(num)) return state.worksById.get(num);
  const data = works.find((item) => Number(item.id) === num) || null;
  if (!data) return null;
  const record = { data, el: document.querySelector(`[data-work-id="${data.id}"]`) };
  state.worksById.set(num, record);
  return record;
}

function deepUrl(id) {
  const w = findWorkById(id)?.data;
  if (!w) return location.href;
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${HASH_WORK_KEY}=${encodeURIComponent(w.id)}&${HASH_TAB_KEY}=${encodeURIComponent(activeTab)}`;
}

function markPlaying(id, on) {
  const record = findWorkById(id);
  if (!record) return;
  record.el?.classList.toggle('playing', !!on);
  const audio = document.getElementById('wc-a' + id);
  if (!audio) return;
  const off = () => {
    record.el?.classList.remove('playing');
    audio.removeEventListener('pause', off);
    audio.removeEventListener('ended', off);
  };
  audio.addEventListener('pause', off, { once: true });
  audio.addEventListener('ended', off, { once: true });
}

function flash(element, text) {
  if (!element) return;
  try {
    const span = document.createElement('span');
    span.className = 'ct-flash';
    span.textContent = text;
    element.appendChild(span);
    requestAnimationFrame(() => span.classList.add('is-visible'));
    setTimeout(() => span.classList.remove('is-visible'), 1400);
    setTimeout(() => span.remove(), 1700);
  } catch (_) {}
}

function computePdfPage(slug, tSec) {
  const cfg = pfMap[slug];
  if (!cfg) return 1;
  if (praeMedia && typeof praeMedia.computePdfPage === 'function') {
    try { return praeMedia.computePdfPage(cfg, tSec || 0); } catch (_) {}
  }
  const printed = printedPageForTime(cfg, tSec || 0);
  return (cfg.pdfStartPage || 1) + (printed - 1) + (cfg.pdfDelta ?? 0);
}

function printedPageForTime(cfg, tSec) {
  if (praeMedia && typeof praeMedia.printedPageForTime === 'function') {
    try { return praeMedia.printedPageForTime(cfg, tSec || 0); } catch (_) {}
  }
  const time = (tSec || 0) + (cfg.mediaOffsetSec || 0);
  let current = cfg.pageMap?.[0]?.page ?? 1;
  for (const row of cfg.pageMap || []) {
    const at = typeof row.at === 'number' ? row.at : cueTime(row.at);
    if (time >= at) current = row.page; else break;
  }
  return current;
}

function cueTime(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  if (/^\d+$/.test(String(value))) return parseInt(value, 10);
  const match = String(value).match(/^(\d+):([0-5]?\d)$/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function gotoPdfPage(pageNum) {
  const frame = state.pdf.frame;
  if (!frame || !frame.src) return;
  if (!/\/viewer\.html/i.test(frame.src)) return;
  const url = new URL(frame.src, location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const current = Number(hash.get('page') || '1');
  const next = Number(pageNum || 1);
  if (current === next) return;
  hash.set('page', String(next));
  if (!hash.has('zoom')) hash.set('zoom', 'page-width');
  if (!hash.has('sidebar')) hash.set('sidebar', '0');
  url.hash = '#' + hash.toString();
  state.pdf.viewerReady = false;
  frame.src = url.toString();
}

function detachPageFollow() {
  if (state.pageFollow.token && typeof state.pageFollow.token.detach === 'function') {
    try { state.pageFollow.token.detach(); } catch (_) {}
  }
  if (state.pageFollow.audio && state.pageFollow.on) {
    state.pageFollow.audio.removeEventListener('timeupdate', state.pageFollow.on);
    state.pageFollow.audio.removeEventListener('seeking', state.pageFollow.on);
  }
  state.pageFollow = { audio: null, slug: null, lastPrinted: null, on: null, token: null, sourceKind: 'audio' };
}

function attachPageFollow(slug, audio) {
  detachPageFollow();
  if (!slug || !audio) return;
  const work = works.find((w) => w && w.slug === slug) || null;
  if (praeMedia && typeof praeMedia.attachPageFollow === 'function' && work) {
    state.pageFollow = {
      audio,
      slug,
      lastPrinted: null,
      on: null,
      token: praeMedia.attachPageFollow(work, { kind: 'audio', audio }),
      sourceKind: 'audio'
    };
    if (state.pageFollow.token && typeof state.pageFollow.token.tick === 'function') {
      try { state.pageFollow.token.tick(); } catch (_) {}
    }
    return;
  }
  const cfg = pfMap[slug];
  if (!cfg) return;
  const onTick = () => {
    const printed = printedPageForTime(cfg, audio.currentTime || 0);
    if (printed !== state.pageFollow.lastPrinted) {
      state.pageFollow.lastPrinted = printed;
      const pdfPage = computePdfPage(slug, audio.currentTime || 0);
      window.dispatchEvent(new CustomEvent('wc:pdf-goto', {
        detail: { slug, printedPage: printed, pdfPage }
      }));
    }
  };
  state.pageFollow = { audio, slug, lastPrinted: null, on: onTick, token: null, sourceKind: 'audio' };
  audio.addEventListener('timeupdate', onTick, { passive: true });
  audio.addEventListener('seeking', onTick, { passive: true });
  onTick();
}

function attachYouTubeFollow(work, controller) {
  detachPageFollow();
  if (!work || !controller || !praeMedia || typeof praeMedia.attachPageFollow !== 'function') return;
  state.pageFollow = {
    audio: null,
    slug: work.slug || null,
    lastPrinted: null,
    on: null,
    token: praeMedia.attachPageFollow(work, { kind: 'youtube', controller }),
    sourceKind: 'youtube'
  };
  if (state.pageFollow.token && typeof state.pageFollow.token.tick === 'function') {
    try { state.pageFollow.token.tick(); } catch (_) {}
  }
}

function getPageFollowSeconds() {
  if (state.pageFollow.sourceKind === 'youtube' && state.youtube.controller && typeof state.youtube.controller.getCurrentTime === 'function') {
    try { return Number(state.youtube.controller.getCurrentTime() || 0); } catch (_) { return 0; }
  }
  return Number(state.pageFollow.audio?.currentTime || 0);
}

async function playYouTubeAt(work, id, t = 0) {
  if (!praeMedia || typeof praeMedia.mountYouTubePlayer !== 'function') {
    flash(findWorkById(id)?.el, 'YouTube runtime unavailable; opening tab and disabling sync');
    detachPageFollow();
    if (praeMedia && typeof praeMedia.openYouTubeTab === 'function') praeMedia.openYouTubeTab(work);
    return;
  }
  try {
    if (window.PRAE && typeof window.PRAE.pauseAllAudio === 'function') {
      window.PRAE.pauseAllAudio(id);
    }
  } catch (_) {}
  showYouTubePane(work, resolveWorkMedia(work));
  try {
    const controller = await praeMedia.mountYouTubePlayer(state.pdf.frame, work, {
      onError: (err) => {
        const code = Number(err?.code);
        flash(findWorkById(id)?.el, `YouTube embed blocked${Number.isFinite(code) ? ` (error ${code})` : ''}`);
        if (praeMedia && typeof praeMedia.openYouTubeTab === 'function') praeMedia.openYouTubeTab(work);
        detachPageFollow();
      }
    });
    state.youtube.controller = controller;
    state.youtube.workId = id;
    const seek = Math.max(0, Number(t) || 0);
    if (typeof controller.seekTo === 'function') controller.seekTo(seek);
    if (typeof controller.play === 'function') controller.play();
    hudState.last = { id, at: seek };
    attachYouTubeFollow(work, controller);
    hudSetTitle(`Now playing — ${work.title || work.slug || ('Work ' + id)}`);
    hudSetSubtitle('YouTube stream');
    hudSetPlaying(true);
  } catch (_) {
    flash(findWorkById(id)?.el, 'YouTube unavailable');
    detachPageFollow();
    if (praeMedia && typeof praeMedia.openYouTubeTab === 'function') praeMedia.openYouTubeTab(work);
  }
}

function playAt(id, t = 0) {
  const meta = findWorkById(id);
  if (!meta) return;
  const work = meta.data;
  const media = resolveWorkMedia(work);
  if (selectedId !== work.id) {
    selectWork(work.id);
  }
  if (media.kind === 'youtube') {
    playYouTubeAt(work, id, t || media.startAtSec || 0);
    return;
  }
  const audio = document.getElementById('wc-a' + work.id) || ensureAudioFor(work);
  if (!audio) return;
  hudState.last = { id: work.id, at: t || 0 };
  if (!audio.src) {
    const raw = audio.getAttribute('data-audio') || work.audio || '';
    const src = normalizeSrc(raw);
    if (src) {
      audio.src = src;
      audio.load();
    }
  }
  const seekAndPlay = () => {
    try {
      if (window.PRAE && typeof window.PRAE.pauseAllAudio === 'function') {
        window.PRAE.pauseAllAudio(work.id);
      }
    } catch (_) {}
    try { audio.currentTime = Math.max(0, Number(t) || 0); } catch (_) {}
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        if (err && err.name === 'NotAllowedError') flash(meta.el, 'Tap to enable audio');
      });
    }
    markPlaying(work.id, true);
    bindAudio(work.id);
    requestAnimationFrame(() => hudUpdate(work.id, audio));
    if (work.slug) attachPageFollow(work.slug, audio);
  };
  if (audio.readyState >= 1) {
    seekAndPlay();
  } else {
    audio.addEventListener('loadedmetadata', () => seekAndPlay(), { once: true });
  }
}

function openPdfFor(id) {
  const meta = findWorkById(id);
  if (!meta) return;
  const work = meta.data;
  const raw = getPdfSourceForWork(work);
  if (!raw) return;
  const viewerUrl = choosePdfViewer(raw);
  const shell = state.pdf.shell;
  const pane = state.pdf.pane;
  const title = state.pdf.title;
  const frame = state.pdf.frame;
  if (!shell || !pane || !frame) {
    window.open(viewerUrl, '_blank', 'noopener');
    return;
  }
  state.pdf.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.pdf.currentSlug = work.slug || null;
  setActiveTab('score');
  let initPage = 1;
  try {
    if (state.pageFollow.slug && state.pageFollow.slug === state.pdf.currentSlug) {
      initPage = computePdfPage(state.pdf.currentSlug, getPageFollowSeconds());
    } else if (pfMap[state.pdf.currentSlug]) {
      initPage = computePdfPage(state.pdf.currentSlug, 0);
    }
  } catch (_) {}
  if (title) title.textContent = String(work.title || 'Score');
  setEmbedFrameMode(frame, 'pdf');
  applyPdfFramePolicy(frame, work, { container: pane });
  shell?.classList.add('has-pdf');
  pane.removeAttribute('hidden');
  pane.setAttribute('aria-hidden', 'false');
  frame.src = 'about:blank';
  requestAnimationFrame(() => {
    state.pdf.viewerReady = false;
    frame.src = `${viewerUrl.split('#')[0]}#page=${Math.max(1, initPage)}&zoom=page-width&toolbar=0&sidebar=0`;
    state.pdf.close?.focus({ preventScroll: true });
  });
}

function showYouTubePane(work, media) {
  const shell = state.pdf.shell;
  const pane = state.pdf.pane;
  const frame = state.pdf.frame;
  if (!shell || !pane || !frame) {
    detachPageFollow();
    if (praeMedia && typeof praeMedia.openYouTubeTab === 'function') {
      praeMedia.openYouTubeTab(work);
    }
    return;
  }
  state.pdf.currentSlug = work.slug || null;
  if (state.pdf.title) state.pdf.title.textContent = String(work.title || 'YouTube');
  setEmbedFrameMode(frame, 'youtube');
  applyPdfFramePolicy(frame, work, { mode: 'interactive', container: pane });
  shell.classList.add('has-pdf');
  pane.removeAttribute('hidden');
  pane.setAttribute('aria-hidden', 'false');
  state.pdf.viewerReady = false;
  frame.src = 'about:blank';
}

function hidePdfPane() {
  const { shell, pane, frame } = state.pdf;
  if (state.youtube.controller && typeof state.youtube.controller.pause === 'function') {
    try { state.youtube.controller.pause(); } catch (_) {}
  }
  shell?.classList.remove('has-pdf');
  pane?.setAttribute('aria-hidden', 'true');
  pane?.setAttribute('hidden', '');
  if (frame) frame.src = 'about:blank';
  state.pdf.currentSlug = null;
  state.pdf.viewerReady = false;
  state.youtube.controller = null;
  state.youtube.workId = null;
  const restore = state.pdf.restoreFocus;
  state.pdf.restoreFocus = null;
  if (restore && typeof restore.focus === 'function') {
    requestAnimationFrame(() => restore.focus());
  }
}

function getActiveAudioInfo() {
  if (state.youtube.controller && state.youtube.workId != null && typeof state.youtube.controller.isPlaying === 'function') {
    try {
      if (state.youtube.controller.isPlaying()) {
        return { id: state.youtube.workId, audio: null, source: 'youtube' };
      }
    } catch (_) {}
  }
  for (const work of works) {
    const audio = document.getElementById('wc-a' + work.id);
    if (audio && !audio.paused && !audio.ended) {
      return { id: work.id, audio, source: 'audio' };
    }
  }
  return { id: null, audio: null, source: null };
}

function syncHudWithActivePlayback() {
  const now = getActiveAudioInfo();
  if (now.audio && now.id != null) {
    hudUpdate(now.id, now.audio);
    return;
  }
  if (now.source === 'youtube' && now.id != null) {
    const work = findWorkById(now.id)?.data;
    hudSetTitle(`Now playing — ${work ? work.title : 'YouTube'}`);
    hudSetSubtitle('YouTube stream');
    hudSetPlaying(true);
    return;
  }
  hudSetIdle();
}

function hudUpdate(id, audio) {
  const refs = ensureHudDom();
  if (!refs) return;
  const work = findWorkById(id)?.data;
  const name = work ? work.title : '—';
  const duration = audio && Number.isFinite(audio.duration) ? formatTime(audio.duration | 0) : '--:--';
  const current = audio && Number.isFinite(audio.currentTime) ? formatTime(audio.currentTime | 0) : '0:00';
  const ratio = audio && audio.duration ? Math.max(0, Math.min(1, (audio.currentTime || 0) / Math.max(1, audio.duration))) : 0;
  hudSetTitle(`Now playing — ${name}`);
  hudSetSubtitle(`${current} / ${duration}`);
  hudSetProgress(ratio);
  hudSetPlaying(!!(audio && !audio.paused));
}

function bindAudio(id) {
  const audio = document.getElementById('wc-a' + id);
  if (!audio || audio.dataset.hudBound === '1') return;
  audio.addEventListener('timeupdate', () => hudUpdate(id, audio), { passive: true });
  audio.addEventListener('ratechange', () => hudUpdate(id, audio), { passive: true });
  audio.addEventListener('volumechange', () => hudUpdate(id, audio), { passive: true });
  audio.addEventListener('play', () => hudUpdate(id, audio), { passive: true });
  audio.addEventListener('loadedmetadata', () => {
    hudUpdate(id, audio);
    if (Number.isFinite(audio.duration)) {
      state.audioDurations.set(id, audio.duration);
      recomputeDurationTotal();
    }
  }, { once: true, passive: true });
  audio.addEventListener('pause', syncHudWithActivePlayback, { passive: true });
  audio.addEventListener('ended', syncHudWithActivePlayback, { passive: true });
  audio.dataset.hudBound = '1';
}

function bindPlaybackListeners(id) {
  const audio = document.getElementById('wc-a' + id);
  if (!audio) return;
  if (audio.dataset.cardsTabsPlayback === '1') return;
  const handler = () => updatePlaybackContext(id);
  audio.addEventListener('timeupdate', handler, { passive: true });
  audio.addEventListener('play', handler, { passive: true });
  audio.addEventListener('pause', handler, { passive: true });
  audio.addEventListener('ended', handler, { passive: true });
  audio.addEventListener('loadedmetadata', handler, { passive: true });
  audio.dataset.cardsTabsPlayback = '1';
}

function updatePlaybackContext(id) {
  const ctx = state.playbackContext.get(id);
  if (!ctx) return;
  const work = findWorkById(id)?.data || null;
  const media = resolveWorkMedia(work);
  if (media.kind === 'youtube') {
    const isPlaying = !!(state.youtube.controller
      && state.youtube.workId === id
      && typeof state.youtube.controller.isPlaying === 'function'
      && state.youtube.controller.isPlaying());
    if (ctx.status) {
      const current = formatTime(Math.floor(getPageFollowSeconds() || 0));
      ctx.status.textContent = `${isPlaying ? 'Playing' : 'Paused'} · ${current} / YouTube`;
    }
    if (ctx.playBtn) {
      const label = isPlaying ? 'Pause' : 'Play';
      const titleSuffix = work?.title ? ` ${work.title}` : '';
      ctx.playBtn.dataset.icon = isPlaying ? 'pause' : 'play';
      ctx.playBtn.setAttribute('aria-label', `${label}${titleSuffix}`.trim());
      if (ctx.sr) ctx.sr.textContent = `${label}${titleSuffix}`.trim();
      if (ctx.text) ctx.text.textContent = isPlaying ? 'Pause' : 'Play YouTube';
    }
    return;
  }
  const audio = document.getElementById('wc-a' + id);
  if (!audio) return;
  const isPlaying = !audio.paused && !audio.ended;
  if (ctx.status) {
    const current = formatTime(Math.floor(audio.currentTime || 0));
    const total = audio.duration ? formatTime(Math.floor(audio.duration)) : '--:--';
    ctx.status.textContent = `${isPlaying ? 'Playing' : 'Paused'} · ${current} / ${total}`;
  }
  if (ctx.playBtn) {
    const label = isPlaying ? 'Pause' : 'Play';
    const titleSuffix = work?.title ? ` ${work.title}` : '';
    ctx.playBtn.dataset.icon = isPlaying ? 'pause' : 'play';
    ctx.playBtn.setAttribute('aria-label', `${label}${titleSuffix}`.trim());
    if (ctx.sr) ctx.sr.textContent = `${label}${titleSuffix}`.trim();
    if (ctx.text) ctx.text.textContent = label;
  }
}

function recomputeDurationTotal() {
  let total = 0;
  for (const value of state.audioDurations.values()) {
    if (Number.isFinite(value)) total += value;
  }
  state.durationTotal = total;
  updateSummaryDuration();
}

function updateSummaryDuration() {
  const container = document.getElementById('ct-summary');
  if (!container) return;
  const cardEl = container.querySelector('[data-summary="duration"]');
  const strong = cardEl?.querySelector('strong');
  if (!state.durationTotal || state.durationTotal <= 0) {
    cardEl?.remove();
    return;
  }
  if (!strong) {
    const article = document.createElement('article');
    article.className = 'ct-summary-card';
    article.dataset.summary = 'duration';
    const heading = document.createElement('h3');
    heading.textContent = 'Known Duration';
    const value = document.createElement('strong');
    value.textContent = formatTime(Math.floor(state.durationTotal));
    article.append(heading, value);
    container.appendChild(article);
    return;
  }
  strong.textContent = formatTime(Math.floor(state.durationTotal));
}

function parseHash() {
  const hash = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const id = params.get(HASH_WORK_KEY);
  const tab = params.get(HASH_TAB_KEY);
  const parsed = { id: null, tab: null };
  if (id && !Number.isNaN(Number(id))) parsed.id = Number(id);
  if (tab && TAB_KEYS.includes(tab)) parsed.tab = tab;
  return parsed;
}

function syncHash() {
  if (!selectedId) return;
  const params = new URLSearchParams();
  params.set(HASH_WORK_KEY, String(selectedId));
  params.set(HASH_TAB_KEY, activeTab);
  const next = `#${params.toString()}`;
  if (location.hash !== next) {
    history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  }
}

function updateTabIndicator() {
  if (!state.tablist) {
    state.tablist = document.querySelector('.ct-tablist');
  }
  const list = state.tablist;
  if (!list) return;
  if (!state.tabIndicator) {
    state.tabIndicator = list.querySelector('.ct-tab-indicator');
  }
  const indicator = state.tabIndicator;
  const activeBtn = list.querySelector(`[data-tab="${activeTab}"]`);
  if (!indicator || !activeBtn) {
    list.dataset.active = '';
    return;
  }
  const width = activeBtn.getBoundingClientRect().width;
  const offset = activeBtn.offsetLeft - list.scrollLeft;
  indicator.style.width = `${width}px`;
  indicator.style.transform = `translateX(${Math.max(0, offset)}px)`;
  list.dataset.active = 'true';
}

function setActiveTab(key, opts = {}) {
  if (!TAB_KEYS.includes(key)) return;
  activeTab = key;
  const tabButtons = document.querySelectorAll('#ct-tabs [role="tab"]');
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === key;
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });
  const panels = document.querySelectorAll('#ct-tabs [role="tabpanel"]');
  panels.forEach((panel) => {
    const controls = panel.getAttribute('aria-labelledby');
    const btn = controls ? document.getElementById(controls) : null;
    const isActive = btn?.dataset.tab === key;
    panel.toggleAttribute('hidden', !isActive);
    panel.tabIndex = isActive ? 0 : -1;
  });
  if (!opts.skipHash) syncHash();
  renderPanels();
  requestAnimationFrame(() => {
    updateTabIndicator();
    focusActivePanelHeading();
  });
}

function selectWork(id, opts = {}) {
  if (!id || Number.isNaN(Number(id))) return;
  const record = findWorkById(id);
  if (!record) return;
  selectedId = record.data.id;
  document.querySelectorAll('.work').forEach((item) => {
    item.classList.toggle('is-selected', Number(item.dataset.workId) === selectedId);
  });
  if (!opts.skipHash) syncHash();
  renderPanels();
  renderActionRail();
}

function renderPanels() {
  const work = selectedId ? findWorkById(selectedId)?.data : null;
  const detailsPanel = document.getElementById('ct-panel-details');
  const cuesPanel = document.getElementById('ct-panel-cues');
  const playbackPanel = document.getElementById('ct-panel-playback');
  const scorePanel = document.getElementById('ct-panel-score');
  state.playbackContext.clear();

  if (detailsPanel) {
    if (!work) {
      detailsPanel.innerHTML = `<div class="ct-empty">Select a work to view details.</div>`;
    } else {
      detailsPanel.innerHTML = '';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.dataset.panelHeading = 'true';
      heading.tabIndex = -1;
      heading.textContent = work.title || 'Untitled work';
      const hero = document.createElement('div');
      hero.className = 'ct-details-hero';
      const titleWrap = document.createElement('div');
      titleWrap.appendChild(heading);
      const slugLine = document.createElement('p');
      slugLine.className = 'ct-muted';
      slugLine.textContent = work.slug ? `Slug · ${work.slug}` : 'Slug · —';
      titleWrap.appendChild(slugLine);
      hero.innerHTML = '';
      hero.appendChild(titleWrap);
      const coverMarkup = createCoverMarkup(work, 'work-cover');
      if (coverMarkup) {
        const coverWrap = document.createElement('div');
        coverWrap.innerHTML = coverMarkup;
        const coverEl = coverWrap.firstElementChild;
        if (coverEl) hero.appendChild(coverEl);
      } else {
        hero.classList.add('is-no-cover');
      }
      header.appendChild(hero);
      detailsPanel.appendChild(header);
      const detailText = work.descriptionEffective || work.onelinerEffective;
      if (detailText) {
        const summary = document.createElement('p');
        summary.textContent = detailText;
        detailsPanel.appendChild(summary);
      }
      const tags = normalizeTagList(work.tags).slice(0, 10);
      if (tags.length) {
        const tagWrap = document.createElement('div');
        tagWrap.className = 'ct-details-tags';
        tags.forEach((tag) => {
          const chip = document.createElement('span');
          chip.className = 'work-tag';
          chip.textContent = tag;
          tagWrap.appendChild(chip);
        });
        detailsPanel.appendChild(tagWrap);
      }
      const detailsList = document.createElement('dl');
      detailsList.className = 'ct-details-list';
      const rows = [
        ['Playback', hasPlayableMedia(work) ? 'Available' : 'Unavailable'],
        ['Score PDF', hasPdfForWork(work) ? 'Available' : 'Unavailable'],
        ['Cue Points', String(Array.isArray(work.cues) ? work.cues.length : 0)]
      ];
      rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        row.append(dt, dd);
        detailsList.appendChild(row);
      });
      detailsPanel.appendChild(detailsList);
    }
  }

  if (cuesPanel) {
    if (!work) {
      cuesPanel.innerHTML = `<div class="ct-empty">Select a work to view cues.</div>`;
    } else if (!Array.isArray(work.cues) || work.cues.length === 0) {
      cuesPanel.innerHTML = `<div class="ct-empty">No cues for this work.</div>`;
    } else {
      cuesPanel.innerHTML = '';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.dataset.panelHeading = 'true';
      heading.tabIndex = -1;
      heading.textContent = 'Cues';
      header.appendChild(heading);
      cuesPanel.appendChild(header);
      const cloud = document.createElement('div');
      cloud.className = 'ct-cues-cloud';
      work.cues.forEach((cue) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'work-cue';
        btn.dataset.id = String(work.id);
        btn.dataset.t = String(cue.t || 0);
        btn.dataset.act = 'play';
        btn.textContent = cue.label ? String(cue.label) : labelForCue(cue.t || 0, cue.label);
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          selectWork(work.id);
          playAt(work.id, cue.t || 0);
        });
        cloud.appendChild(btn);
      });
      cuesPanel.appendChild(cloud);
    }
  }

  if (playbackPanel) {
    if (!work) {
      playbackPanel.innerHTML = `<div class="ct-empty">Select a work to control playback.</div>`;
    } else if (!hasPlayableMedia(work)) {
      playbackPanel.innerHTML = `<div class="ct-empty">No playback available.</div>`;
    } else {
      const media = resolveWorkMedia(work);
      const audio = media.kind === 'youtube' ? null : (document.getElementById('wc-a' + work.id) || ensureAudioFor(work));
      if (audio) {
        bindAudio(work.id);
        bindPlaybackListeners(work.id);
      }
      playbackPanel.innerHTML = '';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.dataset.panelHeading = 'true';
      heading.tabIndex = -1;
      heading.textContent = 'Playback';
      header.appendChild(heading);
      playbackPanel.appendChild(header);
      const statusEl = document.createElement('div');
      statusEl.className = 'ct-playback-status';
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      playbackPanel.appendChild(statusEl);
      const controls = document.createElement('div');
      controls.className = 'ct-playback-controls';
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'ct-playback-button';
      playBtn.dataset.icon = 'play';
      playBtn.innerHTML = `
        ${icon('play', 'ct-icon icon-play')}
        ${icon('pause', 'ct-icon icon-pause')}
        <span class="sr-only">Play</span>
        <span class="ct-btn-text" aria-hidden="true">Play</span>
      `;
      playBtn.addEventListener('click', () => {
        if (media.kind === 'youtube') {
          const now = getActiveAudioInfo();
          if (now.source === 'youtube' && now.id === work.id && state.youtube.controller && typeof state.youtube.controller.pause === 'function') {
            hudState.last = { id: work.id, at: getPageFollowSeconds() || 0 };
            state.youtube.controller.pause();
          } else {
            playAt(work.id, getPageFollowSeconds() || 0);
          }
          updatePlaybackContext(work.id);
          return;
        }
        if (!audio) return;
        if (audio.paused || audio.ended) {
          playAt(work.id, audio.currentTime || 0);
        } else {
          hudState.last = { id: work.id, at: audio.currentTime || 0 };
          audio.pause();
        }
        updatePlaybackContext(work.id);
      });
      controls.appendChild(playBtn);
      playbackPanel.appendChild(controls);
      state.playbackContext.set(work.id, {
        status: statusEl,
        playBtn,
        sr: playBtn.querySelector('.sr-only'),
        text: playBtn.querySelector('.ct-btn-text')
      });
      updatePlaybackContext(work.id);
    }
  }

  if (scorePanel) {
    if (!work) {
      scorePanel.innerHTML = `<div class="ct-empty">Select a work to view scores.</div>`;
    } else if (!hasPdfForWork(work)) {
      scorePanel.innerHTML = `<div class="ct-empty">No score available.</div>`;
    } else {
      scorePanel.innerHTML = '';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.dataset.panelHeading = 'true';
      heading.tabIndex = -1;
      heading.textContent = 'Score';
      header.appendChild(heading);
      scorePanel.appendChild(header);
      const wrapper = document.createElement('div');
      wrapper.className = 'ct-score-actions';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'work-action';
      setActionButton(openBtn, 'document', 'Open PDF');
      openBtn.addEventListener('click', () => {
        openPdfFor(work.id);
      });
      wrapper.appendChild(openBtn);
      scorePanel.appendChild(wrapper);
      if (resolveScorePdfMode(work) === 'clean') {
        const note = document.createElement('p');
        note.className = 'ct-muted';
        note.textContent = 'Clean mode: viewer is locked; page changes follow cues/playback only.';
        scorePanel.appendChild(note);
      }
    }
  }
}

function focusActivePanelHeading() {
  const panel = document.querySelector(`#ct-panel-${activeTab}`);
  if (!panel || panel.hasAttribute('hidden')) return;
  const heading = panel.querySelector('[data-panel-heading]');
  if (heading && typeof heading.focus === 'function') {
    heading.focus({ preventScroll: false });
  }
}

function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeCoverUrl(work) {
  const raw = work && typeof work === 'object' ? (work.cover ?? work.coverUrl ?? null) : null;
  if (raw == null) return '';
  const normalized = praeMedia && typeof praeMedia.normalizeCoverUrl === 'function'
    ? praeMedia.normalizeCoverUrl(raw)
    : String(raw).trim();
  return normalized || '';
}

function createCoverMarkup(work, className = 'work-cover') {
  const cover = normalizeCoverUrl(work);
  if (cover) {
    return `<figure class="${className}"><img src="${escapeHtml(cover)}" alt="${escapeHtml((work?.title || 'Work') + ' cover')}" loading="lazy" decoding="async" onerror="this.style.display='none';var fb=this.nextElementSibling;if(fb)fb.hidden=false;"><span class="work-cover-fallback" hidden>Cover unavailable</span></figure>`;
  }
  return `<figure class="${className}"><span class="work-cover-fallback">Cover unavailable</span></figure>`;
}

function setActionButton(button, iconName, label) {
  if (!button) return;
  button.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
}

function applyCardPointerMotion(card) {
  if (!card || prefersReducedMotion()) return;
  let raf = 0;
  let sweepTimer = null;
  const setSheenSweep = () => {
    card.style.setProperty('--sheen-pos', '-40%');
    requestAnimationFrame(() => {
      card.style.setProperty('--sheen-pos', '128%');
    });
  };
  card.addEventListener('mouseenter', () => {
    clearTimeout(sweepTimer);
    setSheenSweep();
    sweepTimer = setTimeout(setSheenSweep, 360);
  });
  card.addEventListener('focusin', () => setSheenSweep());
  card.addEventListener('mouseleave', () => {
    clearTimeout(sweepTimer);
    card.style.removeProperty('--pointer-x');
    card.style.removeProperty('--pointer-y');
  });
  card.addEventListener('pointermove', (event) => {
    if (raf) cancelAnimationFrame(raf);
    const rect = card.getBoundingClientRect();
    raf = requestAnimationFrame(() => {
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      card.style.setProperty('--pointer-x', `${Math.max(0, Math.min(100, x))}%`);
      card.style.setProperty('--pointer-y', `${Math.max(0, Math.min(100, y))}%`);
    });
  });
}

function readDurationSeconds(work) {
  if (!work || typeof work !== 'object') return null;
  const meta = work.meta || {};
  const candidates = [
    work.duration,
    work.durationSec,
    work.durationSeconds,
    meta.duration,
    meta.durationSec,
    meta.durationSeconds
  ];
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        return parseFloat(trimmed);
      }
      const match = trimmed.match(/^(\d+):(\d{1,2})$/);
      if (match) {
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      }
    }
  }
  return null;
}

function renderSummary() {
  const container = document.getElementById('ct-summary');
  if (!container) return;
  container.innerHTML = '';
  const cards = [
    { key: 'total', title: 'Total Works', value: String(works.length) },
    { key: 'audio', title: 'Playable', value: String(works.filter((w) => hasPlayableMedia(w)).length) },
    { key: 'pdf', title: 'With Scores', value: String(works.filter((w) => hasPdfForWork(w)).length) }
  ];
  let durationSum = 0;
  for (const work of works) {
    const secs = readDurationSeconds(work);
    if (Number.isFinite(secs) && secs > 0) {
      durationSum += secs;
    }
  }
  state.durationTotal = durationSum;
  if (durationSum > 0) {
    cards.push({ key: 'duration', title: 'Known Duration', value: formatTime(Math.floor(durationSum)) });
  }
  cards.forEach((card) => {
    const box = document.createElement('article');
    box.className = 'ct-summary-card';
    box.dataset.summary = card.key;
    const heading = document.createElement('h3');
    heading.textContent = card.title;
    const value = document.createElement('strong');
    value.textContent = card.value;
    box.append(heading, value);
    container.appendChild(box);
  });
}

function renderWorksList() {
  const container = document.getElementById('works-console');
  if (!container) return;
  state.worksById.clear();
  container.innerHTML = '';
  if (works.length === 0) {
    state.playbackContext.clear();
    const empty = document.createElement('div');
    empty.className = 'ct-works-empty';
    empty.textContent = 'No works available.';
    container.appendChild(empty);
    return;
  }
  works.forEach((work, index) => {
    const card = document.createElement('article');
    card.className = 'work';
    card.dataset.workId = String(work.id);
    card.tabIndex = 0;
    card.style.setProperty('--stagger', String(index));
    const tags = normalizeTagList(work.tags).slice(0, 5);
    const tagsMarkup = tags.length
      ? `<div class="work-tags">${tags.map((tag) => `<span class="work-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
    card.innerHTML = `
      <div class="work-header">
        <div class="work-title-block">
          <div class="work-title">${escapeHtml(work.title ?? '')}</div>
          <div class="work-slug">${escapeHtml(work.slug ?? '')}</div>
        </div>
        ${createCoverMarkup(work, 'work-cover')}
      </div>
      <p class="work-one">${escapeHtml(work.onelinerEffective ?? '')}</p>
      ${tagsMarkup}
    `;
    applyCardPointerMotion(card);
    const cues = Array.isArray(work.cues) ? work.cues : [];
    if (cues.length) {
      const cueWrap = document.createElement('div');
      cueWrap.className = 'work-cues';
      cues.forEach((cue) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'work-cue';
        btn.dataset.id = String(work.id);
        btn.dataset.t = String(cue.t || 0);
        btn.dataset.act = 'play';
        btn.textContent = cue.label ? cue.label : labelForCue(cue.t || 0, cue.label);
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          selectWork(work.id);
          playAt(work.id, cue.t || 0);
        });
        cueWrap.appendChild(btn);
      });
      card.appendChild(cueWrap);
    }
    const actions = document.createElement('div');
    actions.className = 'work-actions';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'work-action';
    setActionButton(playBtn, 'play', 'Play');
    playBtn.dataset.act = 'play';
    playBtn.dataset.id = String(work.id);
    if (!hasPlayableMedia(work)) playBtn.disabled = true;
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'work-action';
    setActionButton(copyBtn, 'link', 'Copy URL');
    copyBtn.dataset.act = 'copy';
    copyBtn.dataset.id = String(work.id);
    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'work-action';
    setActionButton(pdfBtn, 'document', 'PDF');
    pdfBtn.dataset.act = 'pdf';
    pdfBtn.dataset.id = String(work.id);
    if (!hasPdfForWork(work)) pdfBtn.disabled = true;
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'work-action';
    setActionButton(openBtn, 'eye', 'Open');
    openBtn.dataset.act = 'open';
    openBtn.dataset.id = String(work.id);
    actions.append(playBtn, copyBtn, pdfBtn, openBtn);
    card.appendChild(actions);
    card.addEventListener('click', (event) => {
      if (event.target.closest('.work-actions') || event.target.closest('.work-cues')) return;
      selectWork(work.id);
    });
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectWork(work.id);
      }
    });
    container.appendChild(card);
    state.worksById.set(Number(work.id), { data: work, el: card });
    if (resolveWorkMedia(work).audioUrl) ensureAudioFor(work);
  });
  selectWork(selectedId, { skipHash: true });
}

function runWorkAction(act, id, opts = {}) {
  const t = Number(opts.t || 0);
  const trigger = opts.trigger || null;
  if (!id) return;
  if (act === 'play') {
    selectWork(id);
    playAt(id, Number.isFinite(t) ? t : 0);
    return;
  }
  if (act === 'copy') {
    const url = deepUrl(id);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => flash(trigger, 'Copied'));
    } else {
      flash(trigger, url);
    }
    return;
  }
  if (act === 'pdf') {
    selectWork(id);
    openPdfFor(id);
    return;
  }
  if (act === 'open') {
    selectWork(id);
    setActiveTab('details');
    document.getElementById('ct-tabs')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  if (act === 'open-window') {
    const url = deepUrl(id);
    window.open(url, '_blank', 'noopener');
  }
}

function handleWorksActions() {
  const container = document.getElementById('works-console');
  if (!container) return;
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !button.dataset.act) return;
    const act = button.dataset.act;
    const id = Number(button.dataset.id || selectedId || 0);
    if (!id) return;
    event.preventDefault();
    runWorkAction(act, id, { trigger: button, t: Number(button.dataset.t || 0) });
  });
}

function bindActionRailEvents() {
  const rail = document.getElementById('ct-action-rail');
  if (!rail) return;
  state.actionRail = rail;
  rail.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    const id = Number(button.dataset.id || selectedId || 0);
    if (!id) return;
    event.preventDefault();
    runWorkAction(act, id, { trigger: button, t: Number(button.dataset.t || 0) });
  });
}

function renderActionRail() {
  if (!state.actionRail) {
    state.actionRail = document.getElementById('ct-action-rail');
  }
  const rail = state.actionRail;
  if (!rail) return;
  const work = selectedId ? findWorkById(selectedId)?.data : null;
  if (!work) {
    rail.innerHTML = `<p class="ct-rail-empty">Select a work to access quick actions.</p>`;
    return;
  }
  const cues = Array.isArray(work.cues) ? work.cues.slice(0, 6) : [];
  const cuesMarkup = cues.length
    ? `<div class="ct-rail-cues">${cues
      .map((cue) => `<button type="button" class="work-cue" data-act="play" data-id="${work.id}" data-t="${cue.t || 0}">${escapeHtml(cue.label ? String(cue.label) : labelForCue(cue.t || 0, cue.label))}</button>`)
      .join('')}</div>`
    : '<p class="ct-rail-empty">No cue markers available for this work.</p>';
  const railCoverMarkup = createCoverMarkup(work, 'work-cover work-cover--rail');
  rail.innerHTML = `
    <div class="ct-rail-head">
      <div>
        <h3 class="ct-rail-title">${escapeHtml(work.title || 'Untitled work')}</h3>
        <p class="ct-rail-sub">${escapeHtml(work.slug || 'work')}</p>
      </div>
      ${railCoverMarkup}
    </div>
    <div class="ct-rail-actions">
      <button type="button" class="ct-rail-btn" data-act="play" data-id="${work.id}" ${hasPlayableMedia(work) ? '' : 'disabled'}>${icon('play')}<span>Play</span></button>
      <button type="button" class="ct-rail-btn" data-act="pdf" data-id="${work.id}" ${hasPdfForWork(work) ? '' : 'disabled'}>${icon('document')}<span>Score</span></button>
      <button type="button" class="ct-rail-btn" data-act="copy" data-id="${work.id}">${icon('link')}<span>Copy Link</span></button>
      <button type="button" class="ct-rail-btn" data-act="open-window" data-id="${work.id}">${icon('arrowUpRight')}<span>New Tab</span></button>
    </div>
    ${cuesMarkup}
  `;
}

function renderFooter() {
  const footer = document.getElementById('prae-footer');
  if (!footer) return;
  const site = (PRAE.config && PRAE.config.site) || {};
  const branding = (PRAE.config && PRAE.config.branding) || {};
  if (PRAE.branding && typeof PRAE.branding.renderFooter === 'function') {
    PRAE.branding.renderFooter(footer, { site, branding });
  }
}

function initBrand() {
  const site = (PRAE.config && PRAE.config.site) || {};
  const titleEl = document.querySelector('[data-site-title]');
  const subtitleEl = document.querySelector('[data-site-subtitle]');
  const nav = document.getElementById('prae-nav');
  if (titleEl) {
    const full = site.fullName || [site.firstName, site.lastName].filter(Boolean).join(' ').trim() || site.title || 'Praetorius';
    titleEl.textContent = full;
  }
  if (subtitleEl) {
    subtitleEl.textContent = site.subtitle || site.description || 'Neo-Brutal Gallery';
  }
  if (nav) {
    const links = Array.isArray(site.links) ? site.links : [];
    nav.innerHTML = links
      .filter((link) => link && (link.label || link.title))
      .map((link) => `<a href="${escapeHtml(link.href || '#')}" ${link.external ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(link.label || link.title || 'Link')}</a>`)
      .join('');
  }
}

function initTabs() {
  const tabButtons = document.querySelectorAll('#ct-tabs [role="tab"]');
  tabButtons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab || 'details');
    });
    btn.addEventListener('keydown', (ev) => {
      const currentIndex = TAB_KEYS.indexOf(btn.dataset.tab || 'details');
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        const next = TAB_KEYS[(currentIndex + 1) % TAB_KEYS.length];
        setActiveTab(next);
        const nextBtn = document.querySelector(`[data-tab="${next}"]`);
        nextBtn?.focus();
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const prev = TAB_KEYS[(currentIndex - 1 + TAB_KEYS.length) % TAB_KEYS.length];
        setActiveTab(prev);
        const prevBtn = document.querySelector(`[data-tab="${prev}"]`);
        prevBtn?.focus();
      }
      if (ev.key === 'Home') {
        ev.preventDefault();
        setActiveTab(TAB_KEYS[0]);
        document.querySelector(`[data-tab="${TAB_KEYS[0]}"]`)?.focus();
      }
      if (ev.key === 'End') {
        ev.preventDefault();
        setActiveTab(TAB_KEYS[TAB_KEYS.length - 1]);
        document.querySelector(`[data-tab="${TAB_KEYS[TAB_KEYS.length - 1]}"]`)?.focus();
      }
    });
  });
  if (!state.tablist) {
    state.tablist = document.querySelector('.ct-tablist');
    state.tabIndicator = state.tablist?.querySelector('.ct-tab-indicator') || null;
  }
  state.tablist?.addEventListener('scroll', () => updateTabIndicator(), { passive: true });
}

function hydrateFromHash() {
  const parsed = parseHash();
  if (parsed.id) {
    selectedId = parsed.id;
  }
  if (parsed.tab) {
    activeTab = parsed.tab;
  }
  if (!selectedId && works.length) {
    selectedId = works[0].id;
  }
  selectWork(selectedId, { skipHash: true });
  setActiveTab(activeTab, { skipHash: true });
}

function bindThemeToggle() {
  const btn = document.getElementById('wc-theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.praeCycleTheme();
    window.praeApplyTheme(window.praeCurrentTheme());
  });
  btn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      window.praeCycleTheme();
      window.praeApplyTheme(window.praeCurrentTheme());
    }
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.altKey || ev.metaKey) && (ev.key === 'd' || ev.key === 'D')) {
      ev.preventDefault();
      window.praeCycleTheme();
      window.praeApplyTheme(window.praeCurrentTheme());
    }
  }, { passive: false });
}

function bindPdfEvents() {
  state.pdf.shell = document.querySelector('.ct-shell');
  state.pdf.pane = document.querySelector('.ct-pdfpane');
  state.pdf.title = document.querySelector('.ct-pdf-title');
  state.pdf.close = document.querySelector('.ct-pdf-close');
  state.pdf.frame = document.querySelector('.ct-pdf-frame');
  state.pdf.backdrop = document.querySelector('[data-pdf-backdrop]');
  if (state.pdf.pane && state.pdf.pane.getAttribute('aria-hidden') !== 'false') {
    state.pdf.pane.setAttribute('hidden', '');
  }
  if (state.pdf.close) {
    state.pdf.close.innerHTML = icon('xMark');
  }
  state.pdf.close?.addEventListener('click', hidePdfPane);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePdfPane();
  }, { passive: true });
  if (state.pdf.frame) {
    state.pdf.frame.addEventListener('load', () => {
      state.pdf.viewerReady = true;
      if (state.pdf.pendingGoto) {
        gotoPdfPage(state.pdf.pendingGoto.pdfPage);
        state.pdf.pendingGoto = null;
      }
    });
  }
  window.addEventListener('wc:pdf-goto', (event) => {
    const detail = event?.detail || {};
    if (!state.pdf.viewerReady || !state.pdf.pane || state.pdf.pane.getAttribute('aria-hidden') === 'true' || (detail.slug && detail.slug !== state.pdf.currentSlug)) {
      state.pdf.pendingGoto = detail;
      return;
    }
    gotoPdfPage(detail.pdfPage);
  });
}

function bindHudToggle() {
  const refs = ensureHudDom();
  const root = refs?.root;
  if (!root) return;
  root.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-hud="toggle"]');
    if (!btn) return;
    const now = getActiveAudioInfo();
    if (now.source === 'youtube' && state.youtube.controller && typeof state.youtube.controller.pause === 'function') {
      hudState.last = { id: now.id, at: getPageFollowSeconds() || 0 };
      state.youtube.controller.pause();
      syncHudWithActivePlayback();
      return;
    }
    if (now.audio && !now.audio.paused) {
      hudState.last = { id: now.id, at: now.audio.currentTime || 0 };
      now.audio.pause();
      syncHudWithActivePlayback();
      return;
    }
    const id = hudState.last.id || (works[0] && works[0].id);
    if (!id) return;
    playAt(id, hudState.last.at || 0);
  });
}

ready(() => {
  document.documentElement.dataset.skin = 'cards-tabs';
  ensureHudDom();
  hudSetIdle();
  bindHudToggle();
  window.praeApplyTheme(window.praeCurrentTheme(), { persist: false });
  bindThemeToggle();
  initBrand();
  renderSummary();
  renderWorksList();
  bindActionRailEvents();
  renderActionRail();
  renderFooter();
  handleWorksActions();
  initTabs();
  bindPdfEvents();
  hydrateFromHash();
  renderPanels();
  updateTabIndicator();
  window.addEventListener('hashchange', hydrateFromHash);
  window.addEventListener('resize', () => updateTabIndicator(), { passive: true });
});

export {};
