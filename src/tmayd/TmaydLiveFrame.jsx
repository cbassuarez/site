import { useEffect, useMemo, useState } from 'react';
import { fetchLiveFrame } from './tmaydApi';
import { buildCacheBustedUrl, formatTmaydDateTime, safeStatusLabel } from './tmaydUtils';

function pollIntervalForStatus(status) {
  switch (status) {
    case 'printing':
    case 'capturing':
      return 12000;
    case 'idle':
      return 30000;
    case 'reset_required':
      return 45000;
    case 'inactive':
    case 'offline':
    case 'maintenance':
    default:
      return 60000;
  }
}

export default function TmaydLiveFrame() {
  const [frame, setFrame] = useState({
    status: 'inactive',
    imageUrl: '',
    observedAt: '',
    width: 0,
    height: 0,
    caption: ''
  });
  const [isMock, setIsMock] = useState(false);
  const [errorKind, setErrorKind] = useState(null);
  const [cacheToken, setCacheToken] = useState('0');

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const tick = async () => {
      const result = await fetchLiveFrame();
      if (cancelled) {
        return;
      }

      setFrame(result.data);
      setIsMock(Boolean(result.mock));
      setErrorKind(result.ok ? null : result.errorKind || 'unknown');
      setCacheToken(String(Date.now()));

      const baseDelay = pollIntervalForStatus(result.data?.status);
      const delay = document.visibilityState === 'hidden' ? Math.max(baseDelay, 90000) : baseDelay;
      timerId = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const shouldShowOffline = useMemo(() => {
    const status = frame?.status || 'inactive';
    return !frame?.imageUrl || status === 'inactive' || status === 'offline' || status === 'maintenance';
  }, [frame]);

  return (
    <section>
      <h2>Slow live frame</h2>
      <p>
        live state: <strong>{safeStatusLabel(frame.status)}</strong>
      </p>
      {frame?.observedAt ? <p>observed: {formatTmaydDateTime(frame.observedAt)}</p> : null}
      {isMock ? <p><small>mock/offline preview mode</small></p> : null}
      {errorKind ? <p><small>live frame source error: {errorKind}</small></p> : null}

      {shouldShowOffline ? (
        <>
          <p>The apparatus is not currently live.</p>
          <p>The archive will begin when the machine is activated.</p>
        </>
      ) : (
        <figure>
          <img
            src={buildCacheBustedUrl(frame.imageUrl, cacheToken)}
            alt="Current camera-gate frame from the Tell Me About Your Day apparatus."
            style={{ width: '100%', maxWidth: '920px', height: 'auto', border: '1px solid #888' }}
          />
          <figcaption>{frame.caption || 'Public camera-gate frame.'}</figcaption>
        </figure>
      )}
    </section>
  );
}
