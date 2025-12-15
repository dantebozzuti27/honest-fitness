/**
 * Chart Context Component
 * Adds trend arrows, percentage changes, and benchmarks to charts
 */

import styles from './ChartContext.module.css'

export default function ChartContext({ 
  currentValue,
  previousValue,
  benchmark,
  trend,
  showTrend = true,
  showBenchmark = false
}) {
  if (!currentValue && !trend) return null

  const change = previousValue ? currentValue - previousValue : 0
  const changePercent = previousValue && previousValue !== 0 
    ? ((change / previousValue) * 100).toFixed(1)
    : 0

  const isPositive = change > 0
  const isNegative = change < 0
  const isStable = change === 0

  return (
    <div className={styles.chartContext}>
      {showTrend && previousValue && (
        <div className={styles.trendIndicator}>
          {isPositive && (
            <span className={styles.trendUp}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 15l-6-6-6 6" />
              </svg>
              {Math.abs(changePercent)}%
            </span>
          )}
          {isNegative && (
            <span className={styles.trendDown}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
              {Math.abs(changePercent)}%
            </span>
          )}
          {isStable && (
            <span className={styles.trendStable}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
              </svg>
              No change
            </span>
          )}
        </div>
      )}
      {showBenchmark && benchmark && (
        <div className={styles.benchmark}>
          <span className={styles.benchmarkLabel}>Benchmark:</span>
          <span className={styles.benchmarkValue}>{benchmark}</span>
          {currentValue > benchmark ? (
            <span className={styles.benchmarkStatus}>Above average</span>
          ) : currentValue < benchmark ? (
            <span className={styles.benchmarkStatus}>Below average</span>
          ) : (
            <span className={styles.benchmarkStatus}>Average</span>
          )}
        </div>
      )}
    </div>
  )
}

