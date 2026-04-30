import { useEffect, useMemo, useState } from 'react';
import { fetchReelByDate, fetchTodayReel } from './tmaydApi';
import { formatTmaydDateTime, isValidArchiveDate } from './tmaydUtils';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
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

export default function TmaydReelViewer({ initialDate = '', highlightPublicCode = '' }) {
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

  function handleDateSubmit(event) {
    event.preventDefault();
    if (!isValidArchiveDate(inputDate)) {
      return;
    }
    setSelectedDate(inputDate);
  }

  const frames = manifest?.frames || [];

  const highlightedExists = useMemo(() => {
    if (!highlightPublicCode) {
      return false;
    }
    return frames.some((frame) => frame.publicCode === highlightPublicCode);
  }, [frames, highlightPublicCode]);

  return (
    <section>
      <h2>Microfiche / film reel viewer</h2>

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
            date: <strong>{manifest.date || selectedDate}</strong> | reel: <strong>{manifest.reelId || 'unknown'}</strong>
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
            <div>
              {frames.map((frame) => {
                const active = highlightPublicCode && frame.publicCode === highlightPublicCode;
                const imageUrl = frame.cropUrl || frame.thumbUrl;
                return (
                  <article key={`${frame.publicCode}-${frame.capturedAt}`} style={{
                    border: active ? '2px solid #111' : '1px solid #999',
                    padding: '0.6rem',
                    marginBottom: '0.8rem'
                  }}>
                    <p>
                      <strong>{frame.publicCode}</strong>
                      {active ? ' (requested artifact)' : ''}
                      <br />
                      captured: {frame.capturedAt ? formatTmaydDateTime(frame.capturedAt) : 'unknown'}
                    </p>
                    {imageUrl ? (
                      <p>
                        <img
                          src={imageUrl}
                          alt={`Thermal paper capture ${frame.publicCode}.`}
                          style={{ width: '100%', maxWidth: '640px', height: 'auto' }}
                        />
                      </p>
                    ) : (
                      <p>no frame image available.</p>
                    )}
                    <p>
                      {frame.rawUrl ? (
                        <a href={frame.rawUrl} target="_blank" rel="noreferrer">open raw frame</a>
                      ) : (
                        <small>raw frame unavailable</small>
                      )}
                    </p>
                  </article>
                );
              })}
            </div>
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
