'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePostHog } from 'posthog-js/react';

// Dynamic import required — react-force-graph-2d accesses window, canvas, and
// requestAnimationFrame at module load time.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => null,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  name: string;
  factCount: number;
  hasConfirmedFacts: boolean;
  role: string | null;
  org: string | null;
  // Simulation fields managed by react-force-graph (x/y) plus the pin (fx/fy)
  // and velocity (vx/vy) we set/preserve for the new-node hand-off.
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  vx?: number;
  vy?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationship_type: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Design tokens — hex/rgba equivalents for canvas context (no CSS vars there)
// ---------------------------------------------------------------------------

// night-900 oklch(0.205 0.022 322) ≈ #211826
const BG_NIGHT = '#211826';

// Five palette colors for nodes
// bright (-500 tones): terracotta, amber, sage, berry, plum
const NODE_BRIGHT = [
  '#B85030',
  '#D4A01A',
  '#5A9970',
  '#B84860',
  '#8060A0',
] as const;
// dim (-300 tones): for raw-only nodes
const NODE_DIM = [
  '#D4907A',
  '#E0C070',
  '#8ABE98',
  '#D490A0',
  '#B09AC8',
] as const;

// star-dim oklch(0.720 0.030 80) ≈ #C9B88A
// night-600 oklch(0.420 0.032 316) ≈ #554068
const EDGE_CONFIRMED = 'rgba(201, 184, 138, 0.6)'; // star-dim @ 60%
const EDGE_INFERRED = 'rgba(85, 64, 104, 0.8)'; // night-600 @ 80%
const LABEL_COLOR = '#C9B88A'; // star-dim

// Assign a palette index by name hash (same algorithm as person-card.tsx)
function paletteIdx(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 5;
}

// Stable key for an edge across both wire shape (string ids) and the post-
// simulation shape (react-force-graph mutates source/target into node objects).
function edgeKey(link: GraphLink): string {
  const s = typeof link.source === 'string' ? link.source : link.source.id;
  const t = typeof link.target === 'string' ? link.target : link.target.id;
  return `${s}|${t}|${link.relationship_type}`;
}

const isTerminal = (s: string) => s === 'complete' || s === 'failed';

const nowMs = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

// ── New-node animation tuning knobs (see docs/handoff.md §14) ───────────────
// Keep the new node pinned at centre until the capture overlay has finished its
// hand-off, THEN release it to travel. Must be ≥ capture-animation's
// (PUSH_LEAD_MS + FADE_MS) so the canvas node doesn't move while the DOM
// overlay node is still fading onto it.
const HANDOFF_HOLD_MS = 1200;
// Edge draw-in: each new edge grows from the new node over DRAW_MS, staggered.
const DRAW_MS = 750;
const STAGGER_MS = 120;
// Gentle settle: raise friction (velocityDecay) during the release/edge reheat
// so the node eases to rest instead of snapping, then restore the base value.
const BASE_VELOCITY_DECAY = 0.2; // matches the prior physics
const SETTLE_VELOCITY_DECAY = 0.45;
const SETTLE_COOL_MS = 1500;

// easeOutCubic — used for edge draw-progress.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onNodeClick?: (personId: string) => void;
  /**
   * Person id arriving via /network?new=<id> from the capture animation. That
   * node is spawned pinned at canvas centre with a pulsing halo; we poll its
   * processing status and animate its edges in once extraction completes.
   */
  newPersonId?: string | null;
}

export default function Constellation({ onNodeClick, newPersonId }: Props) {
  const posthog = usePostHog();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // ── New-node lifecycle (capture animation hand-off) ──────────────────────
  const [newStatus, setNewStatus] = useState<string | null>(
    newPersonId ? 'processing' : null
  );
  const [retrying, setRetrying] = useState(false);
  // Friction is raised transiently during the release/edge-arrival reheats so
  // the new node eases into place (a tuning knob, driven as a prop).
  const [velocityDecay, setVelocityDecay] = useState(BASE_VELOCITY_DECAY);
  // Edges added by the post-completion refetch + when the draw started + each
  // edge's stagger offset — read by linkCanvasObject to grow them in.
  const newEdgeKeys = useRef<Set<string>>(new Set());
  const edgeStagger = useRef<Map<string, number>>(new Map());
  const edgeAnimStart = useRef<number>(0);
  // Live mirror of nodes for timers/rAF that run outside the render cycle.
  const nodesRef = useRef<GraphNode[]>([]);
  const coolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wrapper for the pulsing halo + caption; positioned each frame onto the
  // new node's screen coords so the affordance follows it as it travels.
  const affordanceRef = useRef<HTMLDivElement>(null);
  // prefers-reduced-motion — skips travel + edge growth (edges appear whole).
  const [reduceMotion, setReduceMotion] = useState(false);
  const reduceMotionRef = useRef(false);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDimensions({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Apply link spring strength and distance via d3Force (not typed direct props)
  useEffect(() => {
    const link = fgRef.current?.d3Force('link');
    if (!link) return;
    link.strength(0.7);
    link.distance(60);
  }, []);

  // Fetch graph data
  useEffect(() => {
    fetch('/api/graph')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load graph');
        return res.json() as Promise<{
          nodes: GraphNode[];
          edges: GraphLink[];
        }>;
      })
      .then(({ nodes: n, edges: e }) => {
        // Pin the freshly-added node at the graph origin (0,0) so it lands at
        // canvas centre, matching where the capture overlay node fades out.
        if (newPersonId) {
          const np = n.find((x) => x.id === newPersonId);
          if (np) {
            np.fx = 0;
            np.fy = 0;
            np.x = 0;
            np.y = 0;
          }
        }
        setNodes(n);
        setLinks(e);
        posthog?.capture('graph_opened', {
          node_count: n.length,
          edge_count: e.length,
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [posthog, newPersonId]);

  // Centre the camera on the pinned new node once the graph is mounted.
  useEffect(() => {
    if (!newPersonId || loading || dimensions.width === 0) return;
    const id = setTimeout(() => fgRef.current?.centerAt?.(0, 0, 0), 0);
    return () => clearTimeout(id);
  }, [newPersonId, loading, dimensions.width]);

  // Keep a live mirror of nodes for the off-render timers/rAF below.
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // prefers-reduced-motion.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduceMotion(mq.matches);
      reduceMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Gentle reheat: raise friction so motion eases rather than snaps, nudge the
  // simulation, then restore the base friction after it has settled.
  const gentleReheat = useCallback(() => {
    setVelocityDecay(SETTLE_VELOCITY_DECAY);
    fgRef.current?.d3ReheatSimulation?.();
    if (coolTimerRef.current) clearTimeout(coolTimerRef.current);
    coolTimerRef.current = setTimeout(
      () => setVelocityDecay(BASE_VELOCITY_DECAY),
      SETTLE_COOL_MS
    );
  }, []);

  // Release the centre pin after the overlay hand-off completes, so the node
  // travels from centre to its (edgeless) resting place and settles. Skipped
  // under reduced motion — the node stays put where it landed.
  useEffect(() => {
    if (!newPersonId || loading || reduceMotion) return;
    const id = setTimeout(() => {
      const nn = nodesRef.current.find((n) => n.id === newPersonId);
      if (nn) {
        nn.fx = undefined;
        nn.fy = undefined;
      }
      gentleReheat();
    }, HANDOFF_HOLD_MS);
    return () => clearTimeout(id);
  }, [newPersonId, loading, reduceMotion, gentleReheat]);

  // Track the new node's screen position each frame so the pulsing halo +
  // caption follow it as it travels. Direct DOM writes (no per-frame re-render).
  useEffect(() => {
    if (!newPersonId || newStatus === 'complete') return;
    let raf = 0;
    const tick = () => {
      const el = affordanceRef.current;
      const nn = nodesRef.current.find((n) => n.id === newPersonId);
      const fg = fgRef.current;
      if (el && nn && nn.x != null && nn.y != null && fg?.graph2ScreenCoords) {
        const { x, y } = fg.graph2ScreenCoords(nn.x, nn.y);
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [newPersonId, newStatus]);

  // Clean up the cool-down timer on unmount.
  useEffect(() => {
    return () => {
      if (coolTimerRef.current) clearTimeout(coolTimerRef.current);
    };
  }, []);

  // Re-pull the graph after extraction, preserving node positions so the layout
  // doesn't jump, and flag the brand-new edges for the fade-in ramp.
  const refetchGraph = useCallback(() => {
    fetch('/api/graph')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load graph');
        return res.json() as Promise<{
          nodes: GraphNode[];
          edges: GraphLink[];
        }>;
      })
      .then(({ nodes: n, edges: e }) => {
        setLinks((prev) => {
          const oldKeys = new Set(prev.map(edgeKey));
          const fresh = new Set<string>();
          const stagger = new Map<string, number>();
          let i = 0;
          for (const ed of e) {
            const k = edgeKey(ed);
            if (!oldKeys.has(k)) {
              fresh.add(k);
              stagger.set(k, i * STAGGER_MS);
              i++;
            }
          }
          newEdgeKeys.current = fresh;
          edgeStagger.current = stagger;
          edgeAnimStart.current = nowMs();
          return e;
        });
        setNodes((prev) => {
          const byId = new Map(prev.map((o) => [o.id, o]));
          return n.map((nn) => {
            const old = byId.get(nn.id);
            if (old) {
              nn.x = old.x;
              nn.y = old.y;
              nn.vx = old.vx;
              nn.vy = old.vy;
              // Preserve the pin only if it's still held (release is governed by
              // the HANDOFF_HOLD_MS timer, not by completion).
              if (old.fx != null) {
                nn.fx = old.fx;
                nn.fy = old.fy;
              }
            }
            return nn;
          });
        });
        // Gentle reheat so the new edges grow in and the node re-adjusts toward
        // its neighbours without snapping.
        gentleReheat();
      })
      .catch(() => {
        // Keep the existing graph on a refetch failure.
      });
  }, [gentleReheat]);

  // Poll the new node's processing status. On completion, refetch the graph and
  // fade in any new edges; on failure, surface a retry affordance (no spinner).
  // Keyed on newStatus so a retry (→ 'processing') restarts the loop.
  useEffect(() => {
    if (!newPersonId || !newStatus || isTerminal(newStatus)) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/people/${newPersonId}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (data.status === 'complete') {
          clearInterval(intervalId);
          setNewStatus('complete');
          refetchGraph();
        } else if (data.status === 'failed') {
          clearInterval(intervalId);
          setNewStatus('failed');
        }
      } catch {
        // Network blip — keep polling silently.
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [newPersonId, newStatus, refetchGraph]);

  const handleRetry = useCallback(async () => {
    if (!newPersonId) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/people/${newPersonId}/reprocess`, {
        method: 'POST',
      });
      if (res.ok) setNewStatus('processing'); // restarts the poll effect
    } catch {
      // Leave the failed state; the user can retry again.
    } finally {
      setRetrying(false);
    }
  }, [newPersonId]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const newNodeName = newPersonId
    ? (nodes.find((n) => n.id === newPersonId)?.name ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: `radial-gradient(ellipse at center, #2E2035 0%, ${BG_NIGHT} 100%)`,
      }}
    >
      {/* Loading state */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: LABEL_COLOR,
                    display: 'inline-block',
                    animation: `nvbounce 1.2s ease-in-out ${i * 0.15}s infinite`,
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                color: 'var(--star-dim)',
              }}
            >
              Loading your network&hellip;
            </p>
          </div>
        </div>
      )}

      {/* Fetch error */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              color: 'var(--berry-300)',
            }}
          >
            {error}
          </p>
        </div>
      )}

      {/* Graph */}
      {!loading && !error && dimensions.width > 0 && (
        <ForceGraph2D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor={BG_NIGHT}
          // Node color: bright for confirmed facts, dim for raw-only
          nodeColor={(node) => {
            const n = node as GraphNode;
            const idx = paletteIdx(n.name);
            return n.hasConfirmedFacts ? NODE_BRIGHT[idx] : NODE_DIM[idx];
          }}
          // Node size proportional to fact count
          // Library radius formula: sqrt(nodeVal) * nodeRelSize
          // nodeRelSize=1 → nodeVal 4–25 → radius 2–5 px
          nodeRelSize={1}
          nodeVal={(node) =>
            Math.max(4, Math.min(25, (node as GraphNode).factCount + 4))
          }
          nodeLabel="name"
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(node, ctx, globalScale) => {
            if (globalScale < 1.5) return;
            const n = node as GraphNode;
            if (n.x == null || n.y == null) return;

            const val = Math.max(4, Math.min(25, n.factCount + 4));
            const radius = Math.sqrt(val) * 1;

            // Node glow when selected
            if (selectedNode?.id === n.id) {
              ctx.save();
              ctx.shadowColor = NODE_BRIGHT[paletteIdx(n.name)];
              ctx.shadowBlur = 12;
              ctx.beginPath();
              ctx.arc(n.x, n.y, radius + 1, 0, 2 * Math.PI);
              ctx.fillStyle = NODE_BRIGHT[paletteIdx(n.name)];
              ctx.fill();
              ctx.restore();
            }

            const fontSize = 11 / globalScale;
            ctx.font = `${fontSize}px "Hanken Grotesk", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = LABEL_COLOR;
            ctx.fillText(n.name, n.x, n.y + radius + 2);
          }}
          // Edges drawn manually so freshly-arrived ones can GROW from the new
          // node outward (draw-progress) rather than fade in. Keeps the
          // confirmed (solid) vs inferred (dashed) styling of the default
          // renderer. Widths/dashes divided by globalScale for constant
          // apparent size (ctx is pre-scaled to graph coords).
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={(link, ctx, globalScale) => {
            const l = link as GraphLink;
            const src = l.source as GraphNode;
            const tgt = l.target as GraphNode;
            if (
              src?.x == null ||
              src?.y == null ||
              tgt?.x == null ||
              tgt?.y == null
            )
              return;

            const inferred = l.status === 'inferred';

            // Draw-progress for new edges (skipped under reduced motion).
            let progress = 1;
            if (
              !reduceMotionRef.current &&
              newEdgeKeys.current.has(edgeKey(l))
            ) {
              const stg = edgeStagger.current.get(edgeKey(l)) ?? 0;
              const elapsed = nowMs() - edgeAnimStart.current - stg;
              if (elapsed <= 0) return; // not yet started — nothing to draw
              progress = Math.min(1, elapsed / DRAW_MS);
            }

            // Anchor the growth at the new node so the line draws outward.
            let ax = src.x;
            let ay = src.y;
            let bx = tgt.x;
            let by = tgt.y;
            if (
              progress < 1 &&
              tgt.id === newPersonId &&
              src.id !== newPersonId
            ) {
              ax = tgt.x;
              ay = tgt.y;
              bx = src.x;
              by = src.y;
            }
            if (progress < 1) {
              const e = easeOut(progress);
              bx = ax + (bx - ax) * e;
              by = ay + (by - ay) * e;
            }

            ctx.save();
            ctx.strokeStyle = inferred ? EDGE_INFERRED : EDGE_CONFIRMED;
            ctx.lineWidth = 1.5 / globalScale;
            ctx.setLineDash(inferred ? [4 / globalScale, 4 / globalScale] : []);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            ctx.restore();
          }}
          linkLabel={(link) =>
            (link as GraphLink).relationship_type.replace(/_/g, ' ')
          }
          // Physics — base values from the prior session; velocityDecay is
          // raised transiently during the new-node settle (see gentleReheat).
          ref={fgRef}
          d3AlphaDecay={0.02}
          d3VelocityDecay={velocityDecay}
          warmupTicks={100}
          cooldownTicks={200}
          onNodeClick={(node) => {
            const n = node as GraphNode;
            if (onNodeClick) {
              onNodeClick(n.id);
            } else {
              setSelectedNode(n);
            }
          }}
        />
      )}

      {/* New-node processing / failed affordance — the wrapper is positioned
          each frame onto the node's screen coords (see the rAF effect) so the
          halo + caption follow the node as it travels. */}
      {newPersonId && newStatus && newStatus !== 'complete' && (
        <div
          ref={affordanceRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            // Initial guess = canvas centre (where the node lands); the rAF
            // loop takes over from the first frame.
            transform: `translate(${dimensions.width / 2}px, ${dimensions.height / 2}px)`,
            willChange: 'transform',
            pointerEvents: 'none',
          }}
        >
          {/* Pulsing halo on the node (static under reduced motion) */}
          <div
            className="nv-pulse-ring"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: 'translate(-50%, -50%)',
              width: 56,
              height: 56,
              borderRadius: '50%',
              background:
                newStatus === 'failed' ? 'var(--berry-500)' : 'var(--brand)',
              boxShadow: 'var(--glow-brand)',
            }}
          />

          {/* Caption / retry, just below the node */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 36,
              transform: 'translateX(-50%)',
              width: 260,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              pointerEvents: newStatus === 'failed' ? 'auto' : 'none',
            }}
          >
            {newStatus === 'failed' ? (
              <>
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--berry-300)',
                  }}
                >
                  Couldn&apos;t finish reading these notes.
                </p>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying}
                  style={{
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--berry-300)',
                    background: 'transparent',
                    color: 'var(--berry-300)',
                    padding: '6px 16px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    cursor: retrying ? 'default' : 'pointer',
                    opacity: retrying ? 0.5 : 1,
                  }}
                >
                  {retrying ? 'Retrying…' : 'Try again'}
                </button>
              </>
            ) : (
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--star-dim)',
                }}
              >
                {newNodeName
                  ? `Adding ${newNodeName}…`
                  : 'Adding to your constellation…'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      {selectedNode && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-end',
          }}
          onClick={() => setSelectedNode(null)}
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
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 'var(--screen-max)',
              margin: '0 auto',
              background: '#2E2035', // night-800
              borderRadius: '22px 22px 0 0',
              padding: '16px 20px 40px',
              marginBottom: 'var(--nav-height)',
              boxShadow: 'var(--shadow-lg)',
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

            {/* Person info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-h3)',
                    fontWeight: 600,
                    color: 'var(--text-on-night)',
                    margin: '0 0 4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedNode.name}
                </h2>
                {selectedNode.role && (
                  <p
                    style={{
                      margin: '0',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--star-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedNode.role}
                  </p>
                )}
                {selectedNode.org && (
                  <p
                    style={{
                      margin: '0',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--star-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedNode.org}
                  </p>
                )}
                {!selectedNode.role && !selectedNode.org && (
                  <p
                    style={{
                      margin: '0',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--star-dim)',
                    }}
                  >
                    {selectedNode.factCount > 0
                      ? `${selectedNode.factCount} fact${selectedNode.factCount !== 1 ? 's' : ''}`
                      : 'No facts extracted yet'}
                  </p>
                )}
              </div>

              {/* Close */}
              <button
                onClick={() => setSelectedNode(null)}
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
                  flexShrink: 0,
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

            {/* View profile */}
            <Link
              href={`/people/${selectedNode.id}`}
              style={{
                display: 'block',
                width: '100%',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--brand)',
                padding: '12px 0',
                textAlign: 'center',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-on-accent)',
                textDecoration: 'none',
                boxShadow: 'var(--shadow-sm), var(--glow-brand)',
              }}
            >
              View profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
