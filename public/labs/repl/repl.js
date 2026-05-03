// REPL — wires the editor textarea to the DSL parser, scheduler, and voices.
// Owns: hot-reload (Cmd-Enter), Esc-to-stop, status line, share button,
// example loader, and URL-hash patch persistence.

(function () {
  'use strict';

  const editor = document.getElementById('editor');
  const statusEl = document.getElementById('status');
  const playBtn = document.getElementById('play');
  const stopBtn = document.getElementById('stop');
  const shareBtn = document.getElementById('share');
  const exampleSelect = document.getElementById('example-select');
  const errorList = document.getElementById('errors');
  const beatDotsEl = document.getElementById('beat-dots');
  const blockRowsEl = document.getElementById('block-rows');
  const samplesToggleBtn = document.getElementById('samples-toggle');
  const samplesPanel = document.getElementById('samples-panel');
  const samplesGroupsEl = document.getElementById('samples-groups');
  const samplesFilterInput = document.getElementById('samples-filter');

  const SAMPLES_MANIFEST_URL = './samples/manifest.json';
  const DEFAULT_EXAMPLE_URL = './examples/default.txt';

  let scheduler = null;
  let lastGoodProgram = null;
  let statusTimer = null;

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

  function evaluateAndRun() {
    const text = editor.value;
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
    if (scheduler) {
      scheduler.update(result.program);
      if (!scheduler.isRunning()) scheduler.start();
    }
  }

  function stop() {
    if (scheduler) scheduler.stop();
  }

  function bootScheduler() {
    const audioCtx = window.StringVoice.ensureAudio();
    if (!audioCtx) {
      showWarning('this browser doesn\'t support the Web Audio API');
      return;
    }
    window.StringVoice.resume();
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
    const encoded = await encodeHash(editor.value);
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
      editor.value = text;
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
        editor.value = t;
        return;
      }
    } catch (_) {}
    editor.value = '// failed to load default example. start typing.\n\ntempo 110\n\nstring   A3   C4   E4   G4\nforce    f    mf   p    f\n';
  }

  // ---------------- editor keybindings ----------------

  editor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      evaluateAndRun();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      return;
    }
  });

  playBtn.addEventListener('click', evaluateAndRun);
  stopBtn.addEventListener('click', stop);
  shareBtn.addEventListener('click', shareCurrent);

  // ---------------- examples loader ----------------

  if (exampleSelect) {
    exampleSelect.addEventListener('change', async () => {
      const v = exampleSelect.value;
      if (!v) return;
      try {
        const r = await fetch(`./examples/${v}`);
        if (r.ok) editor.value = await r.text();
      } catch (_) {}
      exampleSelect.value = '';
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
      const push = (name) => {
        if (!surfaces.includes(name)) surfaces.push(name);
      };

      if (block.speed && (hasParamControlStream(block.speed) || block.speed.kind === 'vector')) push('speed');

      for (const name of ['pan', 'gain', 'rate', 'start', 'crush', 'force', 'decay', 'tone', 'harm', 'octave']) {
        if (hasParamControlStream(params[name])) push(name);
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
            push('haze');
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
      const status = formatSourceStatus(state);

      return [name, sourceLabel, status].filter(Boolean).join(' · ');
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
        label.textContent = `${block.voice}`;

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
        couplingEl.textContent = block.attractor ? couplingLabel(block, initialState) : '';

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
          blk.couplingEl.textContent = block.attractor ? couplingLabel(block, attractorState) : '';
          blk.couplingEl.className = 'block-coupling ' + sourceClass(attractorState);
        }

        if (blk.surfacesEl) {
          renderSurfaceChips(blk.surfacesEl, surfacesForBlock(block), Boolean(block.attractor));
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
    if (!editor) return;
    if (document.activeElement !== editor) editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    // Add a leading space if the previous char isn't whitespace or a paren,
    // and a trailing space if the next char isn't whitespace, paren, or eol.
    const prevCh = before.slice(-1);
    const nextCh = after.slice(0, 1);
    const needLead = prevCh && !/\s|\(/.test(prevCh);
    const needTrail = nextCh && !/\s|\)/.test(nextCh);
    const lead = needLead ? ' ' : '';
    const trail = needTrail ? ' ' : '';
    const insert = lead + text + trail;
    editor.value = before + insert + after;
    const caret = start + insert.length;
    editor.selectionStart = editor.selectionEnd = caret;
    // Trigger input event so any future autosizers / observers update.
    editor.dispatchEvent(new Event('input', { bubbles: true }));
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
          editor?.focus();
        }
      }
    });
  }

  // ---------------- status ticker ----------------

  statusTimer = setInterval(setStatusLine, 250);
  setStatusLine();

  // ---------------- bootstrap ----------------

  (async function init() {
    // Kick off sample manifest load in parallel; won't block first audio.
    if (window.SampleVoice) {
      window.SampleVoice.loadManifest(SAMPLES_MANIFEST_URL).catch(() => {});
    }
    const loaded = await loadFromHash();
    if (!loaded) await loadDefaultExample();
    // Pre-render the transport panel from a parse of the loaded text so
    // the slot dots are visible before the user hits play.
    const parsed = window.ReplDSL.parse(editor.value);
      if (parsed.ok) {
        lastGoodProgram = parsed.program;
        if (window.ReplAttractors && window.ReplAttractors.warm) {
          window.ReplAttractors.warm(parsed.program);
        }
        renderTransportShell(parsed.program);
      }
  })();
})();
