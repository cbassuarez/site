import { useEffect, useState } from 'react';
import TmaydLiveFrame from './TmaydLiveFrame';
import TmaydOpsPlaybook from './TmaydOpsPlaybook';
import TmaydReelViewer from './TmaydReelViewer';
import TmaydStatusPanel from './TmaydStatusPanel';
import TmaydSubmissionForm from './TmaydSubmissionForm';
import { fetchTmaydStatus } from './tmaydApi';
import { isValidArchiveDate } from './tmaydUtils';

const BASE_ROUTE = '/labs/tell-me-about-your-day';

function parseRoute(pathname) {
  const result = {
    initialDate: '',
    highlightPublicCode: '',
    notice: ''
  };

  if (!pathname.startsWith(BASE_ROUTE)) {
    return result;
  }

  if (pathname === BASE_ROUTE || pathname === `${BASE_ROUTE}/`) {
    return result;
  }

  const reelMatch = pathname.match(/^\/labs\/tell-me-about-your-day\/reel\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (reelMatch) {
    const date = reelMatch[1];
    if (isValidArchiveDate(date)) {
      result.initialDate = date;
    } else {
      result.notice = 'Requested reel date is invalid. Showing main archive view.';
    }
    return result;
  }

  const dayMatch = pathname.match(/^\/labs\/tell-me-about-your-day\/day\/(DAY-\d{8}-\d{4})\/?$/);
  if (dayMatch) {
    const code = dayMatch[1];
    result.highlightPublicCode = code;
    const m = code.match(/^DAY-(\d{4})(\d{2})(\d{2})-\d{4}$/);
    if (m) {
      result.initialDate = `${m[1]}-${m[2]}-${m[3]}`;
    }
    return result;
  }

  result.notice = 'Requested TMAYD subroute is not available yet. Showing main route.';
  return result;
}

export default function TmaydLabsPage({ pathname }) {
  const routeState = parseRoute(pathname || BASE_ROUTE);
  const [status, setStatus] = useState({
    status: 'inactive',
    intakeOpen: false,
    printingOpen: false,
    archiveOpen: true,
    lastHeartbeatAt: '',
    message: ''
  });
  const [statusIsMock, setStatusIsMock] = useState(false);
  const [statusError, setStatusError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const tick = async () => {
      const result = await fetchTmaydStatus();
      if (cancelled) {
        return;
      }

      setStatus(result.data);
      setStatusIsMock(Boolean(result.mock));
      setStatusError(result.ok ? null : result.errorKind || 'unknown');

      const delay = document.visibilityState === 'hidden' ? 90000 : 30000;
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

  return (
    <>
      <center>
        <h1>cbassuarez.com</h1>
        <p>
          <i>labs / tell me about your day</i>
        </p>
        <p>
          [ <a href="/">home</a> ] [ <a href="/works">works</a> ] [ <a href="/labs/feed">feed</a> ] [ <a href="/labs/guestbook">guestbook</a> ] [ <a href="/about">about</a> ] [ <a href="/contact">contact</a> ]
        </p>
      </center>

      <hr />

      <h2>Project description</h2>
      <p>
        Tell Me About Your Day is a public text intake and thermal-paper archive.
        Messages submitted here may be screened, printed by a local thermal printer,
        photographed as they pass through a small camera gate, and accumulated as a physical strip inside the apparatus.
        The archive below is built from the machine&apos;s paper images, not only from database text.
      </p>

      <p>
        <strong>Public warning:</strong> This is a public artwork, not a private diary.
        Do not submit emergencies, threats, confessions, allegations, names, addresses, phone numbers,
        legal claims, medical details, or private information.
      </p>
      <p>
        Accepted messages may be physically printed, photographed, archived, displayed online,
        livestreamed as still frames, or exhibited. Rejected raw submissions are not intended to be retained.
      </p>

      {routeState.notice ? <p><small>{routeState.notice}</small></p> : null}

      <hr />

      <TmaydStatusPanel status={status} isMock={statusIsMock} errorKind={statusError} />

      <hr />

      <TmaydLiveFrame />

      <hr />

      <TmaydSubmissionForm intakeOpen={Boolean(status?.intakeOpen)} statusMessage={status?.message || ''} />

      <hr />

      <TmaydOpsPlaybook />

      <hr />

      <TmaydReelViewer initialDate={routeState.initialDate} highlightPublicCode={routeState.highlightPublicCode} />
    </>
  );
}
