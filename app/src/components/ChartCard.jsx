/**
 * Unified Chart Card Component
 * Enterprise analytics + Apple liquid glass design
 * All charts use this wrapper for consistency
 */

import { useState, useRef, useEffect } from 'react'
import styles from './ChartCard.module.css'

export default function ChartCard({
  title,
  subtitle,
  categories = [],
  selectedCategory,
  onCategoryChange,
  dateRangePresets = [],
  selectedDateRange,
  onDateRangeChange,
  chartTypes = ['Bar', 'Line', 'Area'],
  selectedChartType,
  onChartTypeChange,
  children,
  insights = [],
  primaryAction,
  secondaryActions = [],
  onShare,
  onExport,
  dataFreshness,
  showComparison = false,
  onToggleComparison
}) {
  const [isControlsExpanded, setIsControlsExpanded] = useState(false)
  const cardRef = useRef(null)

  return (
    <div ref={cardRef} className={styles.chartCard}>
      {/* Top gradient line */}
      <div className={styles.gradientLine} />
      
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.title}>{title}</h3>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          {dataFreshness && (
            <div className={styles.freshness}>
              Updated {dataFreshness}
            </div>
          )}
        </div>
        <div className={styles.headerActions}>
          {onShare && (
            <button 
              className={styles.iconBtn}
              onClick={onShare}
              title="Share"
            >
              Share
            </button>
          )}
          {onExport && (
            <button 
              className={styles.iconBtn}
              onClick={onExport}
              title="Export"
            >
              Export
            </button>
          )}
        </div>
      </div>

      {/* Category Selector */}
      {categories.length > 0 && (
        <div className={styles.categorySelector}>
          {categories.map((category) => (
            <button
              key={category.id || category}
              className={`${styles.categoryBtn} ${
                (selectedCategory?.id || selectedCategory) === (category.id || category) 
                  ? styles.active 
                  : ''
              }`}
              onClick={() => onCategoryChange?.(category)}
            >
              {category.label || category}
            </button>
          ))}
        </div>
      )}

      {/* Controls Toggle */}
      {(dateRangePresets.length > 0 || chartTypes.length > 1 || showComparison) && (
        <button
          className={styles.controlsToggle}
          onClick={() => setIsControlsExpanded(!isControlsExpanded)}
        >
          {isControlsExpanded ? 'Hide Controls' : 'Show Controls'}
        </button>
      )}

      {/* Controls (Collapsible) */}
      {isControlsExpanded && (
        <div className={styles.controls}>
          {/* Date Range Presets */}
          {dateRangePresets.length > 0 && (
            <div className={styles.controlGroup}>
              <div className={styles.controlLabel}>Date Range</div>
              <div className={styles.controlButtons}>
                {dateRangePresets.map((preset) => (
                  <button
                    key={preset.id || preset.label}
                    className={`${styles.controlBtn} ${
                      (selectedDateRange?.id || selectedDateRange) === (preset.id || preset.label)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() => onDateRangeChange?.(preset)}
                  >
                    {preset.label || preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chart Type Selector */}
          {chartTypes.length > 1 && (
            <div className={styles.controlGroup}>
              <div className={styles.controlLabel}>Chart Type</div>
              <div className={styles.controlButtons}>
                {chartTypes.map((type) => (
                  <button
                    key={type}
                    className={`${styles.controlBtn} ${
                      selectedChartType === type ? styles.active : ''
                    }`}
                    onClick={() => onChartTypeChange?.(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comparison Toggle */}
          {showComparison && (
            <div className={styles.controlGroup}>
              <button
                className={`${styles.comparisonToggle} ${
                  showComparison ? styles.active : ''
                }`}
                onClick={onToggleComparison}
              >
                Compare with Previous Period
              </button>
            </div>
          )}
        </div>
      )}

      {/* Chart Visualization */}
      <div className={styles.chartVisualization}>
        {children}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className={styles.insights}>
          {insights.map((insight, i) => (
            <div key={i} className={styles.insightItem}>
              <span className={styles.insightIcon}>{insight.icon || '•'}</span>
              <div className={styles.insightText}>
                {insight.text}
                {insight.value && (
                  <span className={styles.insightValue}> {insight.value}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {(primaryAction || secondaryActions.length > 0) && (
        <div className={styles.actions}>
          {primaryAction && (
            <button
              className={styles.primaryAction}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryActions.map((action, i) => (
            <button
              key={i}
              className={styles.secondaryAction}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

