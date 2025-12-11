/**
 * Line Chart Component
 * Apple-style line chart with smooth gradients and animations
 */

import { useMemo } from 'react'
import styles from './LineChart.module.css'

export default function LineChart({ 
  data, 
  labels, 
  height = 200, 
  color = '#ff2d2d',
  showValues = false,
  xAxisLabel = '',
  yAxisLabel = '',
  dates = null,
  dateData = null
}) {
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const values = Object.values(data).map(v => Number(v) || 0)
    const keys = labels || Object.keys(data)
    const max = Math.max(...values, 1)
    const dateKeys = dates || keys
    
    return { values, keys, max, dateKeys }
  }, [data, labels, dates])

  if (!chartData || chartData.values.length === 0) {
    return <div className={styles.emptyChart}>No data available</div>
  }

  const padding = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartWidth = 100 - padding.left - padding.right
  const chartHeight = 100 - padding.top - padding.bottom

  // Generate path for line
  const points = chartData.values.map((value, i) => {
    const x = padding.left + (i / (chartData.values.length - 1 || 1)) * chartWidth
    const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
    return `${x},${y}`
  }).join(' ')

  // Generate area path (for gradient fill)
  const areaPath = `M ${padding.left},${padding.top + chartHeight} L ${points} L ${padding.left + chartWidth},${padding.top + chartHeight} Z`

  // Generate line path
  const linePath = `M ${points.split(' ')[0]} L ${points.slice(points.indexOf(' ') + 1)}`

  // Y-axis ticks
  const yTicks = 5
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    return (chartData.max / (yTicks - 1)) * i
  })

  return (
    <div className={styles.chartContainer} style={{ height: `${height}px` }}>
      {yAxisLabel && (
        <div className={styles.yAxisLabel}>{yAxisLabel}</div>
      )}
      <svg viewBox="0 0 100 100" className={styles.chart} preserveAspectRatio="xMidYMid meet">
        {/* Y-axis line */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={100 - padding.bottom}
          stroke="#ffffff"
          strokeWidth="0.5"
          opacity="0.3"
        />
        
        {/* X-axis line */}
        <line
          x1={padding.left}
          y1={100 - padding.bottom}
          x2={100 - padding.right}
          y2={100 - padding.bottom}
          stroke="#ffffff"
          strokeWidth="0.5"
          opacity="0.3"
        />
        
        {/* Y-axis ticks and labels */}
        {yTickValues.map((tickValue, i) => {
          const y = padding.top + (chartHeight - ((tickValue / chartData.max) * chartHeight))
          return (
            <g key={i}>
              <line
                x1={padding.left - 2}
                y1={y}
                x2={padding.left}
                y2={y}
                stroke="#ffffff"
                strokeWidth="0.3"
                opacity="0.3"
              />
              <text
                x={padding.left - 5}
                y={y + 1}
                textAnchor="end"
                fontSize="1.5"
                fill="#ffffff"
                className={styles.axisLabel}
                opacity="0.7"
              >
                {tickValue > 1000 ? `${(tickValue / 1000).toFixed(1)}k` : Math.round(tickValue)}
              </text>
            </g>
          )
        })}
        
        {/* Gradient definition for area */}
        <defs>
          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        
        {/* Area fill */}
        <path
          d={areaPath}
          fill="url(#areaGradient)"
          className={styles.area}
        />
        
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.line}
        />
        
        {/* Data points */}
        {chartData.values.map((value, i) => {
          const x = padding.left + (i / (chartData.values.length - 1 || 1)) * chartWidth
          const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="2"
              fill={color}
              className={styles.point}
              style={{ animationDelay: `${i * 0.05}s` }}
            />
          )
        })}
      </svg>
      
      {/* X-axis labels */}
      {chartData.keys && chartData.keys.length > 0 && (
        <div className={styles.xAxisLabels}>
          {chartData.keys.map((key, i) => (
            <span key={i} className={styles.xAxisLabel}>{key}</span>
          ))}
        </div>
      )}
      
      {xAxisLabel && (
        <div className={styles.xAxisLabelText}>{xAxisLabel}</div>
      )}
    </div>
  )
}
