// REPL — wires the CodeMirror editor adapter to the DSL parser, scheduler,
// and voices. Owns: hot-reload (Cmd-Enter), Esc-to-stop, status line, share
// button, example loader, and URL-hash patch persistence.
//
// The editor is a CodeMirror 6 EditorView mounted into #editor by
// repl-editor.js (createReplEditor). All reads/writes go through the
// editorAPI adapter; this file never touches contentDOM directly.

(function () {
  'use strict';

  const editorMount = document.getElementById('editor');
  const statusEl = document.getElementById('status');
    const playBtn = document.getElementById('play');
    const safePlayBtn = document.getElementById('safe-play');
    const stopBtn = document.getElementById('stop');
    const shareBtn = document.getElementById('share');
  const exampleSelect = document.getElementById('example-select');
  const errorList = document.getElementById('errors');
  const beatDotsEl = document.getElementById('beat-dots');
  const blockRowsEl = document.getElementById('block-rows');
  const samplesToggleBtn = document.getElementById('samples-toggle');
  const inputToggleBtn = document.getElementById('input-toggle');
  const inputPanel = document.getElementById('input-panel');
  const inputKindSelect = document.getElementById('input-kind');
  const inputDeviceSelect = document.getElementById('input-device');
  const inputEnableBtn = document.getElementById('input-enable');
  const inputStopBtn = document.getElementById('input-stop');
  const inputStatusEl = document.getElementById('input-status');
  const inputMeterFill = document.getElementById('input-meter-fill');
  const samplesPanel = document.getElementById('samples-panel');
  const samplesGroupsEl = document.getElementById('samples-groups');
    const samplesFilterInput = document.getElementById('samples-filter');
    const replWorkspace = document.getElementById('repl-workspace');
    const referenceToggleBtn = document.getElementById('reference-toggle');
    const referencePanel = document.getElementById('reference-panel');
    const referenceCloseBtn = document.getElementById('reference-close');

    const SAMPLES_MANIFEST_URL = './samples/manifest.json';
    const DEFAULT_EXAMPLE_URL = './examples/default.txt';
    const REFERENCE_SEEN_KEY = 'replReferenceSeen';

  let scheduler = null;
  let lastGoodProgram = null;
  let statusTimer = null;
    let editorAPI = null;
    let shouldAutofocusEditor = true;

  // ---------------- status / errors ----------------

  function setStatusLine() {
    if (!scheduler) {
      statusEl.textContent = 'idle';
      return;
    }
    const t = scheduler.now();
    const transport = formatTime(t.transport);
    const tempo = lastGoodProgram ? Math.round(lastGoodProgram.tempo) : 110;
    const meter = lastGoodProgram ? `${lastGoodProgram.meter.num}/${lastGoodProgram.meter.den}` : '4/4';
    const stateLabel = scheduler.isRunning() ? 'playing' : 'stopped';
    const bar = t.bar + 1; // human-readable: bar 1 = first bar
    statusEl.textContent = `${tempo} bpm · ${meter} · ${stateLabel} · ${transport} · bar ${bar}`;
  }

  function formatTime(s) {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const r = total % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function clearErrors() {
    errorList.innerHTML = '';
  }

  function showErrors(errors) {
    clearErrors();
    for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = `line ${e.line}: ${e.message}`;
      errorList.appendChild(li);
    }
  }

  function showWarning(text) {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.color = '#a04';
    errorList.appendChild(li);
  }

  // ---------------- evaluation ----------------

    async function evaluateAndRun() {
      const text = editorAPI ? editorAPI.getValue() : '';
      const result = window.ReplDSL.parse(text);

      if (!result.ok) {
        showErrors(result.errors);
        // Keep the previously-running program; don't yank audio out.
        return;
      }

      clearErrors();
      lastGoodProgram = result.program;

      if (window.ReplAttractors && window.ReplAttractors.warm) {
        window.ReplAttractors.warm(result.program);
      }

      renderTransportShell(result.program);

      if (!scheduler) bootScheduler();
      if (!scheduler) return;

      const armed = await armInputsForProgram(result.program);
      if (!armed) return;

      // Hard evaluate/play:
      // - stop current audio first
      // - install the newly parsed AST
      // - start from transport zero
      //
      // This intentionally differs from safePlay(), because Cmd-Enter / [play]
      // should rebuild runtime state and allow frozen random choices to reroll.
      if (scheduler.isRunning()) {
        scheduler.stop();
      }

      scheduler.update(result.program);
      scheduler.start();
    }

    async function safePlay() {
      if (!scheduler) bootScheduler();

      if (!scheduler || !lastGoodProgram) {
        await evaluateAndRun();
        return;
      }

      const armed = await armInputsForProgram(lastGoodProgram);
      if (!armed) return;

      if (typeof scheduler.safeRestart === 'function') {
        scheduler.safeRestart();
      } else {
        // Fallback for stale cached scheduler.js.
        scheduler.stop();
        scheduler.start();
      }
    }

    function stop() {
      if (scheduler) {
        scheduler.stop();
      }
      setStatusLine();
      clearActiveClasses();
    }

    function bootScheduler() {
      const audioCtx = window.StringVoice.ensureAudio();
    if (!audioCtx) {
      showWarning('this browser doesn\'t support the Web Audio API');
      return;
    }
    window.StringVoice.resume();
    if (window.InputVoice && window.InputVoice.setAudioContext) {
      window.InputVoice.setAudioContext(audioCtx);
    }
    const masterBus = window.StringVoice.getMasterBus();
    scheduler = window.ReplScheduler.create({ audioCtx, masterBus });
    scheduler.onMissingSample((name) => {
      showWarning(`'${name}' isn't in the bank yet — see /labs/repl/samples/README.md`);
    });
  }

  // ---------------- URL hash share ----------------

  async function encodeHash(text) {
    if (!text) return '';
    if (typeof CompressionStream === 'undefined') {
      return 'v0.' + btoaUrl(unicodeToBytes(text));
    }
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(unicodeToBytes(text));
      writer.close();
      const compressed = await new Response(cs.readable).arrayBuffer();
      return 'v1.' + btoaUrl(new Uint8Array(compressed));
    } catch (_) {
      return 'v0.' + btoaUrl(unicodeToBytes(text));
    }
  }

  async function decodeHash(hash) {
    if (!hash) return '';
    const trimmed = hash.replace(/^#/, '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('v0.')) {
      try { return bytesToUnicode(atobUrl(trimmed.slice(3))); } catch (_) { return ''; }
    }
    if (trimmed.startsWith('v1.')) {
      if (typeof DecompressionStream === 'undefined') return '';
      try {
        const compressed = atobUrl(trimmed.slice(3));
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        return bytesToUnicode(new Uint8Array(decompressed));
      } catch (_) {
        return '';
      }
    }
    return '';
  }

  function unicodeToBytes(s) {
    return new TextEncoder().encode(s);
  }
  function bytesToUnicode(bytes) {
    return new TextDecoder().decode(bytes);
  }
  function btoaUrl(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function atobUrl(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function shareCurrent() {
    const text = editorAPI ? editorAPI.getValue() : '';
    const encoded = await encodeHash(text);
    const url = location.origin + location.pathname + (encoded ? '#' + encoded : '');
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      showWarning('share link copied to clipboard');
      setTimeout(clearErrors, 2500);
    } catch (_) {
      // Older browsers / iframe contexts: leave the URL bar as the share.
      showWarning('URL bar updated — copy from there to share');
      setTimeout(clearErrors, 4000);
    }
  }

  async function loadFromHash() {
    if (!location.hash || location.hash === '#') return false;
    const text = await decodeHash(location.hash);
    if (text) {
      if (editorAPI) editorAPI.setValue(text);
      return true;
    }
    showWarning('couldn\'t load shared patch — falling back to default example');
    return false;
  }

  async function loadDefaultExample() {
    try {
      const r = await fetch(DEFAULT_EXAMPLE_URL);
      if (r.ok) {
        const t = await r.text();
        if (editorAPI) editorAPI.setValue(t);
        return;
      }
    } catch (_) {}
    if (editorAPI) {
      editorAPI.setValue('// failed to load default example. start typing.\n\ntempo 110\n\nstring   A3   C4   E4   G4\nforce    f    mf   p    f\n');
    }
  }

    // ---------------- reference sidebar ----------------

    function setReferenceOpen(open, opts) {
      const options = opts || {};
      const shouldOpen = Boolean(open);

      if (referencePanel) {
        referencePanel.hidden = !shouldOpen;
      }

      if (referenceToggleBtn) {
        referenceToggleBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      }

      if (replWorkspace) {
        replWorkspace.classList.toggle('reference-closed', !shouldOpen);
      }

      if (!shouldOpen && options.markSeen !== false) {
        try { localStorage.setItem(REFERENCE_SEEN_KEY, '1'); } catch (_) {}
      }
    }

    function toggleReference() {
      const isOpen = referencePanel ? !referencePanel.hidden : false;
      setReferenceOpen(!isOpen, { markSeen: isOpen });
      if (editorAPI) editorAPI.focus();
    }

    function initReferencePanel() {
      let seen = false;
      try { seen = localStorage.getItem(REFERENCE_SEEN_KEY) === '1'; } catch (_) {}
      setReferenceOpen(!seen, { markSeen: false });
      shouldAutofocusEditor = seen;
    }
    
  // ---------------- editor keybindings ----------------
  //
  // Editor-local keymap (Cmd-Enter, Cmd-Shift-Enter, Esc, Tab, Cmd-/, Cmd-S,
  // Cmd-K) lives in repl-editor.js. The button handlers below cover the
  // pointer-driven path and refocus the editor afterwards.

    playBtn.addEventListener('click', async () => {
      await evaluateAndRun();
      if (editorAPI) editorAPI.focus();
    });
    if (safePlayBtn) {
      safePlayBtn.addEventListener('click', async () => {
        await safePlay();
        if (editorAPI) editorAPI.focus();
      });
    }
    stopBtn.addEventListener('click', () => {
      stop();
      if (editorAPI) editorAPI.focus();
    });
    shareBtn.addEventListener('click', async () => {
      await shareCurrent();
      if (editorAPI) editorAPI.focus();
    });

    if (referenceToggleBtn) {
      referenceToggleBtn.addEventListener('click', toggleReference);
    }

    if (referenceCloseBtn) {
      referenceCloseBtn.addEventListener('click', () => {
        setReferenceOpen(false);
        if (editorAPI) editorAPI.focus();
      });
    }

  // Document-level Esc safety net: if the user presses Esc anywhere inside
  // the REPL shell, stop audio and refocus the editor. Scoped to the REPL
  // so it doesn't interfere with other browser controls outside.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const replShell = document.querySelector('main.shell');
    const t = e.target;
    if (!replShell || !(t instanceof Node) || !replShell.contains(t)) return;
    // If a CodeMirror keymap already handled Esc inside the editor, this
    // path is harmless: stop() is idempotent and focus() is too.
    stop();
    if (editorAPI) editorAPI.focus();
  });



  function setupExamplePicker(selectEl) {
    if (!selectEl || selectEl.dataset.customPicker === '1') return;
    selectEl.dataset.customPicker = '1';
    selectEl.classList.add('native-example-select');
    selectEl.setAttribute('aria-hidden', 'true');
    selectEl.tabIndex = -1;

    const picker = document.createElement('span');
    picker.className = 'example-picker';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'example-picker-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="button-main">load example</span><span class="button-shortcut">choose patch</span>';

    const list = document.createElement('ul');
    list.className = 'example-picker-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    const colors = ['ryb-red', 'ryb-yellow', 'ryb-blue'];
    Array.from(selectEl.options).forEach((opt) => {
      if (!opt.value) return;
      const item = document.createElement('li');
      item.setAttribute('role', 'presentation');

      const row = document.createElement('button');
      row.type = 'button';
      const optionIndex = list.children.length;
      row.className = `example-picker-option ${colors[optionIndex % colors.length]}`;
      row.setAttribute('role', 'option');
      row.dataset.value = opt.value;
      row.textContent = opt.textContent || opt.value;

      row.addEventListener('click', () => {
        selectEl.value = row.dataset.value || '';
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
      });

      item.appendChild(row);
      list.appendChild(item);
    });

    function openPicker() {
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      const first = list.querySelector('.example-picker-option');
      if (first) first.focus({ preventScroll: true });
    }

    function closePicker() {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }

    function togglePicker() {
      if (list.hidden) openPicker();
      else closePicker();
    }

    button.addEventListener('click', togglePicker);
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    });

    list.addEventListener('keydown', (e) => {
      const rows = Array.from(list.querySelectorAll('.example-picker-option'));
      const current = document.activeElement;
      const idx = rows.indexOf(current);
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
        button.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (rows[Math.min(rows.length - 1, idx + 1)] || rows[0] || button).focus();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        (rows[Math.max(0, idx - 1)] || rows[rows.length - 1] || button).focus();
      }
      if (e.key === 'Home') {
        e.preventDefault();
        if (rows[0]) rows[0].focus();
      }
      if (e.key === 'End') {
        e.preventDefault();
        if (rows[rows.length - 1]) rows[rows.length - 1].focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target)) closePicker();
    });

    selectEl.parentNode.insertBefore(picker, selectEl.nextSibling);
    picker.appendChild(button);
    picker.appendChild(list);
  }

  // ---------------- examples loader ----------------

  if (exampleSelect) {
    setupExamplePicker(exampleSelect);
    exampleSelect.addEventListener('change', async () => {
      const v = exampleSelect.value;
      if (!v) return;
      try {
        const r = await fetch(`./examples/${v}`);
        if (r.ok) {
          const text = await r.text();
          if (editorAPI) editorAPI.setValue(text);
        }
      } catch (_) {}
      exampleSelect.value = '';
      if (editorAPI) editorAPI.focus();
    });
  }

    // ---------------- transport / coupling visualizer ----------------

    // Cached DOM structure: rebuilt only when the program changes, then updated
    // every frame from scheduler.now().
    let blockRowEls = []; // [ { row, slotEls, everyEl, couplingEl, surfacesEl } per block ]
    let beatDotEls = [];
    let couplingSummaryEls = null;

    const SIGNALS = [
      ['I', 'intensity', 'intensity'],
      ['V', 'volatility', 'volatility'],
      ['P', 'pressure', 'pressure'],
      ['D', 'density', 'density'],
      ['T', 'periodicity', 'periodicity'],
      ['R', 'rupture', 'rupture'],
    ];

    function classifySlotForViz(node) {
      if (!node) return 'rest';
      if (node.kind === 'group') return 'group';
      if (node.kind === 'leaf') {
        const t = node.token;
        if (t.kind === 'rest') return 'rest';
        if (t.kind === 'sample' || t.kind === 'sample-selector') return 'sample';
        return 'note';
      }
      return 'rest';
    }

    function hasParamControlStream(stream) {
      if (!stream) return false;
      if (stream.kind === 'scalar') return isParamOp(stream.value);
      if (stream.kind === 'vector') return stream.values.some(isParamOp);
      return false;
    }

    function isParamOp(v) {
      return v && typeof v === 'object' && v.kind === 'param-op';
    }

    function walkSlots(nodes, fn) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) walkSlotNode(node, fn);
    }

    function walkSlotNode(node, fn) {
      if (!node) return;
      fn(node);
      if (node.kind === 'group' && Array.isArray(node.children)) {
        for (const child of node.children) walkSlotNode(child, fn);
      }
    }

    function blockHasTokenKind(block, predicate) {
      let found = false;
      walkSlots(block.slots, (node) => {
        if (found || node.kind !== 'leaf') return;
        if (predicate(node.token)) found = true;
      });
      return found;
    }

    function surfacesForBlock(block) {
      const surfaces = [];

      if (!block) return surfaces;

        const params = block.params || {};
        const effects = block.effects || {};
        const push = (name) => {
          if (!surfaces.includes(name)) surfaces.push(name);
        };

        if (block.fade && block.fade.mode && block.fade.mode !== 'clear') push('fade');

      if (block.speed && (hasParamControlStream(block.speed) || block.speed.kind === 'vector')) push('speed');

      for (const name of ['pan', 'gain', 'rate', 'start', 'crush', 'force', 'decay', 'tone', 'harm', 'octave']) {
        if (hasParamControlStream(params[name])) push(name);
      }
        for (const name of ['compress', 'space', 'resonance', 'comb', 'grain', 'chorus', 'excite', 'blur', 'scar', 'body']) {
          if (effects[name]) push(name);
        }

      if (block.voice === 'string') {
        const hasRandomPitch = blockHasTokenKind(block, (tok) => tok && tok.kind === 'note-random');
        if (hasRandomPitch) push('pitch');
      }

      if (block.voice === 'sample') {
        const hasSelector = blockHasTokenKind(block, (tok) => {
          return tok && (tok.kind === 'sample-selector' || (tok.kind === 'sample' && tok.gated));
        });
        if (hasSelector) push('sample');
      }

        // Attractors now color the medium even when all patch values are literal.
        // These surfaces are always under attractor pressure when coupled.
        if (block.attractor) {
            push('filter');
            push('space');
            push('body');
            push('color');
          push('gain');
          push('pan');

          if (block.voice === 'string') {
            push('decay');
            push('tone');
            push('crush');
            push('pitch');
          } else if (block.voice === 'sample') {
            push('rate');
            push('start');
            push('sample');
          }

          if (block.speed) push('speed');
        }

      return surfaces;
    }

    function attractorStateForBlock(block) {
      if (!block || !block.attractor) return null;

      if (window.ReplAttractors && window.ReplAttractors.peek) {
        return window.ReplAttractors.peek(block.attractor);
      }

      return null;
    }

    function formatDecimal(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return '.00';
      const clamped = Math.max(0, Math.min(1, n));
      return clamped.toFixed(2).replace(/^0/, '');
    }

    function formatConfidence(state) {
      if (!state) return '';
      return `confidence ${formatDecimal(state.confidence)}`;
    }

    function formatSourceStatus(state) {
      if (!state) return '';
      const source = String(state.source || 'fallback');
      const confidence = formatConfidence(state);
      return `${source}${confidence ? ' · ' + confidence : ''}`;
    }

    function sourceClass(state) {
      if (!state) return '';
      if (String(state.status || '') === 'error') return 'source-error';
      return String(state.source || '') === 'live' ? 'source-live' : 'source-fallback';
    }

    function sourceLabelForBlock(block) {
      if (!block || !block.attractor) return '';

      const source = block.source || block.attractor.source || {};
      const parts = [];

      if (source.station) parts.push(source.station);
      if (source.feed) parts.push(source.feed);
      if (source.coords) parts.push(source.coords);
      if (source.city) parts.push(source.city);
      if (source.region) parts.push(source.region);
      if (source.body) parts.push(source.body);

      return parts.join(' · ');
    }

    function couplingLabel(block, state) {
      if (!block || !block.attractor) return 'none';

      const name = block.attractor.raw || 'attractor';
      const sourceLabel = sourceLabelForBlock(block);
      const status = block.voice === 'input' ? formatInputBlockStatus(block) : formatSourceStatus(state);

      return [name, sourceLabel, status].filter(Boolean).join(' · ');
    }
    
    function formatFadeLevel(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return '.00';
      return Math.max(0, Math.min(1, n)).toFixed(2).replace(/^0/, '');
    }

    function fadeLabel(block, fadeState) {
      if (!block || !block.fade || !block.fade.mode || block.fade.mode === 'clear') return '';

      const mode = block.fade.mode;

      if (!fadeState) {
        if (mode === 'hold') return 'fade hold';
        return `fade ${mode}`;
      }

      if (fadeState.held) {
        return `fade hold · ${formatFadeLevel(fadeState.level)}`;
      }

      if (fadeState.completed && fadeState.latched) {
        if (mode === 'in') return `fade in · complete`;
        if (mode === 'out') return `fade out · latched`;
      }

      return `fade ${mode} · ${formatFadeLevel(fadeState.level)}`;
    }

    function blockStatusLabel(block, attractorState, fadeState) {
      const parts = [];

      if (block && block.attractor) {
        parts.push(couplingLabel(block, attractorState));
      }

      const fade = fadeLabel(block, fadeState);
      if (fade) parts.push(fade);

      return parts.join(' · ');
    }

    function signalHTML(state) {
      if (!state) return '';

      return SIGNALS.map(([abbr, key, title]) => {
        return `<span class="signal-token" title="${title}"><abbr>${abbr}</abbr>${formatDecimal(state[key])}</span>`;
      }).join('');
    }

    function renderSurfaceChips(el, surfaces, active) {
      if (!el) return;
      el.innerHTML = '';

      if (!surfaces || surfaces.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'surface-chip';
        empty.textContent = 'literal';
        el.appendChild(empty);
        return;
      }

      for (const surface of surfaces) {
        const chip = document.createElement('span');
        chip.className = 'surface-chip' + (active ? ' active' : '');
        chip.textContent = surface;
        el.appendChild(chip);
      }
    }

    function primaryCoupledBlockState(t) {
      if (!t || !Array.isArray(t.blockStates)) return null;

      const live = t.blockStates.find((state) => {
        return state && state.attractor && state.attractorState && state.attractorState.source === 'live';
      });
      if (live) return live;

      return t.blockStates.find((state) => state && state.attractor) || null;
    }

    function blockFromStateIndex(index) {
      return lastGoodProgram && lastGoodProgram.blocks ? lastGoodProgram.blocks[index] : null;
    }

    function updateCouplingSummary(t) {
      if (!couplingSummaryEls) return;

      const state = primaryCoupledBlockState(t);
      if (!state) {
        couplingSummaryEls.couplingRow.hidden = true;
        couplingSummaryEls.signalsRow.hidden = true;
        couplingSummaryEls.surfacesRow.hidden = true;
        couplingSummaryEls.separator.hidden = true;
        return;
      }

      const block = blockFromStateIndex(state.blockIndex);
      const attractorState = state.attractorState || attractorStateForBlock(block);
      const surfaces = surfacesForBlock(block);

      couplingSummaryEls.couplingRow.hidden = false;
      couplingSummaryEls.signalsRow.hidden = false;
      couplingSummaryEls.surfacesRow.hidden = false;
      couplingSummaryEls.separator.hidden = false;

      couplingSummaryEls.couplingValue.textContent = couplingLabel(block, attractorState);
      couplingSummaryEls.couplingValue.className = 'coupling-value ' + sourceClass(attractorState);
      couplingSummaryEls.signalsValue.innerHTML = signalHTML(attractorState);
      renderSurfaceChips(couplingSummaryEls.surfacesValue, surfaces, true);
    }

    function renderTransportShell(program) {
      if (!beatDotsEl || !blockRowsEl) return;

      // Beat dots — one per beat in the meter.
      beatDotsEl.innerHTML = '';
      beatDotEls = [];
      const beats = program.meter.num;
      for (let i = 0; i < beats; i++) {
        const d = document.createElement('span');
        d.className = 'dot beat';
        beatDotsEl.appendChild(d);
        beatDotEls.push(d);
      }

      // Block rows + coupling summary.
      blockRowsEl.innerHTML = '';
      blockRowEls = [];
      couplingSummaryEls = null;

      if (program.blocks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-msg';
        empty.textContent = '(no voices yet — add a string or sample line)';
        blockRowsEl.appendChild(empty);
        return;
      }

      const couplingRow = document.createElement('div');
      couplingRow.className = 'coupling-row';
      couplingRow.hidden = true;

      const couplingLabelEl = document.createElement('div');
      couplingLabelEl.className = 'coupling-label';
      couplingLabelEl.textContent = 'coupling';

      const couplingSpacer = document.createElement('div');
      couplingSpacer.className = 'slot-dots';

      const couplingValue = document.createElement('div');
      couplingValue.className = 'coupling-value';

      const couplingTail = document.createElement('div');

      couplingRow.appendChild(couplingLabelEl);
      couplingRow.appendChild(couplingSpacer);
      couplingRow.appendChild(couplingValue);
      couplingRow.appendChild(couplingTail);

      const signalsRow = document.createElement('div');
      signalsRow.className = 'coupling-row';
      signalsRow.hidden = true;

      const signalsLabel = document.createElement('div');
      signalsLabel.className = 'coupling-label';
      signalsLabel.textContent = 'signals';

      const signalsSpacer = document.createElement('div');

      const signalsValue = document.createElement('div');
      signalsValue.className = 'coupling-value';

      const signalsTail = document.createElement('div');

      signalsRow.appendChild(signalsLabel);
      signalsRow.appendChild(signalsSpacer);
      signalsRow.appendChild(signalsValue);
      signalsRow.appendChild(signalsTail);

      const surfacesRow = document.createElement('div');
      surfacesRow.className = 'coupling-row';
      surfacesRow.hidden = true;

      const surfacesLabel = document.createElement('div');
      surfacesLabel.className = 'coupling-label';
      surfacesLabel.textContent = 'surfaces';

      const surfacesSpacer = document.createElement('div');

      const surfacesValue = document.createElement('div');
      surfacesValue.className = 'surface-chips';

      const surfacesTail = document.createElement('div');

      surfacesRow.appendChild(surfacesLabel);
      surfacesRow.appendChild(surfacesSpacer);
      surfacesRow.appendChild(surfacesValue);
      surfacesRow.appendChild(surfacesTail);

      const separator = document.createElement('div');
      separator.className = 'coupling-separator';
      separator.hidden = true;

      blockRowsEl.appendChild(couplingRow);
      blockRowsEl.appendChild(signalsRow);
      blockRowsEl.appendChild(surfacesRow);
      blockRowsEl.appendChild(separator);

      couplingSummaryEls = {
        couplingRow,
        signalsRow,
        surfacesRow,
        separator,
        couplingValue,
        signalsValue,
        surfacesValue,
      };

      program.blocks.forEach((block) => {
        const row = document.createElement('div');
        row.className = 'block-row';

        const label = document.createElement('div');
        label.className = 'block-label';
        label.textContent = block.voice === 'input' && block.input ? `input ${block.input.kind}` : `${block.voice}`;

        const slotsWrap = document.createElement('div');
        slotsWrap.className = 'slot-dots';

        const slotEls = [];
        for (let i = 0; i < block.slots.length; i++) {
          const dot = document.createElement('span');
          dot.className = 'dot ' + classifySlotForViz(block.slots[i]);
          dot.title = `slot ${i + 1} of ${block.slots.length}`;
          slotsWrap.appendChild(dot);
          slotEls.push(dot);

          // Add a thin bar separator after every slotsPerBar slots (except last).
          if ((i + 1) % block.slotsPerBar === 0 && i + 1 < block.slots.length) {
            const sep = document.createElement('span');
            sep.style.width = '0';
            sep.style.borderLeft = '1px solid #aaa';
            sep.style.height = '0.9em';
            sep.style.margin = '0 2px';
            slotsWrap.appendChild(sep);
          }
        }

        const couplingEl = document.createElement('div');
        couplingEl.className = 'block-coupling';
          const initialState = attractorStateForBlock(block);
          couplingEl.textContent = blockStatusLabel(block, initialState, null);
        const surfacesEl = document.createElement('div');
        surfacesEl.className = 'surface-chips';
        renderSurfaceChips(surfacesEl, surfacesForBlock(block), false);

        const everyEl = document.createElement('span');
        everyEl.className = 'silent-tag';
        everyEl.style.marginLeft = '0.6em';
        if (block.every) {
          everyEl.textContent = `every ${block.every.count} ${block.every.unit}`;
        }

        row.appendChild(label);
        row.appendChild(slotsWrap);
        row.appendChild(couplingEl);
        row.appendChild(surfacesEl);
        if (block.every) row.appendChild(everyEl);

        blockRowsEl.appendChild(row);
        blockRowEls.push({ row, slotEls, everyEl, couplingEl, surfacesEl, block });
      });

      // Show any parsed/warmed attractor state even before play starts.
      updateCouplingSummary({
        blockStates: program.blocks.map((block, i) => ({
          blockIndex: i,
          attractor: block.attractor,
          attractorState: attractorStateForBlock(block),
        })),
      });
    }

    function clearActiveClasses() {
      for (const d of beatDotEls) d.classList.remove('active');
      for (const blk of blockRowEls) {
        for (const d of blk.slotEls) d.classList.remove('active', 'live', 'fallback');
      }
    }

    function updateVisualizer() {
      if (!scheduler || !lastGoodProgram || !scheduler.isRunning()) {
        clearActiveClasses();
        if (lastGoodProgram) {
          updateCouplingSummary({
            blockStates: lastGoodProgram.blocks.map((block, i) => ({
              blockIndex: i,
              attractor: block.attractor,
              attractorState: attractorStateForBlock(block),
            })),
          });
        }
        return;
      }

      const t = scheduler.now();

      // Beat dot: highlight whichever beat we're in.
      const beatInBar = Math.floor(t.beat) % lastGoodProgram.meter.num;
      for (let i = 0; i < beatDotEls.length; i++) {
        beatDotEls[i].classList.toggle('active', i === beatInBar);
      }

      updateCouplingSummary(t);

      // Per-block: highlight currently-active slot and update coupling readouts.
      for (let i = 0; i < blockRowEls.length; i++) {
        const blk = blockRowEls[i];
        const state = t.blockStates[i];
        const block = lastGoodProgram.blocks[i];

        for (const d of blk.slotEls) d.classList.remove('active', 'live', 'fallback');
        if (!state || !block) continue;

        const attractorState = state.attractorState || attractorStateForBlock(block);
        if (blk.couplingEl) {
            blk.couplingEl.textContent = blockStatusLabel(block, attractorState, state.fadeState);
            blk.couplingEl.className = 'block-coupling ' + sourceClass(attractorState);
        }

        if (blk.surfacesEl) {
            renderSurfaceChips(
              blk.surfacesEl,
              surfacesForBlock(block),
              Boolean(
                block.attractor ||
                (block.effects && Object.keys(block.effects).length) ||
                (block.fade && block.fade.mode && block.fade.mode !== 'clear')
              )
            );
        }

        if (blk.everyEl) {
          if (state.silent) {
            blk.everyEl.style.color = '#bbb';
          } else if (state.every) {
            blk.everyEl.style.color = '#0000cc';
          }
        }

        if (!state.silent && state.inBlockIdx >= 0 && state.inBlockIdx < blk.slotEls.length) {
          const activeDot = blk.slotEls[state.inBlockIdx];
          activeDot.classList.add('active');

          if (attractorState && attractorState.source === 'live') {
            activeDot.classList.add('live');
          } else if (attractorState) {
            activeDot.classList.add('fallback');
          }
        }
      }
    }

    function vizFrame() {
      updateVisualizer();
      requestAnimationFrame(vizFrame);
    }
    requestAnimationFrame(vizFrame);



  // ---------------- live input panel ----------------

  function inputKind() {
    return inputKindSelect ? String(inputKindSelect.value || 'mic') : 'mic';
  }

  function formatInputBlockStatus(block) {
    if (!window.InputVoice || !window.InputVoice.getState || !block || !block.input) return 'input unavailable';
    const state = window.InputVoice.getState()[block.input.kind] || null;
    if (!state) return `${block.input.kind} disconnected`;
    if (state.status === 'live') return `${block.input.kind} live · ${state.label || 'audio input'}`;
    if (state.status === 'requesting') return `${block.input.kind} requesting permission`;
    if (state.status === 'error') return `${block.input.kind} error · ${state.error || 'permission failed'}`;
    return `${block.input.kind} disconnected`;
  }

  function renderInputPanelState(snapshot) {
    if (!inputStatusEl || !inputMeterFill) return;
    const kind = inputKind();
    const state = snapshot && snapshot[kind] ? snapshot[kind] : null;

    if (!state) {
      inputStatusEl.textContent = 'input unavailable';
      inputStatusEl.className = 'input-status source-error';
      inputMeterFill.style.width = '0%';
      return;
    }

    const pieces = [kind, state.status];
    if (state.label && state.status === 'live') pieces.push(state.label);
    if (state.error && state.status === 'error') pieces.push(state.error);
    inputStatusEl.textContent = pieces.join(' · ');
    inputStatusEl.className = 'input-status ' + (state.status === 'live' ? 'source-live' : state.status === 'error' ? 'source-error' : 'source-fallback');
    inputMeterFill.style.width = `${Math.round(Math.max(0, Math.min(1, Number(state.level) || 0)) * 100)}%`;
  }


  function inputKindsForProgram(program) {
    const kinds = new Set();
    const blocks = program && Array.isArray(program.blocks) ? program.blocks : [];
    for (const block of blocks) {
      if (!block || block.voice !== 'input' || !block.input || !block.input.kind) continue;
      kinds.add(String(block.input.kind).toLowerCase());
    }
    return Array.from(kinds).filter(Boolean);
  }

  async function armInputsForProgram(program) {
    const kinds = inputKindsForProgram(program);
    if (!kinds.length) return true;

    if (!window.InputVoice || !window.InputVoice.enable) {
      showWarning('this patch uses input, but the live input module is unavailable');
      return false;
    }

    if (!scheduler) bootScheduler();
    const audioCtx = window.StringVoice && window.StringVoice.ensureAudio ? window.StringVoice.ensureAudio() : null;
    if (!audioCtx) {
      showWarning('this browser does not support Web Audio input');
      return false;
    }

    if (inputPanel) inputPanel.hidden = false;
    if (inputToggleBtn) inputToggleBtn.setAttribute('aria-expanded', 'true');

    const state = window.InputVoice.getState ? window.InputVoice.getState() : {};
    for (const kind of kinds) {
      if (state[kind] && state[kind].status === 'live') continue;

      if (inputKindSelect) {
        inputKindSelect.value = kind;
        if (inputDeviceSelect) inputDeviceSelect.disabled = kind === 'tab';
        if (inputEnableBtn) inputEnableBtn.textContent = kind === 'tab' ? 'capture tab audio' : 'enable audio input';
      }

      const deviceId = inputDeviceSelect && kind !== 'tab' ? inputDeviceSelect.value : '';
      try {
        showWarning(kind === 'tab' ? 'choose a tab and enable audio to play this patch' : 'allow audio input to play this patch');
        await window.InputVoice.enable(kind, { audioCtx, deviceId });
        if (kind !== 'tab') await refreshInputDevices();
        clearErrors();
      } catch (err) {
        showWarning(err && err.message ? err.message : `could not enable ${kind} input`);
        return false;
      }
    }

    return true;
  }

  async function refreshInputDevices() {
    if (!inputDeviceSelect || !window.InputVoice || !window.InputVoice.listDevices) return;
    const current = inputDeviceSelect.value;
    const devices = await window.InputVoice.listDevices();
    inputDeviceSelect.innerHTML = '';

    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'default';
    inputDeviceSelect.appendChild(def);

    for (const device of devices) {
      const opt = document.createElement('option');
      opt.value = device.deviceId || '';
      opt.textContent = device.label || 'audio input';
      inputDeviceSelect.appendChild(opt);
    }

    if (current && Array.from(inputDeviceSelect.options).some((opt) => opt.value === current)) {
      inputDeviceSelect.value = current;
    }
  }

  async function enableSelectedInput() {
    if (!window.InputVoice || !window.InputVoice.enable) {
      showWarning('live input module is unavailable');
      return;
    }

    if (!scheduler) bootScheduler();
    const audioCtx = window.StringVoice && window.StringVoice.ensureAudio ? window.StringVoice.ensureAudio() : null;
    const kind = inputKind();
    const deviceId = inputDeviceSelect && kind !== 'tab' ? inputDeviceSelect.value : '';

    try {
      await window.InputVoice.enable(kind, { audioCtx, deviceId });
      await refreshInputDevices();
      clearErrors();
    } catch (err) {
      showWarning(err && err.message ? err.message : 'input permission failed');
    }
  }

  function stopSelectedInput() {
    if (!window.InputVoice || !window.InputVoice.stop) return;
    window.InputVoice.stop(inputKind());
  }

  function bindInputPanel() {
    if (!inputToggleBtn || !inputPanel) return;

    inputToggleBtn.addEventListener('click', () => {
      const next = inputPanel.hidden;
      inputPanel.hidden = !next;
      inputToggleBtn.setAttribute('aria-expanded', String(next));
      if (next) refreshInputDevices();
    });

    if (inputKindSelect) {
      inputKindSelect.addEventListener('change', () => {
        const kind = inputKind();
        if (inputDeviceSelect) inputDeviceSelect.disabled = kind === 'tab';
        if (inputEnableBtn) inputEnableBtn.textContent = kind === 'tab' ? 'capture tab audio' : 'enable audio input';
        renderInputPanelState(window.InputVoice && window.InputVoice.getState ? window.InputVoice.getState() : null);
      });
    }

    if (inputEnableBtn) inputEnableBtn.addEventListener('click', enableSelectedInput);
    if (inputStopBtn) inputStopBtn.addEventListener('click', stopSelectedInput);

    if (window.InputVoice && window.InputVoice.onStateChange) {
      window.InputVoice.onStateChange(renderInputPanelState);
    }

    refreshInputDevices();
  }

  // ---------------- samples browse panel ----------------

  let samplesGroupsCache = null;
  let samplesPanelRendered = false;

  function renderSamplesPanel(filter) {
    if (!samplesGroupsEl) return;
    if (!samplesGroupsCache && window.SampleVoice) {
      samplesGroupsCache = window.SampleVoice.groups();
    }
    samplesGroupsEl.innerHTML = '';
    const groups = samplesGroupsCache || [];
    const f = (filter || '').trim().toLowerCase();
    let total = 0;
    for (const group of groups) {
      const filtered = f ? group.samples.filter((n) => n.toLowerCase().includes(f)) : group.samples;
      if (filtered.length === 0) continue;
      total += filtered.length;
      const groupEl = document.createElement('div');
      groupEl.className = 'samples-group';
      const head = document.createElement('div');
      head.className = 'samples-group-head';
      head.textContent = `${group.label} — ${filtered.length}${f && filtered.length !== group.samples.length ? ` of ${group.samples.length}` : ''}`;
      groupEl.appendChild(head);
      const pills = document.createElement('div');
      pills.className = 'samples-pills';
      for (const name of filtered) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'samples-pill';
        btn.textContent = name;
        btn.dataset.name = name;
        pills.appendChild(btn);
      }
      groupEl.appendChild(pills);
      samplesGroupsEl.appendChild(groupEl);
    }
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'samples-empty';
      empty.textContent = (groups.length === 0)
        ? 'sample bank not loaded yet — try again in a moment'
        : `no samples match "${filter}"`;
      samplesGroupsEl.appendChild(empty);
    }
    samplesPanelRendered = true;
  }

  function insertAtCursor(text) {
    if (!editorAPI) return;
    editorAPI.focus();
    editorAPI.insertText(text);
  }

  function toggleSamplesPanel(forceState) {
    if (!samplesPanel || !samplesToggleBtn) return;
    const wasHidden = samplesPanel.hasAttribute('hidden');
    const willOpen = typeof forceState === 'boolean' ? forceState : wasHidden;
    if (willOpen) {
      samplesPanel.removeAttribute('hidden');
      samplesToggleBtn.setAttribute('aria-expanded', 'true');
      if (!samplesPanelRendered) {
        // Wait for the manifest to load on first open.
        if (window.SampleVoice && window.SampleVoice.ready) {
          window.SampleVoice.ready().then(() => renderSamplesPanel(samplesFilterInput?.value || ''));
        } else {
          renderSamplesPanel('');
        }
      }
      samplesFilterInput?.focus();
    } else {
      samplesPanel.setAttribute('hidden', '');
      samplesToggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (samplesToggleBtn) {
    samplesToggleBtn.addEventListener('click', () => toggleSamplesPanel());
  }
  if (samplesGroupsEl) {
    // Event delegation: any click on a .samples-pill inserts its data-name.
    samplesGroupsEl.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const pill = target.closest('.samples-pill');
      if (!pill) return;
      const name = pill.getAttribute('data-name');
      if (!name) return;
      insertAtCursor(name);
    });
  }
  if (samplesFilterInput) {
    let filterTimer = null;
    samplesFilterInput.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => renderSamplesPanel(samplesFilterInput.value), 80);
    });
    samplesFilterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (samplesFilterInput.value) {
          samplesFilterInput.value = '';
          renderSamplesPanel('');
        } else {
          toggleSamplesPanel(false);
          if (editorAPI) editorAPI.focus();
        }
      }
    });
  }

  bindInputPanel();

  // ---------------- status ticker ----------------

  statusTimer = setInterval(setStatusLine, 250);
  setStatusLine();

  // ---------------- editor mount ----------------

  function mountEditor() {
    if (!editorMount) return;
    if (typeof window.createReplEditor !== 'function') {
      // Bundle missing — surface a quiet warning and leave the mount empty.
      // The page is still useful (controls/docs); the user just can't type.
      showWarning('editor failed to load (codemirror.bundle.js missing)');
      return;
    }

    editorAPI = window.createReplEditor({
      parent: editorMount,
      initialText: '',
      onChange: () => {
        // Reserved for future autosave/diagnostics hooks. The CM linter
        // already runs on doc changes; we don't hard-evaluate here.
      },
      onCommand: {
        play: evaluateAndRun,
        safePlay,
        stop,
        share: shareCurrent,
      },
      getSampleNames: () => (
        window.SampleVoice && window.SampleVoice.list ? window.SampleVoice.list() : []
      ),
      getSampleGroups: () => (
        window.SampleVoice && window.SampleVoice.groups ? window.SampleVoice.groups() : []
      ),
      parseForDiagnostics: (text) => (
        window.ReplDSL && window.ReplDSL.parse ? window.ReplDSL.parse(text) : { ok: true }
      ),
    });
  }

  // ---------------- bootstrap ----------------

    (async function init() {
      initReferencePanel();
      mountEditor();

    // Kick off sample manifest load in parallel; won't block first audio.
    if (window.SampleVoice) {
      window.SampleVoice.loadManifest(SAMPLES_MANIFEST_URL).catch(() => {});
    }
    const loaded = await loadFromHash();
    if (!loaded) await loadDefaultExample();
    // Pre-render the transport panel from a parse of the loaded text so
    // the slot dots are visible before the user hits play.
    const initialText = editorAPI ? editorAPI.getValue() : '';
    const parsed = window.ReplDSL.parse(initialText);
      if (parsed.ok) {
        lastGoodProgram = parsed.program;
        if (window.ReplAttractors && window.ReplAttractors.warm) {
          window.ReplAttractors.warm(parsed.program);
        }
        renderTransportShell(parsed.program);
      }
        if (editorAPI && shouldAutofocusEditor) editorAPI.focus();
  })();
})();
