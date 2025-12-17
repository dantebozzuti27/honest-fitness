import { useMemo, useState, useRef, useEffect } from 'react'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import Modal from './Modal'
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
  dateData = null, // Full date data object for detail view
  chartTitle = '' // Title for sharing
}) {
  const { toast, showToast, hideToast } = useToast()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  const [selectedBar, setSelectedBar] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [popupZoom, setPopupZoom] = useState(1)
  const [dataRangeStart, setDataRangeStart] = useState(0) // For scale-based zoom
  const [dataRangeEnd, setDataRangeEnd] = useState(null) // For scale-based zoom
  const containerRef = useRef(null)
  const touchStartRef = useRef(null)
  const lastPinchDistanceRef = useRef(null)
  const chartRef = useRef(null)
  const detailModalRef = useRef(null)
  const detailCloseBtnRef = useRef(null)
  const chartData = useMemo(() => {
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    
    const values = Object.values(data).map(v => Number(v) || 0)
    const keys = labels || Object.keys(data)
    const max = Math.max(...values, 1)
    const dateKeys = dates || keys // Use dates if provided, otherwise use keys
    
    return { values, keys, max, dateKeys }
  }, [data, labels, dates])

  // Pinch/zoom handlers - changes time scale in detail modal
  const getDistance = (touch1, touch2) => {
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handleTouchStart = (e) => {
    if (showDetail && visibleData) {
      // In detail modal, track pinch for time scale
      if (e.touches.length === 2) {
        touchStartRef.current = {
          touches: [e.touches[0], e.touches[1]],
          zoom: popupZoom,
          dataRangeStart
        }
        lastPinchDistanceRef.current = getDistance(e.touches[0], e.touches[1])
      }
    } else {
      // On main chart, use image zoom (legacy behavior)
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
  }

  const handleTouchMove = (e) => {
    if (!touchStartRef.current) return
    
    if (showDetail && visibleData && e.touches.length === 2 && touchStartRef.current.touches?.length === 2) {
      // Pinch zoom in detail modal - changes time scale
      const currentDistance = getDistance(e.touches[0], e.touches[1])
      const initialDistance = lastPinchDistanceRef.current
      
      if (initialDistance > 0) {
        const scale = currentDistance / initialDistance
        const newZoom = Math.max(0.5, Math.min(5, touchStartRef.current.zoom * scale))
        setPopupZoom(newZoom)
        lastPinchDistanceRef.current = currentDistance
        
        // Adjust data range
        if (chartData) {
          const totalBars = chartData.values.length
          const visibleCount = Math.max(1, Math.floor(totalBars / newZoom))
          const centerIdx = Math.floor((visibleData.startIdx + visibleData.endIdx) / 2)
          const newStart = Math.max(0, Math.min(centerIdx - Math.floor(visibleCount / 2), totalBars - visibleCount))
          setDataRangeStart(newStart)
        }
      }
    } else if (!showDetail && e.touches.length === 2 && touchStartRef.current.touches?.length === 2) {
      // Pinch zoom on main chart (legacy image zoom)
      const currentDistance = getDistance(e.touches[0], e.touches[1])
      const initialDistance = lastPinchDistanceRef.current
      
      if (initialDistance > 0) {
        const scale = currentDistance / initialDistance
        const newZoom = Math.max(0.5, Math.min(3, touchStartRef.current.zoom * scale))
        setZoom(newZoom)
        lastPinchDistanceRef.current = currentDistance
      }
    } else if (!showDetail && e.touches.length === 1 && touchStartRef.current.startX !== undefined && zoom > 1) {
      // Pan only when zoomed (main chart only)
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

  // Mouse wheel zoom - changes time scale (data range) instead of image zoom
  const handleWheel = (e) => {
    if (showDetail && visibleData) {
      // In detail modal, change data range (time scale)
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1.25 : 0.8
      const newZoom = Math.max(0.5, Math.min(5, popupZoom * delta))
      setPopupZoom(newZoom)
      
      // Adjust data range to show more/less data
      if (chartData) {
        const totalBars = chartData.values.length
        const visibleCount = Math.max(1, Math.floor(totalBars / newZoom))
        const centerIdx = Math.floor((visibleData.startIdx + visibleData.endIdx) / 2)
        const newStart = Math.max(0, Math.min(centerIdx - Math.floor(visibleCount / 2), totalBars - visibleCount))
        setDataRangeStart(newStart)
      }
    } else {
      // On main chart, use image zoom (legacy behavior)
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.5, Math.min(3, zoom * delta))
      setZoom(newZoom)
      if (newZoom === 1) {
        setPan(0)
      }
    }
  }

  // Bar click handler - opens popup modal
  const handleBarClick = (index, value, key, date) => {
    if (onBarClick) {
      onBarClick({ index, value, key, date, fullData: dateData?.[date] || dateData?.[key] })
    } else {
      // Default behavior: show detail modal with full chart
      setPopupZoom(1) // Reset zoom when opening
      setDataRangeStart(0) // Reset data range when opening
      setSelectedBar({ index, value, key, date, fullData: dateData?.[date] || dateData?.[key] })
      setShowDetail(true)
    }
  }

  // Chart container click - opens full chart popup
  const handleChartClick = (e) => {
    if (e.target.closest('.bar') || e.target.closest('rect')) return // Don't trigger on bar clicks
    if (chartData && chartData.values.length > 0) {
      setSelectedBar({ 
        index: 0, 
        value: chartData.values[0], 
        key: chartData.keys[0], 
        date: chartData.dateKeys[0],
        fullData: dateData?.[chartData.dateKeys[0]] || dateData?.[chartData.keys[0]] || data
      })
      setShowDetail(true)
      setPopupZoom(1)
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
  
  // Calculate visible data range based on zoom
  const visibleData = useMemo(() => {
    if (!chartData || !showDetail) return null
    const totalBars = chartData.values.length
    if (totalBars === 0) return null
    
    const visibleCount = Math.max(1, Math.floor(totalBars / popupZoom))
    const startIdx = Math.max(0, Math.min(dataRangeStart, totalBars - visibleCount))
    const endIdx = Math.min(totalBars, startIdx + visibleCount)
    
    const slicedValues = chartData.values.slice(startIdx, endIdx)
    const slicedKeys = chartData.keys.slice(startIdx, endIdx)
    const slicedDateKeys = chartData.dateKeys.slice(startIdx, endIdx)
    
    if (slicedValues.length === 0) return null
    
    return {
      values: slicedValues,
      keys: slicedKeys,
      dateKeys: slicedDateKeys,
      max: Math.max(...slicedValues, 1),
      startIdx,
      endIdx
    }
  }, [chartData, popupZoom, dataRangeStart, showDetail])

  return (
    <>
      <div 
        className={styles.chartContainer}
        ref={containerRef}
        onDoubleClick={() => {
          if (handleDoubleClick && typeof handleDoubleClick === 'function') {
            handleDoubleClick()
          }
        }}
        onClick={(e) => {
          if (handleChartClick && typeof handleChartClick === 'function') {
            handleChartClick(e)
          }
        }}
        style={{
          height: `${height}px`,
          minHeight: `${height}px`,
          cursor: 'pointer'
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
        
        {/* Bars with gradient fills */}
        {chartData.values.map((value, i) => {
          const barHeight = chartData.max > 0 ? (value / chartData.max) * chartHeight : 0
          const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2
          const y = padding.top + chartHeight - barHeight
          const date = chartData.dateKeys[i]
          const key = chartData.keys[i]
          const normalizedValue = chartData.max > 0 ? value / chartData.max : 0
          
          // Create gradient ID for each bar (or reuse)
          const gradientId = `barGradient-${i}`
          
          return (
            <g key={i}>
              {/* Gradient definition */}
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor={color} stopOpacity="0.8" />
                  <stop offset="50%" stopColor={color} stopOpacity="1" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.9" />
                </linearGradient>
              </defs>
              
              {/* Bar with gradient */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(0.5, barHeight)}
                fill={`url(#${gradientId})`}
                className={styles.bar}
                onClick={() => handleBarClick(i, value, key, date)}
                style={{ 
                  cursor: onBarClick || dateData ? 'pointer' : 'default',
                  animationDelay: `${i * 0.03}s`
                }}
                rx="1"
                ry="1"
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
        <Modal
          isOpen={Boolean(showDetail && selectedBar)}
          onClose={() => setShowDetail(false)}
          containerRef={detailModalRef}
          initialFocusRef={detailCloseBtnRef}
          overlayClassName={styles.modalOverlay}
          modalClassName={styles.detailModal}
          ariaLabel="Chart details"
        >
            <div className={styles.modalHeader}>
              <h3>Chart Details</h3>
              <button ref={detailCloseBtnRef} className={styles.closeBtn} onClick={() => setShowDetail(false)}>×</button>
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
              
              {/* Zoom Controls - Changes time scale (shows more/less data) */}
              <div className={styles.zoomControls}>
                <span className={styles.zoomLabel}>Time Scale:</span>
                <div className={styles.zoomButtons}>
                  <button 
                    className={styles.zoomBtn}
                    onClick={() => {
                      const newZoom = Math.max(0.5, popupZoom - 0.25)
                      setPopupZoom(newZoom)
                      // Show more data (zoom out on time scale)
                      if (chartData && visibleData) {
                        const totalBars = chartData.values.length
                        const visibleCount = Math.max(1, Math.floor(totalBars / newZoom))
                        const centerIdx = Math.floor((visibleData.startIdx + visibleData.endIdx) / 2)
                        const newStart = Math.max(0, Math.min(centerIdx - Math.floor(visibleCount / 2), totalBars - visibleCount))
                        setDataRangeStart(newStart)
                      }
                    }}
                    title="Show more time (zoom out)"
                  >
                    −
                  </button>
                  <span className={styles.zoomValue}>
                    {visibleData ? `${visibleData.endIdx - visibleData.startIdx} of ${chartData.values.length} days` : `${Math.round(popupZoom * 100)}%`}
                  </span>
                  <button 
                    className={styles.zoomBtn}
                    onClick={() => {
                      const newZoom = Math.min(5, popupZoom + 0.25)
                      setPopupZoom(newZoom)
                      // Show less data (zoom in on time scale)
                      if (chartData && visibleData) {
                        const totalBars = chartData.values.length
                        const visibleCount = Math.max(1, Math.floor(totalBars / newZoom))
                        const centerIdx = Math.floor((visibleData.startIdx + visibleData.endIdx) / 2)
                        const newStart = Math.max(0, Math.min(centerIdx - Math.floor(visibleCount / 2), totalBars - visibleCount))
                        setDataRangeStart(newStart)
                      }
                    }}
                    title="Show less time (zoom in)"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Expanded Chart View with Time Scale Zoom */}
              <div className={styles.popupChartContainer} ref={chartRef}>
                {visibleData && visibleData.values.length > 0 ? (
                  <div className={styles.chartContainer} style={{ height: '300px', width: '100%' }}>
                    <div className={styles.chartWrapper} style={{ width: '100%', height: '100%' }}>
                      <svg 
                        viewBox="0 0 100 100" 
                        className={styles.chart} 
                        preserveAspectRatio="xMidYMid meet"
                        style={{ width: '100%', height: '100%' }}
                      >
                        {/* Y-axis line */}
                        <line
                          x1="10"
                          y1="10"
                          x2="10"
                          y2="90"
                          stroke="#ffffff"
                          strokeWidth="0.5"
                        />
                        {/* X-axis line */}
                        <line
                          x1="10"
                          y1="90"
                          x2="90"
                          y2="90"
                          stroke="#ffffff"
                          strokeWidth="0.5"
                        />
                        {/* Render bars - use visibleData for time scale zoom */}
                        {visibleData.values.map((value, i) => {
                          const barHeight = visibleData.max > 0 ? (value / visibleData.max) * 80 : 0
                          const totalBars = visibleData.values.length
                          const x = 10 + (i * (80 / Math.max(totalBars, 1)))
                          const y = 90 - barHeight
                          const barWidth = Math.max(2, 80 / Math.max(totalBars, 1) * 0.8)
                          const date = visibleData.dateKeys[i]
                          const key = visibleData.keys[i]
                          
                          return (
                            <rect
                              key={i}
                              x={x}
                              y={y}
                              width={barWidth}
                              height={Math.max(0.5, barHeight)}
                              fill={color}
                              className={styles.bar}
                              onClick={() => handleBarClick(visibleData.startIdx + i, value, key, date)}
                              style={{ cursor: 'pointer' }}
                            />
                          )
                        })}
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyChart}>No data to display</div>
                )}
              </div>

              {/* Share Button */}
              <div className={styles.shareControls}>
                <button
                  className={styles.shareBtn}
                  onClick={async () => {
                    if (chartRef.current) {
                      try {
                        const imageUrl = await generateShareImage(chartRef.current)
                        if (imageUrl) {
                          await shareNative(
                            chartTitle || 'Chart',
                            `Check out this ${chartTitle || 'chart'} from Echelon`,
                            window.location.origin,
                            imageUrl
                          )
                        }
                      } catch (error) {
                        showToast('Failed to share chart. Please try again.', 'error')
                      }
                    }
                  }}
                >
                  Share Chart
                </button>
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
          </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </>
  )
}
