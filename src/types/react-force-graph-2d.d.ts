declare module 'react-force-graph-2d' {
  import { Component } from 'react'

  interface NodeObject {
    id?: string | number
    x?: number
    y?: number
    vx?: number
    vy?: number
    fx?: number
    fy?: number
    [key: string]: any
  }

  interface LinkObject {
    source?: string | number | NodeObject
    target?: string | number | NodeObject
    [key: string]: any
  }

  interface ForceGraphProps {
    graphData?: { nodes: NodeObject[]; links: LinkObject[] }
    width?: number
    height?: number
    backgroundColor?: string
    nodeLabel?: string | ((node: NodeObject) => string)
    nodeColor?: string | ((node: NodeObject) => string)
    nodeVal?: number | string | ((node: NodeObject) => number)
    nodeRelSize?: number
    linkColor?: string | ((link: LinkObject) => string)
    linkWidth?: number | ((link: LinkObject) => number)
    linkDirectionalParticles?: number
    onNodeClick?: (node: NodeObject, event: MouseEvent) => void
    onNodeHover?: (node: NodeObject | null, previousNode: NodeObject | null) => void
    cooldownTicks?: number
    d3AlphaDecay?: number
    d3VelocityDecay?: number
    [key: string]: any
  }

  export default class ForceGraph2D extends Component<ForceGraphProps> {}
}
