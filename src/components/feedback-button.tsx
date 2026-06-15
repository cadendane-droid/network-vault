'use client';

import { useEffect, useRef, useState } from 'react';

const MESSAGE_LIMIT = 2000;

type Phase = 'idle' | 'submitting' | 'success' | 'error';

// Lower-left feedback pill, rendered only on the network page. Opens a
// bottom-sheet modal (same pattern as the constellation node sheet) with a
// textarea posting to /api/feedback.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus when the sheet opens.
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // The sheet is pinned to the bottom of the layout viewport, which doesn't
  // shrink when the mobile keyboard opens — so the keyboard would cover the
  // Send button. Track how much of the viewport bottom the keyboard occupies
  // (via visualViewport) and lift the sheet by that amount.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPhase('idle');
    setErrorMsg(null);
    setMessage('');
    setKeyboardInset(0);
  }

  async function handleSubmit() {
    const trimmed = message.trim();
    if (trimmed === '' || phase === 'submitting') return;

    setPhase('submitting');
    setErrorMsg(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          page: 'network',
          user_agent: navigator.userAgent,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setErrorMsg(
          data.message ?? data.error ?? 'Something went wrong. Please retry.'
        );
        setPhase('error');
        return;
      }

      setPhase('success');
      setTimeout(close, 1400);
    } catch {
      setErrorMsg('Network error. Please retry.');
      setPhase('error');
    }
  }

  return (
    <>
      {/* Pill — fixed lower-left, clear of the bottom nav */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        style={{
          position: 'fixed',
          left: 16,
          bottom:
            'calc(var(--nav-height) + 16px + env(safe-area-inset-bottom))',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: 'var(--brand)',
          color: 'var(--text-on-accent)',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          padding: '10px 16px',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: 'var(--shadow-md), var(--glow-brand)',
          transition: `background var(--dur-fast)`,
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-2.347-.314c-.823.566-2.063 1.18-3.653 1.314.5-.66.876-1.498 1.04-2.404C3.783 14.36 2 12.34 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z"
            clipRule="evenodd"
          />
        </svg>
        Feedback
      </button>

      {/* Modal — backdrop + bottom sheet (constellation sheet pattern) */}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-end',
          }}
          onClick={close}
        >
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
            }}
          />

          {/* Sheet */}
          <div
            role="dialog"
            aria-label="Send feedback"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 'var(--screen-max)',
              margin: '0 auto',
              background: 'var(--night-800)',
              borderRadius: '22px 22px 0 0',
              padding:
                '16px 20px calc(var(--nav-height) + 28px + env(safe-area-inset-bottom))',
              boxShadow: 'var(--shadow-lg)',
              transform: `translateY(${-keyboardInset}px)`,
              transition: 'transform var(--dur-fast)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--night-600)',
                margin: '0 auto 16px',
              }}
            />

            {phase === 'success' ? (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 500,
                  color: 'var(--text-on-night)',
                  textAlign: 'center',
                  margin: '24px 0 32px',
                }}
              >
                Thanks — got it.
              </p>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <h2
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--text-h3)',
                      fontWeight: 600,
                      color: 'var(--text-on-night)',
                      margin: 0,
                    }}
                  >
                    Feedback
                  </h2>
                  <button
                    onClick={close}
                    aria-label="Close"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'var(--night-700)',
                      color: 'var(--star-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      width={14}
                      height={14}
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>

                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MESSAGE_LIMIT}
                  rows={4}
                  placeholder="What's working? What's confusing? What's missing?"
                  disabled={phase === 'submitting'}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'var(--night-700)',
                    border: '1px solid var(--night-600)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '12px 14px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-base)',
                    color: 'var(--text-on-night)',
                    lineHeight: 'var(--leading-normal)',
                    resize: 'none',
                    outline: 'none',
                    marginBottom: 12,
                  }}
                />

                {phase === 'error' && errorMsg && (
                  <p
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--berry-300)',
                      margin: '0 0 12px',
                    }}
                  >
                    {errorMsg}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={phase === 'submitting' || message.trim() === ''}
                  style={{
                    display: 'block',
                    width: '100%',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--brand)',
                    border: 'none',
                    padding: '12px 0',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: 'var(--text-on-accent)',
                    cursor:
                      phase === 'submitting' || message.trim() === ''
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      phase === 'submitting' || message.trim() === '' ? 0.5 : 1,
                    boxShadow: 'var(--shadow-sm), var(--glow-brand)',
                  }}
                >
                  {phase === 'submitting'
                    ? 'Sending…'
                    : phase === 'error'
                      ? 'Try again'
                      : 'Send'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
