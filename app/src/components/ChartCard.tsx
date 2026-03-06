/**
 * Unified Chart Card Component
 * Enterprise analytics + Apple liquid glass design
 * All charts use this wrapper for consistency
 */

import type { ReactNode } from 'react'
import { useState, useRef } from 'react'
import styles from './ChartCard.module.css'

type ChartCardAction = { label: string; onClick: () => void }
type ChartCardInsight = { icon?: string; text: string; value?: string }
type ChartCategory = { id: string; label: string }
type DateRangePreset = { id: string; label: string }

export type ChartCardProps = {
  title: ReactNode
  subtitle?: ReactNode
  categories?: ChartCategory[]
  selectedCategory?: ChartCategory
  onCategoryChange?: (category: ChartCategory) => void
  dateRangePresets?: DateRangePreset[]
  selectedDateRange?: DateRangePreset
  onDateRangeChange?: (preset: DateRangePreset) => void
  chartTypes?: string[]
  selectedChartType?: string
  onChartTypeChange?: (type: string) => void
  children?: ReactNode
  insights?: ChartCardInsight[]
  primaryAction?: ChartCardAction
  secondaryActions?: ChartCardAction[]
  onExport?: () => void
  dataFreshness?: string | null
  showComparison?: boolean
  onToggleComparison?: () => void
}

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
  onExport,
  dataFreshness,
  showComparison = false,
  onToggleComparison
}: ChartCardProps) {
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
          {onExport && typeof onExport === 'function' && (
            <button 
              className={styles.iconBtn}
              onClick={() => {
                if (onExport && typeof onExport === 'function') {
                  onExport()
                }
              }}
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
              key={category.id}
              className={`${styles.categoryBtn} ${
                selectedCategory?.id === category.id
                  ? styles.active 
                  : ''
              }`}
              onClick={() => {
                if (onCategoryChange && typeof onCategoryChange === 'function') {
                  onCategoryChange(category)
                }
              }}
            >
              {category.label}
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
                    key={preset.id}
                    className={`${styles.controlBtn} ${
                      selectedDateRange?.id === preset.id
                        ? styles.active
                        : ''
                    }`}
                    onClick={() => {
                      if (onDateRangeChange && typeof onDateRangeChange === 'function') {
                        onDateRangeChange(preset)
                      }
                    }}
                  >
                    {preset.label}
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
                    onClick={() => {
                      if (onChartTypeChange && typeof onChartTypeChange === 'function') {
                        onChartTypeChange(type)
                      }
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comparison Toggle */}
          {showComparison && onToggleComparison && typeof onToggleComparison === 'function' && (
            <div className={styles.controlGroup}>
              <button
                className={`${styles.comparisonToggle} ${
                  showComparison ? styles.active : ''
                }`}
                onClick={() => {
                  if (onToggleComparison && typeof onToggleComparison === 'function') {
                    onToggleComparison()
                  }
                }}
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
          {primaryAction && primaryAction.onClick && typeof primaryAction.onClick === 'function' && (
            <button
              className={styles.primaryAction}
              onClick={() => {
                if (primaryAction && primaryAction.onClick && typeof primaryAction.onClick === 'function') {
                  primaryAction.onClick()
                }
              }}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryActions.map((action, i) => (
            action && action.onClick && typeof action.onClick === 'function' ? (
              <button
                key={i}
                className={styles.secondaryAction}
                onClick={() => {
                  if (action && action.onClick && typeof action.onClick === 'function') {
                    action.onClick()
                  }
                }}
              >
                {action.label}
              </button>
            ) : null
          ))}
        </div>
      )}
    </div>
  )
}

