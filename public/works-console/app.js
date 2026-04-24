import { normalizeWork } from './lib/work-normalize.js';

(function ensureFavicon(){
  if (typeof document === 'undefined') return;
  const head = document.head || document.querySelector('head');
  if (!head || head.querySelector('link[rel="icon"]')) return;
  const link = document.createElement('link');
  link.setAttribute('rel', 'icon');
  link.setAttribute('type', 'image/svg+xml');
  link.setAttribute('href', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Ccircle cx="8" cy="8" r="7" fill="%23f97316"/%3E%3C/svg%3E');
  head.appendChild(link);
})();

// --- Theme preboot (moved from template.html) -------------------------------
// Applies saved light/dark theme ASAP and sets color-scheme to avoid FOUC.
// Safe alongside the later applyTheme(readTheme()) in initWorksConsole.
;(function bootTheme(){
  function setThemeClasses(eff){
    var host = document.getElementById('works-console');
    try {
      host.classList.remove('prae-theme-light','prae-theme-dark');
      host.classList.add(eff === 'light' ? 'prae-theme-light' : 'prae-theme-dark');
      
    } catch(_) {}
  }
  function run(){
    try{
      var grp = document.getElementById('works-group');
var con = document.getElementById('works-console');
      var saved = localStorage.getItem('wc.theme');
      if (saved && saved.trim().charAt(0)==='{'){
        try { saved = (JSON.parse(saved)||{}).mode || 'dark'; } catch(_){ saved = 'dark'; }
      }
      var eff = (saved === 'light') ? 'light' : 'dark';
      if (grp){
  grp.removeAttribute('data-theme-mode');
  grp.setAttribute('data-theme', eff);
}
if (con){
  con.removeAttribute('data-theme-mode');     // back-compat for old selectors
  con.setAttribute('data-theme', eff);
}
setThemeClasses(eff);
// Respect active theme for native UI
document.documentElement.style.colorScheme = (eff === 'dark' ? 'dark' : 'light');
    }catch(e){}
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();


 function initWorksConsole() { 
  if (window.__PRAE_INITED) return; window.__PRAE_INITED = true;

//  (was an IIFE here; removed — keep everything that was inside) o.0
  const SCOPE = document.getElementById('works-group') || document;
  const cfg = (window.PRAE && window.PRAE.config) || {};
  applySiteChromeFromConfig(cfg.site || {});
  const $ = (s, r = SCOPE) => r.querySelector(s);
  const out = $('#works-console .wc-output');
  const input = $('#wc-cmd');
  const form = $('#works-console .wc-input');
  const consoleRoot = $('#works-console');
const themeRoot = document.getElementById('works-group');
const themeBtn  = document.getElementById('wc-theme-toggle');


  const praeData = window.__PRAE_DATA__ || {};
  const praeWorksList = Array.isArray(praeData.works)
    ? praeData.works
    : (Array.isArray(window.PRAE?.works) ? window.PRAE.works : []);
  const works = {};
  praeWorksList.forEach((item, idx) => {
    const raw = item || {};
    const id = Number.isFinite(Number(raw.id)) ? Number(raw.id) : (idx + 1);
    const clone = { ...raw };
    clone.id = id;
    clone.slug = (clone.slug && String(clone.slug).trim()) || `work-${id}`;
    if (!Array.isArray(clone.cues)) clone.cues = [];
    clone.cues = clone.cues.map(normalizeCue);
    if (clone.openNote && !Array.isArray(clone.openNote)) {
      clone.openNote = [String(clone.openNote)];
    }
    clone.audioId = clone.audioId || `wc-a${id}`;
    works[id] = normalizeWork(clone);
  });

  try {
    if (typeof window.PRAE?.ensureAudioTags === 'function') {
      window.PRAE.ensureAudioTags();
    }
  } catch (_) {}


   // Runtime guard: surface missing <audio> elements
(function warnMissingAudio() {
  try {
    const miss = Object.values(works).filter(w => w && !document.getElementById(w.audioId));
    if (miss.length) {
      miss.forEach(w => appendLine(
        `warn: missing <audio id="${w.audioId}"> for "${w.title}" — generator should create one.`,
        'warn',
        true
      ));
    }
  } catch {}
})();


// === PageFollow maps (printed page numbers) ===
// Tip: if you later want page 1 to start at audio 0:00 (for W1), set mediaOffsetSec to -30.
const pageFollowMaps = praeData.pageFollowMaps
  || (window.PRAE && window.PRAE.pageFollowMaps)
  || {};

   const cmds = ['help','list','open','play','pause','stop','copy','goto','pdf','vol','speed','resume','share','unlock','clear','theme'];
 const aliases = { h:'help', ls:'list', o:'open', p:'play', pa:'pause', st:'stop', cp:'copy', g:'goto', v:'vol', sp:'speed', rs:'resume', sh:'share', ul:'unlock', cls:'clear', th:'theme' };

  const history = []; let hi = 0; let toastTimer = null;
let bootDone = false; // prevent auto-scroll during initial render


  const state = {
    last: { n:null, at:0 },
    vol: 1.0,
    rate: 1.0
  };

  /* Boot: banner + auto List (present/invoked) */
  banner();
  echo('list', true); list(true);
  focusInput();
// Re-align title since console column may expand
  requestAnimationFrame(alignTitleToConsole);
// Make sure we start at the top (production-safe)
requestAnimationFrame(()=>{ out.scrollTop = 0; });
window.addEventListener('load', ()=>{ out.scrollTop = 0; }, { once:true });


  /* ===== Input handling ===== */
 form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = input.value.trim();
  if(!raw){ echo(''); input.value=''; return; }
  bootDone = true;            // <— add this line
  echo(raw, true);
  history.push(raw); hi = history.length;
  run(raw);
  input.value='';
});

  input.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowUp'){ if(hi>0){ hi--; input.value = history[hi]||''; placeCaretEnd(); e.preventDefault(); } }
    if(e.key === 'ArrowDown'){ if(hi<history.length){ hi++; input.value = history[hi]||''; placeCaretEnd(); e.preventDefault(); } }
    if(e.key === 'c' && e.ctrlKey){ appendLine('^C','muted',true); input.value=''; e.preventDefault(); }
    if(e.key === 'l' && e.ctrlKey){ clearOut(); banner(); echo('list', true); list(true); input.value=''; e.preventDefault(); }
    if(e.key === 'Tab'){
      e.preventDefault();
      const parts = input.value.trim().split(/\s+/);
      const first = parts[0] || '';
      const pool = Object.keys(aliases).concat(cmds);
      const matches = pool.filter(c => c.startsWith(first));
      if(matches.length===1){ parts[0] = canonical(matches[0]); input.value = parts.join(' ') + ' '; }
    }
  });

  /* Click-to-run actions */
  if (consoleRoot) {
    consoleRoot.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !consoleRoot.contains(button)) return;

      if (button.classList.contains('js-play')) {
        const index = getWorkIndexForButton(button);
        if (index == null) return;
        runCommand(`play ${index}`);
        return;
      }

      if (button.classList.contains('js-playat')) {
        const index = getWorkIndexForButton(button);
        if (index == null) return;
        const seconds = ensureCueSeconds(button);
        runCommand(`play ${index} ${seconds}`);
        return;
      }

      const cmd = button.getAttribute('data-cmd');
      if (!cmd) return;
      runCommand(cmd);
    });
  }


  /* ===== Command router ===== */
  function run(raw){
    const parts = raw.trim().split(/\s+/);
    let cmd = canonical(parts.shift()?.toLowerCase() || '');
    const args = parts;

    switch(cmd){
      case 'help': help(); break;
      case 'list': list(); break;
      case 'open': openWork(args[0]); break;
      case 'play': playCmd(args); break;
      case 'pause': pauseCmd(args[0]); break;
      case 'stop': stopCmd(args[0]); break;
      case 'copy': copyCmd(args.join(' ')); break;   // allow time
      case 'goto': gotoCmd(args.join(' ')); break;   // allow time
      case 'pdf':  pdfCmd(args[0]); break;
      case 'vol':  volCmd(args[0]); break;
      case 'speed': speedCmd(args[0]); break;
      case 'resume': resumeCmd(args[0]); break;
      case 'share': shareCmd(args[0], args[1]); break;
      case 'unlock': unlockCmd(); break;
      case 'theme': themeCmd(args); break;
      case 'clear': clearOut(); banner(); break;
      default:
        if(cmd){ appendLine(`error: unknown command "${cmd}"`,'err',true); }
        else { appendLine('', '', true); }
    }
  }
// ===== PageFollow engine =====
let pageFollow = { audio:null, slug:null, lastPrinted:null, _on:null };

// printed → actual PDF page (1-based) for a given slug and time
function computePdfPage(slug, tSec=0){
  const cfg = pageFollowMaps[slug];
  if(!cfg) return 1;
  const printed = printedPageForTime(cfg, tSec);
  return (cfg.pdfStartPage || 1) + (printed - 1) + (cfg.pdfDelta ?? 0);
}
function secFromMixed(v){
  if(typeof v === 'number') return v;
  return time(v); // you already have time(mm:ss|s) helper
}

function printedPageForTime(cfg, tSec){
  const T = (tSec || 0) + (cfg.mediaOffsetSec || 0);
  let current = cfg.pageMap[0]?.page ?? 1;
  for(const row of cfg.pageMap){
    const at = secFromMixed(row.at);
    if(T >= at) current = row.page;
    else break;
  }
  return current;
}

function detachPageFollow(){
  if(pageFollow.audio && pageFollow._on){
    pageFollow.audio.removeEventListener('timeupdate', pageFollow._on);
    pageFollow.audio.removeEventListener('seeking', pageFollow._on);
  }
  pageFollow = { audio:null, slug:null, lastPrinted:null, _on:null };
}

function attachPageFollow(slug, audio){
  detachPageFollow();
  const cfg = pageFollowMaps[slug];
  if(!cfg || !audio) return;

  const onTick = ()=>{
    const printed = printedPageForTime(cfg, audio.currentTime || 0);
    if(printed !== pageFollow.lastPrinted){
      pageFollow.lastPrinted = printed;
      const pdfPage = computePdfPage(slug, audio.currentTime || 0);
      try { console.debug('[pagefollow]', { slug, printed, pdfPage, t: (audio.currentTime|0) }); } catch {}      // Fire one simple event. Your PDF pane should listen for this:
      window.dispatchEvent(new CustomEvent('wc:pdf-goto', {
        detail: { slug, printedPage: printed, pdfPage }
      }));
    }
  };

  pageFollow = { audio, slug, lastPrinted:null, _on:onTick };
  audio.addEventListener('timeupdate', onTick, { passive:true });
  audio.addEventListener('seeking', onTick, { passive:true });
  onTick(); // initial sync
}

  /* ===== Commands ===== */
  function help(){
    section('Commands');
    smoothLines([
      'help                   Show this help',
      'list                   List the three works with actions',
      'open <n>               Print program note for work n',
      'play <n> [mm:ss|s]     Play work n at time (defaults to first cue)',
      'pause <n>              Pause work n',
      'stop <n>               Stop work n',
      'copy <n> [time]        Copy deep link (supports ?t=)',
      'goto <n> [time]        Jump to #work-n (supports ?t=)',
      'pdf <n>                Open PDF for work n (1 & 3 only)',
      'vol <0–100>            Set volume percent',
      'speed <0.5–2>          Set playback rate',
      'resume [n]             Resume last (or specific) work',
      'share <n> [time]       Share/copy deep link (supports ?t=)',
      'unlock                 One-shot autoplay unlock',
      'clear                  Clear console',
      '',
      'aliases: h, ls, o, p, pa, st, cp, g, v, sp, rs, sh, ul, cls'
    ], 'muted', 12);
  }

  function list(isBoot=false){
    section(' ');
    const rows = Object.values(works).map((w, idx) => {
      const row = document.createElement('div');
      row.className = 'row';
      const workIndex = workIndexNumber(w, idx);
      row.dataset.workIndex = String(workIndex);
      const summaryNodes = [bold(`[${w.id}] ${w.title}`)];
      if (w.onelinerEffective) {
        summaryNodes.push(span(w.onelinerEffective, 'one'));
      }
      const actions = actRow([
        btn(`open ${w.id}`,'Open'),
        ...createPlayButtons(w, workIndex),
        btn(`copy ${w.id}`,'Copy URL'),
        ...(w.pdf ? [btn(`pdf ${w.id}`,'PDF')] : [])
      ], workIndex);
      row.appendChild(block([...summaryNodes, actions], workIndex));
      return row;
    });

    rows.forEach((r,i) => setTimeout(() => { out.appendChild(r); revealChildren(r); scrollBottom(); }, i*30));
    
  }

  function openWork(nRaw){
    const n = parseInt(nRaw,10);
    const w = works[n];
    if(!w){ return appendLine(`error: unknown work ${nRaw}`,'err',true); }
    section(w.title);

    const revealQueue = [];

    const descriptionSource = typeof w.descriptionEffective === 'string'
      ? w.descriptionEffective
      : '';
    const descParagraphs = descriptionSource
      .split(/\n{2,}/)
      .map(part => part.trim())
      .filter(Boolean);
    descParagraphs.forEach(text => {
      revealQueue.push({ text, className: 'desc' });
    });

    const oneliner = String(w.onelinerEffective ?? '').trim();
    if (oneliner) {
      revealQueue.push({ text: oneliner, className: 'muted one' });
    }

    const openNotes = Array.isArray(w.openNote)
      ? w.openNote
      : (w.openNote != null ? [w.openNote] : []);
    openNotes
      .map(note => String(note ?? '').trim())
      .filter(Boolean)
      .forEach(text => {
        revealQueue.push({ text, className: '' });
      });

    revealQueue.forEach((entry, i) => {
      const { text, className } = entry;
      setTimeout(() => appendLine(text, className, true), i * 20);
    });

    const acts = actRow([
      ...createPlayButtons(w, w.id),
      btn(`copy ${w.id}`,'Copy URL'),
      ...(w.pdf ? [btn(`pdf ${w.id}`,'PDF')] : [])
    ], w.id);
    out.appendChild(acts); reveal(acts); scrollBottom();
  }

  function playCmd(args){
    const n = parseInt(args[0],10);
    const w = works[n];
    if(!w){ return appendLine(`error: unknown work ${args[0]||''}`,'err',true); }
    const t = args[1] ? time(args[1]) : (w.cues[0]?.t ?? 0);
    if(t<0){ return appendLine(`error: invalid time "${args[1]||''}" (use mm:ss or seconds)`,'err',true); }

    const a = $('#'+w.audioId);
    if(!a) return appendLine('error: audio element missing','err',true);

    // Set source (normalize Google Drive "view" to direct "uc?export=download")
    if(!a.src){
      const raw = a.dataset.audio || '';
      const src = normalizeSrc(raw);
      if(!src){ return appendLine('warn: no audio source found','warn',true); }
      a.src = src; a.load();
    }

    // Ensure we seek after metadata is available
    const seekAndPlay = () => {
      try { a.currentTime = t; } catch(_) { /* will try after metadata */ }
      actuallyPlay(a, n, t);
    };

    if(a.readyState >= 1){ // HAVE_METADATA
      seekAndPlay();
    } else {
      const onMeta = () => { a.removeEventListener('loadedmetadata', onMeta); seekAndPlay(); };
      a.addEventListener('loadedmetadata', onMeta);
    }
  }

  function actuallyPlay(a, n, t){
    // Ensure no overlaps: stop any previous/other streams cold.
     if (typeof stopAllAudio === 'function') stopAllAudio(a);
    const p = a.play();
    if(p && typeof p.catch === 'function'){
      p.catch((err)=>{
        // Disambiguate: autoplay vs bad source
        const name = (err && err.name) || '';
        if(name === 'NotAllowedError'){
          appendLine('warn: autoplay blocked; press play once in the browser','warn',true);
          toast('Autoplay blocked — click any Play action once, then retry.');
        } else {
          const bad = mediaStatus(a);
          appendLine(`error: could not start playback (${bad})`,'err',true);
          if(isGoogleDrive(a.src)){
            appendLine('hint: Google Drive viewer links must be converted to direct "uc?export=download" links. This console auto-rewrites, but very large files may still require re-hosting.','muted',true);
          }
        }
      });
    }
    state.last = { n, at: t||0 };
    bindAudio(n);
  hudUpdate(n, a);
  attachPageFollow(works[n].slug, a);   // attach first so showPdfPane() can tick
  syncPdfPaneForWork(n);
    appendLine(`playing [${n}] at ${formatTime(t)} ▷`,'',true);
  }

  function pauseCmd(nRaw){
    const n = parseInt(nRaw,10);
    const w = works[n]; if(!w) return appendLine(`error: unknown work ${nRaw}`,'err',true);
    const a = $('#'+w.audioId);
    if(a && !a.paused){ a.pause(); state.last = { n, at: a.currentTime||0 }; hudUpdate(n,a); appendLine(`paused [${n}] at ${formatTime(a.currentTime|0)} ❚❚`,'',true); }
    else appendLine(`paused [${n}]`,'muted',true);
  }

  function stopCmd(nRaw){
    const n = parseInt(nRaw,10);
    const w = works[n]; if(!w) return appendLine(`error: unknown work ${nRaw}`,'err',true);
    const a = $('#'+w.audioId);
    if(a){ a.pause(); a.currentTime = 0; }
    state.last = { n, at: 0 };
    clearHud(); // hide HUD when unused
detachPageFollow();

    appendLine(`stopped [${n}] ⏹`,'',true);
  }

  function copyCmd(argLine){
    const parts = (argLine ?? '').toString().trim().split(/\s+/);
    const n = parseInt(parts[0]||'',10);
    const tRaw = parts[1];
    return copyWithTime(n, tRaw);
  }

  function gotoCmd(argLine){
    const parts = (argLine ?? '').toString().trim().split(/\s+/);
    const n = parseInt(parts[0]||'',10);
    if(!works[n]) return appendLine(`error: unknown work ${parts[0]||''}`,'err',true);
    const t = secOrTime(parts[1]);
    location.hash = `#work-${n}${t ? `?t=${t}` : ''}`;
    appendLine(`goto #work-${n}${t?`?t=${t}`:''}`,'ok',true);
  }

function pdfCmd(nRaw){
  const n = parseInt(nRaw,10);
  if(!nRaw){ return appendLine('error: pdf requires a work number (1 or 3)','err',true); }
  const w = works[n];
  if(!w){ return appendLine(`error: unknown work ${nRaw}`,'err',true); }
  if(!w.pdf){ return appendLine(`error: no PDF available for work ${n}`,'err',true); }
  showPdfPane(w.pdf, w.title || `Work ${n}`);
// If audio was already playing:
  //  • same work → do not restart
  //  • different work → switch to this work’s audio
  const { n: playingN } = getActiveAudioInfo();
  if (playingN != null){
    if (playingN !== n){
      playCmd([String(n)]);
    }
    // else: already playing this work → leave playback untouched
  }
  // If nothing was playing, do not start audio; pane opened to score p.1 already.
}
const worksConsole = document.getElementById('works-console');
const pdfPane   = worksConsole.querySelector('.wc-pdfpane');
const pdfTitle  = worksConsole.querySelector('.wc-pdf-title');
const pdfFrame  = worksConsole.querySelector('.wc-pdf-frame');
const pdfCloseB = worksConsole.querySelector('.wc-pdf-close');
// === PageFollow → PDF viewer wiring (split-pane iframe) ===
let pendingPdfGoto = null;
let currentPdfSlug = null;
let pdfViewerReady = false;

// Listen for page-follow events from the audio side
 window.addEventListener('wc:pdf-goto', (e) => {
   const { slug, pdfPage } = e.detail || {};
   if (!pdfFrame || !pdfPage) return;
   // If pane closed OR event slug doesn't match the currently loaded PDF, queue it
   if (!worksConsole.classList.contains('has-pdf') ||
      (slug && slug !== currentPdfSlug) ||
      !pdfViewerReady) {
     pendingPdfGoto = { slug, pdfPage };
     return;
   }
   gotoPdfPage(pdfPage);
 });

// Apply any queued page once the viewer has loaded
pdfFrame.addEventListener('load', () => {
   pdfViewerReady = true;
  if (pendingPdfGoto && (!pendingPdfGoto.slug || pendingPdfGoto.slug === currentPdfSlug)) {
     gotoPdfPage(pendingPdfGoto.pdfPage);
     pendingPdfGoto = null;
   }
 });

   // Stable width for transform animation (avoids layout thrash)
function setPdfPaneWidth(){
  const px = Math.min(896, Math.round(window.innerWidth * 0.56)); // ~56vw, capped
  pdfPane?.style.setProperty('--pdf-pane-w', px + 'px');
}
setPdfPaneWidth();
window.addEventListener('resize', setPdfPaneWidth, { passive:true });

// Hash-based navigation that works cross-origin for PDF.js viewer
function gotoPdfPage(pageNum){
  const src = pdfFrame.src || '';
  // PDF.js viewer: update hash (#page=) to navigate without touching the parent scroll state
  if (/\/viewer\.html/i.test(src)) {
    const url  = new URL(src, location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const curPage = Number(hash.get('page') || '1');
    const target  = Number(pageNum);
    if (curPage === target) return; // already there → no-op (prevents extra paints)
    hash.set('page', String(target));
    if (!hash.has('zoom')) hash.set('zoom','page-width');
    url.hash = '#' + hash.toString();
    pdfFrame.src = url.toString();   // hash-only change → fast navigate in PDF.js
  } else {
    // Non-PDF.js viewers (e.g., Drive preview) don’t expose a reliable page API cross-origin.
    // No-op here; see note below to force PDF.js for page-follow works.
  }
}


function showPdfPane(rawUrl, title){
  const url = normalizePdfUrl(rawUrl);
  const src = choosePdfViewer(url);
  pdfTitle.textContent = String(title || 'Score');
  const abs = /^https?:\/\//i.test(src) ? src : ('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.9.179/web/viewer.html?file=' + encodeURIComponent(src));

  // Decide the initial target page BEFORE loading the viewer
  // Prefer the work we’re opening; only use page-follow position if it’s the *same* work.
  let initPage = 1;
  const wForUrl = Object.values(works).find(w => w.pdf === rawUrl);
// Track which work’s PDF is (about to be) loaded
  currentPdfSlug = wForUrl ? wForUrl.slug : null;
  worksConsole.dataset.pdfSlug = currentPdfSlug || '';
  if (wForUrl && pageFollow?.slug === wForUrl.slug){
    // Same work as the actively playing one → land on its *current* score page
    initPage = computePdfPage(wForUrl.slug, pageFollow.audio?.currentTime || 0);
  } else if (wForUrl){
    // Different (or no) active audio → land on SCORE page 1 (printed p.1)
    initPage = computePdfPage(wForUrl.slug, 0);
  } else if (pageFollow?.slug){
    // Fallback
    initPage = computePdfPage(pageFollow.slug, pageFollow.audio?.currentTime || 0);
  }

  // Strip any existing hash and boot the viewer already on the intended page
  const base = abs.split('#')[0];
  worksConsole.classList.add('has-pdf');
pdfPane.removeAttribute('inert');                 // a11y: allow focus
pdfPane.setAttribute('aria-hidden', 'false');
pdfPane.classList.add('is-open');

// Delay src until the pane is on its own composited layer
requestAnimationFrame(()=>requestAnimationFrame(()=>{
  pdfViewerReady = false;                          // viewer will reload now
  pdfFrame.src = `${base}#page=${Math.max(1, initPage)}&zoom=page-width&toolbar=0`;
}));


  // Keep typing focus on the CLI input
  focusInput();
  appendLine(`opening ${title}…`,'muted',true);
// Force a page-follow tick so updated pdfStartPage/pdfDelta apply now
  if (pageFollow && typeof pageFollow._on === 'function') {
    pageFollow.lastPrinted = null; // invalidate cache so next tick dispatches
    pageFollow._on();
  }
// Keep title/subtitle left edge aligned to console column
  kickAlign(8);
}

function hidePdfPane(){
  pdfPane.classList.remove('is-open');
pdfPane.setAttribute('inert','');                  // a11y: make non-focusable
pdfPane.setAttribute('aria-hidden', 'true');
worksConsole.classList.remove('has-pdf');
currentPdfSlug = null;
delete worksConsole.dataset.pdfSlug;

// After the transform transition finishes, free the iframe
const onEnd = (e)=>{
  if (e.propertyName !== 'transform') return;
  pdfPane.removeEventListener('transitionend', onEnd);
  pdfFrame.src = 'about:blank';
  kickAlign(8);
  focusInput();
};
pdfPane.addEventListener('transitionend', onEnd, { once:true });
}

// Keep the PDF pane aligned with the active work (if the pane is open).
function syncPdfPaneForWork(n){
const w = works[n];
  if (!w) return;
  const isOpen = worksConsole.classList.contains('has-pdf');
  if (!w.pdf){ hidePdfPane(); return; }
  const same = isOpen && currentPdfSlug === w.slug;
  if (!same){ showPdfPane(w.pdf, w.title || `Work ${n}`); }
  // else: keep current viewer; page-follow will drive page via wc:pdf-goto
}

// Close interactions
if(pdfCloseB){
  pdfCloseB.addEventListener('click', hidePdfPane);
  // ESC closes when pane is open
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && worksConsole.classList.contains('has-pdf')) hidePdfPane();
  }, {passive:true});
}
// Re-align when the PDF pane finishes its width/transform transition
pdfPane.addEventListener('transitionend', (e)=>{
  if (e.propertyName === 'transform' || e.propertyName === 'opacity') kickAlign(4);
}, {passive:true});


  //apply chrome from initial who are you (init wizard) config
  function applySiteChromeFromConfig(site){
    const titleEl = SCOPE.querySelector('[data-site-title]');
    const labelEl = SCOPE.querySelector('[data-list-label]');
    const subEl   = SCOPE.querySelector('[data-site-subtitle]');
    const updEl   = SCOPE.querySelector('[data-updated]');
    const copyEl  = SCOPE.querySelector('[data-copyright-name]');
    const linksEl = SCOPE.querySelector('[data-links]');
    const badgeEl = SCOPE.querySelector('.wb-badge');
if (badgeEl) badgeEl.style.display = (site.showBadge === false) ? 'none' : '';


    const fullName = site.fullName || [site.firstName, site.lastName].filter(Boolean).join(' ').trim();
    if (titleEl && fullName) titleEl.textContent = fullName;
    if (copyEl  && (site.copyrightName || fullName)) copyEl.textContent = site.copyrightName || fullName;
    if (labelEl && site.listLabel) labelEl.textContent = site.listLabel;
    if (subEl   && site.subtitle)  subEl.textContent   = site.subtitle;

    if (updEl){
      // manual date string (e.g. "Nov 7") or auto (today)
      if (site.updated?.mode === 'manual' && site.updated.value){
        updEl.textContent = `Updated ${site.updated.value}`;
      } else {
        const fmt = new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric' });
        updEl.textContent = `Updated ${fmt.format(new Date())}`;
      }
    }





    
    if (linksEl){
  linksEl.innerHTML = '';

  const raw = Array.isArray(site.links) ? site.links : [];
  const cleaned = raw
    .map((l) => {
      if (!l) return null;
      const label = String(l.label ?? '').trim();
      let href = String(l.href ?? '').trim();
      const external = (l.external !== false); // default = external

      // Drop placeholders / empties
      if (!label || !href || href === '#' || href === '/') return null;

      // Add protocol if missing (treat bare domains as external)
      const isAbs = /^(?:[a-z]+:)?\/\//i.test(href);
      const isRel = href.startsWith('/') || href.startsWith('#');
      const isMail = /^mailto:/i.test(href);
      if (!isAbs && !isRel && !isMail) href = 'https://' + href.replace(/^\/+/, '');

      return { label, href, external };
    })
    .filter(Boolean);

  const seen = new Set();
  for (const l of cleaned){
    const key = (l.label + '|' + l.href).toLowerCase();
    if (seen.has(key)) continue; seen.add(key);

    const a = document.createElement('a');
    a.className = 'wb-chip';
    a.textContent = l.label;
    a.href = l.href;
    if (l.external) { a.target = '_blank'; a.rel = 'noopener'; }
    linksEl.appendChild(a);
  }
}

  }

  
// Re-align whenever #works-console gains/loses the has-pdf class
new MutationObserver(()=> kickAlign(4))
  .observe(worksConsole, { attributes:true, attributeFilter:['class'] });


/* Reuse your previous helpers (keep or paste if you removed them) */
function choosePdfViewer(url){
  const m = url.match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
  if (m) {
    // Prefer PDF.js for page control:
    const direct = `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(direct)}#page=1&zoom=page-width&toolbar=0`;

  }
  const sameOrigin = url.startsWith(location.origin);
  const corsLikely = /^https?:\/\/([^\/]*\.)?(jsdelivr\.net|unpkg\.com|githubusercontent\.com|cloudflare-ipfs\.com|stagedevices\.com|dexdsl\.org|cbassuarez\.com)\//i.test(url);
  if (sameOrigin || corsLikely){
   return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(url)}#page=1&zoom=page-width&toolbar=0`;



  }
  return `${url}#toolbar=1&view=FitH`;
}


function normalizePdfUrl(u){
  if(!u) return '';
  const m = u.match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
  if(m) return `https://drive.google.com/file/d/${m[1]}/view?usp=drivesdk`;
  return u;
}


  function volCmd(arg){
    const v = Math.max(0, Math.min(100, parseInt(arg ?? '100',10)));
    state.vol = v/100;
    Object.values(works).forEach(w=>{
      const a = document.getElementById(w.audioId); if(a) a.volume = state.vol;
    });
    appendLine(`volume ${v}%`,'ok',true);
    const lastA = state.last.n ? document.getElementById(works[state.last.n].audioId) : null;
    hudUpdate(state.last.n, lastA);
  }

  function speedCmd(arg){
    const r = Math.max(.5, Math.min(2, parseFloat(arg ?? '1')||1));
    state.rate = r;
    Object.values(works).forEach(w=>{
      const a = document.getElementById(w.audioId); if(a) a.playbackRate = state.rate;
    });
    appendLine(`speed ${r.toFixed(2)}x`,'ok',true);
    const lastA = state.last.n ? document.getElementById(works[state.last.n].audioId) : null;
    hudUpdate(state.last.n, lastA);
  }

  function resumeCmd(nRaw){
    const n = nRaw ? parseInt(nRaw,10) : (state.last.n || null);
    if(!n || !works[n]) return appendLine('error: nothing to resume','err',true);
    const at = state.last.at || 0;
    run(`play ${n} ${formatTime(at|0)}`);
  }

  function shareCmd(nRaw, tRaw){
    const n = parseInt(nRaw,10); if(!works[n]) return appendLine(`error: unknown work ${nRaw}`,'err',true);
    const t = secOrTime(tRaw);
    const url = deepUrl(n, t);
    if(navigator.share){
      navigator.share({title: works[n].title, url}).then(
        ()=> appendLine('shared','ok',true),
        ()=> appendLine(url,'muted',true)
      );
    } else {
      if(navigator.clipboard) navigator.clipboard.writeText(url);
      appendLine(url,'ok',true);
    }
  }

  function unlockCmd(){
    const targets = Object.values(works).map(w=>document.getElementById(w.audioId)).filter(Boolean);
    let ran = false;
    const doOne = (a)=> new Promise(res=>{
      const prevV = a.volume; a.volume = 0;
      const src = a.src || normalizeSrc(a.dataset.audio||''); if(!a.src && src){ a.src = src; a.load(); }
      a.play().then(()=>{ a.pause(); a.volume = prevV; res(); }).catch(()=>{ a.volume = prevV; res(); });
    });
    (async () => {
      for(const a of targets){ await doOne(a); ran = true; }
      appendLine(ran ? 'audio unlocked' : 'nothing to unlock','ok',true);
       })();
  }

  /* ===== UI helpers ===== */
  function banner(){
    section('Praetorius – Interactive Portfolio v0.1');
    appendLine('Click an action or type a command.','muted',true);
    appendLine('Type help for more options','muted',true);
    appendLine(' ','muted',true);

  }

  function echo(s, isCmd=false){
    const ln = document.createElement('div');
    ln.className = 'line cmd-echo';
    ln.innerHTML = `<span class="prompt" style="color:var(--accent);font-weight:700">$</span><span class="sp"></span>${escapeHtml(s)}`;
    out.appendChild(ln); reveal(ln); scrollBottom();
  }

  function section(titleText){
    divider();
    const ln = el('div','line title');
    ln.textContent = titleText;
    out.appendChild(ln); reveal(ln);
    divider();
  }

  function smoothLines(arr, cls='', step=10){
    arr.forEach((t,i)=> setTimeout(()=> appendLine(t,cls,true), i*step));
  }

  function appendLine(t, cls='', animate=false){
    const ln = el('div', 'line'+(cls?(' '+cls):''));
    ln.textContent = t;
    out.appendChild(ln);
    if(animate) reveal(ln);
    scrollBottom();
  }

  function divider(){ const d = el('div','divider'); out.appendChild(d); }

  function btn(cmd, label, options = {}){
    const b = document.createElement('button');
    b.type = 'button';
    const extra = options.className ? ` ${options.className}` : '';
    b.className = `btn${extra}`;
    if (cmd) {
      b.setAttribute('data-cmd', cmd);
    }
    const aria = options.ariaLabel || (cmd ? `${label} (${cmd})` : label);
    if (aria) b.setAttribute('aria-label', aria);
    b.textContent = label;
    const data = options.dataset || {};
    Object.entries(data).forEach(([key, value]) => {
      if (value == null) return;
      b.dataset[key] = String(value);
    });
    return b;
  }

  function actRow(children, workIndex){
    const r = el('div','actions');
    if (workIndex != null) r.dataset.workIndex = String(workIndex);
    children.forEach(c => r.appendChild(c));
    return r;
  }

  function block(nodes, workIndex){
    const b = el('div','blk');
    if (workIndex != null) b.dataset.workIndex = String(workIndex);
    nodes.forEach(n => b.appendChild(n));
    return b;
  }

  function workIndexNumber(work, fallbackIdx){
    const raw = Number(work?.id);
    if (Number.isInteger(raw) && raw >= 1) return raw;
    return Number.isInteger(fallbackIdx) ? (fallbackIdx + 1) : 1;
  }

  function createPlayButtons(work, workIndex){
    const buttons = [createPlayButton(workIndex)];
    const cues = Array.isArray(work?.cues) ? work.cues : [];
    cues.forEach((cue) => {
      buttons.push(createCueButton(cue, workIndex));
    });
    return buttons;
  }

  function createPlayButton(workIndex){
    return btn(null, 'Play', {
      className: 'js-play',
      ariaLabel: `Play work ${workIndex}`,
      dataset: { workIndex, seconds: 0 }
    });
  }

  function createCueButton(cue, workIndex){
    const dataset = { workIndex };
    Object.assign(dataset, cueDatasetForButton(cue));
    if (dataset.seconds != null) {
      const coerced = Math.max(0, Math.floor(Number(dataset.seconds)));
      dataset.seconds = coerced;
    }
    const seconds = Number(dataset.seconds);
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : null;
    const labelSuffix = (typeof cue?.label === 'string' && cue.label.trim())
      ? cue.label.trim()
      : (safeSeconds != null ? `@${formatTime(Math.floor(safeSeconds))}` : '@0:00');
    return btn(null, `Play ${labelSuffix}`, {
      className: 'js-playat',
      ariaLabel: `Play ${labelSuffix}`,
      dataset
    });
  }

  function cueDatasetForButton(cue){
    const dataset = {};
    const sources = [cue?.t, cue?.seconds, cue?.at, cue?.time];
    let mmssCandidate = '';
    for (const value of sources){
      if (value == null || value === '') continue;
      const secs = parseCueSecondsValue(value);
      if (Number.isFinite(secs)){
        dataset.seconds = Math.max(0, Math.floor(secs));
        return dataset;
      }
      if (!mmssCandidate){
        const mmss = canonicalMmss(value);
        if (mmss) mmssCandidate = mmss;
      }
    }
    if (mmssCandidate) dataset.mmss = mmssCandidate;
    return dataset;
  }

  function normalizeCue(input){
    const cue = (typeof input === 'object' && input !== null) ? { ...input } : { at: input };
    const candidates = [cue.t, cue.seconds, cue.at, cue.time];
    let seconds = NaN;
    for (const value of candidates){
      seconds = parseCueSecondsValue(value);
      if (Number.isFinite(seconds)) break;
    }
    if (Number.isFinite(seconds)){
      const safe = Math.max(0, seconds);
      cue.t = safe;
      cue.seconds = safe;
      if (!cue.label || !String(cue.label).trim()){
        cue.label = `@${formatTime(Math.floor(safe))}`;
      }
    }
    return cue;
  }

  function parseCueSecondsValue(value){
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const str = String(value).trim();
    if (!str) return NaN;
    if (/^-?\d+$/.test(str)) return Number(str);
    const match = str.match(/^(-?\d+):([0-5]?\d)$/);
    if (!match) return NaN;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return NaN;
    return minutes * 60 + seconds;
  }

  function canonicalMmss(value){
    if (value == null || value === '') return '';
    const str = String(value).trim();
    const match = str.match(/^(\d+):([0-5]?\d)$/);
    if (!match) return '';
    const minutes = String(Number(match[1]));
    const seconds = match[2].padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function getWorkIndexForButton(button){
    if (!button) return null;
    if (button.dataset.workIndex != null){
      const parsed = Number(button.dataset.workIndex);
      if (Number.isInteger(parsed) && parsed >= 1) return parsed;
      console.warn('Invalid data-work-index on console action', button);
      return null;
    }
    const owner = button.closest('[data-work-index]');
    if (owner?.dataset?.workIndex != null){
      const parsed = Number(owner.dataset.workIndex);
      if (Number.isInteger(parsed) && parsed >= 1) return parsed;
      console.warn('Invalid data-work-index on console action', owner);
      return null;
    }
    console.error('Missing data-work-index on console action', button);
    return null;
  }

  function secondsFromButton(button){
    if (!button) return NaN;
    const rawSeconds = button.dataset.seconds;
    if (rawSeconds != null && rawSeconds !== ''){
      const parsed = Number(rawSeconds);
      if (Number.isFinite(parsed)) return parsed;
    }
    const mmss = button.dataset.mmss;
    if (mmss != null && mmss !== ''){
      return parseMmss(mmss);
    }
    return NaN;
  }

  function parseMmss(value){
    if (value == null || value === '') return NaN;
    const str = String(value).trim();
    const match = str.match(/^(-?\d+):([0-5]?\d)$/);
    if (!match) return NaN;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return NaN;
    return minutes * 60 + seconds;
  }

  function ensureCueSeconds(button){
    const raw = secondsFromButton(button);
    let seconds = Number.isFinite(raw) ? raw : NaN;
    if (!Number.isFinite(seconds) || seconds < 0){
      if (!button.dataset.warnedInvalid){
        console.warn('Invalid cue time on Play@ button; defaulting to 0.', button);
        button.dataset.warnedInvalid = '1';
      }
      seconds = 0;
    }
    const safe = Math.max(0, Math.floor(seconds));
    button.dataset.seconds = String(safe);
    delete button.dataset.mmss;
    return safe;
  }

  function runCommand(raw){
    const command = String(raw || '').trim();
    if (!command) return;
    bootDone = true;
    echo(command, true);
    run(command);
  }

  function bold(text){
    const d = el('div','line');
    const s = document.createElement('span'); s.style.fontWeight='800'; s.textContent = text;
    d.appendChild(s);
    return d;
  }

  function span(text, cls){
    const d = el('div','line ' + (cls||'')); d.textContent = text; return d;
  }

  function el(tag, cls){ const n = document.createElement(tag); if(cls) n.className = cls; return n; }

  function reveal(node){ requestAnimationFrame(()=> node.classList.add('in')); }
  function revealChildren(node){ node.querySelectorAll('.line, .actions, .blk').forEach(n => reveal(n)); }

  function clearOut(){ out.innerHTML=''; }

  function time(s){
    if(s==null || s==='') return -1;
    if(/^\d+$/.test(s)) return parseInt(s,10);
    const m = String(s).match(/^(\d+):([0-5]?\d)$/);
    if(!m) return -1;
    return parseInt(m[1],10)*60 + parseInt(m[2],10);
  }
  function formatTime(sec){ sec = Math.max(0, Math.floor(sec)); const m=Math.floor(sec/60), s=sec%60; return `${m}:${s.toString().padStart(2,'0')}`; }
  function canonical(name){ if(!name) return ''; if(aliases[name]) return aliases[name]; return name; }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
  function scrollBottom(force=false){
  if(!bootDone && !force) return; // don't jump to bottom until user interacts
  out.scrollTop = out.scrollHeight;
}

  function focusInput(){ $('#works-console').addEventListener('click', ()=> input.focus(), {capture:true}); input.focus(); }
  function placeCaretEnd(){ const v = input.value; input.value=''; input.value=v; }

  /* ===== Media helpers ===== */
// Stop every <audio> on the page except the one we’re about to play
  function stopAllAudio(exceptEl){
    const all = Array.from(document.querySelectorAll('audio'));
    for(const a of all){
      if(exceptEl && a === exceptEl) continue;
      try { a.pause(); a.currentTime = 0; } catch(_){}
    }
  }
function getActiveAudioInfo(){
  for (const w of Object.values(works)){
    const a = document.getElementById(w.audioId);
    if (a && !a.paused && !a.ended){
      return { n: w.id, audio: a };
    }
  }
  return { n: null, audio: null };
}

  function isGoogleDrive(u){ return /https?:\/\/(drive|docs)\.google\.com\/file\/d\//.test(u); }
  function normalizeSrc(u){
    if(!u) return '';
    // Convert "https://drive.google.com/file/d/<ID>/view" → "https://drive.google.com/uc?export=download&id=<ID>"
    const m = u.match(/https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([^/]+)\//);
    if(m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    return u;
  }
  function mediaStatus(a){
    if(a.error){ return `media error ${a.error.code}`; }
    switch(a.networkState){
      case a.NETWORK_EMPTY: return 'no source';
      case a.NETWORK_IDLE: return 'network idle';
      case a.NETWORK_LOADING: return 'loading';
      case a.NETWORK_NO_SOURCE: return 'no compatible source';
    }
    return 'unknown';
  }
// First interaction enables auto-scroll
['keydown','pointerdown','wheel'].forEach(ev=>{
  document.addEventListener(ev, ()=> (bootDone = true), { once:true, passive:true });
});

  /* ===== HUD helpers ===== */
  const hudBox = document.querySelector('#works-console .wc-hud');
  if(hudBox){
    hudBox.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-hud="toggle"]');
      if(!btn) return;
      const n = state.last.n;
      if(!n || !works[n]){ appendLine('warn: nothing to control','warn',true); return; }
      const a = document.getElementById(works[n].audioId);
      // Toggle: pause if playing, resume if paused
      if(a && !a.paused){
        run(`pause ${n}`);
      } else {
        run(`resume ${n}`);
      }
    });
  }

  /* Build HUD DOM once; just update text/progress later */
  let hudRefs = null;
  function ensureHudDom(){
    if(!hudBox) return null;
    if(hudRefs) return hudRefs;
    hudBox.innerHTML = '';
    const wrap  = document.createElement('div'); wrap.className = 'row';
    // Single pill with marquee text
    const tag   = document.createElement('span');
    tag.className = 'tag tag-now';
    const tagScroll = document.createElement('span'); tagScroll.className = 'scroll';
    const tagTxt    = document.createElement('span'); tagTxt.className = 'txt';
    const tagDup    = document.createElement('span'); tagDup.className = 'dup'; tagDup.setAttribute('aria-hidden','true');
    tagScroll.append(tagTxt, tagDup); tag.appendChild(tagScroll);
    const time  = document.createElement('span'); time.className = 'hud-time';
    const pipe  = document.createElement('span'); pipe.textContent = '|';
    const vol   = document.createElement('span'); vol.className = 'soft hud-vol';
    const speed = document.createElement('span'); speed.className = 'soft hud-speed';
    const meter = document.createElement('div'); meter.className = 'meter'; meter.setAttribute('aria-hidden','true');
    const fill  = document.createElement('span'); meter.appendChild(fill);
    const actions = document.createElement('div'); actions.className = 'hud-actions';
    const btn   = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn hud-btn'; btn.setAttribute('data-hud','toggle');
    actions.appendChild(btn);
    wrap.append(tag, time, pipe, vol, speed, meter, actions);
    hudBox.appendChild(wrap);
    hudRefs = { tag, tagTxt, tagDup, time, vol, speed, fill, btn };
    // Lock pill width to current “Now Playing” size so it doesn’t grow/shrink with titles
    // (measure after it’s in the DOM)
    requestAnimationFrame(()=>{ if (!tag.style.width) tag.style.width = tag.offsetWidth + 'px'; });
    return hudRefs;
  }

  function hudUpdate(n, a){
    if(!hudBox) return;
    const refs = ensureHudDom(); if(!refs) return;
    const currentWork = (n && works[n]) ? works[n] : null;
    const title = currentWork?.title || '—';
    const oneliner = currentWork?.onelinerEffective || '';
    const pillText = currentWork
      ? `Now playing ${title}${oneliner ? ` — ${oneliner}` : ''}`
      : 'Now playing —';
    // Update marquee text and duplicate for seamless loop
    refs.tagTxt.textContent = pillText;
    refs.tagDup.textContent = ' · ' + pillText;
    // Toggle marquee only if content overflows the fixed pill width
    // (use scrollWidth of the inner scroller vs the container width)
    const needsMarq = refs.tagScroll
      ? (refs.tagScroll.scrollWidth > refs.tag.clientWidth + 2)
      : (refs.tag.querySelector('.scroll').scrollWidth > refs.tag.clientWidth + 2);
    const tagEl = refs.tag;
    tagEl.classList.toggle('is-marquee', needsMarq);
    const dur = Number.isFinite(a?.duration) ? formatTime(a.duration|0) : '--:--';
    const cur = Number.isFinite(a?.currentTime) ? formatTime(a.currentTime|0) : '0:00';
    const pct = (a && a.duration) ? Math.max(0,Math.min(100,(a.currentTime/a.duration)*100)) : 0;
    refs.time.textContent  = `${cur} / ${dur}`;
    refs.vol.textContent   = `vol:${Math.round(state.vol*100)}`;
    refs.speed.textContent = `speed:${state.rate.toFixed(2)}x`;
    refs.fill.style.inset  = `0 ${100-pct}% 0 0`;  // keep your meter style
    refs.btn.textContent   = a?.paused ? 'Play ▷' : 'Pause ❚❚';
    refs.btn.setAttribute('aria-label', `${a?.paused ? 'Play' : 'Pause'} current track`);
  }
function clearHud(){
    if(!hudBox) return;
    hudBox.innerHTML = '';
    hudRefs = null;
  }

  function bindAudio(n){
    const w = works[n]; if(!w) return;
    const a = document.getElementById(w.audioId); if(!a) return;
    a.volume = state.vol; a.playbackRate = state.rate;
    if(!a.dataset.bound){
      a.addEventListener('timeupdate', ()=> hudUpdate(n,a), {passive:true});
      a.addEventListener('ratechange', ()=> hudUpdate(n,a), {passive:true});
      a.addEventListener('volumechange', ()=> hudUpdate(n,a), {passive:true});
      a.addEventListener('loadedmetadata', ()=> hudUpdate(n,a), {once:true, passive:true});
      a.addEventListener('ended', ()=> { hudUpdate(n,a); }, {passive:true});
      a.dataset.bound = '1';
    }
  }

  function pct(x){ return Math.max(0,Math.min(1, x)); }
  function secOrTime(s){ return (/^\d+(:[0-5]?\d)?$/.test(s||'')) ? time(s) : null; }
  function deepUrl(n, tSec){
    const base = `${location.origin}${location.pathname}#work-${n}`;
    return tSec ? `${base}?t=${tSec|0}` : base;
  }
  function copyWithTime(n, tRaw){
    const w = works[n]; if(!w) return appendLine(`error: unknown work ${n}`,'err',true);
    const t = secOrTime(tRaw);
    const url = deepUrl(n, t);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(() => appendLine(`copied ${url}`,'ok',true),
        () => appendLine(url,'muted',true));
    } else {
      appendLine(url,'muted',true);
    }
  }

  /* Tiny toast (for autoplay or hints) */
  function toast(text, ms=2600){
    let t = $('.toast', out);
    if(!t){ t = document.createElement('div'); t.className='toast'; out.appendChild(t); }
    t.textContent = text; reveal(t);
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> t.classList.remove('in'), ms);
  }

  // Deep-link: #work-<n>[?t=<sec>]
  function handleHash(){
    const m = location.hash.match(/^#work-(\d+)(?:\?t=(\d+))?$/);
    if(!m) return;
    const n = parseInt(m[1],10);
    const t = m[2] ? parseInt(m[2],10) : null;
    openWork(n);
    if (Number.isFinite(t)) run(`play ${n} ${t}`);
  }
  window.addEventListener('hashchange', handleHash, { passive:true });
  handleHash();
  /* ===== Theme management (UI + CLI) — Light/Dark only (no Auto) ===== */
  
  function readTheme(){
    try{
      const v = localStorage.getItem('wc.theme') || 'dark';
      return (v.trim().charAt(0)==='{') ? ((JSON.parse(v)||{}).mode || 'dark') : v; // migrate JSON → string
    }catch(_){ return 'dark'; }
  }
  function writeTheme(v){
    try{ localStorage.setItem('wc.theme', (v==='light' ? 'light' : 'dark')); }catch(_){}
  }
 function applyTheme(mode){
  const eff = (mode==='light') ? 'light' : 'dark';
  const grp = document.getElementById('works-group');
  const host = document.getElementById('works-console');

  if (grp){
    grp.removeAttribute('data-theme-mode');
    grp.setAttribute('data-theme', eff);
  }
  if (host){
    host.classList.remove('prae-theme-light','prae-theme-dark');
    host.classList.add(eff === 'light' ? 'prae-theme-light' : 'prae-theme-dark');
    // optional: mirror data-theme for legacy selectors
    host.setAttribute('data-theme', eff);
  }
  if (themeBtn){
    themeBtn.setAttribute('title', `Toggle theme (Alt/Opt+D) · current: ${eff}`);
    themeBtn.setAttribute('aria-checked', String(eff==='dark'));
  }
  try{ localStorage.setItem('wc.theme', eff); }catch(_){}
  document.documentElement.style.colorScheme = (eff === 'dark' ? 'dark' : 'light');
}

  function cycleTheme(){
    const cur  = themeRoot.getAttribute('data-theme') || readTheme();
    const next = (cur === 'dark') ? 'light' : 'dark';
    applyTheme(next);
    appendLine(`theme ${next}`,'ok',true);
  }
  function themeCmd(args){
    const sub = (args[0]||'').toLowerCase();
    if(sub==='dark' || sub==='light'){ applyTheme(sub); appendLine(`theme ${sub}`,'ok',true); }
    else { appendLine('usage: theme dark|light','muted',true); }
  }
  if(themeBtn){ themeBtn.addEventListener('click', cycleTheme, {passive:true}); }
  document.addEventListener('keydown', (e)=>{
    if((e.altKey||e.metaKey) && (e.key==='d' || e.key==='D')){ e.preventDefault(); cycleTheme(); }
  }, {passive:false});
  applyTheme(readTheme());
/* ===== Align title/subtitle left edge with console column ===== */
  const titleWrap = document.querySelector('#works-title .wt-wrap');
  const groupRoot = document.getElementById('works-group');
  function alignTitleToConsole(){
    const frame = document.querySelector('#works-console .wc-frame');
    if(!titleWrap || !groupRoot || !frame) return;
    const gr = groupRoot.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const left = Math.max(0, Math.round(fr.left - gr.left));
    titleWrap.style.marginLeft = left + 'px';
    titleWrap.style.marginRight = '0';
    titleWrap.style.width = Math.round(fr.width) + 'px';
  }
  // Burst re-align (handles CSS transitions & async layout)
  function kickAlign(pulses = 6){
    let i = 0;
    const tick = () => { alignTitleToConsole(); if(++i < pulses) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // Initial + responsive hooks
  window.addEventListener('load', alignTitleToConsole, { once:true });
  window.addEventListener('resize', alignTitleToConsole, { passive:true });
  try{
    const ro = new ResizeObserver(()=> kickAlign(2));
    const split = document.querySelector('#works-console .wc-split');
    const frame = document.querySelector('#works-console .wc-frame');
    if (split) ro.observe(split);
    if (frame) ro.observe(frame);
  }catch(_){}



}
// then run it after DOM is ready
document.addEventListener('DOMContentLoaded', initWorksConsole);
