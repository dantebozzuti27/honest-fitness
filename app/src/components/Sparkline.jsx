/**
 * Sparkline Component
 * Mini line chart for quick glances at trends
 */

import { useMemo } from 'react'
import styles from './Sparkline.module.css'

export default function Sparkline({ 
  data, 
  height = 40,
  color = '#ff2d2d',
  showTrend = true
}) {
  const chartData = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return null
    
    const values = data.map(v => Number(v) || 0)
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const range = max - min || 1
    
    return { values, max, min, range }
  }, [data])

  if (!chartData || chartData.values.length === 0) {
    return <div className={styles.emptySparkline}>—</div>
  }

  const width = 100
  const padding = 2
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  // Generate path
  const points = chartData.values.map((value, i) => {
    const x = padding + (i / (chartData.values.length - 1 || 1)) * chartWidth
    const y = padding + chartHeight - ((value - chartData.min) / chartData.range) * chartHeight
    return `${x},${y}`
  }).join(' ')

  const linePath = `M ${points.split(' ')[0]} L ${points.slice(points.indexOf(' ') + 1)}`

  // Calculate trend
  const firstValue = chartData.values[0]
  const lastValue = chartData.values[chartData.values.length - 1]
  const trend = lastValue > firstValue ? 'up' : lastValue < firstValue ? 'down' : 'stable'
  const trendPercent = firstValue !== 0 
    ? Math.abs(((lastValue - firstValue) / firstValue) * 100)
    : 0

  return (
    <div className={styles.sparklineContainer}>
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className={styles.sparkline}
        preserveAspectRatio="none"
      >
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.line}
        />
        {/* First and last points */}
        {chartData.values.length > 0 && (
          <>
            <circle
              cx={points.split(' ')[0].split(',')[0]}
              cy={points.split(' ')[0].split(',')[1]}
              r="1.5"
              fill={color}
              opacity="0.6"
            />
            <circle
              cx={points.split(' ')[chartData.values.length - 1].split(',')[0]}
              cy={points.split(' ')[chartData.values.length - 1].split(',')[1]}
              r="2"
              fill={color}
            />
          </>
        )}
      </svg>
      {showTrend && (
        <div className={styles.trend}>
          {trend === 'up' && <span className={styles.trendUp}>↑</span>}
          {trend === 'down' && <span className={styles.trendDown}>↓</span>}
          {trend === 'stable' && <span className={styles.trendStable}>→</span>}
        </div>
      )}
    </div>
  )
}

