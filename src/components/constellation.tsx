'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Dynamic import required — react-force-graph-2d accesses window, canvas, and
// requestAnimationFrame at module load time. Importing it directly (or without
// ssr: false) throws "window is not defined" during Next.js server render.
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
  // Added by the force simulation after first render
  x?: number;
  y?: number;
}

export interface GraphLink {
  // Before the simulation resolves IDs these are strings;
  // after resolution the library replaces them with node objects.
  source: string | GraphNode;
  target: string | GraphNode;
  relationship_type: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  /** Called when the user clicks a node. Receives the node's person id. */
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

  // Measure the container so the graph fills its parent precisely without
  // overflowing or causing scroll. Responds to window/layout resizes.
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

  // Apply link spring strength and distance via d3Force — neither is a typed
  // prop on this version of react-force-graph-2d. Runs once after mount;
  // affects all simulation ticks during cooldown and user interaction.
  useEffect(() => {
    const link = fgRef.current?.d3Force('link');
    if (!link) return;
    link.strength(0.7); // pulls connected nodes along when a neighbour moves
    link.distance(60); // moderate rest length between connected nodes
  }, []);

  // Fetch graph data once on mount.
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
        setLinks(e); // API field is 'edges'; the library expects 'links'
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Stable reference — the force library mutates node/link objects in-place
  // (adding x, y, vx, vy). A new graphData object every render would restart
  // the simulation, so we memoize and only rebuild when the data changes.
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  return (
    <div ref={containerRef} className="w-full h-full bg-zinc-950">
      {/* Client-side fetch loading state */}
      {loading && (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
            </div>
            <p className="text-sm text-zinc-500">
              Loading your network&hellip;
            </p>
          </div>
        </div>
      )}

      {/* Fetch error */}
      {error && (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Graph — only rendered once dimensions are known and data is ready */}
      {!loading && !error && dimensions.width > 0 && (
        <ForceGraph2D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#09090b" // zinc-950 — the constellation dark background
          // Node colour: purple for confirmed facts, zinc gray for raw only.
          nodeColor={(node) =>
            (node as GraphNode).hasConfirmedFacts ? '#7c3aed' : '#71717a'
          }
          // Node size proportional to fact count.
          // Library radius formula: sqrt(nodeVal) * nodeRelSize.
          // nodeRelSize=1 (overrides the library default of 4).
          // nodeVal range 4–25 → radius 2–5 px.
          // Adding 4 ensures zero-fact nodes still render at minimum size.
          nodeRelSize={1}
          nodeVal={(node) =>
            Math.max(4, Math.min(25, (node as GraphNode).factCount + 4))
          }
          // Node label: native tooltip on hover (always) + canvas text at zoom > 1.5.
          nodeLabel="name"
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(node, ctx, globalScale) => {
            // Only draw text labels when zoomed in past the threshold.
            if (globalScale < 1.5) return;
            const n = node as GraphNode;
            if (n.x == null || n.y == null) return;

            // Mirror the nodeVal clamping so the label sits just below the node.
            const val = Math.max(4, Math.min(25, n.factCount + 4));
            const radius = Math.sqrt(val) * 1; // nodeRelSize = 1

            // Scale font inversely with zoom so apparent size stays constant.
            const fontSize = 11 / globalScale;
            ctx.font = `${fontSize}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#e4e4e7'; // zinc-200
            ctx.fillText(n.name, n.x, n.y + radius + 2);
          }}
          // Edge colour, width, and style.
          linkColor={() => '#52525b'} // zinc-600
          linkWidth={1.5}
          // Solid for confirmed connections; dashed for inferred.
          linkLineDash={(link) =>
            (link as GraphLink).status === 'inferred' ? [4, 4] : null
          }
          // Relationship type shown as tooltip on edge hover.
          linkLabel={(link) =>
            (link as GraphLink).relationship_type.replace(/_/g, ' ')
          }
          // Physics — tuned for an elastic, interconnected feel.
          // linkStrength (0.7) is applied via fgRef d3Force in a useEffect above
          // because it isn't a direct prop on this library version.
          // Lower alphaDecay keeps the simulation warm longer for better settling.
          // Lower velocityDecay reduces damping so nodes carry momentum.
          // Longer warmup lets the layout settle before first render.
          ref={fgRef}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.2}
          warmupTicks={100}
          cooldownTicks={200}
          // Node click — open the bottom sheet. The sheet's "View profile"
          // link handles navigation; onNodeClick prop is an optional override.
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
      {/* ------------------------------------------------------------------ */}
      {/* Bottom sheet — shown when a node is tapped/clicked.               */}
      {/* Displays name, role, and org so the user can confirm before        */}
      {/* leaving the graph. Backdrop tap or × dismisses without navigating. */}
      {/* ------------------------------------------------------------------ */}
      {selectedNode && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          onClick={() => setSelectedNode(null)}
        >
          {/* Semi-transparent backdrop */}
          <div className="absolute inset-0 bg-black/50" />

          {/* Sheet panel — constrained to mobile width on large screens.       */}
          {/* mb-16 lifts the panel above the fixed bottom nav (4rem / 64px). */}
          <div
            className="relative w-full max-w-lg mx-auto bg-zinc-900 rounded-t-2xl px-5 pt-4 pb-10 mb-16 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-700" />

            {/* Person info + close button */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex-1 min-w-0 pr-3">
                <h2 className="text-base font-semibold text-white truncate">
                  {selectedNode.name}
                </h2>
                {selectedNode.role && (
                  <p className="mt-0.5 text-sm text-zinc-400 truncate">
                    {selectedNode.role}
                  </p>
                )}
                {selectedNode.org && (
                  <p className="text-sm text-zinc-400 truncate">
                    {selectedNode.org}
                  </p>
                )}
                {!selectedNode.role && !selectedNode.org && (
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {selectedNode.factCount > 0
                      ? `${selectedNode.factCount} fact${selectedNode.factCount !== 1 ? 's' : ''}`
                      : 'No facts extracted yet'}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                aria-label="Close"
                className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Navigate to profile */}
            <Link
              href={`/people/${selectedNode.id}`}
              className="block w-full rounded-full bg-violet-600 py-2.5 text-center text-sm font-medium text-white hover:bg-violet-500 active:bg-violet-700 transition-colors"
            >
              View profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
