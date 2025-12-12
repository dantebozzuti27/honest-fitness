/**
 * Data Catalog Page
 * Displays data dictionary, metric definitions, and data sources
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DATA_DICTIONARY, METRIC_DEFINITIONS, searchDataCatalog } from '../lib/dataCatalog'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import styles from './DataCatalog.module.css'

export default function DataCatalog() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTable, setSelectedTable] = useState(null)
  const [selectedMetric, setSelectedMetric] = useState(null)

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    return searchDataCatalog(searchQuery)
  }, [searchQuery])

  const tables = Object.entries(DATA_DICTIONARY)
  const metrics = Object.entries(METRIC_DEFINITIONS)

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Data Catalog</h1>
        <HomeButton />
      </header>

      <div className={styles.content}>
        {/* Search */}
        <div className={styles.searchSection}>
          <input
            type="text"
            placeholder="Search tables, columns, or metrics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        {/* Search Results */}
        {searchQuery && searchResults.length > 0 && (
          <div className={styles.searchResults}>
            <h3>Search Results</h3>
            {searchResults.map((result, idx) => (
              <div
                key={idx}
                className={styles.searchResultItem}
                onClick={() => {
                  if (result.type === 'table') {
                    setSelectedTable(result.name)
                    setSearchQuery('')
                  } else if (result.type === 'metric') {
                    setSelectedMetric(result.name)
                    setSearchQuery('')
                  }
                }}
              >
                <span className={styles.resultType}>{result.type}</span>
                <span className={styles.resultName}>{result.name}</span>
                <span className={styles.resultDescription}>{result.description}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tables Section */}
        {!searchQuery && (
          <>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Data Tables</h2>
              <p className={styles.sectionDescription}>
                All data tables in the system with their columns and relationships
              </p>
              <div className={styles.tablesList}>
                {tables.map(([tableName, tableInfo]) => (
                  <div
                    key={tableName}
                    className={`${styles.tableCard} ${selectedTable === tableName ? styles.selected : ''}`}
                    onClick={() => setSelectedTable(selectedTable === tableName ? null : tableName)}
                  >
                    <div className={styles.tableHeader}>
                      <h3 className={styles.tableName}>{tableName}</h3>
                      <span className={styles.tableToggle}>
                        {selectedTable === tableName ? '−' : '+'}
                      </span>
                    </div>
                    <p className={styles.tableDescription}>{tableInfo.description}</p>
                    {selectedTable === tableName && (
                      <div className={styles.tableDetails}>
                        <h4>Columns</h4>
                        <div className={styles.columnsList}>
                          {Object.entries(tableInfo.columns).map(([colName, colInfo]) => (
                            <div key={colName} className={styles.columnItem}>
                              <div className={styles.columnHeader}>
                                <span className={styles.columnName}>{colName}</span>
                                <span className={styles.columnType}>{colInfo.type}</span>
                              </div>
                              <p className={styles.columnDescription}>{colInfo.description}</p>
                              {colInfo.example && (
                                <p className={styles.columnExample}>Example: {colInfo.example}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        {tableInfo.relationships && (
                          <>
                            <h4>Relationships</h4>
                            <div className={styles.relationshipsList}>
                              {Object.entries(tableInfo.relationships).map(([relName, relDesc]) => (
                                <div key={relName} className={styles.relationshipItem}>
                                  <span className={styles.relationshipName}>{relName}:</span>
                                  <span className={styles.relationshipDesc}>{relDesc}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Metrics Section */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Metric Definitions</h2>
              <p className={styles.sectionDescription}>
                Definitions and calculations for all metrics displayed in the app
              </p>
              <div className={styles.metricsList}>
                {metrics.map(([metricName, metricInfo]) => (
                  <div
                    key={metricName}
                    className={`${styles.metricCard} ${selectedMetric === metricName ? styles.selected : ''}`}
                    onClick={() => setSelectedMetric(selectedMetric === metricName ? null : metricName)}
                  >
                    <div className={styles.metricHeader}>
                      <h3 className={styles.metricName}>{metricName.replace(/_/g, ' ')}</h3>
                      <span className={styles.metricToggle}>
                        {selectedMetric === metricName ? '−' : '+'}
                      </span>
                    </div>
                    <p className={styles.metricDescription}>{metricInfo.description}</p>
                    {selectedMetric === metricName && (
                      <div className={styles.metricDetails}>
                        {metricInfo.calculation && (
                          <div className={styles.metricCalculation}>
                            <strong>Calculation:</strong> {metricInfo.calculation}
                          </div>
                        )}
                        {metricInfo.unit && (
                          <div className={styles.metricUnit}>
                            <strong>Unit:</strong> {metricInfo.unit}
                          </div>
                        )}
                        {metricInfo.example !== undefined && (
                          <div className={styles.metricExample}>
                            <strong>Example:</strong> {metricInfo.example}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

