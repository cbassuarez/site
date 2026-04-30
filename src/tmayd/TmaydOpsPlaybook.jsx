export default function TmaydOpsPlaybook() {
  return (
    <section>
      <h2>Public ops / playbook</h2>

      <details>
        <summary>How the machine works</summary>
        <p>
          The public website submits messages to an API. The website does not talk directly to the printer.
          A local bridge polls the API for accepted print jobs.
        </p>
      </details>

      <details>
        <summary>What gets printed</summary>
        <p>
          Only accepted messages are queued and printed. Accepted messages may be photographed and included in public archive views.
        </p>
      </details>

      <details>
        <summary>What gets rejected</summary>
        <p>
          Messages that include disallowed or identifying content can be rejected by deterministic filters and moderation checks.
          Screening may include Bedrock/guardrails in the backend pipeline.
        </p>
      </details>

      <details>
        <summary>What is retained</summary>
        <p>
          Accepted message records, print-job state, and camera-gate capture metadata can be retained for operation and archive display.
        </p>
      </details>

      <details>
        <summary>What is not retained</summary>
        <p>
          Rejected raw submissions are not intended to be retained as durable records.
        </p>
      </details>

      <details>
        <summary>What happens when the machine is offline</summary>
        <p>
          Public status may show offline/inactive. Submission intake can be paused. Archive and reel browsing may still show previously captured paper frames.
        </p>
      </details>

      <details>
        <summary>Physical archive / gravity well</summary>
        <p>
          Paper passes through a fixed camera gate and drops into a transparent gravity well. The public archive prioritizes these paper images.
        </p>
      </details>

      <details>
        <summary>Bedrock moderation role</summary>
        <p>
          Bedrock/guardrails may be used as a screening component. The backend moderation decision pipeline remains authoritative.
        </p>
      </details>

      <details>
        <summary>Machine-readable code / rMQR</summary>
        <p>
          Machine-readable codes should encode public lookup metadata only. Hidden or private content is not intended for encoded output.
        </p>
      </details>
    </section>
  );
}
