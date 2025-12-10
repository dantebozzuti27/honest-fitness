/**
 * Insights Card Component
 * Displays actionable insights from data enrichment and ML predictions
 */

import { useState } from 'react'
import styles from './InsightsCard.module.css'
import { useHaptic } from '../hooks/useHaptic'

export default function InsightsCard({ 
  title, 
  insights = [], 
  type = 'info', // 'info', 'success', 'warning', 'error'
  onDismiss,
  expandable = true 
}) {
  const [expanded, setExpanded] = useState(false)
  const { triggerHaptic } = useHaptic()
  
  if (!insights || insights.length === 0) return null
  
  const handleExpand = () => {
    if (expandable) {
      triggerHaptic('light')
      setExpanded(!expanded)
    }
  }
  
  const displayedInsights = expanded ? insights : insights.slice(0, 1)
  
  return (
    <div className={`${styles.insightsCard} ${styles[type]}`}>
      <div className={styles.cardHeader}>
        <div className={styles.headerContent}>
          <h3 className={styles.cardTitle}>{title}</h3>
          {insights.length > 1 && expandable && (
            <button 
              className={styles.expandBtn}
              onClick={handleExpand}
              aria-label={expanded ? 'Collapse insights' : 'Expand insights'}
            >
              {expanded ? '−' : '+'}
            </button>
          )}
        </div>
        {onDismiss && (
          <button 
            className={styles.dismissBtn}
            onClick={() => {
              triggerHaptic('light')
              onDismiss()
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      
      <div className={styles.insightsList}>
        {displayedInsights.map((insight, index) => (
          <div key={index} className={styles.insightItem}>
            {insight.icon && <span className={styles.insightIcon}>{insight.icon}</span>}
            <div className={styles.insightContent}>
              <p className={styles.insightMessage}>{insight.message}</p>
              {insight.action && (
                <button 
                  className={styles.actionBtn}
                  onClick={() => {
                    triggerHaptic('medium')
                    insight.action()
                  }}
                >
                  {insight.actionLabel || 'Take Action'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {insights.length > 1 && !expanded && (
        <button 
          className={styles.showMoreBtn}
          onClick={handleExpand}
        >
          Show {insights.length - 1} more
        </button>
      )}
    </div>
  )
}

