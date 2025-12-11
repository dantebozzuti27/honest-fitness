/**
 * Unified Chart Component
 * Supports all chart types with consistent interactions
 * Pinch-to-zoom date range selection
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import styles from './UnifiedChart.module.css'
import { formatDateShort } from '../utils/dateUtils'

export default function UnifiedChart({
  data,
  labels,
  dates,
  type = 'bar', // 'bar', 'line', 'area'
  height = 200,
  color = 'var(--accent)',
  onDateRangeChange,
  showValues = true,
  xAxisLabel = '',
  yAxisLabel = ''
}) {
  const [dateRange, setDateRange] = useState({ start: 0, end: null })
  const [isPinching, setIsPinching] = useState(false)
  const [pinchStartDistance, setPinchStartDistance] = useState(0)
  const [pinchStartRange, setPinchStartRange] = useState({ start: 0, end: null })
  const containerRef = useRef(null)
  const touchStartRef = useRef(null)

  // Process chart data - only show dates that have actual data
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    // Get all dates that have actual data (non-null, non-undefined, non-zero if appropriate)
    const dataEntries = Object.entries(data)
      .filter(([key, value]) => {
        const numValue = Number(value)
        return !isNaN(numValue) && (numValue !== 0 || value === 0) // Include zero values
      })
    
    if (dataEntries.length === 0) return null
    
    // Sort by date to ensure chronological order
    const sortedEntries = dataEntries.sort((a, b) => {
      const dateA = new Date(a[0] + 'T12:00:00').getTime()
      const dateB = new Date(b[0] + 'T12:00:00').getTime()
      return dateA - dateB
    })
    
    // Only use dates that exist in the data
    const dataKeys = sortedEntries.map(([key]) => key)
    const dataValues = sortedEntries.map(([, value]) => Number(value) || 0)
    const max = Math.max(...dataValues, 1)
    
    // Apply date range filter (only within actual data range)
    const startIdx = Math.max(0, Math.min(dateRange.start, dataKeys.length - 1))
    const endIdx = dateRange.end !== null 
      ? Math.min(dateRange.end, dataKeys.length)
      : dataKeys.length
    
    const filteredKeys = dataKeys.slice(startIdx, endIdx)
    const filteredValues = dataValues.slice(startIdx, endIdx)
    const filteredEntries = sortedEntries.slice(startIdx, endIdx)
    
    return {
      keys: filteredKeys,
      values: filteredValues,
      entries: filteredEntries,
      max,
      total: dataKeys.length,
      startIdx,
      endIdx
    }
  }, [data, labels, dates, dateRange])

  // Calculate pinch distance
  const getDistance = (touch1, touch2) => {
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Touch handlers for pinch-to-zoom date range
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      setIsPinching(true)
      const distance = getDistance(e.touches[0], e.touches[1])
      setPinchStartDistance(distance)
      setPinchStartRange({ ...dateRange })
      touchStartRef.current = {
        touches: [e.touches[0], e.touches[1]],
        distance
      }
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && isPinching && touchStartRef.current) {
      e.preventDefault()
      const currentDistance = getDistance(e.touches[0], e.touches[1])
      const scale = currentDistance / pinchStartDistance
      
      // Calculate new date range based on pinch scale
      const totalDataPoints = chartData?.total || Object.keys(data || {}).length
      const currentRangeSize = (pinchStartRange.end !== null 
        ? pinchStartRange.end 
        : totalDataPoints) - pinchStartRange.start
      
      // Pinch out = expand range (show more data)
      // Pinch in = narrow range (show less data)
      const newRangeSize = Math.max(1, Math.min(totalDataPoints, Math.round(currentRangeSize / scale)))
      const center = pinchStartRange.start + (currentRangeSize / 2)
      const newStart = Math.max(0, Math.min(center - (newRangeSize / 2), totalDataPoints - newRangeSize))
      const newEnd = Math.min(totalDataPoints, newStart + newRangeSize)
      
      const newRange = {
        start: Math.round(newStart),
        end: newEnd >= totalDataPoints ? null : Math.round(newEnd)
      }
      
      setDateRange(newRange)
      
      // Notify parent of date range change
      if (onDateRangeChange && chartData) {
        const startDate = chartData.keys[newRange.start]
        const endDate = newRange.end !== null 
          ? chartData.keys[newRange.end - 1]
          : chartData.keys[chartData.keys.length - 1]
        onDateRangeChange({ start: startDate, end: endDate, indices: newRange })
      }
    }
  }

  const handleTouchEnd = () => {
    setIsPinching(false)
    touchStartRef.current = null
  }

  // Reset date range
  const resetDateRange = () => {
    setDateRange({ start: 0, end: null })
    if (onDateRangeChange && chartData) {
      onDateRangeChange({ 
        start: chartData.keys[0], 
        end: chartData.keys[chartData.keys.length - 1],
        indices: { start: 0, end: null }
      })
    }
  }

  // Attach touch event listeners
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)
    container.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [isPinching, pinchStartDistance, pinchStartRange, chartData, data, onDateRangeChange])

  if (!chartData || chartData.values.length === 0) {
    return (
      <div className={styles.emptyChart}>
        <div className={styles.emptyText}>No data available</div>
      </div>
    )
  }

  // Chart dimensions - use actual pixel values, not percentages
  const svgWidth = 800
  const svgHeight = height
  const padding = { top: 30, right: 40, bottom: 50, left: 60 }
  const chartWidth = svgWidth - padding.left - padding.right
  const chartHeight = svgHeight - padding.top - padding.bottom

  return (
    <div 
      ref={containerRef}
      className={styles.chartContainer}
      style={{ height: `${height}px` }}
    >
      {/* Date Range Overlay (shows when pinching) */}
      {isPinching && (
        <div className={styles.dateRangeOverlay}>
          <div className={styles.dateRangeLabel}>
            {dateRange.end !== null 
              ? `${chartData.endIdx - chartData.startIdx} of ${chartData.total} days`
              : 'All data'}
          </div>
        </div>
      )}

      {/* Chart SVG */}
      <svg 
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className={styles.chart}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={svgHeight - padding.bottom}
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="1"
        />
        
        {/* X-axis */}
        <line
          x1={padding.left}
          y1={svgHeight - padding.bottom}
          x2={svgWidth - padding.right}
          y2={svgHeight - padding.bottom}
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="1"
        />
        
        {/* Y-axis ticks */}
        {Array.from({ length: 5 }, (_, i) => {
          const tickValue = (chartData.max / 4) * i
          const y = padding.top + chartHeight - (i / 4) * chartHeight
          return (
            <g key={i}>
              <line
                x1={padding.left - 5}
                y1={y}
                x2={padding.left}
                y2={y}
                stroke="rgba(255, 255, 255, 0.2)"
                strokeWidth="1"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="var(--text-secondary)"
                className={styles.axisLabel}
              >
                {tickValue > 1000 ? `${(tickValue / 1000).toFixed(1)}k` : Math.round(tickValue)}
              </text>
            </g>
          )
        })}

        {/* Chart content based on type */}
        {type === 'bar' && (
          <>
            {chartData.values.map((value, i) => {
              const barHeight = (value / chartData.max) * chartHeight
              const barWidth = Math.max(2, (chartWidth / chartData.values.length) * 0.8)
              const x = padding.left + (i * (chartWidth / chartData.values.length)) + ((chartWidth / chartData.values.length) - barWidth) / 2
              const y = padding.top + chartHeight - barHeight
              
              return (
                <g key={i}>
                  <defs>
                    <linearGradient id={`barGradient-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor={color} stopOpacity="1" />
                      <stop offset="100%" stopColor={color} stopOpacity="0.7" />
                    </linearGradient>
                  </defs>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(1, barHeight)}
                    fill={`url(#barGradient-${i})`}
                    className={styles.bar}
                    rx="4"
                    ry="4"
                    style={{ animationDelay: `${i * 0.03}s` }}
                  />
                  {showValues && value > 0 && barHeight > 20 && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--text-primary)"
                      className={styles.valueLabel}
                    >
                      {value > 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}
                    </text>
                  )}
                </g>
              )
            })}
          </>
        )}

        {type === 'line' && (
          <>
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0.05" />
              </linearGradient>
            </defs>
            {chartData.values.length > 1 && (
              <>
                {/* Area fill */}
                <path
                  d={`M ${padding.left},${padding.top + chartHeight} ${chartData.values.map((value, i) => {
                    const x = padding.left + (i / (chartData.values.length - 1)) * chartWidth
                    const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
                    return `L ${x},${y}`
                  }).join(' ')} L ${padding.left + chartWidth},${padding.top + chartHeight} Z`}
                  fill="url(#areaGradient)"
                  className={styles.area}
                />
                {/* Line */}
                <path
                  d={`M ${chartData.values.map((value, i) => {
                    const x = padding.left + (i / (chartData.values.length - 1)) * chartWidth
                    const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
                    return i === 0 ? `${x},${y}` : `L ${x},${y}`
                  }).join(' ')}`}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.line}
                />
                {/* Points */}
                {chartData.values.map((value, i) => {
                  const x = padding.left + (i / (chartData.values.length - 1)) * chartWidth
                  const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={color}
                      stroke="rgba(0, 0, 0, 0.3)"
                      strokeWidth="1"
                      className={styles.point}
                      style={{ animationDelay: `${i * 0.05}s` }}
                    />
                  )
                })}
              </>
            )}
          </>
        )}

        {type === 'area' && (
          <>
            <defs>
              <linearGradient id="areaGradientFull" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                <stop offset="100%" stopColor={color} stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {chartData.values.length > 1 && (
              <>
                <path
                  d={`M ${padding.left},${padding.top + chartHeight} ${chartData.values.map((value, i) => {
                    const x = padding.left + (i / (chartData.values.length - 1)) * chartWidth
                    const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
                    return `L ${x},${y}`
                  }).join(' ')} L ${padding.left + chartWidth},${padding.top + chartHeight} Z`}
                  fill="url(#areaGradientFull)"
                  className={styles.area}
                />
                <path
                  d={`M ${chartData.values.map((value, i) => {
                    const x = padding.left + (i / (chartData.values.length - 1)) * chartWidth
                    const y = padding.top + chartHeight - (value / chartData.max) * chartHeight
                    return i === 0 ? `${x},${y}` : `L ${x},${y}`
                  }).join(' ')}`}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.line}
                />
              </>
            )}
          </>
        )}
      </svg>

      {/* X-axis labels */}
      {chartData.keys.length > 0 && (
        <div className={styles.xAxisLabels}>
          {chartData.keys.map((key, i) => {
            // Show fewer labels to avoid crowding
            const showLabel = chartData.keys.length <= 7 || 
                            i === 0 || 
                            i === chartData.keys.length - 1 ||
                            i % Math.ceil(chartData.keys.length / 5) === 0
            if (!showLabel) return null
            
            // Format date properly
            let displayLabel = key
            try {
              // Try to format as date if it's a date string (YYYY-MM-DD)
              if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
                displayLabel = formatDateShort(key)
              } else if (key.length > 10) {
                displayLabel = formatDateShort(key) || key.substring(0, 8)
              }
            } catch (e) {
              // Fallback to truncated string
              displayLabel = key.length > 8 ? key.substring(0, 6) + '...' : key
            }
            
            return (
              <span key={i} className={styles.xAxisLabel} title={key}>
                {displayLabel}
              </span>
            )
          })}
        </div>
      )}

      {/* Pinch hint */}
      {!isPinching && dateRange.end === null && (
        <div className={styles.pinchHint}>
          Pinch to zoom date range
        </div>
      )}

      {/* Reset button (when zoomed) */}
      {dateRange.end !== null && (
        <button
          className={styles.resetBtn}
          onClick={() => {
            if (resetDateRange && typeof resetDateRange === 'function') {
              resetDateRange()
            }
          }}
          title="Reset to full range"
        >
          Reset
        </button>
      )}
    </div>
  )
}

