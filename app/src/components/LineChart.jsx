import { useMemo } from 'react'
import styles from './LineChart.module.css'

export default function LineChart({ data, labels, height = 200, color = '#ff2d2d', showPoints = true, showGrid = true }) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null
    
    const values = data.map(v => Number(v) || 0)
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const range = max - min || 1
    
    const padding = 10
    const chartWidth = 100 - padding * 2
    const chartHeight = height - padding * 2
    
    const points = values.map((value, i) => {
      const x = padding + (i / (values.length - 1 || 1)) * chartWidth
      const y = padding + chartHeight - ((value - min) / range) * chartHeight
      return { x, y, value }
    })
    
    const path = points.length > 1
      ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
      : ''
    
    return { points, path, min, max, range }
  }, [data, height])
  
  if (!chartData) {
    return <div className={styles.emptyChart}>No data available</div>
  }
  
  return (
    <div className={styles.chartContainer}>
      <svg viewBox={`0 0 100 ${height}`} className={styles.chart}>
        {showGrid && (
          <g className={styles.grid}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
              const y = 10 + ratio * (height - 20)
              return (
                <line
                  key={i}
                  x1="10"
                  y1={y}
                  x2="90"
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                  opacity="0.3"
                />
              )
            })}
          </g>
        )}
        {chartData.path && (
          <path
            d={chartData.path}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            className={styles.line}
          />
        )}
        {showPoints && chartData.points.map((point, i) => (
          <circle
            key={i}
            cx={point.x}
            cy={point.y}
            r="1.5"
            fill={color}
            className={styles.point}
            style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      {labels && (
        <div className={styles.labels}>
          {labels.map((label, i) => (
            <span key={i} className={styles.label}>{label}</span>
          ))}
        </div>
      )}
      <div className={styles.legend}>
        <span>Min: {chartData.min.toFixed(1)}</span>
        <span>Max: {chartData.max.toFixed(1)}</span>
      </div>
    </div>
  )
}

