import { useMemo, useState } from 'react';
import { submitTmaydMessage } from './tmaydApi';

const MAX_CHARS = 700;
const MIN_CHARS = 3;
const URL_PATTERN = /(https?:\/\/|www\.)/i;

export default function TmaydSubmissionForm({ intakeOpen = true, statusMessage = '' }) {
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState({ tone: 'neutral', message: '' });

  const charsUsed = text.length;

  const validationError = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length < MIN_CHARS) {
      return `Please enter at least ${MIN_CHARS} characters.`;
    }
    if (trimmed.length > MAX_CHARS) {
      return `Please keep your message to ${MAX_CHARS} characters or fewer.`;
    }
    if (URL_PATTERN.test(trimmed)) {
      return 'Please remove URLs and submit plain text only.';
    }
    return null;
  }, [text]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = text.trim();

    if (trimmed.length < MIN_CHARS) {
      setResult({ tone: 'error', message: `Please enter at least ${MIN_CHARS} characters.` });
      return;
    }
    if (trimmed.length > MAX_CHARS) {
      setResult({ tone: 'error', message: `Please keep your message to ${MAX_CHARS} characters or fewer.` });
      return;
    }
    if (URL_PATTERN.test(trimmed)) {
      setResult({ tone: 'error', message: 'Please remove URLs and submit plain text only.' });
      return;
    }
    if (!consent) {
      setResult({ tone: 'error', message: 'Consent is required before submission.' });
      return;
    }

    setPending(true);
    setResult({ tone: 'neutral', message: 'Sending...' });

    try {
      const response = await submitTmaydMessage({ text: trimmed, consent: true });

      if (response.status === 'accepted') {
        const codeSuffix = response.publicCode ? ` (${response.publicCode})` : '';
        setResult({ tone: 'success', message: `${response.message || 'Your message entered the print queue.'}${codeSuffix}` });
        setText('');
        setConsent(false);
        return;
      }

      if (response.status === 'rejected' && response.kind === 'soft') {
        setResult({
          tone: 'error',
          message: response.message || 'This message includes identifying information. Please submit a non-identifying version.'
        });
        return;
      }

      if (response.status === 'rejected') {
        setResult({
          tone: 'error',
          message: response.message || 'This message cannot be accepted. Please submit a non-identifying reflection about your day.'
        });
        return;
      }

      if (response.status === 'rate_limited') {
        setResult({ tone: 'error', message: response.message || 'Too many submissions. Please try again later.' });
        return;
      }

      setResult({
        tone: 'error',
        message: response.message || 'The machine is temporarily not accepting messages. Please try again later.'
      });
    } catch {
      setResult({ tone: 'error', message: 'The machine is temporarily not accepting messages. Please try again later.' });
    } finally {
      setPending(false);
    }
  }

  const formDisabled = pending || !intakeOpen;

  return (
    <section>
      <h2>Submission form</h2>
      <p>
        Write a small public trace of your day. Do not submit emergencies, threats, confessions, allegations,
        names, addresses, phone numbers, legal claims, medical details, or private information. This is an artwork,
        not a private diary or reporting channel.
      </p>
      {!intakeOpen ? (
        <p>
          <strong>Intake currently closed.</strong> {statusMessage || 'The machine is not currently accepting messages.'}
        </p>
      ) : null}
      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="tmayd-message">Message</label>
          <br />
          <textarea
            id="tmayd-message"
            name="message"
            rows="8"
            cols="64"
            maxLength={MAX_CHARS}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={formDisabled}
            required
          />
        </p>
        <p>
          <small>{charsUsed} / {MAX_CHARS}</small>
        </p>
        {validationError ? <p><small>{validationError}</small></p> : null}
        <p>
          <label htmlFor="tmayd-consent">
            <input
              id="tmayd-consent"
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={formDisabled}
              required
            />{' '}
            I consent to public archival display if accepted.
          </label>
        </p>
        <p>
          <button type="submit" disabled={formDisabled}>
            {pending ? 'sending...' : 'send to the machine'}
          </button>
        </p>
      </form>
      {result.message ? (
        <p role="status">
          <strong>{result.tone === 'success' ? 'status: accepted' : result.tone === 'error' ? 'status: notice' : 'status:'}</strong>{' '}
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
