import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  SessionOverviewData,
  TopicNode,
  TopicEdge,
  SemanticEdgeType,
  KnowledgeCommunity,
} from '../../types'
import { KnowledgeNodeDetail } from './KnowledgeNodeDetail'
import { TacitKnowledgeView } from './TacitKnowledgeView'
import { GraphMetricsPanel } from './GraphMetricsPanel'
import './KnowledgeGraphView.css'

interface Props {
  overview: SessionOverviewData | null
  loading: boolean
  error: string | null
  onSessionSelect: (sessionId: string) => void
}

const COMMUNITY_COLORS = [
  '#6366f1',
  '#06b6d4',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#84cc16',
  '#e11d48',
  '#0ea5e9',
]

const EDGE_COLORS: Record<SemanticEdgeType, string> = {
  'semantic-similarity': '#6366f1',
  'shared-module': '#06b6d4',
  'workflow-continuation': '#14b8a6',
  'cross-project-bridge': '#f59e0b',
}

const EDGE_TYPE_LABELS: Record<SemanticEdgeType, string> = {
  'semantic-similarity': 'Semantic Similarity',
  'shared-module': 'Shared Module',
  'workflow-continuation': 'Workflow Continuation',
  'cross-project-bridge': 'Cross-Project Bridge',
}

const ALL_EDGE_TYPES: SemanticEdgeType[] = [
  'semantic-similarity',
  'shared-module',
  'workflow-continuation',
  'cross-project-bridge',
]

export function KnowledgeGraphView({
  overview,
  loading,
  error,
  onSessionSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 })
  const [selectedNode, setSelectedNode] = useState<TopicNode | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [visibleCommunities, setVisibleCommunities] = useState<Set<number>>(
    new Set()
  )
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<SemanticEdgeType>>(
    new Set(ALL_EDGE_TYPES)
  )

  // Extract communities
  const communities = useMemo(() => {
    if (!overview) return []
    return overview.knowledgeGraph.communities
  }, [overview])

  // Build community -> color mapping
  const communityColorMap = useMemo(() => {
    const map = new Map<number, string>()
    communities.forEach((c, i) => {
      map.set(c.id, COMMUNITY_COLORS[i % COMMUNITY_COLORS.length])
    })
    return map
  }, [communities])

  // Initialize visible communities when data loads
  useEffect(() => {
    if (communities.length > 0 && visibleCommunities.size === 0) {
      setVisibleCommunities(new Set(communities.map((c) => c.id)))
    }
  }, [communities, visibleCommunities.size])

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
    const filteredNodes = nodes.filter((n) =>
      visibleCommunities.has(n.communityId)
    )
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
        label: n.label,
        keywords: n.keywords,
        project: n.project,
        sessionCount: n.sessionCount,
        communityId: n.communityId,
        betweennessCentrality: n.betweennessCentrality,
        val: Math.max(2, n.sessionCount * 2),
      })),
      links: filteredEdges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        strength: e.strength,
        label: e.label,
      })),
    }
  }, [overview, visibleCommunities, visibleEdgeTypes])

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
      const topicNode = overview.knowledgeGraph.nodes.find(
        (n: TopicNode) => n.id === node.id
      )
      setSelectedNode(topicNode ?? null)
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

  const toggleCommunity = useCallback((communityId: number) => {
    setVisibleCommunities((prev) => {
      const next = new Set(prev)
      if (next.has(communityId)) {
        next.delete(communityId)
      } else {
        next.add(communityId)
      }
      return next
    })
  }, [])

  const toggleEdgeType = useCallback((edgeType: SemanticEdgeType) => {
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
      return communityColorMap.get(node.communityId ?? 0) ?? COMMUNITY_COLORS[0]
    },
    [communityColorMap, hoveredNodeId]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback(
    (link: any) => {
      return (
        EDGE_COLORS[(link.type as SemanticEdgeType) ?? 'semantic-similarity'] ??
        '#8b949e'
      )
    },
    []
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any) => {
    return (link.strength ?? 0.5) * 3
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeLabel = useCallback((node: any) => {
    const kw = (node.keywords as string[]) || []
    return `${node.label}\n[${kw.join(', ')}]\nSessions: ${node.sessionCount ?? 0}`
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
          <span className="kg-filter-label">Communities</span>
          <div className="kg-filter-options">
            {communities.map((comm: KnowledgeCommunity) => (
              <label key={comm.id} className="kg-filter-checkbox">
                <input
                  type="checkbox"
                  checked={visibleCommunities.has(comm.id)}
                  onChange={() => toggleCommunity(comm.id)}
                />
                <span
                  className="project-color-dot"
                  style={{
                    backgroundColor: communityColorMap.get(comm.id),
                  }}
                />
                {comm.label}
                <span className="kg-filter-count">
                  ({comm.topicIds.length})
                </span>
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

      {/* Metrics panel */}
      <GraphMetricsPanel
        metrics={overview.knowledgeGraph.metrics}
        communities={communities}
      />

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
              backgroundColor="#fafaf9"
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
              No topics match the current filters
            </div>
          )}
        </div>

        {selectedNode && (
          <KnowledgeNodeDetail
            node={selectedNode}
            edges={selectedNodeEdges}
            allTopics={overview.knowledgeGraph.nodes}
            onSessionSelect={onSessionSelect}
            onClose={handleCloseDetail}
          />
        )}
      </div>

      {/* Tacit knowledge section */}
      <div className="kg-tacit-section">
        <TacitKnowledgeView
          knowledge={overview.tacitKnowledge}
          graphMetrics={overview.knowledgeGraph.metrics}
          topics={overview.knowledgeGraph.nodes}
        />
      </div>
    </div>
  )
}
