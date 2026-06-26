import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { CanFrame } from '../types'

export const BYTE_COLORS = [
  '#38bdf8', '#34d399', '#a78bfa', '#fbbf24',
  '#f87171', '#22d3ee', '#a3e635', '#e879f9',
]

const DOWNSAMPLE_THRESHOLD = 500

interface Props {
  frames: CanFrame[]
  visibleBytes: Set<number>
  byteCount: number
  height?: number
  singleByte?: number
  title?: string
  autoScale?: boolean
  downsample?: boolean
}

export default function ByteGraph({
  frames, visibleBytes, byteCount, height = 200, singleByte, title, autoScale = false, downsample = true,
}: Props) {
  const byteIndices = useMemo(() => (
    singleByte !== undefined
      ? [singleByte]
      : Array.from({ length: byteCount }, (_, i) => i).filter((i) => visibleBytes.has(i))
  ), [singleByte, byteCount, visibleBytes])

  const { yMin, yMax } = useMemo(() => {
    if (!autoScale || byteIndices.length === 0) return { yMin: 0, yMax: 255 }
    let lo = 255, hi = 0
    for (const f of frames) {
      for (const bi of byteIndices) {
        const v = f.bytes[bi] ?? 0
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (lo === hi) { lo = Math.max(0, lo - 10); hi = Math.min(255, hi + 10) }
    const pad = Math.max(2, Math.round((hi - lo) * 0.12))
    return { yMin: Math.max(0, lo - pad), yMax: Math.min(255, hi + pad) }
  }, [frames, byteIndices, autoScale])

  const option = useMemo(() => {
    const timestamps = frames.map((f) => f.timestamp)
    const hasLegend = byteIndices.length > 1

    const series = byteIndices.map((byteIdx) => ({
      name: `B${byteIdx + 1}`,
      type: 'line',
      data: frames.map((f) => f.bytes[byteIdx] ?? 0),
      sampling: downsample && frames.length > DOWNSAMPLE_THRESHOLD ? 'lttb' : undefined,
      smooth: false,
      showSymbol: frames.length < 80,
      symbolSize: 3,
      lineStyle: { color: BYTE_COLORS[byteIdx % BYTE_COLORS.length], width: 1.5 },
      itemStyle: { color: BYTE_COLORS[byteIdx % BYTE_COLORS.length] },
      emphasis: { focus: 'series' },
    }))

    const range = yMax - yMin
    const yFormatter = (v: number) => {
      if (range <= 20) return `${Math.round(v)}`
      return `0x${Math.round(v).toString(16).toUpperCase().padStart(2, '0')}`
    }

    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 52, right: 36, top: title ? 28 : 12, bottom: hasLegend ? 46 : 40 },
      title: title ? {
        text: title,
        textStyle: { color: '#94a3b8', fontSize: 11, fontWeight: 'normal', fontFamily: 'JetBrains Mono, monospace' },
        left: 4,
        top: 2,
      } : undefined,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (params: any[]) => {
          const ts = timestamps[params[0]?.dataIndex ?? 0]
          const lines = params.map(
            (p: any) =>
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}: <b>${p.value}</b> (0x${Number(p.value).toString(16).toUpperCase().padStart(2, '0')})`,
          )
          return `<div style="font-size:11px"><div style="color:#64748b;margin-bottom:4px">t=${ts}ms</div>${lines.join('<br/>')}</div>`
        },
        axisPointer: { type: 'line', lineStyle: { color: '#475569', type: 'dashed' } },
      },
      legend: hasLegend ? {
        data: byteIndices.map((i) => `B${i + 1}`),
        textStyle: { color: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        bottom: 22,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      } : undefined,
      xAxis: {
        type: 'category',
        data: timestamps,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#475569', fontSize: 10, showMaxLabel: true, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#475569', fontSize: 10, formatter: yFormatter },
        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        {
          type: 'slider',
          xAxisIndex: 0,
          height: 14,
          bottom: hasLegend ? 4 : 4,
          fillerColor: 'rgba(14,165,233,0.1)',
          borderColor: '#334155',
          handleStyle: { color: '#0ea5e9' },
          textStyle: { color: '#475569', fontSize: 9 },
          brushSelect: false,
        },
        {
          type: 'slider',
          yAxisIndex: 0,
          orient: 'vertical',
          width: 14,
          right: 4,
          fillerColor: 'rgba(14,165,233,0.1)',
          borderColor: '#334155',
          handleStyle: { color: '#0ea5e9' },
          textStyle: { show: false },
          brushSelect: false,
        },
      ],
      series,
    }
  }, [frames, byteIndices, title, yMin, yMax, downsample])

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
      notMerge
    />
  )
}
