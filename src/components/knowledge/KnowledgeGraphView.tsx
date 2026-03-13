import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  SessionOverviewData,
  KnowledgeNode,
  KnowledgeEdge,
  EdgeType,
} from '../../types'
import { KnowledgeNodeDetail } from './KnowledgeNodeDetail'
import { TacitKnowledgeView } from './TacitKnowledgeView'
import './KnowledgeGraphView.css'

interface Props {
  overview: SessionOverviewData | null
  loading: boolean
  error: string | null
  onSessionSelect: (sessionId: string) => void
}

const CHART_COLORS = [
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#60a5fa',
  '#fbbf24',
]

const EDGE_COLORS: Record<EdgeType, string> = {
  'same-branch': '#a78bfa',
  'shared-files': '#8b7aaa',
  'resume-chain': '#34d399',
  'memory-chain': '#fbbf24',
  'plan-reference': '#60a5fa',
}

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  'same-branch': 'Same Branch',
  'shared-files': 'Shared Files',
  'resume-chain': 'Resume Chain',
  'memory-chain': 'Memory Chain',
  'plan-reference': 'Plan Reference',
}

const ALL_EDGE_TYPES: EdgeType[] = [
  'same-branch',
  'shared-files',
  'resume-chain',
  'memory-chain',
  'plan-reference',
]

export function KnowledgeGraphView({
  overview,
  loading,
  error,
  onSessionSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 })
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [visibleProjects, setVisibleProjects] = useState<Set<string>>(
    new Set()
  )
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<EdgeType>>(
    new Set(ALL_EDGE_TYPES)
  )

  // Extract unique projects from knowledge graph
  const projects = useMemo(() => {
    if (!overview) return []
    const projectSet = new Set(
      overview.knowledgeGraph.nodes.map((n) => n.project)
    )
    return Array.from(projectSet).sort()
  }, [overview])

  // Build project -> color mapping
  const projectColorMap = useMemo(() => {
    const map = new Map<string, string>()
    projects.forEach((p, i) => {
      map.set(p, CHART_COLORS[i % CHART_COLORS.length])
    })
    return map
  }, [projects])

  // Initialize visible projects when data loads
  useEffect(() => {
    if (projects.length > 0 && visibleProjects.size === 0) {
      setVisibleProjects(new Set(projects))
    }
  }, [projects, visibleProjects.size])

  // ResizeObserver for responsive graph sizing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width: Math.floor(width), height: Math.floor(height) })
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Filter nodes and edges
  const filteredData = useMemo(() => {
    if (!overview) return { nodes: [], links: [] }

    const { nodes, edges } = overview.knowledgeGraph
    const filteredNodes = nodes.filter((n) => visibleProjects.has(n.project))
    const nodeIds = new Set(filteredNodes.map((n) => n.id))

    const filteredEdges = edges.filter(
      (e) =>
        visibleEdgeTypes.has(e.type) &&
        nodeIds.has(e.source) &&
        nodeIds.has(e.target)
    )

    return {
      nodes: filteredNodes.map((n) => ({
        id: n.id,
        project: n.project,
        firstPrompt: n.firstPrompt,
        createdAt: n.createdAt,
        toolCallCount: n.toolCallCount,
        durationMinutes: n.durationMinutes,
        val: Math.max(1, n.toolCallCount / 10),
      })),
      links: filteredEdges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        strength: e.strength,
      })),
    }
  }, [overview, visibleProjects, visibleEdgeTypes])

  // Edges connected to selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode || !overview) return []
    return overview.knowledgeGraph.edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    )
  }, [selectedNode, overview])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback(
    (node: any) => {
      if (!overview || !node.id) return
      const knowledgeNode = overview.knowledgeGraph.nodes.find(
        (n: KnowledgeNode) => n.id === node.id
      )
      setSelectedNode(knowledgeNode ?? null)
    },
    [overview]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeHover = useCallback(
    (node: any | null) => {
      setHoveredNodeId(node?.id != null ? String(node.id) : null)
    },
    []
  )

  const handleCloseDetail = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const toggleProject = useCallback((project: string) => {
    setVisibleProjects((prev) => {
      const next = new Set(prev)
      if (next.has(project)) {
        next.delete(project)
      } else {
        next.add(project)
      }
      return next
    })
  }, [])

  const toggleEdgeType = useCallback((edgeType: EdgeType) => {
    setVisibleEdgeTypes((prev) => {
      const next = new Set(prev)
      if (next.has(edgeType)) {
        next.delete(edgeType)
      } else {
        next.add(edgeType)
      }
      return next
    })
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeColor = useCallback(
    (node: any) => {
      if (hoveredNodeId && String(node.id) === hoveredNodeId) {
        return '#ffffff'
      }
      return projectColorMap.get(node.project ?? '') ?? CHART_COLORS[0]
    },
    [projectColorMap, hoveredNodeId]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback(
    (link: any) => {
      return EDGE_COLORS[(link.type as EdgeType) ?? 'shared-files'] ?? '#8b949e'
    },
    []
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any) => {
    return (link.strength ?? 0.5) * 2
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeLabel = useCallback((node: any) => {
    return node.firstPrompt ?? ''
  }, [])

  if (loading) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-loading">Loading knowledge graph...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-error">Error: {error}</div>
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-empty">No overview data available</div>
      </div>
    )
  }

  return (
    <div className="knowledge-graph-view">
      {/* Filter controls */}
      <div className="kg-filters">
        <div className="kg-filter-group">
          <span className="kg-filter-label">Projects</span>
          <div className="kg-filter-options">
            {projects.map((project) => (
              <label key={project} className="kg-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleProjects.has(project)}
                  onChange={() => toggleProject(project)}
                />
                <span
                  className="project-color-dot"
                  style={{
                    backgroundColor: projectColorMap.get(project),
                  }}
                />
                {project}
              </label>
            ))}
          </div>
        </div>

        <div className="kg-filter-group">
          <span className="kg-filter-label">Edge Types</span>
          <div className="kg-filter-options">
            {ALL_EDGE_TYPES.map((edgeType) => (
              <label key={edgeType} className="kg-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleEdgeTypes.has(edgeType)}
                  onChange={() => toggleEdgeType(edgeType)}
                />
                <span
                  className="edge-color-dot"
                  style={{ backgroundColor: EDGE_COLORS[edgeType] }}
                />
                {EDGE_TYPE_LABELS[edgeType]}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Graph + detail panel */}
      <div className="kg-content">
        <div
          ref={containerRef}
          className={`kg-graph-container ${selectedNode ? 'with-detail' : ''}`}
        >
          {filteredData.nodes.length > 0 ? (
            <ForceGraph2D
              graphData={filteredData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="#faf7ff"
              nodeLabel={nodeLabel}
              nodeColor={nodeColor}
              nodeVal="val"
              nodeRelSize={4}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkDirectionalParticles={1}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          ) : (
            <div className="kg-empty">
              No nodes match the current filters
            </div>
          )}
        </div>

        {selectedNode && (
          <KnowledgeNodeDetail
            node={selectedNode}
            edges={selectedNodeEdges}
            onSessionSelect={onSessionSelect}
            onClose={handleCloseDetail}
          />
        )}
      </div>

      {/* Tacit knowledge section */}
      <div className="kg-tacit-section">
        <TacitKnowledgeView knowledge={overview.tacitKnowledge} />
      </div>
    </div>
  )
}
