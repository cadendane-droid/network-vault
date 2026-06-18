'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { LazyMotion, m, useReducedMotion } from 'motion/react';

// Lazy-load the DOM animation features so the core `m` runtime stays small.
const loadFeatures = () =>
  import('./motion-features').then((mod) => mod.default);

// ---------------------------------------------------------------------------
// Timing (precise sequence from the spec)
// ---------------------------------------------------------------------------
const HOLD_MS = 1000; // t=0 → 1s: no movement
const FLOAT_MS = 3000; // t=1s → 4s: fold + travel to centre
const SETTLE_MS = 350; // after arrival + navigation, before the overlay fades
const FADE_MS = 350; // overlay cross-fade hand-off to the canvas node

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
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

export function useCapture(): CaptureContextValue {
  const ctx = useContext(CaptureContext);
  if (!ctx) {
    throw new Error('useCapture must be used within <CaptureProvider>');
  }
  return ctx;
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
  const reduce = useReducedMotion();
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [node, setNode] = useState<NodeState | null>(null);
  const [navigated, setNavigated] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const personIdRef = useRef<string | null>(null);
  const floatStartedRef = useRef(false);
  const navigatedRef = useRef(false);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    personIdRef.current = null;
    floatStartedRef.current = false;
    navigatedRef.current = false;
    setNavigated(false);
    setPhase('idle');
    setNode(null);
  }, []);

  // Navigate exactly once, and never without a resolved person id. Under
  // reduced motion we go as soon as the id lands; otherwise we wait until the
  // float has begun so the route transition happens behind the moving node.
  const navigate = useCallback(() => {
    if (navigatedRef.current) return;
    if (!personIdRef.current) return;
    if (!reduceRef.current && !floatStartedRef.current) return;
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
      personIdRef.current = null;

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
          navigate();
        })
        .catch(() => {
          // POST failed — cancel the float; the form surfaces the error.
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
        navigate(); // go now if the id already landed during the hold
        const t2 = setTimeout(() => setPhase('arrived'), FLOAT_MS);
        timers.current.push(t2);
      }, HOLD_MS);
      timers.current.push(t1);
    },
    [navigate, reset]
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

  return (
    <CaptureContext.Provider value={{ start }}>
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
