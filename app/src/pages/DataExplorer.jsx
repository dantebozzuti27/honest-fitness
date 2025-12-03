import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getAllUserData,
  getDataForDateRange,
  calculateTrend,
  sliceDataByPeriod,
  comparePeriods,
  getMetricSummary,
  getCorrelation,
  getExtremes
} from '../lib/dataAccess'
import { getTodayEST } from '../utils/dateUtils'
import styles from './DataExplorer.module.css'

export default function DataExplorer() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: getTodayEST(),
    dataTypes: ['fitbit', 'workouts', 'metrics'],
    period: 'day'
  })
  const [selectedMetric, setSelectedMetric] = useState('steps')
  const [view, setView] = useState('overview') // overview, trends, compare, extremes

  useEffect(() => {
    if (user) {
      loadData()
    }
  }, [user, filters])

  const loadData = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      const allData = await getAllUserData(user.id, filters)
      setData(allData)
    } catch (error) {
      console.error('Error loading data:', error)
      alert('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const fitbitData = data?.fitbit || []
  const metricsData = data?.metrics || []
  const workoutsData = data?.workouts || []

  const trends = selectedMetric && fitbitData.length > 0
    ? calculateTrend(fitbitData, selectedMetric, filters.period)
    : null

  const summary = selectedMetric && fitbitData.length > 0
    ? getMetricSummary(fitbitData, selectedMetric)
    : null

  const topDays = selectedMetric && fitbitData.length > 0
    ? getExtremes(fitbitData, selectedMetric, 5, 'top')
    : []

  const bottomDays = selectedMetric && fitbitData.length > 0
    ? getExtremes(fitbitData, selectedMetric, 5, 'bottom')
    : []

  const availableMetrics = fitbitData.length > 0
    ? Object.keys(fitbitData[0]).filter(key => 
        key !== 'id' && 
        key !== 'user_id' && 
        key !== 'date' && 
        key !== 'created_at' && 
        key !== 'updated_at'
      )
    : []

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading data...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Data Explorer</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className={styles.content}>
        {/* Filters */}
        <div className={styles.filtersCard}>
          <h2>Filters</h2>
          <div className={styles.filterRow}>
            <label>
              Start Date:
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </label>
            <label>
              End Date:
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </label>
            <label>
              Period:
              <select
                value={filters.period}
                onChange={(e) => setFilters({ ...filters, period: e.target.value })}
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </label>
          </div>
          <div className={styles.filterRow}>
            <label>
              Metric:
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
              >
                {availableMetrics.map(metric => (
                  <option key={metric} value={metric}>
                    {metric.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>
            <label>
              View:
              <select
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                <option value="overview">Overview</option>
                <option value="trends">Trends</option>
                <option value="compare">Compare Periods</option>
                <option value="extremes">Top/Bottom Days</option>
              </select>
            </label>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className={styles.summaryCard}>
            <h2>Summary: {selectedMetric.replace(/_/g, ' ')}</h2>
            <div className={styles.statsGrid}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Average</div>
                <div className={styles.statValue}>
                  {typeof summary.average === 'number' 
                    ? summary.average.toFixed(1) 
                    : 'N/A'}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Min</div>
                <div className={styles.statValue}>
                  {summary.min != null ? summary.min.toFixed(1) : 'N/A'}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Max</div>
                <div className={styles.statValue}>
                  {summary.max != null ? summary.max.toFixed(1) : 'N/A'}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Median</div>
                <div className={styles.statValue}>
                  {summary.median != null ? summary.median.toFixed(1) : 'N/A'}
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Data Points</div>
                <div className={styles.statValue}>{summary.count}</div>
              </div>
            </div>
          </div>
        )}

        {/* Trends View */}
        {view === 'trends' && trends && (
          <div className={styles.trendsCard}>
            <h2>Trends ({filters.period})</h2>
            <div className={styles.trendsList}>
              {trends.map((trend, idx) => (
                <div key={idx} className={styles.trendItem}>
                  <div className={styles.trendPeriod}>{trend.period}</div>
                  <div className={styles.trendStats}>
                    <span>Avg: {trend.average != null ? trend.average.toFixed(1) : 'N/A'}</span>
                    {trend.trend && (
                      <span className={styles[`trend${trend.trend}`]}>
                        {trend.trend === 'up' ? '↑' : trend.trend === 'down' ? '↓' : '→'} 
                        {trend.changePercent != null 
                          ? `${Math.abs(trend.changePercent).toFixed(1)}%`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Extremes View */}
        {view === 'extremes' && (
          <div className={styles.extremesCard}>
            <div className={styles.extremesSection}>
              <h3>Top 5 Days</h3>
              <div className={styles.extremesList}>
                {topDays.map((day, idx) => (
                  <div key={idx} className={styles.extremeItem}>
                    <span className={styles.extremeDate}>{day.date}</span>
                    <span className={styles.extremeValue}>{day.value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.extremesSection}>
              <h3>Bottom 5 Days</h3>
              <div className={styles.extremesList}>
                {bottomDays.map((day, idx) => (
                  <div key={idx} className={styles.extremeItem}>
                    <span className={styles.extremeDate}>{day.date}</span>
                    <span className={styles.extremeValue}>{day.value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className={styles.dataTableCard}>
          <h2>Raw Data ({fitbitData.length} records)</h2>
          <div className={styles.tableContainer}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  {availableMetrics.slice(0, 8).map(metric => (
                    <th key={metric}>
                      {metric.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fitbitData.slice(0, 50).map((row, idx) => (
                  <tr key={idx}>
                    <td>{row.date}</td>
                    {availableMetrics.slice(0, 8).map(metric => (
                      <td key={metric}>
                        {row[metric] != null 
                          ? (typeof row[metric] === 'number' 
                              ? row[metric].toFixed(1) 
                              : row[metric])
                          : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {fitbitData.length > 50 && (
              <div className={styles.tableNote}>
                Showing first 50 of {fitbitData.length} records
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

