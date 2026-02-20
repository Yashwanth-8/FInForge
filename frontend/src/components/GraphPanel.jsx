import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import styles from './GraphPanel.module.css'

const RING_COLORS = {
  cycle: '#ef4444',
  smurfing: '#f5c518',
  shell_network: '#c084fc',
}

export default function GraphPanel({ graphData, suspiciousAccounts, fraudRings }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const zoomRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)

  useEffect(() => {
    if (!graphData || !svgRef.current) return

    const container = containerRef.current
    const W = container.clientWidth || 820
    const H = 580

    const suspiciousMap = new Map(suspiciousAccounts.map(s => [s.account_id, s]))
    const ringColorMap = new Map()
    fraudRings.forEach(ring => {
      const color = RING_COLORS[ring.pattern_type] || '#60a5fa'
      ring.member_accounts.forEach(m => ringColorMap.set(m, { color, ring }))
    })

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', W).attr('height', H)

    const defs = svg.append('defs')

    const mkArrow = (id, color) => {
      defs.append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0,-5L10,0L0,5Z')
        .attr('fill', color).attr('opacity', 0.9)
    }
    mkArrow('arrowNormal', '#2a3347')
    mkArrow('arrowSusp', '#ff3b6b')
    mkArrow('arrowCycle', '#ef4444')
    mkArrow('arrowSmurf', '#f5c518')
    mkArrow('arrowShell', '#c084fc')

    const filt = defs.append('filter').attr('id', 'glow')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    filt.append('feGaussianBlur').attr('stdDeviation', '3.5').attr('result', 'blur')
    const merge = filt.append('feMerge')
    merge.append('feMergeNode').attr('in', 'blur')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    // ── KEY FIX: all nodes share the same mutable objects ─────────────────
    // Do NOT filter before passing to simulation — filter AFTER so D3 mutates
    // the same objects that both node groups reference.
    const nodes = graphData.nodes.map(n => ({ ...n }))
    const edges = graphData.edges.map(e => ({ ...e }))

    setNodeCount(nodes.length)
    setEdgeCount(edges.length)

    const zoom = d3.zoom().scaleExtent([0.05, 8]).on('zoom', e => g.attr('transform', e.transform))
    svg.call(zoom)
    zoomRef.current = zoom

    const g = svg.append('g')

    const getR = d => d.suspicious ? Math.min(20, 8 + Math.sqrt(d.tx_total || 1) * 1.2) : 3

    // ── Run simulation FIRST so x,y get assigned before rendering ────────
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id)
        .distance(d => {
          const src = typeof d.source === 'object' ? d.source.id : d.source
          const tgt = typeof d.target === 'object' ? d.target.id : d.target
          if (suspiciousMap.has(src) && suspiciousMap.has(tgt)) return 65
          if (suspiciousMap.has(src) || suspiciousMap.has(tgt)) return 85
          return 35
        })
        .strength(0.3)
      )
      .force('charge', d3.forceManyBody().strength(d => d.suspicious ? -220 : -35))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius(d => getR(d) + (d.suspicious ? 10 : 3)))
      .stop()

    // Warm up simulation — run ticks synchronously so initial positions are set
    const warmupTicks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()))
    for (let i = 0; i < Math.min(warmupTicks, 300); i++) sim.tick()

    // ── Now split nodes by suspicious flag — positions already set ────────
    const normalNodes = nodes.filter(d => !d.suspicious)
    const suspNodes = nodes.filter(d => d.suspicious)

    // Split edges
    const normalEdges = edges.filter(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source
      const tgt = typeof e.target === 'object' ? e.target.id : e.target
      return !suspiciousMap.has(src) && !suspiciousMap.has(tgt)
    })
    const fraudEdges = edges.filter(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source
      const tgt = typeof e.target === 'object' ? e.target.id : e.target
      return suspiciousMap.has(src) || suspiciousMap.has(tgt)
    })

    // ── LAYER 1: normal edges ─────────────────────────────────────────────
    const normalLinkSel = g.append('g').selectAll('line')
      .data(normalEdges).join('line')
      .attr('stroke', 'rgba(255,255,255,0.06)')
      .attr('stroke-width', 0.5)

    // ── LAYER 2: fraud edges ──────────────────────────────────────────────
    const fraudLinkSel = g.append('g').selectAll('line')
      .data(fraudEdges).join('line')
      .attr('stroke', d => {
        const src = typeof d.source === 'object' ? d.source.id : d.source
        const rc = ringColorMap.get(src)
        return rc ? rc.color + '90' : 'rgba(255,59,107,0.45)'
      })
      .attr('stroke-width', 1.4)
      .attr('marker-end', d => {
        const src = typeof d.source === 'object' ? d.source.id : d.source
        const rc = ringColorMap.get(src)
        if (!rc) return 'url(#arrowSusp)'
        if (rc.ring.pattern_type === 'cycle') return 'url(#arrowCycle)'
        if (rc.ring.pattern_type === 'smurfing') return 'url(#arrowSmurf)'
        if (rc.ring.pattern_type === 'shell_network') return 'url(#arrowShell)'
        return 'url(#arrowSusp)'
      })

    // ── LAYER 3: normal nodes ─────────────────────────────────────────────
    const normalNodeGroup = g.append('g').selectAll('g')
      .data(normalNodes).join('g')
      .attr('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        const rect = container.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14,
          id: d.id, txIn: d.tx_in, txOut: d.tx_out,
          totalIn: d.total_in, totalOut: d.total_out,
          suspScore: null, ringId: null, patterns: [], ringColor: null,
        })
      })
      .on('mousemove', event => {
        const rect = container.getBoundingClientRect()
        setTooltip(t => t ? { ...t, x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 } : null)
      })
      .on('mouseout', () => setTooltip(null))

    normalNodeGroup.append('circle')
      .attr('r', 3)
      .attr('fill', 'rgba(0,229,255,0.12)')
      .attr('stroke', 'rgba(0,229,255,0.28)')
      .attr('stroke-width', 0.7)

    // ── LAYER 4: suspicious nodes ─────────────────────────────────────────
    const suspNodeGroup = g.append('g').selectAll('g')
      .data(suspNodes).join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on('mouseover', (event, d) => {
        const susp = suspiciousMap.get(d.id)
        const rc = ringColorMap.get(d.id)
        const rect = container.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14,
          id: d.id, txIn: d.tx_in, txOut: d.tx_out,
          totalIn: d.total_in, totalOut: d.total_out,
          suspScore: susp?.suspicion_score,
          ringId: susp?.ring_id,
          patterns: susp?.detected_patterns,
          ringColor: rc?.color,
        })
      })
      .on('mousemove', event => {
        const rect = container.getBoundingClientRect()
        setTooltip(t => t ? { ...t, x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 } : null)
      })
      .on('mouseout', () => setTooltip(null))

    // glow ring
    suspNodeGroup.append('circle')
      .attr('r', d => getR(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', d => ringColorMap.get(d.id)?.color || '#ff3b6b')
      .attr('stroke-width', 1.5).attr('opacity', 0.3)
      .attr('filter', 'url(#glow)')

    // main circle
    suspNodeGroup.append('circle')
      .attr('r', getR)
      .attr('fill', d => {
        const rc = ringColorMap.get(d.id)
        return rc ? rc.color + '22' : 'rgba(255,59,107,0.15)'
      })
      .attr('stroke', d => ringColorMap.get(d.id)?.color || '#ff3b6b')
      .attr('stroke-width', 2)

    // label
    suspNodeGroup.append('text')
      .text(d => d.id.length > 12 ? '…' + d.id.slice(-7) : d.id)
      .attr('text-anchor', 'middle')
      .attr('dy', d => getR(d) + 13)
      .attr('font-size', '9px')
      .attr('font-family', 'Space Mono, monospace')
      .attr('fill', d => ringColorMap.get(d.id)?.color || '#ff3b6b')
      .attr('pointer-events', 'none')

    // ── Position everything from warmed-up simulation ─────────────────────
    const positionAll = () => {
      normalLinkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)

      fraudLinkSel.each(function (d) {
        const sx = d.source.x, sy = d.source.y
        const tx = d.target.x, ty = d.target.y
        const dx = tx - sx, dy = ty - sy
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const targetR = getR(d.target) + 8
        const ratio = Math.max(0, (dist - targetR) / dist)
        d3.select(this)
          .attr('x1', sx).attr('y1', sy)
          .attr('x2', sx + dx * ratio).attr('y2', sy + dy * ratio)
      })

      normalNodeGroup.attr('transform', d => `translate(${d.x},${d.y})`)
      suspNodeGroup.attr('transform', d => `translate(${d.x},${d.y})`)
    }

    // Draw initial positions immediately
    positionAll()

    // Then resume simulation for live animation
    sim.on('tick', positionAll).restart()

    return () => sim.stop()

  }, [graphData, suspiciousAccounts, fraudRings])

  const resetZoom = () => {
    if (zoomRef.current && svgRef.current) {
      d3.select(svgRef.current).transition().duration(600).call(
        zoomRef.current.transform, d3.zoomIdentity
      )
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>
          Transaction Network Graph
          <span className={styles.badge}>{nodeCount} nodes · {edgeCount} edges</span>
        </div>
        <button className={styles.resetBtn} onClick={resetZoom}>⊕ Reset Zoom</button>
      </div>

      <div className={styles.sectionLabel}>03 · Visualization</div>

      <div className={styles.graphWrap} ref={containerRef}>
        <svg ref={svgRef} className={styles.svg} />

        <div className={styles.legend}>
          {[
            { color: 'rgba(0,229,255,0.12)', border: 'rgba(0,229,255,0.28)', label: 'Normal' },
            { color: '#ef444422', border: '#ef4444', label: 'Cycle Ring' },
            { color: '#f5c51822', border: '#f5c518', label: 'Smurfing' },
            { color: '#c084fc22', border: '#c084fc', label: 'Shell Network' },
          ].map(l => (
            <div key={l.label} className={styles.legendItem}>
              <svg width="13" height="13">
                <circle cx="6.5" cy="6.5" r="5.5" fill={l.color} stroke={l.border} strokeWidth="1.4" />
              </svg>
              {l.label}
            </div>
          ))}
        </div>

        {tooltip && (
          <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
            <div className={styles.tooltipId} style={{ color: tooltip.ringColor || 'var(--accent)' }}>
              {tooltip.id}
            </div>
            <div className={styles.tooltipRow}><span>Tx In</span><span>{tooltip.txIn}</span></div>
            <div className={styles.tooltipRow}><span>Tx Out</span><span>{tooltip.txOut}</span></div>
            <div className={styles.tooltipRow}><span>Vol In</span><span>{tooltip.totalIn?.toFixed(0)}</span></div>
            <div className={styles.tooltipRow}><span>Vol Out</span><span>{tooltip.totalOut?.toFixed(0)}</span></div>
            {tooltip.suspScore != null && (
              <div className={styles.tooltipRow}>
                <span>Suspicion</span>
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{tooltip.suspScore}%</span>
              </div>
            )}
            {tooltip.ringId && (
              <div className={styles.tooltipRow}>
                <span>Ring</span>
                <span style={{ color: tooltip.ringColor }}>{tooltip.ringId}</span>
              </div>
            )}
            {tooltip.patterns?.length > 0 && (
              <div className={styles.tooltipPatterns}>
                {tooltip.patterns.map(p => (
                  <span key={p} className={styles.tooltipTag}>{p.replace(/_/g, ' ')}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}