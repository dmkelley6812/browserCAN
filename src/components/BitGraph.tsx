import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { CanFrame } from '../types'

// MSB → LSB order (bit 7 on top, bit 0 on bottom)
const BIT_COLORS = [
  '#e879f9', // b7
  '#818cf8', // b6
  '#38bdf8', // b5
  '#34d399', // b4
  '#a3e635', // b3
  '#fbbf24', // b2
  '#fb923c', // b1
  '#f87171', // b0
]

const ROW_H  = 28
const ROW_GAP = 5
const LEFT   = 36
const RIGHT  = 20
const TOP    = 6
const BOTTOM = 30 // x-axis labels + dataZoom slider

interface Props {
  frames: CanFrame[]
  byteIndex: number
}

export default function BitGraph({ frames, byteIndex }: Props) {
  const option = useMemo(() => {
    const timestamps = frames.map((f) => f.timestamp)

    // One series per bit (position 0=b7 MSB … 7=b0 LSB)
    const bitSeries = Array.from({ length: 8 }, (_, pos) => {
      const bitShift = 7 - pos
      return frames.map((f) => ((f.bytes[byteIndex] ?? 0) >> bitShift) & 1)
    })

    const grids = Array.from({ length: 8 }, (_, i) => ({
      left: LEFT,
      right: RIGHT,
      top: TOP + i * (ROW_H + ROW_GAP),
      height: ROW_H,
    }))

    const xAxes = Array.from({ length: 8 }, (_, i) => ({
      gridIndex: i,
      type: 'category' as const,
      data: timestamps,
      axisLine: { lineStyle: { color: '#1e293b' } },
      axisTick: { show: false },
      axisLabel: {
        show: i === 7,
        color: '#475569',
        fontSize: 9,
        hideOverlap: true,
      },
      splitLine: { show: false },
    }))

    const yAxes = Array.from({ length: 8 }, (_, i) => ({
      gridIndex: i,
      type: 'value' as const,
      min: -0.2,
      max: 1.2,
      interval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { show: false },
    }))

    const series = Array.from({ length: 8 }, (_, i) => ({
      type: 'line',
      xAxisIndex: i,
      yAxisIndex: i,
      data: bitSeries[i],
      step: 'end' as const,
      showSymbol: false,
      lineStyle: { color: BIT_COLORS[i], width: 1.5 },
      itemStyle: { color: BIT_COLORS[i] },
      areaStyle: { color: BIT_COLORS[i], opacity: 0.12 },
    }))

    // Graphic bit labels (b7 … b0) drawn on left of each row
    const graphic = Array.from({ length: 8 }, (_, i) => ({
      type: 'text',
      left: 6,
      top: TOP + i * (ROW_H + ROW_GAP) + ROW_H / 2 - 7,
      style: {
        text: `b${7 - i}`,
        fill: BIT_COLORS[i],
        fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 'bold',
      },
    }))

    return {
      backgroundColor: 'transparent',
      animation: false,
      graphic,
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        label: { show: false },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#475569', type: 'dashed' } },
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (params: any[]) => {
          if (!params.length) return ''
          const ts = timestamps[params[0]?.dataIndex ?? 0]
          // Collect one value per bit (series is one per grid, tooltip fires once per grid cell)
          // Reconstruct all 8 bits from current byte value
          const byteVal = frames[params[0]?.dataIndex ?? 0]?.bytes[byteIndex] ?? 0
          const binStr = byteVal.toString(2).padStart(8, '0')
          const bits = Array.from({ length: 8 }, (_, i) => ({
            bit: 7 - i,
            val: (byteVal >> (7 - i)) & 1,
            color: BIT_COLORS[i],
          }))
          const bitsHtml = bits
            .map((b) => `<span style="color:${b.color}">b${b.bit}</span>:<b>${b.val}</b>`)
            .join('  ')
          return `<div style="font-size:11px"><div style="color:#64748b;margin-bottom:4px">t=${ts}ms &nbsp; 0x${byteVal.toString(16).toUpperCase().padStart(2,'0')} &nbsp; <span style="font-family:monospace">${binStr}</span></div>${bitsHtml}</div>`
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: Array.from({ length: 8 }, (_, i) => i),
          filterMode: 'none',
        },
        {
          type: 'slider',
          xAxisIndex: Array.from({ length: 8 }, (_, i) => i),
          height: 14,
          bottom: 4,
          fillerColor: 'rgba(14,165,233,0.1)',
          borderColor: '#334155',
          handleStyle: { color: '#0ea5e9' },
          textStyle: { color: '#475569', fontSize: 9 },
          brushSelect: false,
        },
      ],
      series,
    }
  }, [frames, byteIndex])

  const totalHeight = TOP + 8 * (ROW_H + ROW_GAP) - ROW_GAP + BOTTOM

  return (
    <ReactECharts
      option={option}
      style={{ height: totalHeight, width: '100%' }}
      opts={{ renderer: 'canvas' }}
      notMerge
    />
  )
}
