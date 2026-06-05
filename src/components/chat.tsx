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

  // Scroll to bottom whenever messages change or streaming updates
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
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: errMsg };
          }
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

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          /* Empty state — example questions */
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 text-center">
              Try asking
            </p>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => handleSubmit(q)}
                disabled={isStreaming}
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 transition-colors disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white border border-zinc-100 text-zinc-800'
                }`}
              >
                {msg.content === '' && msg.role === 'assistant' ? (
                  /* Streaming indicator */
                  <span className="inline-flex gap-1 items-center h-4">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" />
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-zinc-100 bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your network…"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={() => handleSubmit(input)}
            disabled={isStreaming || input.trim() === ''}
            aria-label="Send"
            className="shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 rotate-90"
            >
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.065-.021L10 15.636l6.66 2.305.065.021a1 1 0 001.169-1.409l-7-14z" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-zinc-400">
          Answers come only from your vault
        </p>
      </div>
    </div>
  );
}
