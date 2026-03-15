import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  SessionOverviewData,
  TopicNode,
  SemanticEdgeType,
  KnowledgeCommunity,
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

interface GraphNode {
  [key: string]: unknown
  id: string
  label: string
  keywords: string[]
  project: string
  sessionCount: number
  communityId: number
  betweennessCentrality: number
  val: number
  x?: number
  y?: number
}

interface GraphLink {
  [key: string]: unknown
  source: string | GraphNode
  target: string | GraphNode
  type: SemanticEdgeType
  strength: number
  label: string
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
  'semantic-similarity': 'Semantic',
  'shared-module': 'Module',
  'workflow-continuation': 'Workflow',
  'cross-project-bridge': 'Cross-Project',
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
  const [visibleCommunities, setVisibleCommunities] = useState<Set<number> | null>(
    null
  )
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<SemanticEdgeType>>(
    new Set(ALL_EDGE_TYPES)
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'insights' | 'detail'>('insights')

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

  // Default to all communities visible until user interacts
  const effectiveVisibleCommunities = useMemo(
    () => visibleCommunities ?? new Set(communities.map((c) => c.id)),
    [visibleCommunities, communities]
  )

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
    if (!overview) return { nodes: [] as GraphNode[], links: [] as GraphLink[] }

    const { nodes, edges } = overview.knowledgeGraph
    const filteredNodes = nodes.filter((n) =>
      effectiveVisibleCommunities.has(n.communityId)
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
  }, [overview, effectiveVisibleCommunities, visibleEdgeTypes])

  // Edges connected to selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode || !overview) return []
    return overview.knowledgeGraph.edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    )
  }, [selectedNode, overview])

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (!overview || !node.id) return
      const topicNode = overview.knowledgeGraph.nodes.find(
        (n: TopicNode) => n.id === node.id
      )
      if (topicNode) {
        setSelectedNode(topicNode)
        setSidebarTab('detail')
      }
    },
    [overview]
  )

  const handleNodeHover = useCallback(
    (node: GraphNode | null) => {
      setHoveredNodeId(node?.id != null ? String(node.id) : null)
    },
    []
  )

  const handleCloseDetail = useCallback(() => {
    setSelectedNode(null)
    setSidebarTab('insights')
  }, [])

  const toggleCommunity = useCallback((communityId: number) => {
    setVisibleCommunities((prev) => {
      const next = new Set(prev ?? communities.map((c) => c.id))
      if (next.has(communityId)) {
        next.delete(communityId)
      } else {
        next.add(communityId)
      }
      return next
    })
  }, [communities])

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

  const toggleAllCommunities = useCallback(() => {
    setVisibleCommunities((prev) => {
      if ((prev?.size ?? communities.length) === communities.length) {
        return new Set<number>()
      }
      return new Set(communities.map((c) => c.id))
    })
  }, [communities])

  const nodeColor = useCallback(
    (node: GraphNode) => {
      if (hoveredNodeId && String(node.id) === hoveredNodeId) {
        return '#ffffff'
      }
      return communityColorMap.get(node.communityId ?? 0) ?? COMMUNITY_COLORS[0]
    },
    [communityColorMap, hoveredNodeId]
  )

  const linkColor = useCallback(
    (link: GraphLink) => {
      const type = (typeof link.source === 'string' || typeof link.target === 'string')
        ? link.type
        : link.type
      return (
        EDGE_COLORS[type ?? 'semantic-similarity'] ??
        '#8b949e'
      )
    },
    []
  )

  const linkWidth = useCallback((link: GraphLink) => {
    return (link.strength ?? 0.5) * 3
  }, [])

  const nodeLabel = useCallback((node: GraphNode) => {
    const kw = node.keywords || []
    return `${node.label}\n[${kw.join(', ')}]\nSessions: ${node.sessionCount ?? 0}`
  }, [])

  if (loading) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-loading">ナレッジグラフを読み込み中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-error">エラー: {error}</div>
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="knowledge-graph-view">
        <div className="kg-empty">データがありません</div>
      </div>
    )
  }

  const { metrics } = overview.knowledgeGraph

  return (
    <div className="knowledge-graph-view">
      <div className="kg-main-layout">
        {/* Left: Graph area */}
        <div className="kg-graph-area">
          {/* Floating metrics bar */}
          <div className="kg-metrics-bar">
            <span className="kg-metric">{metrics.totalTopics} topics</span>
            <span className="kg-metric-sep" />
            <span className="kg-metric">{metrics.totalEdges} edges</span>
            <span className="kg-metric-sep" />
            <span className="kg-metric">{communities.length} communities</span>
            <span className="kg-metric-sep" />
            <span className="kg-metric">Q={metrics.modularity.toFixed(2)}</span>
            {metrics.isolatedTopicCount > 0 && (
              <>
                <span className="kg-metric-sep" />
                <span className="kg-metric kg-metric-warn">
                  {metrics.isolatedTopicCount} isolated
                </span>
              </>
            )}
          </div>

          {/* Filter toggle button */}
          <button
            className={`kg-filter-toggle ${filtersOpen ? 'active' : ''}`}
            onClick={() => setFiltersOpen((p) => !p)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>

          {/* Collapsible filter overlay */}
          {filtersOpen && (
            <div className="kg-filter-overlay">
              <div className="kg-filter-section">
                <div className="kg-filter-header">
                  <span className="kg-filter-title">Communities</span>
                  <button
                    className="kg-filter-toggle-all"
                    onClick={toggleAllCommunities}
                  >
                    {effectiveVisibleCommunities.size === communities.length ? 'None' : 'All'}
                  </button>
                </div>
                <div className="kg-filter-pills">
                  {communities.map((comm: KnowledgeCommunity) => {
                    const active = effectiveVisibleCommunities.has(comm.id)
                    const color = communityColorMap.get(comm.id) ?? COMMUNITY_COLORS[0]
                    return (
                      <button
                        key={comm.id}
                        className={`kg-pill ${active ? 'active' : ''}`}
                        style={{
                          '--pill-color': color,
                          borderColor: active ? color : undefined,
                          backgroundColor: active ? `${color}18` : undefined,
                        } as React.CSSProperties}
                        onClick={() => toggleCommunity(comm.id)}
                      >
                        <span
                          className="kg-pill-dot"
                          style={{ backgroundColor: active ? color : 'var(--text-secondary)' }}
                        />
                        <span className="kg-pill-label">{comm.label}</span>
                        <span className="kg-pill-count">{comm.topicIds.length}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="kg-filter-section">
                <span className="kg-filter-title">Edge Types</span>
                <div className="kg-filter-chips">
                  {ALL_EDGE_TYPES.map((edgeType) => {
                    const active = visibleEdgeTypes.has(edgeType)
                    const color = EDGE_COLORS[edgeType]
                    return (
                      <button
                        key={edgeType}
                        className={`kg-chip ${active ? 'active' : ''}`}
                        style={{
                          '--chip-color': color,
                          borderColor: active ? color : undefined,
                          backgroundColor: active ? `${color}18` : undefined,
                        } as React.CSSProperties}
                        onClick={() => toggleEdgeType(edgeType)}
                      >
                        <span
                          className="kg-chip-line"
                          style={{ backgroundColor: active ? color : 'var(--text-secondary)' }}
                        />
                        {EDGE_TYPE_LABELS[edgeType]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Graph canvas */}
          <div ref={containerRef} className="kg-graph-container">
            {filteredData.nodes.length > 0 ? (
              <ForceGraph2D
                graphData={filteredData}
                width={dimensions.width}
                height={dimensions.height}
                backgroundColor="#fafaf9"
                nodeLabel={nodeLabel as (node: object) => string}
                nodeColor={nodeColor as (node: object) => string}
                nodeVal="val"
                nodeRelSize={4}
                linkColor={linkColor as (link: object) => string}
                linkWidth={linkWidth as (link: object) => number}
                linkDirectionalParticles={1}
                onNodeClick={handleNodeClick as (node: object, event: MouseEvent) => void}
                onNodeHover={handleNodeHover as (node: object | null, previousNode: object | null) => void}
                cooldownTicks={100}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
              />
            ) : (
              <div className="kg-empty">
                現在のフィルターに一致するトピックがありません
              </div>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="kg-sidebar">
          {/* Sidebar tabs */}
          <div className="kg-sidebar-tabs">
            <button
              className={`kg-sidebar-tab ${sidebarTab === 'insights' ? 'active' : ''}`}
              onClick={() => setSidebarTab('insights')}
            >
              Insights
            </button>
            <button
              className={`kg-sidebar-tab ${sidebarTab === 'detail' ? 'active' : ''}`}
              onClick={() => setSidebarTab('detail')}
              disabled={!selectedNode}
            >
              Topic Detail
            </button>
          </div>

          {/* Sidebar content */}
          <div className="kg-sidebar-content">
            {sidebarTab === 'insights' && (
              <TacitKnowledgeView
                knowledge={overview.tacitKnowledge}
                graphMetrics={metrics}
                topics={overview.knowledgeGraph.nodes}
              />
            )}
            {sidebarTab === 'detail' && selectedNode && (
              <KnowledgeNodeDetail
                node={selectedNode}
                edges={selectedNodeEdges}
                allTopics={overview.knowledgeGraph.nodes}
                skillCandidates={overview.tacitKnowledge?.skillCandidates}
                enrichedSequences={overview.tacitKnowledge?.enrichedToolSequences}
                onSessionSelect={onSessionSelect}
                onClose={handleCloseDetail}
              />
            )}
            {sidebarTab === 'detail' && !selectedNode && (
              <div className="kg-sidebar-empty">
                グラフのノードをクリックするとトピックの詳細が表示されます
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
