/**
 * Pie/Donut Chart Component
 * Apple-style pie chart for distributions
 */

import { useMemo } from 'react'
import styles from './PieChart.module.css'

export default function PieChart({ 
  data, 
  height = 200,
  donut = false,
  showLabels = true,
  showLegend = true,
  colors = ['#ff2d2d', '#4ade80', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'],
  onSegmentClick
}) {
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const entries = Object.entries(data)
      .map(([key, value]) => ({ key, value: Number(value) || 0 }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
    
    const total = entries.reduce((sum, item) => sum + item.value, 0)
    
    if (total === 0) return null
    
    let currentAngle = -90 // Start at top
    const segments = entries.map((item, i) => {
      const percentage = (item.value / total) * 100
      const angle = (item.value / total) * 360
      const startAngle = currentAngle
      const endAngle = currentAngle + angle
      currentAngle = endAngle
      
      return {
        ...item,
        percentage,
        angle,
        startAngle,
        endAngle,
        color: colors[i % colors.length]
      }
    })
    
    return { segments, total }
  }, [data, colors])

  if (!chartData || chartData.segments.length === 0) {
    return <div className={styles.emptyChart}>No data available</div>
  }

  const size = height
  const center = size / 2
  const radius = (size - 40) / 2
  const innerRadius = donut ? radius * 0.6 : 0

  // Convert angle to radians and calculate path
  const getPath = (startAngle, endAngle, innerR, outerR) => {
    const start = polarToCartesian(center, center, outerR, endAngle)
    const end = polarToCartesian(center, center, outerR, startAngle)
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0
    
    if (innerR === 0) {
      // Pie chart
      return [
        'M', center, center,
        'L', start.x, start.y,
        'A', outerR, outerR, 0, largeArcFlag, 0, end.x, end.y,
        'Z'
      ].join(' ')
    } else {
      // Donut chart
      const innerStart = polarToCartesian(center, center, innerR, endAngle)
      const innerEnd = polarToCartesian(center, center, innerR, startAngle)
      
      return [
        'M', start.x, start.y,
        'A', outerR, outerR, 0, largeArcFlag, 0, end.x, end.y,
        'L', innerEnd.x, innerEnd.y,
        'A', innerR, innerR, 0, largeArcFlag, 1, innerStart.x, innerStart.y,
        'Z'
      ].join(' ')
    }
  }

  function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    }
  }

  return (
    <div className={styles.chartContainer} style={{ height: `${height}px` }}>
      <svg 
        viewBox={`0 0 ${size} ${size}`} 
        className={styles.chart} 
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%' }}
      >
        {chartData.segments.map((segment, i) => {
          const path = getPath(segment.startAngle, segment.endAngle, innerRadius, radius)
          const midAngle = (segment.startAngle + segment.endAngle) / 2
          const labelRadius = innerRadius + (radius - innerRadius) / 2
          const labelPos = polarToCartesian(center, center, labelRadius, midAngle)
          
          return (
            <g key={i}>
              <path
                d={path}
                fill={segment.color}
                className={styles.segment}
                style={{ 
                  animationDelay: `${i * 0.1}s`,
                  filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))'
                }}
                onClick={() => {
                  if (onSegmentClick && typeof onSegmentClick === 'function') {
                    onSegmentClick(segment)
                  }
                }}
                onTouchStart={(e) => {
                  e.preventDefault()
                  if (onSegmentClick && typeof onSegmentClick === 'function') {
                    onSegmentClick(segment)
                  }
                }}
              />
              {showLabels && segment.percentage > 5 && (
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="3"
                  fill="#ffffff"
                  className={styles.label}
                  fontWeight="600"
                >
                  {Math.round(segment.percentage)}%
                </text>
              )}
            </g>
          )
        })}
      </svg>
      
      {showLegend && (
        <div className={styles.legend}>
          {chartData.segments.map((segment, i) => (
            <div key={i} className={styles.legendItem}>
              <div 
                className={styles.legendColor} 
                style={{ backgroundColor: segment.color }}
              />
              <span className={styles.legendLabel}>{segment.key}</span>
              <span className={styles.legendValue}>
                {segment.value.toLocaleString()} ({Math.round(segment.percentage)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

