'use client';

import { useEffect, useRef, useState } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const EXAMPLE_QUESTIONS = [
  'Who do I know working in venture capital?',
  'What shared interests do people in my network have?',
  'Who introduced me to someone recently?',
];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: trimmed,
    };
    const assistantMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        const errMsg =
          (data as { error?: string }).error ??
          'Something went wrong. Please try again.';
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant')
            updated[updated.length - 1] = { ...last, content: errMsg };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + chunk,
            };
          }
          return updated;
        });
      }

      // Guard: surface error if stream closed with no content
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          updated[updated.length - 1] = {
            ...last,
            content: 'Something went wrong — please try again.',
          };
        }
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          updated[updated.length - 1] = {
            ...last,
            content: 'Network error. Please try again.',
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(input);
    }
  }

  const hasInput = input.trim().length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxWidth: 'var(--screen-max)',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Messages / empty state */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--gutter)' }}>
        {messages.length === 0 ? (
          /* Empty state */
          <div style={{ paddingTop: 56, paddingBottom: 24 }}>
            {/* Overline */}
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-mono)',
                color: 'var(--text-muted)',
                margin: '0 0 10px',
                textAlign: 'center',
              }}
            >
              Ask your network
            </p>

            {/* Title */}
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-h1)',
                fontWeight: 600,
                color: 'var(--text-strong)',
                letterSpacing: 'var(--tracking-tight)',
                lineHeight: 'var(--leading-tight)',
                textAlign: 'center',
                margin: '0 0 28px',
              }}
            >
              What are you looking for?
            </h1>

            {/* Suggested prompts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  disabled={isStreaming}
                  style={{
                    width: '100%',
                    background: 'var(--surface-card)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-xs)',
                    padding: '15px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: `background var(--dur-fast)`,
                    opacity: isStreaming ? 0.5 : 1,
                  }}
                >
                  {/* Terracotta dot */}
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--brand)',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-base)',
                      color: 'var(--text-body)',
                      lineHeight: 'var(--leading-snug)',
                    }}
                  >
                    {q}
                  </span>
                  {/* Chevron */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    style={{ color: 'var(--text-faint)', flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              paddingTop: 20,
              paddingBottom: 16,
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent:
                    msg.role === 'user' ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end',
                  gap: 10,
                }}
              >
                {/* Assistant avatar */}
                {msg.role === 'assistant' && (
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: 'var(--brand)',
                      color: 'var(--text-on-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {/* Sparkle icon */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </div>
                )}

                {/* Bubble / card */}
                {msg.role === 'user' ? (
                  <div
                    style={{
                      maxWidth: '85%',
                      background: 'var(--ink-900)',
                      color: 'var(--surface-card)',
                      borderRadius: '18px 18px 4px 18px',
                      padding: '11px 16px',
                      boxShadow: 'var(--shadow-sm)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-base)',
                      lineHeight: 'var(--leading-normal)',
                    }}
                  >
                    <span style={{ whiteSpace: 'pre-wrap' }}>
                      {msg.content}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      maxWidth: '85%',
                      background: 'var(--surface-card)',
                      borderRadius: 'var(--radius-lg)',
                      boxShadow: 'var(--shadow-md)',
                      border: '1px solid var(--border-subtle)',
                      padding: '14px 16px',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-base)',
                      color: 'var(--text-strong)',
                      lineHeight: 'var(--leading-normal)',
                    }}
                  >
                    {msg.content === '' ? (
                      /* Typing indicator — nvbounce animation from globals.css */
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 4,
                          alignItems: 'center',
                          height: 18,
                        }}
                      >
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--text-faint)',
                              display: 'inline-block',
                              animation: `nvbounce 1.2s ease-in-out ${i * 0.15}s infinite`,
                            }}
                          />
                        ))}
                      </span>
                    ) : (
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          flexShrink: 0,
          padding: `12px var(--gutter) calc(12px + env(safe-area-inset-bottom))`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 10,
            background: 'var(--surface-card)',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--radius-pill)',
            boxShadow: 'var(--shadow-md)',
            padding: '8px 8px 8px 18px',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your network…"
            rows={1}
            disabled={isStreaming}
            style={
              {
                flex: 1,
                border: 'none',
                background: 'transparent',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-strong)',
                resize: 'none',
                outline: 'none',
                maxHeight: 120,
                overflowY: 'auto',
                // 24px line + 8px top/bottom = 40px single-line height,
                // matching the send button so the placeholder sits centered.
                lineHeight: '24px',
                padding: '8px 0',
                opacity: isStreaming ? 0.6 : 1,
                fieldSizing: 'content',
              } as React.CSSProperties
            }
          />

          {/* Send button */}
          <button
            onClick={() => handleSubmit(input)}
            disabled={isStreaming || !hasInput}
            aria-label="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: 'none',
              background:
                hasInput && !isStreaming
                  ? 'var(--brand)'
                  : 'var(--surface-sunken)',
              color:
                hasInput && !isStreaming
                  ? 'var(--text-on-accent)'
                  : 'var(--text-faint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: hasInput && !isStreaming ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              transition: `background var(--dur-fast), color var(--dur-fast)`,
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              width={16}
              height={16}
              style={{ transform: 'rotate(90deg)' }}
              aria-hidden="true"
            >
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.065-.021L10 15.636l6.66 2.305.065.021a1 1 0 001.169-1.409l-7-14z" />
            </svg>
          </button>
        </div>

        <p
          style={{
            marginTop: 6,
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            color: 'var(--text-faint)',
          }}
        >
          Answers come only from your vault
        </p>
      </div>
    </div>
  );
}
