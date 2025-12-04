import { useMemo } from 'react'
import styles from './BarChart.module.css'

export default function BarChart({ data, labels, height = 200, color = 'var(--text-primary)', showValues = true }) {
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const values = Object.values(data).map(v => Number(v) || 0)
    const keys = labels || Object.keys(data)
    const max = Math.max(...values, 1)
    
    return { values, keys, max }
  }, [data, labels])
  
  if (!chartData || chartData.values.length === 0) {
    return <div className={styles.emptyChart}>No data available</div>
  }
  
  const barWidth = Math.max(5, 80 / Math.max(chartData.values.length, 1))
  
  return (
    <div className={styles.chartContainer}>
      <svg viewBox="0 0 100 100" className={styles.chart} preserveAspectRatio="xMidYMid meet">
        {chartData.values.map((value, i) => {
          const barHeight = chartData.max > 0 ? (value / chartData.max) * 70 : 0
          const x = 10 + i * barWidth
          const y = 90 - barHeight
          
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={Math.max(2, barWidth * 0.8)}
                height={Math.max(1, barHeight)}
                fill={color}
                stroke={color}
                strokeWidth="0.5"
                className={styles.bar}
                opacity="0.9"
              />
              {showValues && value > 0 && barHeight > 5 && (
                <text
                  x={x + barWidth * 0.4}
                  y={y - 2}
                  textAnchor="middle"
                  fontSize="2.5"
                  fill="var(--text-primary)"
                  className={styles.value}
                >
                  {value > 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {chartData.keys && chartData.keys.length > 0 && (
        <div className={styles.labels}>
          {chartData.keys.map((key, i) => (
            <span key={i} className={styles.label}>{key}</span>
          ))}
        </div>
      )}
    </div>
  )
}

