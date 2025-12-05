import { useState } from 'react'
import styles from './BodyHeatmap.module.css'

export default function BodyHeatmap({ data, metric = 'count', detailedStats = {}, onDrillDown }) {
  const [selectedPart, setSelectedPart] = useState(null)
  const maxValue = Math.max(...Object.values(data), 1)

  const getIntensity = (bodyPart) => {
    const value = data[bodyPart] || 0
    return value / maxValue
  }

  const handleSelect = (bodyPart) => {
    // Toggle selection
    setSelectedPart(selectedPart === bodyPart ? null : bodyPart)
  }

  const getStats = (bodyPart) => {
    return detailedStats[bodyPart] || {
      lastTrained: null,
      topExercise: null,
      avgPerWeek: 0
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr + 'T12:00:00')
    const today = new Date()
    const diffDays = Math.floor((today - date) / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getColor = (intensity) => {
    if (intensity === 0) return 'rgba(30, 30, 30, 0.6)'
    if (intensity < 0.25) return `rgba(255, 80, 80, ${0.3 + intensity * 0.4})`
    if (intensity < 0.5) return `rgba(255, 60, 60, ${0.5 + intensity * 0.3})`
    if (intensity < 0.75) return `rgba(255, 45, 45, ${0.7 + intensity * 0.2})`
    return `rgba(255, 30, 30, ${0.85 + intensity * 0.15})`
  }

  const getGlow = (intensity) => {
    if (intensity === 0) return 'none'
    const alpha = 0.3 + intensity * 0.5
    return `0 0 ${10 + intensity * 15}px rgba(255, 45, 45, ${alpha})`
  }

  const getValue = (bodyPart) => data[bodyPart] || 0

  return (
    <div className={styles.container}>
      {/* Grid background */}
      <div className={styles.gridBg}></div>
      
      <div className={styles.views}>
        {/* Front View */}
        <div className={styles.view}>
          <span className={styles.viewLabel}>
            <span className={styles.labelIcon}>▶</span> FRONT
          </span>
          <div className={styles.bodyWrapper}>
            <svg viewBox="0 0 200 380" className={styles.body}>
              <defs>
                <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
                <linearGradient id="bodyBase" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#1a1a1a" />
                  <stop offset="100%" stopColor="#0a0a0a" />
                </linearGradient>
              </defs>
              
              {/* Head */}
              <ellipse cx="100" cy="32" rx="22" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="1" />
              
              {/* Neck */}
              <path d="M88 58 L88 72 L112 72 L112 58" fill="url(#bodyBase)" stroke="#333" strokeWidth="1" />
              
              {/* Trapezius/Shoulders */}
              <path 
                d="M45 82 C60 72 85 70 100 70 C115 70 140 72 155 82 L152 100 C130 92 100 90 100 90 C100 90 70 92 48 100 Z" 
                fill={getColor(getIntensity('Shoulders'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Left Deltoid */}
              <ellipse cx="52" cy="95" rx="18" ry="22" fill={getColor(getIntensity('Shoulders'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Right Deltoid */}
              <ellipse cx="148" cy="95" rx="18" ry="22" fill={getColor(getIntensity('Shoulders'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Chest - Pectorals */}
              <path 
                d="M58 95 C65 88 85 85 100 88 L100 130 C85 128 68 120 58 105 Z" 
                fill={getColor(getIntensity('Chest'))}
                stroke="#444" strokeWidth="0.5"
              />
              <path 
                d="M142 95 C135 88 115 85 100 88 L100 130 C115 128 132 120 142 105 Z" 
                fill={getColor(getIntensity('Chest'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Abs - 6 pack */}
              <rect x="78" y="132" width="44" height="22" rx="3" fill={getColor(getIntensity('Core'))} stroke="#444" strokeWidth="0.5" />
              <rect x="78" y="156" width="44" height="22" rx="3" fill={getColor(getIntensity('Core'))} stroke="#444" strokeWidth="0.5" />
              <rect x="80" y="180" width="40" height="20" rx="3" fill={getColor(getIntensity('Core'))} stroke="#444" strokeWidth="0.5" />
              {/* Center line */}
              <line x1="100" y1="132" x2="100" y2="200" stroke="#333" strokeWidth="1" />
              
              {/* Obliques */}
              <path d="M58 130 Q65 160 72 200 L78 200 L78 132 Z" fill={getColor(getIntensity('Core'))} stroke="#444" strokeWidth="0.5" opacity="0.7" />
              <path d="M142 130 Q135 160 128 200 L122 200 L122 132 Z" fill={getColor(getIntensity('Core'))} stroke="#444" strokeWidth="0.5" opacity="0.7" />
              
              {/* Left Bicep */}
              <ellipse cx="38" cy="130" rx="14" ry="32" fill={getColor(getIntensity('Biceps'))} stroke="#444" strokeWidth="0.5" transform="rotate(-8, 38, 130)" />
              
              {/* Right Bicep */}
              <ellipse cx="162" cy="130" rx="14" ry="32" fill={getColor(getIntensity('Biceps'))} stroke="#444" strokeWidth="0.5" transform="rotate(8, 162, 130)" />
              
              {/* Left Forearm */}
              <ellipse cx="32" cy="185" rx="10" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" transform="rotate(-5, 32, 185)" />
              
              {/* Right Forearm */}
              <ellipse cx="168" cy="185" rx="10" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" transform="rotate(5, 168, 185)" />
              
              {/* Hands */}
              <ellipse cx="28" cy="225" rx="8" ry="14" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              <ellipse cx="172" cy="225" rx="8" ry="14" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              
              {/* Hip flexors */}
              <path d="M72 200 Q80 210 100 212 Q120 210 128 200 L128 220 Q100 225 72 220 Z" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              
              {/* Left Quad */}
              <path 
                d="M72 220 C68 240 65 280 68 320 L92 320 C95 280 92 250 90 220 Z" 
                fill={getColor(getIntensity('Legs'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Right Quad */}
              <path 
                d="M128 220 C132 240 135 280 132 320 L108 320 C105 280 108 250 110 220 Z" 
                fill={getColor(getIntensity('Legs'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Knees */}
              <ellipse cx="80" cy="325" rx="14" ry="10" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              <ellipse cx="120" cy="325" rx="14" ry="10" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              
              {/* Left Calf */}
              <ellipse cx="78" cy="355" rx="10" ry="20" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Right Calf */}
              <ellipse cx="122" cy="355" rx="10" ry="20" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Heart indicator for Cardio */}
              <g transform="translate(100, 115)" opacity={getIntensity('Cardio') > 0 ? 1 : 0.3}>
                <path 
                  d="M0,-6 C-4,-10 -10,-10 -10,-4 C-10,3 0,10 0,10 C0,10 10,3 10,-4 C10,-10 4,-10 0,-6" 
                  fill={getColor(getIntensity('Cardio'))}
                  stroke="#ff4444" strokeWidth="0.5"
                  className={styles.heartPulse}
                />
              </g>
              
              {/* Scan lines overlay */}
              <g className={styles.scanLines}>
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                  <line key={i} x1="0" y1={i * 38} x2="200" y2={i * 38} stroke="rgba(255,45,45,0.03)" strokeWidth="1" />
                ))}
              </g>
            </svg>
          </div>
        </div>

        {/* Back View */}
        <div className={styles.view}>
          <span className={styles.viewLabel}>
            <span className={styles.labelIcon}>▶</span> BACK
          </span>
          <div className={styles.bodyWrapper}>
            <svg viewBox="0 0 200 380" className={styles.body}>
              {/* Head */}
              <ellipse cx="100" cy="32" rx="22" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="1" />
              
              {/* Neck */}
              <path d="M88 58 L88 72 L112 72 L112 58" fill="url(#bodyBase)" stroke="#333" strokeWidth="1" />
              
              {/* Trapezius */}
              <path 
                d="M60 72 C75 68 90 67 100 67 C110 67 125 68 140 72 L145 95 Q100 85 55 95 Z" 
                fill={getColor(getIntensity('Back'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Rear Delts */}
              <ellipse cx="50" cy="92" rx="16" ry="20" fill={getColor(getIntensity('Shoulders'))} stroke="#444" strokeWidth="0.5" />
              <ellipse cx="150" cy="92" rx="16" ry="20" fill={getColor(getIntensity('Shoulders'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Lats */}
              <path 
                d="M55 95 C50 120 48 160 65 200 L78 200 L78 130 C70 115 60 100 55 95 Z" 
                fill={getColor(getIntensity('Back'))}
                stroke="#444" strokeWidth="0.5"
              />
              <path 
                d="M145 95 C150 120 152 160 135 200 L122 200 L122 130 C130 115 140 100 145 95 Z" 
                fill={getColor(getIntensity('Back'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Mid back / Rhomboids */}
              <rect x="68" y="100" width="64" height="50" rx="5" fill={getColor(getIntensity('Back'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Spine */}
              <line x1="100" y1="72" x2="100" y2="210" stroke="#333" strokeWidth="2" />
              {/* Spine segments */}
              {[80, 100, 120, 140, 160, 180].map(y => (
                <line key={y} x1="94" y1={y} x2="106" y2={y} stroke="#444" strokeWidth="1" />
              ))}
              
              {/* Lower Back / Erectors */}
              <path 
                d="M75 150 L75 200 Q100 205 125 200 L125 150 Q100 155 75 150 Z" 
                fill={getColor(getIntensity('Back'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Left Tricep */}
              <ellipse cx="36" cy="128" rx="12" ry="30" fill={getColor(getIntensity('Triceps'))} stroke="#444" strokeWidth="0.5" transform="rotate(-8, 36, 128)" />
              
              {/* Right Tricep */}
              <ellipse cx="164" cy="128" rx="12" ry="30" fill={getColor(getIntensity('Triceps'))} stroke="#444" strokeWidth="0.5" transform="rotate(8, 164, 128)" />
              
              {/* Forearms */}
              <ellipse cx="30" cy="185" rx="10" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" transform="rotate(-5, 30, 185)" />
              <ellipse cx="170" cy="185" rx="10" ry="28" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" transform="rotate(5, 170, 185)" />
              
              {/* Hands */}
              <ellipse cx="26" cy="225" rx="8" ry="14" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              <ellipse cx="174" cy="225" rx="8" ry="14" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              
              {/* Glutes */}
              <ellipse cx="82" cy="218" rx="18" ry="16" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              <ellipse cx="118" cy="218" rx="18" ry="16" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Left Hamstring */}
              <path 
                d="M65 232 C62 260 62 300 68 320 L92 320 C96 295 94 260 90 232 Z" 
                fill={getColor(getIntensity('Legs'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Right Hamstring */}
              <path 
                d="M135 232 C138 260 138 300 132 320 L108 320 C104 295 106 260 110 232 Z" 
                fill={getColor(getIntensity('Legs'))}
                stroke="#444" strokeWidth="0.5"
              />
              
              {/* Knees */}
              <ellipse cx="80" cy="325" rx="14" ry="10" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              <ellipse cx="120" cy="325" rx="14" ry="10" fill="url(#bodyBase)" stroke="#333" strokeWidth="0.5" />
              
              {/* Calves */}
              <ellipse cx="78" cy="355" rx="12" ry="22" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              <ellipse cx="122" cy="355" rx="12" ry="22" fill={getColor(getIntensity('Legs'))} stroke="#444" strokeWidth="0.5" />
              
              {/* Scan lines */}
              <g className={styles.scanLines}>
                {[0,1,2,3,4,5,6,7,8,9].map(i => (
                  <line key={i} x1="0" y1={i * 38} x2="200" y2={i * 38} stroke="rgba(255,45,45,0.03)" strokeWidth="1" />
                ))}
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* Intensity Scale */}
      <div className={styles.intensityScale}>
        <span className={styles.scaleLabel}>INACTIVE</span>
        <div className={styles.scaleBar}>
          <div className={styles.scaleGradient}></div>
        </div>
        <span className={styles.scaleLabel}>MAX</span>
      </div>

      {/* Bottom sheet modal for selected body part */}
      {selectedPart && (
        <div className={styles.tooltipOverlay} onClick={() => setSelectedPart(null)}>
          <div className={styles.tooltip} onClick={e => e.stopPropagation()}>
            <div className={styles.tooltipHeader}>{selectedPart.toUpperCase()}</div>
            <div className={styles.tooltipContent}>
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Last trained:</span>
                <span className={styles.tooltipValue}>{formatDate(getStats(selectedPart).lastTrained)}</span>
              </div>
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Top exercise:</span>
                <span className={styles.tooltipValue}>{getStats(selectedPart).topExercise || '—'}</span>
              </div>
              <div className={styles.tooltipRow}>
                <span className={styles.tooltipLabel}>Avg/week:</span>
                <span className={styles.tooltipValue}>{getStats(selectedPart).avgPerWeek?.toFixed(1) || '0'}</span>
              </div>
            </div>
            <div className={styles.tooltipActions}>
              {onDrillDown && (
                <button 
                  className={styles.tooltipDrillDown} 
                  onClick={() => {
                    onDrillDown(selectedPart)
                    setSelectedPart(null)
                  }}
                >
                  View {selectedPart} History
                </button>
              )}
              <button className={styles.tooltipClose} onClick={() => setSelectedPart(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className={styles.statsGrid}>
        {['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core', 'Legs', 'Cardio', 'Recovery'].map(bp => {
          const value = getValue(bp)
          const intensity = getIntensity(bp)
          const percent = Math.round(intensity * 100)
          return (
            <button 
              key={bp} 
              className={`${styles.statItem} ${selectedPart === bp ? styles.statItemHovered : ''}`}
              onClick={() => handleSelect(bp)}
            >
              <div className={styles.statHeader}>
                <span className={styles.statName}>{bp.toUpperCase()}</span>
                <span className={styles.statValue}>{value}</span>
              </div>
              <div className={styles.statBar}>
                <div 
                  className={styles.statFill}
                  style={{ 
                    width: `${percent}%`,
                    background: intensity > 0 ? `linear-gradient(90deg, rgba(255,45,45,0.6), rgba(255,45,45,${0.4 + intensity * 0.6}))` : 'transparent',
                    boxShadow: intensity > 0.3 ? getGlow(intensity) : 'none'
                  }}
                ></div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
