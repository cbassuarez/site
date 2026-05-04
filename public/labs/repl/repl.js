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
  const transportVizEl = document.getElementById('transport-viz');
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

    const SIGNAL_META = {
      I: {
        key: 'intensity',
        name: 'intensity',
        summary: 'overall signal strength / amplitude pressure',
        detail: 'How strong the current source is. Usually tracks amplitude, confidence, or signal presence.',
        use: 'higher I = louder, more present, more forceful',
        modulates: ['gain', 'compress', 'trigger', 'space'],
      },
      V: {
        key: 'volatility',
        name: 'volatility',
        summary: 'instability, flux, and rate of change',
        detail: 'How unstable or fast-changing the source is. Often derived from flux, motion, or sudden parameter change.',
        use: 'higher V = more drift, jitter, mutation, spatial instability',
        modulates: ['pan', 'blur', 'grain', 'rate', 'leaf'],
      },
      P: {
        key: 'pressure',
        name: 'pressure',
        summary: 'force applied by the source to the patch',
        detail: 'How much force the source applies to the patch. Useful for density, compression, and body behavior.',
        use: 'higher P = heavier behavior, more compression, stronger body/color',
        modulates: ['force', 'body', 'compress', 'filter', 'crush'],
      },
      D: {
        key: 'density',
        name: 'density',
        summary: 'activity concentration and event crowding',
        detail: 'How active or crowded the source is over time. Usually related to onset rate, activity, or event concentration.',
        use: 'higher D = more events, tighter spacing, denser sample behavior',
        modulates: ['beat', 'time', 'grain', 'trigger', 'sample'],
      },
      T: {
        key: 'periodicity',
        name: 'tension',
        summary: 'distance from rest; harmonic or behavioral strain',
        detail: 'How far the source is from rest. A composite signal for instability, brightness, pressure, or unresolved motion.',
        use: 'higher T = more edge, stretch, harmonic strain, or unresolved energy',
        modulates: ['pitch', 'tone', 'filter', 'resonance', 'decay'],
      },
      R: {
        key: 'rupture',
        name: 'rupture',
        summary: 'attacks, transients, breaks, and discontinuities',
        detail: 'How sharply the source breaks continuity. Usually tracks transients, attacks, spikes, or discontinuities.',
        use: 'higher R = attacks, cuts, scars, re-articulations',
        modulates: ['trigger', 'scar', 'leaf', 'start', 'reset'],
      },
    };



    const SURFACE_META = {
      speed: {
        name: 'speed',
        summary: 'pattern-time multiplier / temporal pressure',
        detail: 'Changes how quickly a block consumes its score material. When coupled, speed becomes the surface where signal motion can bend musical time.',
        use: 'higher drive = faster bodies, warped pacing, or drifted clock behavior',
        drivenBy: ['volatility', 'density', 'rupture'],
      },
      pan: {
        name: 'pan',
        summary: 'left-right position / spatial lateral motion',
        detail: 'Moves material across the stereo field. It is the simplest surface for drift, jitter, and attractor steering.',
        use: 'higher drive = more lateral motion, instability, or spatial displacement',
        drivenBy: ['volatility', 'intensity', 'pressure'],
      },
      gain: {
        name: 'gain',
        summary: 'level / amplitude opening',
        detail: 'Controls how present a block is in the mix. It is usually the first surface touched by intensity and confidence.',
        use: 'higher drive = louder, closer, more exposed material',
        drivenBy: ['intensity', 'pressure'],
      },
      force: {
        name: 'force',
        summary: 'gesture weight / physical push',
        detail: 'Applies body-like pressure to synthesis and coupled behavior. Useful when a source should push the patch instead of merely modulating it.',
        use: 'higher drive = heavier articulation, stronger impact, more push',
        drivenBy: ['pressure', 'intensity', 'rupture'],
      },
      compress: {
        name: 'compress',
        summary: 'dynamic regulation / signal clamp',
        detail: 'Turns incoming pressure into compression behavior. It can make the system feel held down, squeezed, or mechanically governed.',
        use: 'higher drive = more grip, flattening, density, or pressure-control',
        drivenBy: ['pressure', 'density', 'intensity'],
      },
      space: {
        name: 'space',
        summary: 'room send / spatial bloom',
        detail: 'Opens reverberant space around the block. Coupling this surface lets the environment expand, contract, or smear around the source.',
        use: 'higher drive = wider room, longer tail, more atmospheric spread',
        drivenBy: ['intensity', 'tension', 'volatility'],
      },
      body: {
        name: 'body',
        summary: 'resonant mass / embodied color',
        detail: 'Adds mass, chamber, or object-like coloration. It makes a signal feel housed inside something physical.',
        use: 'higher drive = thicker resonance, stronger object-color, heavier body',
        drivenBy: ['pressure', 'intensity', 'tension'],
      },
      pitch: {
        name: 'pitch',
        summary: 'frequency target / harmonic address',
        detail: 'Controls tonal height or pitch selection. In coupled patches, pitch is where tension can become harmonic strain.',
        use: 'higher drive = brighter register, wider pitch pull, sharper harmonic motion',
        drivenBy: ['tension', 'volatility'],
      },
      filter: {
        name: 'filter',
        summary: 'spectral gate / brightness contour',
        detail: 'Shapes the brightness and spectral aperture of a block. It is the main surface for weather, pressure, and tone-color steering.',
        use: 'higher drive = more open spectrum, sharper contour, stronger color shift',
        drivenBy: ['tension', 'pressure', 'intensity'],
      },
      color: {
        name: 'color',
        summary: 'timbre stain / spectral identity',
        detail: 'Marks the block with source-derived tone color. It is a broad surface for making control feel visible in the sound.',
        use: 'higher drive = stronger coloration, more source identity, less neutrality',
        drivenBy: ['pressure', 'tension', 'intensity'],
      },
      decay: {
        name: 'decay',
        summary: 'release length / tail behavior',
        detail: 'Changes how long a gesture remains after articulation. Useful for turning density and tension into lingering or clipped behavior.',
        use: 'higher drive = longer tails, stretched release, or more unstable endings',
        drivenBy: ['tension', 'density', 'intensity'],
      },
      tone: {
        name: 'tone',
        summary: 'brightness / harmonic emphasis',
        detail: 'Tilts the block toward darker or brighter harmonic behavior. It is a compact surface for timbral pressure.',
        use: 'higher drive = brighter edge, stronger tone focus, more harmonic bite',
        drivenBy: ['tension', 'pressure'],
      },
      crush: {
        name: 'crush',
        summary: 'bit damage / digital abrasion',
        detail: 'Introduces reduction, grit, or broken digital texture. It is the surface where pressure can become audible damage.',
        use: 'higher drive = more grit, fracture, hard edges, and degraded signal',
        drivenBy: ['pressure', 'rupture', 'tension'],
      },
      rate: {
        name: 'rate',
        summary: 'sample speed / playback motion',
        detail: 'Changes sample playback speed and direction-like behavior. It lets unstable sources bend sample motion directly.',
        use: 'higher drive = faster playback, pitch-linked motion, or sample instability',
        drivenBy: ['volatility', 'density', 'tension'],
      },
      start: {
        name: 'start',
        summary: 'sample entry point / cut location',
        detail: 'Moves where sample playback begins. This surface turns rupture into cuts, skips, and re-articulations inside recorded material.',
        use: 'higher drive = more displacement, sharper cuts, less stable sample origin',
        drivenBy: ['rupture', 'volatility'],
      },
      sample: {
        name: 'sample',
        summary: 'archive choice / material selection',
        detail: 'Selects or biases which sample material appears. It is the surface for turning a signal into curatorial pressure.',
        use: 'higher drive = more active selection, tighter bias, or denser archive behavior',
        drivenBy: ['density', 'rupture', 'intensity'],
      },
      fade: {
        name: 'fade',
        summary: 'entry-exit envelope / presence gate',
        detail: 'Controls whether a block enters, leaves, or holds in place. It makes presence itself a performable surface.',
        use: 'higher drive = clearer entrances, exits, holds, or threshold behavior',
        drivenBy: ['intensity', 'rupture'],
      },
      harm: {
        name: 'harm',
        summary: 'harmonic selection / partial emphasis',
        detail: 'Bends harmonic emphasis inside pitched material. It turns control streams into changes in intervallic color.',
        use: 'higher drive = stronger harmonic pull, brighter partials, altered interval color',
        drivenBy: ['tension', 'pressure'],
      },
      octave: {
        name: 'octave',
        summary: 'register displacement / octave pressure',
        detail: 'Moves material between octave bands. This surface keeps pitch identity while changing scale and register.',
        use: 'higher drive = broader register jumps, more vertical displacement',
        drivenBy: ['tension', 'volatility'],
      },
      resonance: {
        name: 'resonance',
        summary: 'filter peak / ringing emphasis',
        detail: 'Adds focused ringing around spectral contours. It can make tension feel like a point of acoustic stress.',
        use: 'higher drive = sharper peaks, more whistle, more unstable focus',
        drivenBy: ['tension', 'pressure'],
      },
      comb: {
        name: 'comb',
        summary: 'delay teeth / resonant interference',
        detail: 'Creates tight delay-based coloration and notched resonance. It is a surface for making space feel mechanical or striated.',
        use: 'higher drive = stronger interference, metallic teeth, tighter coloration',
        drivenBy: ['volatility', 'tension'],
      },
      grain: {
        name: 'grain',
        summary: 'granular texture / particle behavior',
        detail: 'Breaks material into smaller pieces and controls particle activity. It turns density into audible particulate motion.',
        use: 'higher drive = more particles, finer texture, denser fragmentation',
        drivenBy: ['density', 'volatility', 'rupture'],
      },
      chorus: {
        name: 'chorus',
        summary: 'detuned doubling / unstable plurality',
        detail: 'Adds moving duplicate voices around the source. It is a surface for widening and destabilizing identity.',
        use: 'higher drive = wider doubling, more shimmer, less single-body certainty',
        drivenBy: ['volatility', 'tension'],
      },
      excite: {
        name: 'excite',
        summary: 'added brightness / activation energy',
        detail: 'Injects extra high-frequency activation into the block. It makes the source feel sparked or chemically awake.',
        use: 'higher drive = brighter attack, more activation, more edge',
        drivenBy: ['intensity', 'rupture', 'tension'],
      },
      blur: {
        name: 'blur',
        summary: 'edge smear / temporal softening',
        detail: 'Softens articulation and smears boundaries. It is the opposite of rupture: a surface for loss of contour.',
        use: 'higher drive = more smear, softer attacks, less precise edges',
        drivenBy: ['volatility', 'density'],
      },
      scar: {
        name: 'scar',
        summary: 'cut memory / accumulated damage',
        detail: 'Leaves marks from discontinuities and attacks. It lets rupture become a remembered texture instead of a one-time event.',
        use: 'higher drive = more cuts, marks, hard edits, and historical damage',
        drivenBy: ['rupture', 'pressure'],
      },
      literal: {
        name: 'literal',
        summary: 'fixed value / uncoupled surface',
        detail: 'This block has no exposed surface chips yet. Its values are being read as written rather than bent by an attractor or control stream.',
        use: 'literal = stable score behavior with no active surface legend',
        drivenBy: ['score'],
      },
    };

    const SURFACE_STATE_META = {
      speed: {
        label: 'SPEED',
        role: 'playback rate / beat division',
        bends: ['beat', 'rate', 'time'],
        units: ['number', 'ratio', 'pattern'],
        cues: [
          { test: (item) => item.kind === 'pattern', text: 'patterned playback clock' },
          { test: (item) => numericAverage(item.values) > 1.25, text: 'fast playback pressure' },
          { test: (item) => numericAverage(item.values) > 0 && numericAverage(item.values) < 0.85, text: 'slowed time / stretched pacing' },
        ],
      },
      pan: {
        label: 'PAN',
        role: 'stereo or spatial placement',
        bends: ['space', 'motion', 'field'],
        units: ['left', 'right', 'center', 'modulation'],
        cues: [
          { test: (item) => item.kind === 'field' || item.kind === 'modulation', text: 'stereo motion field' },
          { test: (item) => item.rawLower.includes('right') && item.rawLower.includes('left'), text: 'right/left pan alternation' },
        ],
      },
      gain: {
        label: 'GAIN',
        role: 'amplitude scalar',
        bends: ['loudness', 'presence'],
        units: ['0–1', 'number', 'signal'],
        cues: [
          { test: (item) => numericAverage(item.values) >= 0.75, text: 'strong presence / forward level' },
          { test: (item) => numericAverage(item.values) > 0 && numericAverage(item.values) < 0.4, text: 'quiet level / recessed presence' },
          { test: (item) => numericAverage(item.values) > 0, text: 'moderate amplitude scalar' },
        ],
      },
      compress: {
        label: 'COMPRESS',
        role: 'dynamic pressure / transient containment',
        bends: ['body', 'density', 'force'],
        units: ['number', 'symbol', 'signal'],
        cues: [{ test: () => true, text: 'dynamic clamp / pressure control' }],
      },
      force: {
        label: 'FORCE',
        role: 'physical pressure applied to the patch',
        bends: ['body', 'compress', 'trigger'],
        units: ['pp', 'p', 'mp', 'mf', 'f', 'ff'],
        cues: [
          { test: (item) => item.displayText.includes('MF'), text: 'medium-force body pressure' },
          { test: (item) => numericAverage(item.values) >= 0.7, text: 'heavy physical push' },
          { test: (item) => numericAverage(item.values) > 0, text: 'body pressure / trigger force' },
        ],
      },
      decay: {
        label: 'DECAY',
        role: 'tail length / release memory',
        bends: ['space', 'resonance', 'memory'],
        units: ['seconds', 'ratio', 'number'],
        cues: [
          { test: (item) => numericAverage(item.values) >= 2, text: 'long tail / release memory' },
          { test: (item) => numericAverage(item.values) > 0, text: 'shortened release contour' },
        ],
      },
      pitch: {
        label: 'PITCH',
        role: 'frequency displacement / harmonic position',
        bends: ['tone', 'tension', 'resonance'],
        units: ['number', 'ratio', 'symbol'],
        cues: [{ test: () => true, text: 'harmonic displacement / pitch pull' }],
      },
      filter: {
        label: 'FILTER',
        role: 'spectral gate / color aperture',
        bends: ['tone', 'brightness', 'pressure'],
        units: ['hz', 'word', 'number'],
        cues: [{ test: () => true, text: 'spectral aperture / brightness contour' }],
      },
      color: {
        label: 'COLOR',
        role: 'timbre tint / spectral identity',
        bends: ['tone', 'surface', 'source'],
        units: ['word', 'symbol', 'signal'],
        cues: [{ test: () => true, text: 'timbre stain / source color' }],
      },
      crush: {
        label: 'CRUSH',
        role: 'bit-depth damage / digital pressure',
        bends: ['rupture', 'scar', 'body'],
        units: ['number', 'symbol', 'signal'],
        cues: [{ test: () => true, text: 'digital abrasion / hard edge' }],
      },
      rate: {
        label: 'RATE',
        role: 'sample playback speed',
        bends: ['sample', 'pitch', 'motion'],
        units: ['number', 'ratio', 'pattern'],
        cues: [{ test: () => true, text: 'sample motion / playback rate' }],
      },
      start: {
        label: 'START',
        role: 'sample entry point / cut location',
        bends: ['rupture', 'sample', 'scar'],
        units: ['seconds', 'number', 'signal'],
        cues: [{ test: () => true, text: 'sample cut-point displacement' }],
      },
      sample: {
        label: 'SAMPLE',
        role: 'archive choice / material selection',
        bends: ['archive', 'density', 'rupture'],
        units: ['selector', 'word', 'signal'],
        cues: [{ test: () => true, text: 'archive selection pressure' }],
      },
      fade: {
        label: 'FADE',
        role: 'entry-exit envelope / presence gate',
        bends: ['presence', 'threshold', 'time'],
        units: ['mode', 'seconds'],
        cues: [{ test: () => true, text: 'presence envelope / entrance gate' }],
      },
      harm: {
        label: 'HARM',
        role: 'harmonic selection / partial emphasis',
        bends: ['pitch', 'tone', 'color'],
        units: ['number', 'symbol'],
        cues: [{ test: () => true, text: 'harmonic color selection' }],
      },
      octave: {
        label: 'OCTAVE',
        role: 'register displacement',
        bends: ['pitch', 'scale', 'register'],
        units: ['integer', 'pattern'],
        cues: [{ test: () => true, text: 'register shift / scale displacement' }],
      },
      resonance: {
        label: 'RESONANCE',
        role: 'resonant emphasis / ringing body',
        bends: ['body', 'tone', 'decay'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'ringing body emphasis' }],
      },
      comb: {
        label: 'COMB',
        role: 'delay-line coloration',
        bends: ['space', 'filter', 'body'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'mechanical comb coloration' }],
      },
      grain: {
        label: 'GRAIN',
        role: 'granular spray / microscopic density',
        bends: ['density', 'sample', 'time'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'grain cloud / microscopic density' }],
      },
      chorus: {
        label: 'CHORUS',
        role: 'duplicate voice spread',
        bends: ['space', 'blur', 'motion'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'widened duplicate-voice field' }],
      },
      excite: {
        label: 'EXCITE',
        role: 'activation energy / brightness injection',
        bends: ['attack', 'tone', 'rupture'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'sparked attack / added brightness' }],
      },
      blur: {
        label: 'BLUR',
        role: 'edge smear / temporal softening',
        bends: ['time', 'density', 'contour'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'smeared contour / softened articulation' }],
      },
      scar: {
        label: 'SCAR',
        role: 'cut memory / accumulated damage',
        bends: ['rupture', 'sample', 'history'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'remembered cuts / historical damage' }],
      },
      body: {
        label: 'BODY',
        role: 'resonant mass / embodied color',
        bends: ['pressure', 'tone', 'space'],
        units: ['number', 'mode'],
        cues: [{ test: () => true, text: 'resonant mass / object color' }],
      },
    };

    const SIGNALS = Object.entries(SIGNAL_META).map(([abbr, meta]) => [abbr, meta.key, meta.name]);

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

    function surfaceStateMetaFor(name) {
      const key = String(name || '').toLowerCase();
      const fallback = surfaceMetaFor(key);
      return SURFACE_STATE_META[key] || {
        label: key.toUpperCase(),
        role: fallback.summary || 'exposed behavior surface',
        bends: fallback.drivenBy || ['score'],
        units: ['value'],
        cues: [{ test: () => true, text: fallback.use || `${key} behavior surface` }],
      };
    }

    function numericAverage(values) {
      if (!Array.isArray(values)) return 0;
      const nums = values.map((v) => Number(v)).filter(Number.isFinite);
      if (!nums.length) return 0;
      return nums.reduce((sum, v) => sum + v, 0) / nums.length;
    }

    function paramStreamValues(stream) {
      if (!stream) return [];
      const raw = stream.kind === 'vector' ? stream.values : [stream.value];
      return raw.map((value) => {
        if (isParamOp(value)) return value.raw || value.op || '*';
        if (typeof value === 'number') return value;
        if (value && typeof value === 'object') return value.raw || value.name || value.kind || 'object';
        return value;
      });
    }

    function rawParamLineForBlock(block, name) {
      if (!block || !block.paramLines || !editorAPI) return '';
      const lineNumber = block.paramLines[name];
      if (!lineNumber) return '';
      const lines = String(editorAPI.getValue() || '').split(/\r?\n/);
      const line = lines[lineNumber - 1] || '';
      const trimmed = line.trim();
      const pattern = new RegExp('^' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\s*', 'i');
      return trimmed.replace(pattern, '').trim();
    }

    function escapeTooltipText(value) {
      const div = document.createElement('div');
      div.textContent = value == null ? '' : String(value);
      return div.innerHTML;
    }

    function displayTokensFromRaw(raw) {
      const text = String(raw || '').trim();
      if (!text) return [];
      const normalized = text
        .replace(/\bpi\b/gi, 'π')
        .replace(/\b([0-9]+)\s*\*\s*π\b/g, '$1π')
        .replace(/[()]/g, ' ')
        .replace(/[|]/g, ' | ')
        .replace(/\s+/g, ' ')
        .trim();
      return normalized ? normalized.split(' ').filter(Boolean) : [];
    }

    function classifySurfaceState(name, raw, stream) {
      const text = String(raw || '').trim();
      const lower = text.toLowerCase();
      const values = paramStreamValues(stream);
      const tokenCount = displayTokensFromRaw(text).filter((token) => token !== '|').length || values.length;

      if (/\*|~|_/.test(text)) {
        if (/\bleft\b|\bright\b|\bcenter\b/.test(lower)) return 'field';
        return 'modulation';
      }
      if (/[()|]/.test(text) || tokenCount > 1 || (stream && stream.kind === 'vector')) return 'pattern';
      if (/^(ppp|pp|p|mp|mf|f|ff|fff|quiet|half|full|loud|dark|bright|left|right|center|off|on)$/i.test(text)) return 'symbol';
      if (values.length && values.every((v) => Number.isFinite(Number(v)))) return 'number';
      if (/^-?(?:\d+(?:\.\d+)?|π|pi)(?:[*/]-?(?:\d+(?:\.\d+)?|π|pi))*$/i.test(text)) return 'number';
      if (/^[a-z][a-z0-9_.:-]*$/i.test(text)) return 'word';
      return 'unknown';
    }

    function surfaceStateDisplayText(raw, values) {
      const tokens = displayTokensFromRaw(raw);
      if (tokens.length) return tokens.join(' · ');
      if (Array.isArray(values) && values.length) {
        return values.map((v) => {
          if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3))).replace(/^0\./, '.');
          return String(v);
        }).join(' · ');
      }
      return 'default';
    }


    function formatSurfaceNumber(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value == null ? '' : value);
      if (Math.abs(n) >= 10) return String(Math.round(n * 10) / 10);
      if (Number.isInteger(n)) return String(n);
      return String(Math.round(n * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.');
    }

    function liveSurfaceValueFor(name, liveState) {
      if (!liveState) return undefined;
      const key = String(name || '').toLowerCase();
      if (key === 'speed') return liveState.speed;
      if (key === 'fade') return undefined;
      if (liveState.params && Object.prototype.hasOwnProperty.call(liveState.params, key)) return liveState.params[key];
      if (liveState.effects) {
        const rawKey = '_raw' + key.charAt(0).toUpperCase() + key.slice(1);
        if (Object.prototype.hasOwnProperty.call(liveState.effects, rawKey)) return liveState.effects[rawKey];
        if (Object.prototype.hasOwnProperty.call(liveState.effects, key)) return liveState.effects[key];
      }
      return undefined;
    }

    function displayTextForLiveSurface(name, liveValue, fallback) {
      if (liveValue === undefined || liveValue === null || liveValue === '') return fallback;
      const key = String(name || '').toLowerCase();
      if (typeof liveValue === 'number') {
        if (key === 'pan') {
          if (liveValue > 0.08) return `R ${formatSurfaceNumber(liveValue)}`;
          if (liveValue < -0.08) return `L ${formatSurfaceNumber(Math.abs(liveValue))}`;
          return 'CENTER';
        }
        return formatSurfaceNumber(liveValue);
      }
      if (typeof liveValue === 'string') return liveValue.toUpperCase();
      if (liveValue && typeof liveValue === 'object') return String(liveValue.raw || liveValue.name || liveValue.kind || fallback || 'ON').toUpperCase();
      return String(liveValue).toUpperCase();
    }

    function streamForSurface(block, name) {
      if (!block) return null;
      if (name === 'speed') return block.speed || null;
      if (name === 'fade') return block.fade || null;
      if (block.params && block.params[name]) return block.params[name];
      if (block.effects && block.effects[name]) return block.effects[name];
      return null;
    }

    function activeSurfaceStateItems(block, liveState) {
      if (!block || !block.paramLines) return [];
      const items = [];
      const seen = new Set();
      const keys = Object.keys(block.paramLines)
        .filter((name) => SURFACE_STATE_META[name] || SURFACE_META[name] || name === 'fade')
        .sort((a, b) => (block.paramLines[a] || 0) - (block.paramLines[b] || 0));

      for (const name of keys) {
        if (seen.has(name)) continue;
        seen.add(name);
        const stream = streamForSurface(block, name);
        if (!stream && name !== 'fade') continue;
        const raw = rawParamLineForBlock(block, name);
        const values = paramStreamValues(stream);
        const kind = classifySurfaceState(name, raw, stream);
        const meta = surfaceStateMetaFor(name);
        const fallbackText = surfaceStateDisplayText(raw, values);
        const liveValue = liveSurfaceValueFor(name, liveState);
        const displayText = displayTextForLiveSurface(name, liveValue, fallbackText);
        const item = {
          name,
          meta,
          kind,
          raw,
          rawLower: String(raw || '').toLowerCase(),
          values: liveValue !== undefined && liveValue !== null && Number.isFinite(Number(liveValue)) ? [Number(liveValue)] : values,
          liveValue,
          displayText,
          behavior: meta.role,
        };
        const cue = (meta.cues || []).find((candidate) => {
          try { return candidate.test(item); } catch (_) { return false; }
        });
        if (cue && cue.text) item.behavior = cue.text;
        items.push(item);
      }
      return items;
    }

    function surfaceStateTokens(item) {
      const tokens = String(item && item.displayText ? item.displayText : '')
        .split(' · ')
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => token !== '|');
      if (tokens.length) return tokens;
      if (item && Array.isArray(item.values) && item.values.length) {
        return item.values.map((value) => String(value)).filter(Boolean);
      }
      return ['default'];
    }

    function compactSurfaceStateValue(item) {
      const tokens = surfaceStateTokens(item);
      const upper = tokens.map((token) => token.toUpperCase());
      if (item.kind === 'field') {
        const hasLeft = upper.some((token) => token.includes('LEFT'));
        const hasRight = upper.some((token) => token.includes('RIGHT'));
        const hasCenter = upper.some((token) => token.includes('CENTER'));
        if (hasLeft && hasRight) return 'R ↔ L';
        if (hasLeft) return 'LEFT';
        if (hasRight) return 'RIGHT';
        if (hasCenter) return 'CENTER';
      }
      if (item.kind === 'pattern' || item.kind === 'modulation') {
        const visible = tokens.filter((token) => !/^[*~_\-]+$/.test(token)).slice(0, 4);
        return visible.join(' ').replace(/\bpi\b/gi, 'π') || item.kind.toUpperCase();
      }
      const joined = tokens.slice(0, 3).join(' ');
      if (joined.length > 18) return `${joined.slice(0, 15)}…`;
      return joined || 'default';
    }

    function surfaceHudKind(item) {
      const name = String(item && item.name ? item.name : '').toLowerCase();
      if (name === 'speed' || name === 'rate') return 'clock';
      if (name === 'pan') return 'pan';
      if (name === 'gain') return 'level';
      if (name === 'compress' || name === 'crush') return 'clamp';
      if (name === 'force') return 'pressure';
      if (name === 'decay' || name === 'fade') return 'tail';
      if (name === 'space' || name === 'blur' || name === 'chorus') return 'field';
      if (name === 'pitch' || name === 'octave' || name === 'harm') return 'pitch';
      if (name === 'grain' || name === 'density') return 'particle';
      if (name === 'sample' || name === 'start') return 'tape';
      if (name === 'scar' || name === 'rupture') return 'cut';
      if (name === 'tone' || name === 'filter' || name === 'color' || name === 'body') return 'stamp';
      if (item.kind === 'number') return 'level';
      if (item.kind === 'pattern' || item.kind === 'modulation') return 'clock';
      return 'stamp';
    }

    function normalizedSurfaceNumber(item) {
      const nums = (item && Array.isArray(item.values) ? item.values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite);
      if (nums.length) return Math.max(0, Math.min(1, nums.reduce((sum, value) => sum + value, 0) / nums.length));
      const text = String(item && item.raw ? item.raw : '').trim();
      const n = Number(text);
      if (!Number.isFinite(n)) return 0.5;
      if (n > 1) return Math.max(0, Math.min(1, n / 8));
      return Math.max(0, Math.min(1, n));
    }

    function meterCellsHTML(count, active, className = 'surface-hud-cell') {
      const total = Math.max(1, count | 0);
      const filled = Math.max(0, Math.min(total, active | 0));
      let html = '';
      for (let i = 0; i < total; i += 1) {
        html += `<span class="${className}${i < filled ? ' is-on' : ''}"></span>`;
      }
      return html;
    }

    function clockHudHTML(item) {
      const tokens = surfaceStateTokens(item).filter((token) => token !== '|').slice(0, 4);
      const filled = Math.max(1, Math.min(4, tokens.length || 1));
      return `<span class="surface-hud-clock" aria-hidden="true">${meterCellsHTML(4, filled)}</span>`;
    }

    function pressureHudHTML(item) {
      const symbols = { ppp: 1, pp: 1, p: 2, mp: 3, mf: 4, f: 5, ff: 6, fff: 6 };
      const key = String(compactSurfaceStateValue(item)).toLowerCase().trim();
      const filled = symbols[key] || Math.max(1, Math.round(normalizedSurfaceNumber(item) * 6));
      return `<span class="surface-hud-ladder" aria-hidden="true">${meterCellsHTML(6, filled, 'surface-hud-step')}</span>`;
    }

    function tailHudHTML(item) {
      const filled = Math.max(1, Math.round(normalizedSurfaceNumber(item) * 6));
      return `<span class="surface-hud-tail" aria-hidden="true">${meterCellsHTML(6, filled)}</span>`;
    }

    function panHudHTML(item) {
      const text = String(item.raw || item.displayText || '').toLowerCase();
      const hasLeft = /left/.test(text);
      const hasRight = /right/.test(text);
      const hasCenter = /center/.test(text) || (!hasLeft && !hasRight);
      return `
        <span class="surface-hud-pan" aria-hidden="true">
          <span>L</span>
          <span class="surface-hud-pan-cell${hasLeft ? ' is-on' : ''}"></span>
          <span class="surface-hud-pan-cell${hasCenter ? ' is-on' : ''}"></span>
          <span class="surface-hud-pan-cell${hasRight ? ' is-on' : ''}"></span>
          <span>R</span>
        </span>`;
    }

    function levelHudHTML(item, cells = 6) {
      const filled = Math.max(0, Math.min(cells, Math.round(normalizedSurfaceNumber(item) * cells)));
      return `<span class="surface-hud-level" aria-hidden="true">${meterCellsHTML(cells, filled)}</span>`;
    }

    function fieldHudHTML(item) {
      const filled = Math.max(1, Math.round(normalizedSurfaceNumber(item) * 5));
      return `<span class="surface-hud-field" aria-hidden="true">${meterCellsHTML(5, filled)}</span>`;
    }

    function pitchHudHTML(item) {
      const n = normalizedSurfaceNumber(item);
      const active = Math.max(1, Math.min(5, Math.round(n * 5)));
      return `<span class="surface-hud-pitch" aria-hidden="true">${meterCellsHTML(5, active)}</span>`;
    }

    function particleHudHTML(item) {
      const active = Math.max(1, Math.min(7, Math.round(normalizedSurfaceNumber(item) * 7)));
      return `<span class="surface-hud-particles" aria-hidden="true">${meterCellsHTML(7, active, 'surface-hud-dot')}</span>`;
    }

    function tapeHudHTML(item) {
      return `<span class="surface-hud-tape" aria-hidden="true"><span></span><span></span><span></span></span>`;
    }

    function cutHudHTML(item) {
      const active = Math.max(1, Math.min(5, Math.round(normalizedSurfaceNumber(item) * 5)));
      return `<span class="surface-hud-cut" aria-hidden="true">${meterCellsHTML(5, active)}</span>`;
    }

    function stampHudHTML(item) {
      const value = escapeTooltipText(compactSurfaceStateValue(item).toUpperCase());
      return `<span class="surface-hud-stamp" aria-hidden="true">${value || 'ON'}</span>`;
    }

    function surfaceHudVizHTML(item) {
      switch (surfaceHudKind(item)) {
        case 'clock': return clockHudHTML(item);
        case 'pressure': return pressureHudHTML(item);
        case 'tail': return tailHudHTML(item);
        case 'pan': return panHudHTML(item);
        case 'level': return levelHudHTML(item);
        case 'clamp': return levelHudHTML(item, 5);
        case 'field': return fieldHudHTML(item);
        case 'pitch': return pitchHudHTML(item);
        case 'particle': return particleHudHTML(item);
        case 'tape': return tapeHudHTML(item);
        case 'cut': return cutHudHTML(item);
        case 'stamp':
        default: return stampHudHTML(item);
      }
    }

    function surfaceStateHudHTML(item) {
      const label = escapeTooltipText(item.meta.label || item.name.toUpperCase());
      const value = escapeTooltipText(compactSurfaceStateValue(item).toUpperCase());
      const kind = escapeTooltipText(surfaceHudKind(item).toUpperCase());
      const aria = `${label}: ${compactSurfaceStateValue(item)}. ${item.behavior || item.meta.role || 'active surface parameter'}.`;
      return `
        <button class="surface-hud" type="button" data-surface="${escapeTooltipText(item.name)}" data-kind="${escapeTooltipText(item.kind)}" data-hud-kind="${kind}" aria-label="${escapeTooltipText(aria)}">
          <span class="surface-hud-top"><span class="surface-hud-label">${label}</span><span class="surface-hud-kind">${kind}</span></span>
          <span class="surface-hud-value">${value || 'ON'}</span>
          ${surfaceHudVizHTML(item)}
        </button>`;
    }

    function renderSurfaceStatePanel(el, block, liveState) {
      if (!el) return [];
      const items = activeSurfaceStateItems(block, liveState);
      if (!items.length) {
        if (el.classList && el.classList.contains('block-surface-state')) {
          el.innerHTML = '';
          el.hidden = true;
        } else {
          el.innerHTML = '<div class="surface-state-empty">no active surface instruments</div>';
          el.hidden = false;
        }
        return [];
      }
      el.hidden = false;
      el.innerHTML = items.map(surfaceStateHudHTML).join('');
      return items.map((item) => item.name);
    }

    function surfaceMetaFor(name) {
      const key = String(name || 'literal').toLowerCase();
      return SURFACE_META[key] || {
        name: key,
        summary: 'exposed parameter surface',
        detail: 'This chip marks a block surface that can be written literally, automated by control streams, or bent by an attractor.',
        use: `${key} = active behavior surface`,
        drivenBy: ['signal', 'score'],
      };
    }

    function surfaceAriaLabel(name) {
      const meta = surfaceMetaFor(name);
      return `${meta.name}: ${meta.summary}. Driven by ${meta.drivenBy.join(', ')}.`;
    }

    function ensureSurfaceTooltip() {
      let tooltip = document.getElementById('surface-tooltip');
      if (tooltip) return tooltip;

      tooltip = document.createElement('aside');
      tooltip.id = 'surface-tooltip';
      tooltip.className = 'surface-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tooltip);
      return tooltip;
    }

    function surfaceTooltipHTML(name) {
      const meta = surfaceMetaFor(name);
      const label = escapeTooltipText(String(name || 'literal').toUpperCase());
      const chips = meta.drivenBy.map((item) => `<span>${escapeTooltipText(item)}</span>`).join('');

      return `
        <div class="surface-tooltip-stamp"><span class="surface-tooltip-mark" aria-hidden="true"></span> SURFACE / ${label}</div>
        <div class="surface-tooltip-title">${escapeTooltipText(meta.name)}</div>
        <div class="surface-tooltip-summary">${escapeTooltipText(meta.summary)}</div>
        <div class="surface-tooltip-detail">${escapeTooltipText(meta.detail)}</div>
        <div class="surface-tooltip-use">${escapeTooltipText(meta.use)}</div>
        <div class="surface-tooltip-modulates"><strong>driven by</strong><div>${chips}</div></div>
      `;
    }

    function positionSurfaceTooltip(tooltip, target, clientX, clientY) {
      positionSignalTooltip(tooltip, target, clientX, clientY);
    }

    function showSurfaceTooltip(target, clientX, clientY) {
      const name = target && target.dataset ? target.dataset.surface : '';
      if (!name) return;

      const tooltip = ensureSurfaceTooltip();
      tooltip.dataset.surface = name;
      tooltip.innerHTML = surfaceTooltipHTML(name);
      tooltip.setAttribute('aria-hidden', 'false');
      tooltip.classList.add('visible');
      target.setAttribute('aria-describedby', 'surface-tooltip');
      positionSurfaceTooltip(tooltip, target, clientX, clientY);
    }

    function hideSurfaceTooltip(target) {
      const tooltip = document.getElementById('surface-tooltip');
      if (!tooltip) return;

      tooltip.classList.remove('visible');
      tooltip.setAttribute('aria-hidden', 'true');
      if (target && target.removeAttribute) target.removeAttribute('aria-describedby');
    }

    function bindSurfaceTooltipEvents() {
      if (!transportVizEl) return;

      transportVizEl.addEventListener('mousemove', (event) => {
        const target = event.target.closest('.surface-chip[data-surface], .surface-hud[data-surface]');
        if (!target || !transportVizEl.contains(target)) return;
        showSurfaceTooltip(target, event.clientX, event.clientY);
      });

      transportVizEl.addEventListener('mouseleave', (event) => {
        hideSurfaceTooltip(event.target);
      });

      transportVizEl.addEventListener('focusin', (event) => {
        const target = event.target.closest('.surface-chip[data-surface], .surface-hud[data-surface]');
        if (!target || !transportVizEl.contains(target)) return;
        const rect = target.getBoundingClientRect();
        showSurfaceTooltip(target, rect.left + rect.width / 2, rect.top);
      });

      transportVizEl.addEventListener('focusout', (event) => {
        const target = event.target.closest('.surface-chip[data-surface], .surface-hud[data-surface]');
        if (target) hideSurfaceTooltip(target);
      });

      window.addEventListener('scroll', () => hideSurfaceTooltip(document.activeElement), true);
      window.addEventListener('resize', () => hideSurfaceTooltip(document.activeElement));
    }

    bindSurfaceTooltipEvents();

    function renderSurfaceChips(el, surfaces, active, activeSurfaceNames) {
      if (!el) return;
      el.innerHTML = '';

      if (!surfaces || surfaces.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'surface-chip';
        empty.textContent = 'literal';
        empty.dataset.surface = 'literal';
        empty.tabIndex = 0;
        empty.setAttribute('role', 'button');
        empty.setAttribute('aria-label', surfaceAriaLabel('literal'));
        el.appendChild(empty);
        return;
      }

      const activeSet = activeSurfaceNames instanceof Set ? activeSurfaceNames : new Set(activeSurfaceNames || []);
      for (const surface of surfaces) {
        const isActiveSurface = active || activeSet.has(surface);
        const chip = document.createElement('span');
        chip.className = 'surface-chip' + (isActiveSurface ? ' active' : '');
        chip.textContent = surface;
        chip.dataset.surface = surface;
        chip.tabIndex = 0;
        chip.setAttribute('role', 'button');
        chip.setAttribute('aria-label', surfaceAriaLabel(surface));
        el.appendChild(chip);
      }
    }

    function walkSlots(slots, fn) {
      if (!Array.isArray(slots)) return;
      for (const node of slots) {
        if (!node) continue;
        fn(node);
        if (node.kind === 'group') walkSlots(node.children, fn);
      }
    }

    function blockHasTokenKind(block, predicate) {
      let found = false;
      walkSlots(block && block.slots, (node) => {
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
        if (name && !surfaces.includes(name)) surfaces.push(name);
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

      // Attractors color the medium even when patch values are literal.
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
      if (window.ReplAttractors && typeof window.ReplAttractors.peek === 'function') {
        try {
          return window.ReplAttractors.peek(block.attractor);
        } catch (_) {
          return null;
        }
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

      if (fadeState.held) return `fade hold · ${formatFadeLevel(fadeState.level)}`;

      if (fadeState.completed && fadeState.latched) {
        if (mode === 'in') return 'fade in · complete';
        if (mode === 'out') return 'fade out · latched';
      }

      return `fade ${mode} · ${formatFadeLevel(fadeState.level)}`;
    }

    function blockStatusLabel(block, attractorState, fadeState) {
      const parts = [];
      if (block && block.attractor) parts.push(couplingLabel(block, attractorState));
      const fade = fadeLabel(block, fadeState);
      if (fade) parts.push(fade);
      return parts.join(' · ');
    }

    function signalAriaLabel(abbr, value) {
      const meta = SIGNAL_META[abbr];
      if (!meta) return `Signal ${abbr}: ${formatDecimal(value)}`;
      return `${meta.name}: ${meta.summary}. Modulates ${meta.modulates.join(', ')}.`;
    }

    function signalHTML(state) {
      if (!state) return '';
      return SIGNALS.map(([abbr, key]) => {
        const value = Math.max(0, Math.min(1, Number(state[key]) || 0));
        const level = String(value.toFixed(3));
        const ariaLabel = signalAriaLabel(abbr, value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<span class="signal-token" style="--signal:${level}" data-signal="${abbr}" data-signal-value="${level}" tabindex="0" role="button" aria-label="${ariaLabel}"><abbr>${abbr}</abbr>${formatDecimal(value)}</span>`;
      }).join('');
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
      renderSurfaceChips(couplingSummaryEls.surfacesValue, surfaces, false);
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
        d.title = `beat ${i + 1} of ${beats}`;
        d.setAttribute('aria-label', `beat ${i + 1}`);
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

        const surfaceStateEl = document.createElement('div');
        surfaceStateEl.className = 'surface-state-stack block-surface-state';
        renderSurfaceStatePanel(surfaceStateEl, block, null);

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
        row.appendChild(surfaceStateEl);
        row.appendChild(couplingEl);
        row.appendChild(surfacesEl);
        if (block.every) row.appendChild(everyEl);

        blockRowsEl.appendChild(row);
        blockRowEls.push({ row, slotEls, everyEl, couplingEl, surfacesEl, surfaceStateEl, block });
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
      if (transportVizEl) transportVizEl.dataset.running = 'false';
      for (const d of beatDotEls) {
        d.classList.remove('active');
        d.style.removeProperty('--beat-progress');
      }
      for (const blk of blockRowEls) {
        if (blk.row) blk.row.classList.remove('active', 'silent', 'live', 'fallback');
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
      if (transportVizEl) {
        transportVizEl.dataset.running = 'true';
        transportVizEl.style.setProperty('--beat-progress', String(Math.max(0, Math.min(1, Number(t.beatProgress) || 0))));
      }

      // Beat dot: highlight whichever beat we're in, and expose beat progress for the light fill.
      const beatInBar = Number.isFinite(t.beatIndex) ? t.beatIndex : (Math.floor(t.beat) % lastGoodProgram.meter.num);
      for (let i = 0; i < beatDotEls.length; i++) {
        const active = i === beatInBar;
        beatDotEls[i].classList.toggle('active', active);
        if (active) {
          beatDotEls[i].style.setProperty('--beat-progress', String(Math.max(0, Math.min(1, Number(t.beatProgress) || 0))));
        } else {
          beatDotEls[i].style.removeProperty('--beat-progress');
        }
      }

      updateCouplingSummary(t);

      // Per-block: highlight currently-active slot and update coupling readouts.
      for (let i = 0; i < blockRowEls.length; i++) {
        const blk = blockRowEls[i];
        const state = t.blockStates[i];
        const block = lastGoodProgram.blocks[i];

        for (const d of blk.slotEls) d.classList.remove('active', 'live', 'fallback');
        if (blk.row) blk.row.classList.remove('active', 'silent', 'live', 'fallback');
        if (!state || !block) continue;

        const attractorState = state.attractorState || attractorStateForBlock(block);
        if (blk.row) {
          blk.row.classList.toggle('silent', Boolean(state.silent));
          blk.row.classList.toggle('active', !state.silent && state.inBlockIdx >= 0);
          blk.row.classList.toggle('live', Boolean(attractorState && attractorState.source === 'live'));
          blk.row.classList.toggle('fallback', Boolean(attractorState && attractorState.source && attractorState.source !== 'live'));
        }
        if (blk.couplingEl) {
            blk.couplingEl.textContent = blockStatusLabel(block, attractorState, state.fadeState);
            blk.couplingEl.className = 'block-coupling ' + sourceClass(attractorState);
        }

        if (blk.surfaceStateEl) {
          renderSurfaceStatePanel(blk.surfaceStateEl, block, state.surfaceState || null);
        }

        if (blk.surfacesEl) {
            renderSurfaceChips(
              blk.surfacesEl,
              surfacesForBlock(block),
              Boolean(
                (!state.silent && state.inBlockIdx >= 0) ||
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
      try {
        updateVisualizer();
      } catch (err) {
        // Keep the transport sidebar alive even if an unexpected program state slips through.
        if (!vizFrame._lastWarn || performance.now() - vizFrame._lastWarn > 1500) {
          vizFrame._lastWarn = performance.now();
          // eslint-disable-next-line no-console
          console.warn('[repl transport viz] update failed:', err);
        }
      } finally {
        requestAnimationFrame(vizFrame);
      }
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
