'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

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
  x?: number;
  y?: number;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onNodeClick?: (personId: string) => void;
}

export default function Constellation({ onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

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
        setNodes(n);
        setLinks(e);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  return (
    <div
      ref={containerRef}
      style={{
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
          // Edge styling — confirmed vs inferred
          linkColor={(link) =>
            (link as GraphLink).status === 'inferred'
              ? EDGE_INFERRED
              : EDGE_CONFIRMED
          }
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
