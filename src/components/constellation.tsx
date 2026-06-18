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

// Scale the alpha of an existing `rgba(r,g,b,a)` string by `factor` (0–1), used
// to fade newly-arrived edges in. Falls back to the original string if it isn't
// in the expected rgba form.
function withAlpha(rgba: string, factor: number): string {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const parts = m[1].split(',').map((p) => p.trim());
  const [r, g, b] = parts;
  const a = parts[3] != null ? parseFloat(parts[3]) : 1;
  return `rgba(${r}, ${g}, ${b}, ${(a * factor).toFixed(3)})`;
}

const isTerminal = (s: string) => s === 'complete' || s === 'failed';

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
  // Edge keys added by the post-completion refetch, plus when the fade began —
  // read by linkColor each frame to ramp their alpha in (~0.7s).
  const newEdgeKeys = useRef<Set<string>>(new Set());
  const edgeAnimStart = useRef<number>(0);

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
          for (const ed of e) {
            const k = edgeKey(ed);
            if (!oldKeys.has(k)) fresh.add(k);
          }
          newEdgeKeys.current = fresh;
          edgeAnimStart.current =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
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
              if (old.fx != null) {
                nn.fx = old.fx;
                nn.fy = old.fy;
              }
            }
            return nn;
          });
        });
        // Reheat so the added edges actually repaint during the fade window.
        fgRef.current?.d3ReheatSimulation?.();
        // Release the new node's pin shortly after so it eases into the layout.
        setTimeout(() => {
          setNodes((prev) =>
            prev.map((p) => {
              if (p.id !== newPersonId) return p;
              p.fx = undefined;
              p.fy = undefined;
              return p;
            })
          );
          fgRef.current?.d3ReheatSimulation?.();
        }, 900);
      })
      .catch(() => {
        // Keep the existing graph on a refetch failure.
      });
  }, [newPersonId]);

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
          // Edge styling — confirmed vs inferred, with a fade-in ramp for any
          // edges that just arrived from the post-completion refetch.
          linkColor={(link) => {
            const l = link as GraphLink;
            const base =
              l.status === 'inferred' ? EDGE_INFERRED : EDGE_CONFIRMED;
            if (
              newEdgeKeys.current.size > 0 &&
              newEdgeKeys.current.has(edgeKey(l))
            ) {
              const now =
                typeof performance !== 'undefined'
                  ? performance.now()
                  : Date.now();
              const p = Math.min(1, (now - edgeAnimStart.current) / 700);
              return withAlpha(base, p);
            }
            return base;
          }}
          linkWidth={1.5}
          linkLineDash={(link) =>
            (link as GraphLink).status === 'inferred' ? [4, 4] : null
          }
          linkLabel={(link) =>
            (link as GraphLink).relationship_type.replace(/_/g, ' ')
          }
          // Physics — unchanged from previous session
          ref={fgRef}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.2}
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

      {/* New-node processing / failed affordance — centred on the pinned node */}
      {newPersonId && newStatus && newStatus !== 'complete' && (
        <>
          {/* Pulsing halo behind the node (static under reduced motion) */}
          <div
            className="nv-pulse-ring"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 56,
              height: 56,
              borderRadius: '50%',
              background:
                newStatus === 'failed' ? 'var(--berry-500)' : 'var(--brand)',
              boxShadow: 'var(--glow-brand)',
              pointerEvents: 'none',
            }}
          />

          {/* Caption / retry */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 'calc(50% + 52px)',
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
        </>
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
