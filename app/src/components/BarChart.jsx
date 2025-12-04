import { useMemo } from 'react'
import styles from './BarChart.module.css'

export default function BarChart({ 
  data, 
  labels, 
  height = 200, 
  color = '#ff2d2d', 
  showValues = true,
  xAxisLabel = '',
  yAxisLabel = ''
}) {
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
  
  // Calculate chart dimensions with space for axes
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartWidth = 100 - padding.left - padding.right
  const chartHeight = 100 - padding.top - padding.bottom
  const barWidth = Math.max(3, chartWidth / Math.max(chartData.values.length, 1) * 0.8)
  const barSpacing = chartWidth / chartData.values.length
  
  // Generate Y-axis ticks
  const yTicks = 5
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    return (chartData.max / (yTicks - 1)) * i
  })
  
  return (
    <div className={styles.chartContainer}>
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
        />
        
        {/* X-axis line */}
        <line
          x1={padding.left}
          y1={100 - padding.bottom}
          x2={100 - padding.right}
          y2={100 - padding.bottom}
          stroke="#ffffff"
          strokeWidth="0.5"
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
              />
              <text
                x={padding.left - 5}
                y={y + 1}
                textAnchor="end"
                fontSize="1.5"
                fill="#ffffff"
                className={styles.axisLabel}
              >
                {tickValue > 1000 ? `${(tickValue / 1000).toFixed(1)}k` : Math.round(tickValue)}
              </text>
            </g>
          )
        })}
        
        {/* Bars */}
        {chartData.values.map((value, i) => {
          const barHeight = chartData.max > 0 ? (value / chartData.max) * chartHeight : 0
          const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2
          const y = padding.top + chartHeight - barHeight
          
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(0.5, barHeight)}
                fill={color}
                className={styles.bar}
              />
              {showValues && value > 0 && barHeight > 3 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 1}
                  textAnchor="middle"
                  fontSize="1"
                  fill="#ffffff"
                  className={styles.value}
                >
                  {value > 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}
                </text>
              )}
            </g>
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

