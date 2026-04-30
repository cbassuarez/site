import { formatTmaydDateTime, safeStatusLabel } from './tmaydUtils';

export default function TmaydStatusPanel({ status, isMock = false, errorKind = null }) {
  const intakeLabel = status?.intakeOpen ? 'open' : 'closed';
  const printLabel = status?.printingOpen ? 'open' : 'closed';
  const archiveLabel = status?.archiveOpen ? 'open' : 'closed';

  return (
    <section>
      <h2>Machine status</h2>
      <p>
        state: <strong>{safeStatusLabel(status?.status)}</strong>
      </p>
      <p>
        intake: {intakeLabel} | print path: {printLabel} | archive: {archiveLabel}
      </p>
      <p>
        last heartbeat: {status?.lastHeartbeatAt ? formatTmaydDateTime(status.lastHeartbeatAt) : 'unknown'}
      </p>
      {status?.message ? <p>{status.message}</p> : null}
      {isMock ? <p><small>mock/offline preview mode</small></p> : null}
      {errorKind ? <p><small>status source error: {errorKind}</small></p> : null}
    </section>
  );
}
