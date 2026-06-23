'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { LazyMotion, m, useReducedMotion } from 'motion/react';
import { usePostHog } from 'posthog-js/react';

// Lazy-load the DOM animation features so the core `m` runtime stays small.
const loadFeatures = () =>
  import('./motion-features').then((mod) => mod.default);

// ---------------------------------------------------------------------------
// Timing (precise sequence from the spec)
// ---------------------------------------------------------------------------
const HOLD_MS = 1000; // t=0 → 1s: no movement
const FLOAT_MS = 3000; // t=1s → 4s: fold + travel to centre
// Push to /network this many ms BEFORE the float ends, so the constellation is
// already mounting + fading in (see globals.css .nv-fade-in) as the node lands —
// the destination is present to receive it instead of hard-cutting in.
const PUSH_LEAD_MS = 900;
const SETTLE_MS = 250; // after arrival + navigation, before the overlay fades
const FADE_MS = 350; // overlay cross-fade hand-off to the canvas node

// person_capture_timing (#13) safety deadline. Armed when the node becomes
// visible: if processing completion is never observed (e.g. the user leaves
// /network before extraction finishes, so the poll stops), the event is still
// flushed this long after node-visible with ms_to_processing_complete = null —
// so the headline (ms_to_node_visible) is never lost.
const TIMING_SAFETY_MS = 60000;

// Final node size at centre (px). Matches the small constellation node scale.
const NODE_SIZE = 40;
const NAV_HEIGHT = 64; // var(--nav-height); the canvas area sits above the nav

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface StartArgs {
  /** Display name (used for the optimistic node; brand-neutral copy only). */
  name: string;
  /** Bounding rect of the submit control, captured at tap time (t=0). */
  originRect: DOMRect | null;
  /**
   * Resolves with the created person's id once POST /api/people returns.
   * If it rejects (validation / limit / network error) the animation cancels.
   */
  personIdPromise: Promise<string>;
}

interface CaptureContextValue {
  start: (args: StartArgs) => void;
  /**
   * Called by the constellation when the optimistic node for `personId`
   * actually mounts on the canvas (the real paint, in both motion paths — never
   * the overlay animation). Records the headline ms_to_node_visible delta.
   */
  markNodeVisible: (personId: string) => void;
  /**
   * Called by the constellation when processing for `personId` reaches a
   * terminal state — 'complete' is the client-observable mirror of the
   * server-side `processing_completed`; 'failed' resolves the delta as null.
   */
  markProcessingComplete: (
    personId: string,
    status: 'complete' | 'failed'
  ) => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

export function useCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) {
    throw new Error('useCapture must be used within <CaptureProvider>');
  }
  return ctx;
}

// Non-throwing accessor for components that only report timing milestones (e.g.
// the constellation). Returns null if rendered outside a CaptureProvider.
export function useCaptureTiming(): CaptureContextValue | null {
  return useContext(CaptureContext);
}

// ---------------------------------------------------------------------------
// Provider + overlay
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'hold' | 'float' | 'arrived' | 'fading';

interface NodeState {
  name: string;
  origin: { x: number; y: number };
  target: { x: number; y: number };
  initSize: { w: number; h: number };
}

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const posthog = usePostHog();
  const reduce = useReducedMotion();
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  // ── person_capture_timing (#13) ──────────────────────────────────────────
  // t=0 is submit (POST fired, top of start()). We record three ms deltas as
  // the milestones land and emit ONE person_capture_timing event:
  //   ms_to_post_response       — POST /api/people resolves
  //   ms_to_node_visible        — the optimistic node actually mounts on the
  //                               canvas (headline metric; real paint, both
  //                               motion paths — NOT the overlay animation)
  //   ms_to_processing_complete — processing reaches 'complete' for this person
  // The event flushes once both node-visible AND a terminal processing signal
  // are in (success → all three populated; failure/safety-deadline → null
  // processing). See TIMING_SAFETY_MS and docs §3 #13.
  const timingT0Ref = useRef<number | null>(null);
  const timingPersonRef = useRef<string | null>(null);
  const msToPostRef = useRef<number | null>(null);
  const msToNodeRef = useRef<number | null>(null);
  const msToProcRef = useRef<number | null>(null);
  const procResolvedRef = useRef(false);
  const timingSentRef = useRef(false);
  const timingDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nowMs = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const resetTiming = useCallback(() => {
    if (timingDeadlineRef.current) {
      clearTimeout(timingDeadlineRef.current);
      timingDeadlineRef.current = null;
    }
    timingT0Ref.current = null;
    timingPersonRef.current = null;
    msToPostRef.current = null;
    msToNodeRef.current = null;
    msToProcRef.current = null;
    procResolvedRef.current = false;
    timingSentRef.current = false;
  }, []);

  // Emit exactly once, only when the headline (node-visible) is known and a
  // terminal processing signal (complete / failed / deadline) has arrived.
  const flushTiming = useCallback(() => {
    if (timingSentRef.current) return;
    if (msToNodeRef.current == null) return; // headline required
    if (!procResolvedRef.current) return; // wait for processing or deadline
    timingSentRef.current = true;
    if (timingDeadlineRef.current) {
      clearTimeout(timingDeadlineRef.current);
      timingDeadlineRef.current = null;
    }
    // Client timing stays inside the window guard.
    if (typeof window !== 'undefined') {
      posthog?.capture('person_capture_timing', {
        person_id: timingPersonRef.current,
        ms_to_post_response: msToPostRef.current,
        ms_to_node_visible: msToNodeRef.current,
        ms_to_processing_complete: msToProcRef.current,
      });
    }
  }, [posthog]);

  const markNodeVisible = useCallback(
    (personId: string) => {
      if (timingT0Ref.current == null) return;
      if (timingPersonRef.current !== personId) return;
      if (msToNodeRef.current != null) return; // once
      msToNodeRef.current = Math.round(nowMs() - timingT0Ref.current);
      // Arm the safety deadline so the event still flushes if processing
      // completion is never observed.
      if (!timingDeadlineRef.current && !timingSentRef.current) {
        timingDeadlineRef.current = setTimeout(() => {
          procResolvedRef.current = true;
          flushTiming();
        }, TIMING_SAFETY_MS);
      }
      flushTiming();
    },
    [flushTiming]
  );

  const markProcessingComplete = useCallback(
    (personId: string, status: 'complete' | 'failed') => {
      if (timingT0Ref.current == null) return;
      if (timingPersonRef.current !== personId) return;
      if (procResolvedRef.current) return;
      procResolvedRef.current = true;
      msToProcRef.current =
        status === 'complete'
          ? Math.round(nowMs() - timingT0Ref.current)
          : null;
      flushTiming();
    },
    [flushTiming]
  );

  // Clear the safety deadline if the provider itself unmounts.
  useEffect(() => {
    return () => {
      if (timingDeadlineRef.current) clearTimeout(timingDeadlineRef.current);
    };
  }, []);

  const [phase, setPhase] = useState<Phase>('idle');
  const [node, setNode] = useState<NodeState | null>(null);
  const [navigated, setNavigated] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const personIdRef = useRef<string | null>(null);
  const floatStartedRef = useRef(false);
  // Opens shortly before the float ends; gates the push so the route changes
  // during the float's tail (overlapping the destination's fade-in) rather than
  // at float start. Under reduced motion the gate is bypassed.
  const navGateRef = useRef(false);
  const navigatedRef = useRef(false);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    personIdRef.current = null;
    floatStartedRef.current = false;
    navGateRef.current = false;
    navigatedRef.current = false;
    setNavigated(false);
    setPhase('idle');
    setNode(null);
  }, []);

  // Navigate exactly once, and never without a resolved person id. Under
  // reduced motion we go as soon as the id lands; otherwise we wait until the
  // nav gate opens (near the end of the float) so the route changes during the
  // float's tail and the destination fades in to receive the node.
  const navigate = useCallback(() => {
    if (navigatedRef.current) return;
    if (!personIdRef.current) return;
    if (!reduceRef.current && !navGateRef.current) return;
    navigatedRef.current = true;
    setNavigated(true);
    router.push(`/network?new=${personIdRef.current}`);
  }, [router]);

  // Fade the overlay only after the node has arrived at centre *and* the route
  // has been pushed — then unmount. This is the centre-to-centre hand-off: the
  // constellation spawns its own node at centre while this one fades out.
  useEffect(() => {
    if (phase === 'arrived' && navigated) {
      const t = setTimeout(() => setPhase('fading'), SETTLE_MS);
      timers.current.push(t);
      return () => clearTimeout(t);
    }
    if (phase === 'fading') {
      const t = setTimeout(reset, FADE_MS + 50);
      timers.current.push(t);
      return () => clearTimeout(t);
    }
  }, [phase, navigated, reset]);

  const start = useCallback(
    ({ name, originRect, personIdPromise }: StartArgs) => {
      reset();
      navigatedRef.current = false;
      floatStartedRef.current = false;
      navGateRef.current = false;
      personIdRef.current = null;

      // t=0 for #13 — the POST has just fired (the form builds personIdPromise,
      // which kicks off the fetch, immediately before calling start()).
      resetTiming();
      timingT0Ref.current = nowMs();

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const origin = {
        x: originRect ? originRect.left + originRect.width / 2 : vw / 2,
        y: originRect ? originRect.top + originRect.height / 2 : vh / 2,
      };
      // Centre of the canvas area (viewport minus the fixed bottom nav).
      const target = { x: vw / 2, y: (vh - NAV_HEIGHT) / 2 };
      const initSize = {
        w: originRect ? clamp(originRect.width, 120, 260) : 160,
        h: originRect ? clamp(originRect.height, 40, 72) : 52,
      };

      setNode({ name, origin, target, initSize });

      // Both the form (for error UX) and this provider observe the same promise.
      personIdPromise
        .then((id) => {
          personIdRef.current = id;
          // #13: POST resolved — record the response delta and bind the timing
          // to this person so the constellation milestones match.
          if (timingT0Ref.current != null) {
            timingPersonRef.current = id;
            msToPostRef.current = Math.round(nowMs() - timingT0Ref.current);
          }
          navigate();
        })
        .catch(() => {
          // POST failed — cancel the float; the form surfaces the error. Abandon
          // this capture's timing (no node will mount, nothing to report).
          resetTiming();
          reset();
        });

      // Reduced motion: no float. Hold a (non-animated) centre node until the
      // id resolves, then navigate; the constellation handles the pulse.
      if (reduceRef.current) {
        setPhase('arrived');
        return;
      }

      setPhase('hold');
      const t1 = setTimeout(() => {
        floatStartedRef.current = true;
        setPhase('float');
        // Open the nav gate near the end of the float so the push (and the
        // destination's fade-in) overlaps the float's tail.
        const tPush = setTimeout(() => {
          navGateRef.current = true;
          navigate(); // push now if the id is ready; else navigate() on resolve
        }, FLOAT_MS - PUSH_LEAD_MS);
        const t2 = setTimeout(() => setPhase('arrived'), FLOAT_MS);
        timers.current.push(tPush, t2);
      }, HOLD_MS);
      timers.current.push(t1);
    },
    [navigate, reset, resetTiming]
  );

  // Per-phase animation target. borderRadius stays a percentage end-to-end so
  // it interpolates cleanly (rounded card → circle).
  const animate = (() => {
    if (!node) return undefined;
    const { origin, target, initSize } = node;
    switch (phase) {
      case 'hold':
        return {
          left: origin.x,
          top: origin.y,
          width: initSize.w,
          height: initSize.h,
          borderRadius: '18%',
          opacity: 1,
        };
      case 'float':
        return {
          left: target.x,
          top: target.y,
          width: NODE_SIZE,
          height: NODE_SIZE,
          borderRadius: '50%',
          opacity: 1,
        };
      case 'arrived':
        return {
          left: target.x,
          top: target.y,
          width: [NODE_SIZE, NODE_SIZE * 1.18, NODE_SIZE],
          height: [NODE_SIZE, NODE_SIZE * 1.18, NODE_SIZE],
          borderRadius: '50%',
          opacity: 1,
        };
      case 'fading':
        return {
          left: target.x,
          top: target.y,
          width: NODE_SIZE,
          height: NODE_SIZE,
          borderRadius: '50%',
          opacity: 0,
        };
      default:
        return undefined;
    }
  })();

  const transition = (() => {
    switch (phase) {
      case 'float':
        return { duration: FLOAT_MS / 1000, ease: [0.22, 1, 0.36, 1] as const };
      case 'arrived':
        return {
          width: {
            duration: 1.4,
            repeat: Infinity,
            ease: 'easeInOut' as const,
          },
          height: {
            duration: 1.4,
            repeat: Infinity,
            ease: 'easeInOut' as const,
          },
          left: { duration: 0.3 },
          top: { duration: 0.3 },
        };
      case 'fading':
        return { duration: FADE_MS / 1000 };
      default:
        return { duration: 0.3 };
    }
  })();

  const showNode = node && phase !== 'idle' && !reduce;

  // Stable identity so timing consumers (constellation) don't re-run their
  // milestone effects on every animation-phase re-render of this provider.
  const contextValue = useMemo(
    () => ({ start, markNodeVisible, markProcessingComplete }),
    [start, markNodeVisible, markProcessingComplete]
  );

  return (
    <CaptureContext.Provider value={contextValue}>
      {children}
      <LazyMotion features={loadFeatures} strict>
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            pointerEvents: 'none',
          }}
        >
          {showNode && node && (
            <m.div
              initial={{
                left: node.origin.x,
                top: node.origin.y,
                width: node.initSize.w,
                height: node.initSize.h,
                borderRadius: '18%',
                opacity: 0,
              }}
              animate={animate}
              transition={transition}
              style={{
                position: 'absolute',
                transform: 'translate(-50%, -50%)',
                background: 'var(--brand)',
                boxShadow: 'var(--shadow-md), var(--glow-brand)',
              }}
            />
          )}
        </div>
      </LazyMotion>
    </CaptureContext.Provider>
  );
}
