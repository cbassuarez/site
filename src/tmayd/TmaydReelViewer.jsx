import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchReelByDate, fetchTodayReel } from './tmaydApi';
import { formatTmaydDateTime, isValidArchiveDate } from './tmaydUtils';

const AUTO_MIN_MS = 220;
const AUTO_MAX_MS = 2200;
const ZOOM_MIN = 90;
const ZOOM_MAX = 280;
const LAMP_MIN = 70;
const LAMP_MAX = 190;
const CONTRAST_MIN = 85;
const CONTRAST_MAX = 260;
const VIEWER_SETTINGS_KEY = 'tmayd:daily-receipt-viewer:v2';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function codeDate(publicCode) {
  if (typeof publicCode !== 'string') {
    return '';
  }
  const match = publicCode.match(/^DAY-(\d{4})(\d{2})(\d{2})-\d{4}$/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function loadViewerSettings() {
  const defaults = {
    autoPlayMs: 820,
    zoomPct: 128,
    lampPct: 124,
    contrastPct: 156,
    invertPolarity: false,
    viewMode: 'frame'
  };

  try {
    const raw = localStorage.getItem(VIEWER_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      autoPlayMs: clamp(Math.round(safeNumber(parsed.autoPlayMs, defaults.autoPlayMs)), AUTO_MIN_MS, AUTO_MAX_MS),
      zoomPct: clamp(Math.round(safeNumber(parsed.zoomPct, defaults.zoomPct)), ZOOM_MIN, ZOOM_MAX),
      lampPct: clamp(Math.round(safeNumber(parsed.lampPct, defaults.lampPct)), LAMP_MIN, LAMP_MAX),
      contrastPct: clamp(Math.round(safeNumber(parsed.contrastPct, defaults.contrastPct)), CONTRAST_MIN, CONTRAST_MAX),
      invertPolarity: Boolean(parsed.invertPolarity),
      viewMode: parsed.viewMode === 'sheet' ? 'sheet' : 'frame'
    };
  } catch (_) {
    return defaults;
  }
}

function saveViewerSettings(settings) {
  try {
    localStorage.setItem(VIEWER_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

export default function TmaydReelViewer({ initialDate = '', highlightPublicCode = '' }) {
  const prefs = useMemo(() => loadViewerSettings(), []);
  const derivedDateFromCode = codeDate(highlightPublicCode);
  const defaultDate = isValidArchiveDate(initialDate)
    ? initialDate
    : isValidArchiveDate(derivedDateFromCode)
      ? derivedDateFromCode
      : todayDate();

  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [inputDate, setInputDate] = useState(defaultDate);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [errorKind, setErrorKind] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoPlayMs, setAutoPlayMs] = useState(prefs.autoPlayMs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomPct, setZoomPct] = useState(prefs.zoomPct);
  const [lampPct, setLampPct] = useState(prefs.lampPct);
  const [contrastPct, setContrastPct] = useState(prefs.contrastPct);
  const [invertPolarity, setInvertPolarity] = useState(prefs.invertPolarity);
  const [viewMode, setViewMode] = useState(prefs.viewMode);
  const [isDragging, setIsDragging] = useState(false);

  const framePaneRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0
  });
  const inertiaRef = useRef(0);

  const frames = manifest?.frames || [];
  const frameCount = frames.length;
  const activeFrame = frameCount > 0 ? frames[clamp(activeIndex, 0, frameCount - 1)] : null;
  const canPan = viewMode === 'frame' && zoomPct > 100;

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      const result = selectedDate === todayDate()
        ? await fetchTodayReel()
        : await fetchReelByDate(selectedDate);

      if (!active) {
        return;
      }

      setManifest(result.data);
      setIsMock(Boolean(result.mock));
      setErrorKind(result.ok ? null : result.errorKind || 'unknown');
      setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [selectedDate]);

  useEffect(() => {
    saveViewerSettings({
      autoPlayMs,
      zoomPct,
      lampPct,
      contrastPct,
      invertPolarity,
      viewMode
    });
  }, [autoPlayMs, zoomPct, lampPct, contrastPct, invertPolarity, viewMode]);

  useEffect(() => {
    if (frameCount === 0) {
      setActiveIndex(0);
      setIsPlaying(false);
      return;
    }

    if (highlightPublicCode) {
      const hit = frames.findIndex((frame) => frame.publicCode === highlightPublicCode);
      if (hit >= 0) {
        setActiveIndex(hit);
        return;
      }
    }

    setActiveIndex((current) => clamp(current, 0, frameCount - 1));
  }, [frameCount, frames, highlightPublicCode]);

  useEffect(() => {
    if (!isPlaying || frameCount <= 1) {
      return undefined;
    }
    const timerId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % frameCount);
    }, clamp(autoPlayMs, AUTO_MIN_MS, AUTO_MAX_MS));
    return () => window.clearInterval(timerId);
  }, [isPlaying, frameCount, autoPlayMs]);

  function stopInertia() {
    if (inertiaRef.current) {
      window.cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = 0;
    }
  }

  function clampPaneScroll(pane) {
    const maxX = Math.max(0, pane.scrollWidth - pane.clientWidth);
    const maxY = Math.max(0, pane.scrollHeight - pane.clientHeight);
    if (pane.scrollLeft < 0) pane.scrollLeft = 0;
    if (pane.scrollLeft > maxX) pane.scrollLeft = maxX;
    if (pane.scrollTop < 0) pane.scrollTop = 0;
    if (pane.scrollTop > maxY) pane.scrollTop = maxY;
  }

  function startInertia(vx0, vy0) {
    const pane = framePaneRef.current;
    if (!pane) return;
    let vx = vx0;
    let vy = vy0;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.max(1, now - last);
      last = now;

      pane.scrollLeft += vx * dt;
      pane.scrollTop += vy * dt;
      clampPaneScroll(pane);

      const maxX = Math.max(0, pane.scrollWidth - pane.clientWidth);
      const maxY = Math.max(0, pane.scrollHeight - pane.clientHeight);
      if ((pane.scrollLeft <= 0 && vx < 0) || (pane.scrollLeft >= maxX && vx > 0)) vx = 0;
      if ((pane.scrollTop <= 0 && vy < 0) || (pane.scrollTop >= maxY && vy > 0)) vy = 0;

      const decay = Math.pow(0.90, dt / 16.67);
      vx *= decay;
      vy *= decay;

      if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
        inertiaRef.current = 0;
        return;
      }
      inertiaRef.current = window.requestAnimationFrame(frame);
    };
    inertiaRef.current = window.requestAnimationFrame(frame);
  }

  useEffect(() => {
    if (!canPan) {
      setIsDragging(false);
      dragRef.current.active = false;
      stopInertia();
    }
  }, [canPan]);

  useEffect(() => () => stopInertia(), []);

  useEffect(() => {
    const pane = framePaneRef.current;
    if (!pane) return;
    clampPaneScroll(pane);
  }, [zoomPct, activeIndex, viewMode]);

  function onPanePointerDown(event) {
    if (!canPan) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const pane = framePaneRef.current;
    if (!pane) return;
    stopInertia();
    dragRef.current.active = true;
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.lastX = event.clientX;
    dragRef.current.lastY = event.clientY;
    dragRef.current.lastT = performance.now();
    dragRef.current.vx = 0;
    dragRef.current.vy = 0;
    setIsDragging(true);
    if (pane.setPointerCapture) pane.setPointerCapture(event.pointerId);
  }

  function onPanePointerMove(event) {
    const pane = framePaneRef.current;
    const drag = dragRef.current;
    if (!pane || !drag.active) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;

    pane.scrollLeft -= dx;
    pane.scrollTop -= dy;
    clampPaneScroll(pane);

    const instVx = (-dx) / dt;
    const instVy = (-dy) / dt;
    drag.vx = drag.vx * 0.72 + instVx * 0.28;
    drag.vy = drag.vy * 0.72 + instVy * 0.28;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastT = now;
  }

  function endPaneDrag(event) {
    const pane = framePaneRef.current;
    const drag = dragRef.current;
    if (!drag.active) {
      return;
    }
    drag.active = false;
    setIsDragging(false);
    if (pane && pane.releasePointerCapture && drag.pointerId !== null) {
      try {
        pane.releasePointerCapture(drag.pointerId);
      } catch (_) {}
    }
    if (!canPan) {
      drag.vx = 0;
      drag.vy = 0;
      return;
    }
    const speed = Math.hypot(drag.vx, drag.vy);
    if (speed >= 0.02) {
      startInertia(drag.vx, drag.vy);
    }
  }

  function handleDateSubmit(event) {
    event.preventDefault();
    if (!isValidArchiveDate(inputDate)) {
      return;
    }
    setSelectedDate(inputDate);
  }

  function jumpTo(index) {
    if (frameCount === 0) {
      return;
    }
    setActiveIndex(clamp(index, 0, frameCount - 1));
  }

  function stepBy(delta) {
    if (frameCount === 0) {
      return;
    }
    setActiveIndex((current) => clamp(current + delta, 0, frameCount - 1));
  }

  function onViewerKeyDown(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepBy(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepBy(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      jumpTo(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      jumpTo(frameCount - 1);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (frameCount > 1) {
        setIsPlaying((current) => !current);
      }
    }
  }

  const highlightedExists = useMemo(() => {
    if (!highlightPublicCode) {
      return false;
    }
    return frames.some((frame) => frame.publicCode === highlightPublicCode);
  }, [frames, highlightPublicCode]);

  const activeImageUrl = activeFrame ? (activeFrame.cropUrl || activeFrame.thumbUrl || activeFrame.rawUrl) : '';
  const filterValue = [
    invertPolarity ? 'invert(1)' : '',
    'grayscale(1)',
    `brightness(${lampPct}%)`,
    `contrast(${contrastPct}%)`
  ].filter(Boolean).join(' ');

  const frameLabel = frameCount > 0
    ? `${String(activeIndex + 1).padStart(4, '0')} / ${String(frameCount).padStart(4, '0')}`
    : '0000 / 0000';

  const currentDateLabel = manifest?.date || selectedDate;

  return (
    <section>
      <h2>Daily receipt microfiche viewer</h2>

      <form onSubmit={handleDateSubmit}>
        <label htmlFor="tmayd-reel-date">Archive date</label>{' '}
        <input
          id="tmayd-reel-date"
          type="date"
          value={inputDate}
          onChange={(event) => setInputDate(event.target.value)}
        />{' '}
        <button type="submit">load date</button>
      </form>

      {loading ? <p>loading reel manifest...</p> : null}
      {manifest ? (
        <>
          <p>
            date: <strong>{currentDateLabel}</strong> | reel: <strong>{manifest.reelId || 'unknown'}</strong> | status: <strong>{manifest.status || 'unknown'}</strong>
          </p>
          <p>
            generated: {manifest.generatedAt ? formatTmaydDateTime(manifest.generatedAt) : 'unknown'}
          </p>
          {isMock ? <p><small>mock/offline preview mode</small></p> : null}
          {errorKind ? <p><small>reel source error: {errorKind}</small></p> : null}
          {highlightPublicCode && !highlightedExists ? (
            <p><small>requested artifact {highlightPublicCode} was not found in this reel.</small></p>
          ) : null}

          {frames.length === 0 ? (
            <p>No paper frames have been archived for this date yet.</p>
          ) : (
            <>
              <p>
                mode:{' '}
                <button type="button" onClick={() => setViewMode('frame')} disabled={viewMode === 'frame'}>frame gate</button>{' '}
                <button type="button" onClick={() => setViewMode('sheet')} disabled={viewMode === 'sheet'}>contact sheet</button>
              </p>

              <p>
                Use keyboard in viewer: <code>left/right</code> step frame, <code>home/end</code> jump, <code>space</code> play/stop.
              </p>

              <div
                tabIndex={0}
                onKeyDown={onViewerKeyDown}
                aria-label="TMAYD microfiche frame viewer"
                style={{
                  border: '2px solid #111',
                  padding: '0.6rem',
                  marginBottom: '0.8rem',
                  background: '#efefef'
                }}
              >
                <p style={{ marginTop: 0 }}>
                  frame: <strong>{frameLabel}</strong>{' '}
                  {activeFrame ? (
                    <>
                      | code: <strong>{activeFrame.publicCode}</strong>
                      {highlightPublicCode && activeFrame.publicCode === highlightPublicCode ? ' (requested artifact)' : ''}
                      | captured: {activeFrame.capturedAt ? formatTmaydDateTime(activeFrame.capturedAt) : 'unknown'}
                    </>
                  ) : null}
                </p>

                <p>
                  <button type="button" onClick={() => jumpTo(0)} disabled={activeIndex <= 0}>|&lt;</button>{' '}
                  <button type="button" onClick={() => stepBy(-1)} disabled={activeIndex <= 0}>&lt;</button>{' '}
                  <button type="button" onClick={() => setIsPlaying((current) => !current)} disabled={frameCount <= 1}>
                    {isPlaying ? 'stop' : 'play'}
                  </button>{' '}
                  <button type="button" onClick={() => stepBy(1)} disabled={activeIndex >= frameCount - 1}>&gt;</button>{' '}
                  <button type="button" onClick={() => jumpTo(frameCount - 1)} disabled={activeIndex >= frameCount - 1}>&gt;|</button>{' '}
                  speed:{' '}
                  <input
                    type="range"
                    min={AUTO_MIN_MS}
                    max={AUTO_MAX_MS}
                    step="20"
                    value={autoPlayMs}
                    onChange={(event) => setAutoPlayMs(clamp(Number(event.target.value) || 0, AUTO_MIN_MS, AUTO_MAX_MS))}
                    aria-label="autoplay speed"
                  />{' '}
                  {autoPlayMs}ms/frame
                </p>

                <p>
                  zoom:{' '}
                  <input
                    type="range"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step="1"
                    value={zoomPct}
                    onChange={(event) => setZoomPct(clamp(Number(event.target.value) || 0, ZOOM_MIN, ZOOM_MAX))}
                  />{' '}
                  {zoomPct}%{' '}
                  lamp:{' '}
                  <input
                    type="range"
                    min={LAMP_MIN}
                    max={LAMP_MAX}
                    step="1"
                    value={lampPct}
                    onChange={(event) => setLampPct(clamp(Number(event.target.value) || 0, LAMP_MIN, LAMP_MAX))}
                  />{' '}
                  {lampPct}%{' '}
                  contrast:{' '}
                  <input
                    type="range"
                    min={CONTRAST_MIN}
                    max={CONTRAST_MAX}
                    step="1"
                    value={contrastPct}
                    onChange={(event) => setContrastPct(clamp(Number(event.target.value) || 0, CONTRAST_MIN, CONTRAST_MAX))}
                  />{' '}
                  {contrastPct}%{' '}
                  <label>
                    <input
                      type="checkbox"
                      checked={invertPolarity}
                      onChange={(event) => setInvertPolarity(event.target.checked)}
                    /> invert polarity
                  </label>
                </p>

                {viewMode === 'frame' ? (
                  <>
                    <div
                      ref={framePaneRef}
                      onPointerDown={onPanePointerDown}
                      onPointerMove={onPanePointerMove}
                      onPointerUp={endPaneDrag}
                      onPointerCancel={endPaneDrag}
                      style={{
                        background: '#0b0b0b',
                        border: '2px solid #000',
                        outline: '1px solid #444',
                        minHeight: '320px',
                        maxHeight: '70vh',
                        overflow: 'auto',
                        padding: '0.8rem',
                        cursor: canPan ? (isDragging ? 'grabbing' : 'grab') : 'default',
                        touchAction: canPan ? 'none' : 'auto'
                      }}
                    >
                      {activeImageUrl ? (
                        <img
                          src={activeImageUrl}
                          alt={`TMAYD thermal-paper frame ${activeFrame?.publicCode || ''}`}
                          draggable={false}
                          style={{
                            display: 'block',
                            width: `${zoomPct}%`,
                            minWidth: '100%',
                            maxWidth: 'none',
                            height: 'auto',
                            margin: '0 auto',
                            userSelect: 'none',
                            filter: filterValue
                          }}
                        />
                      ) : (
                        <p style={{ color: '#eee' }}>no frame image available for this record.</p>
                      )}
                    </div>

                    <p>
                      {canPan ? (
                        <small>drag to pan when zoomed; release to glide with inertial deceleration.</small>
                      ) : (
                        <small>increase zoom above 100% to enable drag-pan.</small>
                      )}
                    </p>

                    <h3>Index strip</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.35rem' }}>
                      {frames.map((frame, index) => {
                        const selected = index === activeIndex;
                        const imageUrl = frame.thumbUrl || frame.cropUrl || frame.rawUrl;
                        return (
                          <button
                            key={`${frame.publicCode}-${frame.capturedAt}-${index}`}
                            type="button"
                            onClick={() => jumpTo(index)}
                            style={{
                              border: selected ? '2px solid #111' : '1px solid #777',
                              background: '#f8f8f8',
                              padding: '0.25rem',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                          >
                            <small>
                              {String(index + 1).padStart(4, '0')}
                              <br />
                              {frame.publicCode}
                            </small>
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={`Index frame ${frame.publicCode}`}
                                style={{ display: 'block', marginTop: '0.25rem', width: '100%', height: 'auto', filter: 'grayscale(1) contrast(160%) brightness(122%)' }}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Contact sheet</h3>
                    <p><small>click a tile to jump to that frame in the gate.</small></p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.45rem' }}>
                      {frames.map((frame, index) => {
                        const selected = index === activeIndex;
                        const imageUrl = frame.thumbUrl || frame.cropUrl || frame.rawUrl;
                        return (
                          <button
                            key={`${frame.publicCode}-${frame.capturedAt}-${index}-sheet`}
                            type="button"
                            onClick={() => {
                              jumpTo(index);
                              setViewMode('frame');
                            }}
                            style={{
                              border: selected ? '2px solid #111' : '1px solid #777',
                              background: '#f7f7f7',
                              padding: '0.35rem',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                          >
                            <small>
                              {String(index + 1).padStart(4, '0')} | {frame.publicCode}
                            </small>
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={`Contact-sheet frame ${frame.publicCode}`}
                                style={{
                                  display: 'block',
                                  marginTop: '0.25rem',
                                  width: '100%',
                                  height: 'auto',
                                  filter: filterValue
                                }}
                              />
                            ) : (
                              <small>no image</small>
                            )}
                            <small style={{ display: 'block', marginTop: '0.25rem' }}>
                              {frame.capturedAt ? formatTmaydDateTime(frame.capturedAt) : 'unknown capture time'}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <p>
                  {activeFrame?.rawUrl ? (
                    <a href={activeFrame.rawUrl} target="_blank" rel="noreferrer">open raw frame</a>
                  ) : (
                    <small>raw frame unavailable</small>
                  )}{' '}
                  {activeFrame?.cropUrl ? (
                    <>
                      | <a href={activeFrame.cropUrl} target="_blank" rel="noreferrer">open crop frame</a>
                    </>
                  ) : null}{' '}
                  {activeFrame?.thumbUrl ? (
                    <>
                      | <a href={activeFrame.thumbUrl} target="_blank" rel="noreferrer">open thumb frame</a>
                    </>
                  ) : null}
                </p>
              </div>
            </>
          )}

          {(manifest.derived.contactSheetUrl || manifest.derived.stripUrls.length > 0 || manifest.derived.timelapseUrl) ? (
            <>
              <h3>Generated strip artifacts</h3>
              {manifest.derived.contactSheetUrl ? (
                <p>
                  <a href={manifest.derived.contactSheetUrl} target="_blank" rel="noreferrer">open contact sheet</a>
                </p>
              ) : null}
              {manifest.derived.contactSheetUrl ? (
                <p>
                  <img
                    src={manifest.derived.contactSheetUrl}
                    alt={`Contact sheet for reel ${manifest.reelId || manifest.date || selectedDate}.`}
                    style={{ width: '100%', maxWidth: '760px', height: 'auto' }}
                  />
                </p>
              ) : null}
              {manifest.derived.stripUrls.length > 0 ? (
                <ul>
                  {manifest.derived.stripUrls.map((url, index) => (
                    <li key={`${url}-${index}`}>
                      <a href={url} target="_blank" rel="noreferrer">strip {String(index + 1).padStart(4, '0')}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {manifest.derived.timelapseUrl ? (
                <p>
                  <a href={manifest.derived.timelapseUrl} target="_blank" rel="noreferrer">open timelapse</a>
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
