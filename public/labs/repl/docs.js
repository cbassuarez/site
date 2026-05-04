(() => {
  const DOCS = [
    {
      id: 'start-here',
      title: 'start here',
      summary: 'What the instrument is, how to evaluate, and how a patch is built.',
      blocks: [
        { type: 'p', text: 'seb’s repl is a live-coding environment for score-grid notation. A patch is made from voice blocks. Each block names a body — string, sample, input — and the rows underneath shape how that body behaves.' },
        { type: 'callout', text: 'A patch is a score. A block is a body. A row changes how that body behaves. Attractors let outside systems — weather, archives, microphones, browser tabs — lean on the score without replacing it.' },
        { type: 'code', code: 'tempo 88\nmeter 4/4\n\nstring A4 ~ C5\ngain 0.6\nspace 0.2' },
        { type: 'table', headers: ['gesture', 'meaning'], rows: [
          ['Cmd-Enter', 'evaluate the current score and rebuild runtime state'],
          ['Cmd-Shift-Enter', 'replay without unlocking frozen random choices'],
          ['Esc', 'stop all active voices'],
          ['Tab', 'indent, or accept an open completion']
        ]},
        { type: 'p', text: 'Evaluate is the execution gate. Replay is the re-arm control. Stop is the red interrupt. Input opens the live-source panel.' }
      ]
    },
    {
      id: 'language',
      title: 'the language',
      summary: 'Global rows, voice headers, comments, patterns, and modulation values.',
      blocks: [
        { type: 'p', text: 'The language is line-based. Global rows describe the score. Voice headers begin blocks. Rows underneath a voice shape that block until the next voice header appears.' },
        { type: 'code', code: 'tempo 84\nmeter 4/4\n\nstring *!4 (*4 A*) ~ C*!\ngain 0.55\npan *~\nbody glass\nspace 0.25' },
        { type: 'table', headers: ['part', 'role'], rows: [
          ['tempo / meter', 'global score timing'],
          ['string / sample / input', 'voice headers that start blocks'],
          ['gain / pan / space', 'surface rows that shape a voice'],
          ['// comment', 'score annotation; ignored by the parser'],
          ['mic.intensity 0.1 0.75', 'live modulation source mapped into a range']
        ]},
        { type: 'callout', text: 'A block can be read vertically: first what speaks, then how it moves, where it sits, what it listens to, and what it remembers.' }
      ]
    },
    {
      id: 'voices',
      title: 'voices',
      summary: 'The three body types: string, sample, and input.',
      blocks: [
        { type: 'h', text: 'string' },
        { type: 'p', text: 'A string voice is a synthetic, resonant, pitched body. It is good for pulses, tones, phrase patterns, tuned gestures, and bodies that respond to weather or live input.' },
        { type: 'code', code: 'string *!4 (*4 A*) ~ C*!\ngain 0.55\ndecay 4\nbody glass\nspace 0.24' },
        { type: 'h', text: 'sample' },
        { type: 'p', text: 'A sample voice is archival memory: playback, grain, scar, rate, start position, and triggered fragments from the sample bank.' },
        { type: 'code', code: 'sample snm-*&24 ~ tub-*&32 ~\ngain 0.48\ngrain 0.34\nscar memory\nbody paper' },
        { type: 'h', text: 'input' },
        { type: 'p', text: 'An input voice is a live source, a sensor, and an attractor field. It can be heard, analyzed, or both.' },
        { type: 'code', code: 'input mic\ngain 0\nmonitor off\nlisten on' },
        { type: 'callout', text: 'monitor controls whether you hear the input. listen controls whether the system analyzes it.' }
      ]
    },
    {
      id: 'rows-surfaces',
      title: 'rows and surfaces',
      summary: 'Rows grouped by musical behavior rather than alphabetically.',
      blocks: [
        { type: 'p', text: 'Rows are surfaces. Some set a fixed value. Others accept patterns or live modulation sources.' },
        { type: 'table', headers: ['family', 'rows'], rows: [
          ['level and placement', 'gain, pan'],
          ['time and articulation', 'speed, time, beat, leaf, decay, fade'],
          ['tone and body', 'tone, body, filter, color, pitch'],
          ['pressure and dynamics', 'force, compress, crush'],
          ['memory and sample behavior', 'sample, rate, start, grain, scar, choose, trigger'],
          ['space', 'space, blur, comb, chorus, resonance, excite'],
          ['routing and coupling', 'attractor, monitor, listen']
        ]},
        { type: 'h', text: 'fixed and live values' },
        { type: 'code', code: 'gain 0.5\ngain mic.intensity 0.1 0.75\nspace mic.silence 0.15 0.85\ngrain mic.noisiness 0.05 0.55' },
        { type: 'p', text: 'A single number sets a fixed value. A live source maps an attractor feature into a range.' }
      ]
    },
    {
      id: 'patterns',
      title: 'patterns',
      summary: 'Lists, leaves, wildcards, tuplets, and branching score structures.',
      blocks: [
        { type: 'p', text: 'Patterns are not only lists. They are small branching score structures. Operators can repeat, interrupt, randomize, freeze, or select leaves.' },
        { type: 'table', headers: ['operator', 'meaning'], rows: [
          ['~', 'sustain, continue, or hold depending on row context'],
          ['*', 'random choice or wildcard'],
          ['!', 'freeze a random choice'],
          ['( )', 'subdivide a slot or group leaves'],
          ['&N', 'drift or gradient over N seconds'],
          [';', 'selector separator / temporal punctuation in some sample forms'],
          ['1/2, pi/4', 'fractions and symbolic proportions where supported']
        ]},
        { type: 'code', code: 'string A4 ~ C5 ~ E5\nstring *!4 (*4 A*) ~ C*!\nsample snm-*&24 ~ tub-*&32 ~\nrate (*&16 ~)\npan (*~ - right) (*~ - left)' },
        { type: 'callout', text: 'When in doubt, read a pattern as a route map: some marks are destinations, some are repeats, some are switches, and some are frozen decisions.' }
      ]
    },
    {
      id: 'coupling-weather',
      title: 'coupling and weather',
      summary: 'Attractors, weather, archives, and live fields.',
      blocks: [
        { type: 'p', text: 'An attractor lets a block lean toward another source of behavior. It can push choices, surfaces, timing, density, pressure, and memory without replacing the block’s own syntax.' },
        { type: 'table', headers: ['source', 'use'], rows: [
          ['weather', 'external environmental coupling'],
          ['archive', 'memory/sample bias'],
          ['mic', 'microphone analysis field'],
          ['interface', 'audio interface analysis field'],
          ['tab', 'browser tab audio analysis field'],
          ['input', 'nearest live input aggregate']
        ]},
        { type: 'table', headers: ['feature', 'rough meaning'], rows: [
          ['intensity', 'loudness / energy'],
          ['volatility / flux', 'change or instability'],
          ['density', 'activity / onset rate'],
          ['periodicity', 'tonal or rhythmic steadiness'],
          ['rupture', 'transients / attacks'],
          ['silence', 'absence / staleness / open space'],
          ['brightness', 'spectral highness'],
          ['noisiness', 'flatness / noise profile'],
          ['confidence', 'signal-present confidence']
        ]},
        { type: 'code', code: 'string A4 ~ C5\nattractor weather.dew\npan *~\nspace 0.25\n\ninput mic\ngain 0\nlisten on\n\nsample snm-*&24\nattractor mic\ngrain mic.noisiness 0.05 0.55\ntrigger mic.rupture 0.52' }
      ]
    },
    {
      id: 'live-input',
      title: 'live input',
      summary: 'Mic, interface, tab audio, monitoring, listening, and feedback safety.',
      blocks: [
        { type: 'p', text: 'Input is not just audio entering the mix. It is live material, live sensor, and live attractor.' },
        { type: 'callout', text: 'Input does not have to be heard to matter.' },
        { type: 'h', text: 'silent attractor' },
        { type: 'code', code: 'input mic\ngain 0\nmonitor off\nlisten on\n\nstring A4 ~ C5\nattractor mic\ngain mic.intensity 0.1 0.6\nspace mic.silence 0.2 0.9' },
        { type: 'h', text: 'audible input' },
        { type: 'code', code: 'input mic\ngain 0.35\nmonitor on\nlisten on\ncompress mic.intensity 0.1 0.45\nspace mic.silence 0.08 0.45' },
        { type: 'table', headers: ['form', 'meaning'], rows: [
          ['input mic', 'browser microphone input'],
          ['input interface', 'audio interface / mixer / external source input'],
          ['input tab', 'browser tab audio via screen/tab sharing'],
          ['monitor off', 'do not route input to speakers'],
          ['listen on', 'analyze the input and publish attractor features']
        ]},
        { type: 'p', text: 'Use headphones when monitoring a microphone. Tab audio requires the browser share picker and must be started from a user gesture.' }
      ]
    },
    {
      id: 'examples',
      title: 'examples',
      summary: 'What each included example demonstrates and what to try changing.',
      blocks: [
        { type: 'table', headers: ['example', 'what it teaches'], rows: [
          ['01. literal vs coupled', 'fixed values against weather/coupled behavior'],
          ['02. pitch organism', 'string patterns as living pitch bodies'],
          ['03. sample field', 'sample-bank playback and field behavior'],
          ['04. speed warp', 'time surfaces and local movement'],
          ['05. weather dew', 'weather as a coupling source'],
          ['06. quake rupture', 'rupture / pressure / force language'],
          ['07. tide breath', 'slow environmental motion'],
          ['08. solar flare', 'high-energy external coupling'],
          ['09. archive memory', 'archive/sample memory behavior'],
          ['10. notation reference', 'dense syntax reference as a patch'],
          ['11. effect surfaces', 'space, compression, blur, comb, chorus, resonance'],
          ['12. weather body', 'body/tone shaped by weather'],
          ['13. archive scar', 'sample scars and memory pressure'],
          ['14. fades', 'block presence over time'],
          ['15. live input primer', 'mic/input fundamentals'],
          ['16. live input modulation', 'input driving time, gain, samples, effects'],
          ['17. live input as silent attractor', 'THE TUB-style silent sensing'],
          ['18. live input as audible material', 'input routed as a voice'],
          ['19. tab input sample weather', 'browser tab audio as weather'],
          ['20. interface input cybernetic score', 'performer-facing interface input']
        ]},
        { type: 'p', text: 'The fastest way to learn the instrument is to load an example, evaluate it, change one row, evaluate again, then add one attractor.' }
      ]
    },
    {
      id: 'performance',
      title: 'performance workflow',
      summary: 'How to build and modify patches live.',
      blocks: [
        { type: 'ol', items: [
          'choose an example',
          'evaluate',
          'change one row',
          'evaluate again',
          'add an attractor',
          'replay when structure changes significantly',
          'stop when routing or input gets unstable'
        ]},
        { type: 'p', text: 'Use comments as score notes. They are not second-class: in a live patch, comments can be performer instructions, warnings, or future gestures.' },
        { type: 'code', code: '// TRY: clap for rupture; hum for periodicity\ninput mic\ngain 0\nlisten on\n\nsample snm-*&24\nattractor mic\ntrigger mic.rupture 0.52' },
        { type: 'callout', text: 'Evaluate changes the score. Replay restarts the present world without unlocking frozen random choices.' }
      ]
    },
    {
      id: 'troubleshooting',
      title: 'troubleshooting',
      summary: 'Common symptoms, likely causes, and fixes.',
      blocks: [
        { type: 'table', headers: ['symptom', 'try'], rows: [
          ['I do not hear sound.', 'Press Evaluate from a click, raise gain, check output device, confirm the patch is not analysis-only input.'],
          ['The browser blocked audio.', 'Interact with the page and Evaluate again; browsers require user gestures to unlock audio.'],
          ['Mic permission did not appear.', 'Use an input patch and press Evaluate or the Input button; confirm HTTPS or localhost.'],
          ['Input is armed but silent.', 'Set monitor on and gain above 0 if you want to hear it; listen on only analyzes it.'],
          ['Tab audio does not work.', 'Use input tab, choose a tab in the share picker, and enable tab audio in the browser dialog.'],
          ['The patch runs but nothing changes.', 'Check gain, row spelling, attractor confidence, and whether the row accepts live modulation.'],
          ['The sample name does not resolve.', 'Open Samples and check the bank name; wildcard forms like snm-* can help.'],
          ['Replay behaves differently from Evaluate.', 'Replay preserves frozen choices; Evaluate may rebuild and reroll them.'],
          ['I hear feedback.', 'Use headphones, turn monitor off, lower gain, or move the mic away from speakers.']
        ]},
        { type: 'p', text: 'If the editor looks wrong after patching, hard reload the page. If the runtime disappears, look for scripts that rewrite mounted DOM after initialization.' }
      ]
    },
    {
      id: 'reference',
      title: 'reference',
      summary: 'Compact syntax sheet for voices, rows, features, and shortcuts.',
      blocks: [
        { type: 'h', text: 'voice headers' },
        { type: 'code', code: 'string <pattern>\nsample <pattern>\ninput mic\ninput interface\ninput tab' },
        { type: 'h', text: 'live source features' },
        { type: 'code', code: 'mic.intensity\nmic.rupture\nmic.density\nmic.brightness\nmic.noisiness\nmic.periodicity\nmic.volatility\nmic.silence\nmic.confidence' },
        { type: 'h', text: 'keyboard' },
        { type: 'table', headers: ['shortcut', 'action'], rows: [
          ['Cmd-Enter', 'evaluate'],
          ['Cmd-Shift-Enter', 'replay'],
          ['Esc', 'stop'],
          ['Tab', 'indent or accept completion'],
          ['Cmd-/', 'toggle line comments']
        ]},
        { type: 'h', text: 'browser requirements' },
        { type: 'p', text: 'Audio unlock requires a user gesture. Mic and interface input require permission and HTTPS or localhost. Tab audio requires getDisplayMedia and the browser share picker.' }
      ]
    }
  ];

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const inline = (text) => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');

  const sectionSearchText = (section) => [
    section.title,
    section.summary,
    ...section.blocks.flatMap((block) => {
      if (block.text) return [block.text];
      if (block.code) return [block.code];
      if (block.items) return block.items;
      if (block.rows) return block.rows.flat();
      return [];
    })
  ].join(' ').toLowerCase();

  const renderBlock = (block) => {
    if (block.type === 'p') return `<p>${inline(block.text)}</p>`;
    if (block.type === 'h') return `<h4>${escapeHtml(block.text)}</h4>`;
    if (block.type === 'callout') return `<div class="docs-callout">${inline(block.text)}</div>`;
    if (block.type === 'code') return `<div class="docs-code"><pre>${escapeHtml(block.code)}</pre></div>`;
    if (block.type === 'ul') return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
    if (block.type === 'ol') return `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
    if (block.type === 'table') {
      return [
        '<table class="docs-table">',
        '<thead><tr>',
        block.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join(''),
        '</tr></thead><tbody>',
        block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join(''),
        '</tbody></table>'
      ].join('');
    }
    return '';
  };

  const renderSection = (section, index) => `
    <section class="docs-section" id="docs-section-${escapeHtml(section.id)}" data-doc-id="${escapeHtml(section.id)}" data-doc-search="${escapeHtml(sectionSearchText(section))}">
      <div class="docs-section-kicker">${String(index + 1).padStart(2, '0')}</div>
      <h3>${escapeHtml(section.title)}</h3>
      <p><strong>${escapeHtml(section.summary)}</strong></p>
      ${section.blocks.map(renderBlock).join('\n')}
    </section>
  `;

  const render = () => {
    const panel = document.getElementById('docs-panel');
    const toggle = document.getElementById('docs-toggle');
    const close = document.getElementById('docs-close');
    const nav = document.getElementById('docs-nav');
    const content = document.getElementById('docs-content');
    const search = document.getElementById('docs-search');
    if (!panel || !toggle || !nav || !content) return;

    nav.innerHTML = DOCS.map((section, index) => `
      <button class="docs-nav-button${index === 0 ? ' is-active' : ''}" type="button" data-doc-target="${escapeHtml(section.id)}">
        <span class="docs-nav-num">${String(index + 1).padStart(2, '0')}</span>
        <span>${escapeHtml(section.title)}</span>
      </button>
    `).join('');

    content.innerHTML = DOCS.map(renderSection).join('') + '<div class="docs-empty">no section matches that search.</div>';

    const setOpen = (shouldOpen) => {
      panel.hidden = !shouldOpen;
      toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      if (shouldOpen) {
        const target = search || content;
        window.requestAnimationFrame(() => target.focus({ preventScroll: false }));
      }
    };

    const activate = (id, shouldScroll = true) => {
      nav.querySelectorAll('.docs-nav-button').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.docTarget === id);
      });
      const section = content.querySelector(`[data-doc-id="${CSS.escape(id)}"]`);
      if (section && shouldScroll) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    if (close) close.addEventListener('click', () => setOpen(false));

    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-doc-target]');
      if (!button) return;
      activate(button.dataset.docTarget);
    });

    content.addEventListener('scroll', () => {
      const sections = Array.from(content.querySelectorAll('.docs-section:not([hidden])'));
      const current = sections.find((section) => section.getBoundingClientRect().top >= content.getBoundingClientRect().top - 6) || sections[0];
      if (current) activate(current.dataset.docId, false);
    }, { passive: true });

    if (search) {
      search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        let visibleCount = 0;
        content.querySelectorAll('.docs-section').forEach((section) => {
          const visible = !query || section.dataset.docSearch.includes(query);
          section.hidden = !visible;
          visibleCount += visible ? 1 : 0;
        });
        nav.querySelectorAll('.docs-nav-button').forEach((button) => {
          const section = content.querySelector(`[data-doc-id="${CSS.escape(button.dataset.docTarget)}"]`);
          button.hidden = section ? section.hidden : false;
        });
        content.classList.toggle('is-empty', visibleCount === 0);
        const firstVisible = content.querySelector('.docs-section:not([hidden])');
        if (firstVisible) activate(firstVisible.dataset.docId, false);
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
      }
    });

    if (window.location.hash === '#docs') setOpen(true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
})();
