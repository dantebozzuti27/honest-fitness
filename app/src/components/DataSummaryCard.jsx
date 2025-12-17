/**
 * Data Summary Card Component
 * Progressive disclosure: Summary → Expandable Details → Full View
 */

import { useRef, useState } from 'react'
import styles from './DataSummaryCard.module.css'
import { useHaptic } from '../hooks/useHaptic'
import Modal from './Modal'

export default function DataSummaryCard({
  title,
  summary,
  details,
  fullData,
  icon,
  trend,
  trendValue,
  onViewFull,
  color = '#007AFF'
}) {
  const [expanded, setExpanded] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const { triggerHaptic } = useHaptic()
  const fullModalRef = useRef(null)
  const fullCloseBtnRef = useRef(null)
  
  const handleExpand = () => {
    triggerHaptic('light')
    setExpanded(!expanded)
  }
  
  const handleViewFull = () => {
    triggerHaptic('medium')
    if (onViewFull) {
      onViewFull()
    } else {
      setShowFull(!showFull)
    }
  }
  
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'
  const trendClass = trend === 'up' ? styles.trendUp : trend === 'down' ? styles.trendDown : styles.trendNeutral
  
  return (
    <div className={styles.summaryCard}>
      {/* Summary Level */}
      <div className={styles.summaryLevel}>
        <div className={styles.summaryHeader}>
          {icon && <span className={styles.summaryIcon}>{icon}</span>}
          <div className={styles.summaryContent}>
            <h3 className={styles.summaryTitle}>{title}</h3>
            <div className={styles.summaryValue}>{summary}</div>
          </div>
          {trend && (
            <div className={`${styles.trendIndicator} ${trendClass}`}>
              <span className={styles.trendIcon}>{trendIcon}</span>
              {trendValue && <span className={styles.trendValue}>{trendValue}</span>}
            </div>
          )}
        </div>
        
        {details && (
          <button 
            className={styles.expandBtn}
            onClick={() => {
              if (handleExpand && typeof handleExpand === 'function') {
                handleExpand()
              }
            }}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? 'Show Less' : 'Show Details'}
          </button>
        )}
      </div>
      
      {/* Details Level (Expandable) */}
      {expanded && details && (
        <div className={styles.detailsLevel}>
          <div className={styles.detailsContent}>
            {typeof details === 'string' ? (
              <p className={styles.detailsText}>{details}</p>
            ) : (
              <div className={styles.detailsList}>
                {details.map((detail, index) => (
                  <div key={index} className={styles.detailItem}>
                    {detail.label && <span className={styles.detailLabel}>{detail.label}:</span>}
                    <span className={styles.detailValue}>{detail.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {fullData && (
            <button 
              className={styles.viewFullBtn}
              onClick={() => {
                if (handleViewFull && typeof handleViewFull === 'function') {
                  handleViewFull()
                }
              }}
            >
              View Full Analysis
            </button>
          )}
        </div>
      )}
      
      {/* Full Data Level (Modal) */}
      {showFull && fullData && (
        <Modal
          isOpen={Boolean(showFull && fullData)}
          onClose={() => setShowFull(false)}
          containerRef={fullModalRef}
          initialFocusRef={fullCloseBtnRef}
          overlayClassName={styles.fullDataModal}
          overlayStyle={{ background: 'var(--glass-overlay-bg)' }}
          modalClassName={styles.modalContent}
          ariaLabel={`${title} full analysis`}
        >
            <div className={styles.modalHeader}>
              <h2>{title} - Full Analysis</h2>
              <button 
                className={styles.closeBtn}
                onClick={() => setShowFull(false)}
                aria-label="Close"
                ref={fullCloseBtnRef}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {typeof fullData === 'string' ? (
                <pre className={styles.fullDataText}>{fullData}</pre>
              ) : (
                <div className={styles.fullDataContent}>
                  {Object.entries(fullData).map(([key, value]) => (
                    <div key={key} className={styles.fullDataRow}>
                      <span className={styles.fullDataKey}>{key}:</span>
                      <span className={styles.fullDataValue}>
                        {typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </Modal>
      )}
    </div>
  )
}

