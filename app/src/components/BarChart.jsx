import { useMemo, useState, useRef, useEffect } from 'react'
import styles from './BarChart.module.css'

export default function BarChart({ 
  data, 
  labels, 
  height = 200, 
  color = '#ff2d2d', 
  showValues = true,
  xAxisLabel = '',
  yAxisLabel = '',
  dates = null, // Array of dates corresponding to each bar
  onBarClick = null, // Callback when a bar is clicked
  dateData = null // Full date data object for detail view
}) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  const [selectedBar, setSelectedBar] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [popupZoom, setPopupZoom] = useState(1)
  const containerRef = useRef(null)
  const touchStartRef = useRef(null)
  const lastPinchDistanceRef = useRef(null)
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const values = Object.values(data).map(v => Number(v) || 0)
    const keys = labels || Object.keys(data)
    const max = Math.max(...values, 1)
    const dateKeys = dates || keys // Use dates if provided, otherwise use keys
    
    return { values, keys, max, dateKeys }
  }, [data, labels, dates])

  // Pinch/zoom handlers
  const getDistance = (touch1, touch2) => {
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      touchStartRef.current = {
        touches: [e.touches[0], e.touches[1]],
        zoom,
        pan
      }
      lastPinchDistanceRef.current = getDistance(e.touches[0], e.touches[1])
    } else if (e.touches.length === 1) {
      touchStartRef.current = {
        touches: [e.touches[0]],
        zoom,
        pan,
        startX: e.touches[0].clientX
      }
    }
  }

  const handleTouchMove = (e) => {
    if (!touchStartRef.current) return
    
    if (e.touches.length === 2 && touchStartRef.current.touches?.length === 2) {
      // Pinch zoom
      const currentDistance = getDistance(e.touches[0], e.touches[1])
      const initialDistance = lastPinchDistanceRef.current
      
      if (initialDistance > 0) {
        const scale = currentDistance / initialDistance
        const newZoom = Math.max(0.5, Math.min(3, touchStartRef.current.zoom * scale))
        setZoom(newZoom)
        lastPinchDistanceRef.current = currentDistance
      }
    } else if (e.touches.length === 1 && touchStartRef.current.startX !== undefined && zoom > 1) {
      // Pan only when zoomed
      const deltaX = e.touches[0].clientX - touchStartRef.current.startX
      const containerWidth = containerRef.current?.offsetWidth || 300
      const maxPan = (zoom - 1) * containerWidth * 0.5
      const newPan = Math.max(-maxPan, Math.min(maxPan, touchStartRef.current.pan + deltaX * 0.5))
      setPan(newPan)
      touchStartRef.current.startX = e.touches[0].clientX
    }
  }

  const handleTouchEnd = () => {
    touchStartRef.current = null
    lastPinchDistanceRef.current = null
  }

  // Reset zoom/pan
  const handleDoubleClick = () => {
    setZoom(1)
    setPan(0)
  }

  // Mouse wheel zoom
  const handleWheel = (e) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.5, Math.min(3, zoom * delta))
    setZoom(newZoom)
    if (newZoom === 1) {
      setPan(0)
    }
  }

  // Bar click handler
  const handleBarClick = (index, value, key, date) => {
    if (onBarClick) {
      onBarClick({ index, value, key, date, fullData: dateData?.[date] || dateData?.[key] })
    } else {
      // Default behavior: show detail modal
      setSelectedBar({ index, value, key, date, fullData: dateData?.[date] || dateData?.[key] })
      setShowDetail(true)
    }
  }

  // Attach event listeners with passive: false for proper zoom/pan
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const touchStart = (e) => {
      if (e.touches.length === 1 || e.touches.length === 2) {
        e.preventDefault()
      }
      handleTouchStart(e)
    }

    const touchMove = (e) => {
      if (touchStartRef.current) {
        e.preventDefault()
      }
      handleTouchMove(e)
    }

    const touchEnd = () => {
      handleTouchEnd()
    }

    const wheel = (e) => {
      e.preventDefault()
      handleWheel(e)
    }

    container.addEventListener('touchstart', touchStart, { passive: false })
    container.addEventListener('touchmove', touchMove, { passive: false })
    container.addEventListener('touchend', touchEnd, { passive: false })
    container.addEventListener('wheel', wheel, { passive: false })

    return () => {
      container.removeEventListener('touchstart', touchStart)
      container.removeEventListener('touchmove', touchMove)
      container.removeEventListener('touchend', touchEnd)
      container.removeEventListener('wheel', wheel)
    }
  }, [zoom, pan])
  
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
    <>
      <div 
        className={styles.chartContainer}
        ref={containerRef}
        onDoubleClick={handleDoubleClick}
        style={{
          height: `${height}px`,
          minHeight: `${height}px`
        }}
      >
        <div 
          className={styles.chartWrapper}
          style={{
            transform: `scale(${zoom}) translateX(${pan}px)`,
            transformOrigin: 'center center',
            transition: touchStartRef.current ? 'none' : 'transform 0.2s ease-out',
            width: '100%',
            height: '100%'
          }}
        >
        {zoom !== 1 && (
          <div className={styles.zoomIndicator}>
            {Math.round(zoom * 100)}% • Double tap to reset
          </div>
        )}
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
          const date = chartData.dateKeys[i]
          const key = chartData.keys[i]
          
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(0.5, barHeight)}
                fill={color}
                className={styles.bar}
                onClick={() => handleBarClick(i, value, key, date)}
                style={{ cursor: onBarClick || dateData ? 'pointer' : 'default' }}
              />
              {showValues && value > 0 && barHeight > 3 && (
                <text
                  x={x + barWidth / 2}
                  y={y - 1}
                  textAnchor="middle"
                  fontSize="1"
                  fill="#ffffff"
                  className={styles.value}
                  pointerEvents="none"
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
      </div>

      {/* Detail Modal with Chart Popup */}
      {showDetail && selectedBar && (
        <>
          <div className={styles.modalOverlay} onClick={() => setShowDetail(false)} />
          <div className={styles.detailModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Chart Details</h3>
              <button className={styles.closeBtn} onClick={() => setShowDetail(false)}>×</button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Date:</span>
                <span className={styles.detailValue}>{selectedBar.date || selectedBar.key}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Value:</span>
                <span className={styles.detailValue}>
                  {selectedBar.value > 1000 
                    ? `${(selectedBar.value / 1000).toFixed(1)}k` 
                    : Math.round(selectedBar.value)}
                </span>
              </div>
              
              {/* Zoom Controls */}
              <div className={styles.zoomControls}>
                <span className={styles.zoomLabel}>Zoom X-Axis:</span>
                <div className={styles.zoomButtons}>
                  <button 
                    className={styles.zoomBtn}
                    onClick={() => setPopupZoom(Math.max(0.5, popupZoom - 0.25))}
                  >
                    −
                  </button>
                  <span className={styles.zoomValue}>{Math.round(popupZoom * 100)}%</span>
                  <button 
                    className={styles.zoomBtn}
                    onClick={() => setPopupZoom(Math.min(3, popupZoom + 0.25))}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Expanded Chart View */}
              <div className={styles.popupChartContainer} style={{ transform: `scaleX(${popupZoom})` }}>
                <div className={styles.chartContainer}>
                  <div className={styles.chartWrapper}>
                    <svg viewBox="0 0 100 100" className={styles.chart} preserveAspectRatio="xMidYMid meet">
                      {/* Chart visualization would go here - simplified for popup */}
                      <text x="50" y="50" textAnchor="middle" fontSize="4" fill="#ffffff">
                        Chart View (Zoom: {Math.round(popupZoom * 100)}%)
                      </text>
                    </svg>
                  </div>
                </div>
              </div>

              {selectedBar.fullData && (
                <div className={styles.detailData}>
                  <h4>Full Data:</h4>
                  <pre className={styles.dataPreview}>
                    {JSON.stringify(selectedBar.fullData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
