import { useMemo } from 'react'
import styles from './BarChart.module.css'

export default function BarChart({ data, labels, height = 200, color = '#ff2d2d', showValues = true }) {
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const values = Object.values(data).map(v => Number(v) || 0)
    const keys = Object.keys(data)
    const max = Math.max(...values, 1)
    
    return { values, keys, max }
  }, [data])
  
  if (!chartData) {
    return <div className={styles.emptyChart}>No data available</div>
  }
  
  const barWidth = 80 / chartData.values.length
  
  return (
    <div className={styles.chartContainer}>
      <svg viewBox="0 0 100 100" className={styles.chart}>
        {chartData.values.map((value, i) => {
          const barHeight = (value / chartData.max) * 70
          const x = 10 + i * barWidth
          const y = 90 - barHeight
          
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth * 0.8}
                height={barHeight}
                fill={color}
                className={styles.bar}
                opacity="0.8"
              />
              {showValues && value > 0 && (
                <text
                  x={x + barWidth * 0.4}
                  y={y - 2}
                  textAnchor="middle"
                  fontSize="3"
                  fill="var(--text-primary)"
                  className={styles.value}
                >
                  {value}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {labels && (
        <div className={styles.labels}>
          {chartData.keys.map((key, i) => (
            <span key={i} className={styles.label}>{key}</span>
          ))}
        </div>
      )}
    </div>
  )
}

