/**
 * Data Lineage Tracking
 * Track data flow from sources through transformations to destinations
 */

import { logError } from '../utils/logger'

/**
 * Data lineage registry
 */
export const DATA_LINEAGE = {
  sources: {
    manual: {
      description: 'Manual user input',
      tables: ['workouts', 'health_metrics', 'goals'],
      transformations: ['validation', 'cleaning', 'enrichment']
    },
    fitbit: {
      description: 'Fitbit API integration',
      tables: ['health_metrics', 'fitbit_daily'],
      transformations: ['normalization', 'enrichment', 'merging']
    },
    oura: {
      description: 'Oura API integration',
      tables: ['health_metrics', 'oura_daily'],
      transformations: ['normalization', 'enrichment', 'merging']
    },
    events: {
      description: 'User interaction events',
      tables: ['user_events'],
      transformations: ['aggregation', 'analytics']
    }
  },
  transformations: {
    validation: {
      description: 'Data validation',
      input_tables: ['workouts', 'health_metrics'],
      output_tables: ['workouts', 'health_metrics'],
      functions: ['validateWorkout', 'validateHealthMetrics']
    },
    cleaning: {
      description: 'Data cleaning and normalization',
      input_tables: ['workouts', 'health_metrics'],
      output_tables: ['workouts', 'health_metrics'],
      functions: ['cleanWorkoutData', 'cleanHealthMetrics']
    },
    enrichment: {
      description: 'Data enrichment with derived metrics',
      input_tables: ['workouts', 'health_metrics'],
      output_tables: ['data_enrichments'],
      functions: ['enrichWorkoutData', 'enrichHealthMetrics']
    },
    aggregation: {
      description: 'Data aggregation',
      input_tables: ['workouts', 'health_metrics'],
      output_tables: ['daily_workout_summaries', 'daily_health_summaries'],
      functions: ['refresh_all_materialized_views']
    },
    feature_engineering: {
      description: 'Feature engineering for ML',
      input_tables: ['workouts', 'health_metrics'],
      output_tables: ['engineered_features'],
      functions: ['calculateRollingStats', 'calculateRatioFeatures']
    }
  },
  destinations: {
    analytics: {
      description: 'Analytics dashboards',
      source_tables: ['workouts', 'health_metrics', 'daily_workout_summaries'],
      consumers: ['Analytics page', 'Reports']
    },
    ml_models: {
      description: 'Machine learning models',
      source_tables: ['engineered_features', 'workouts', 'health_metrics'],
      consumers: ['Prediction models', 'Recommendation engine']
    },
    exports: {
      description: 'Data exports',
      source_tables: ['workouts', 'health_metrics', 'goals'],
      consumers: ['User exports', 'GDPR requests']
    }
  }
}

/**
 * Get lineage for a table
 */
export function getTableLineage(tableName) {
  const lineage = {
    table: tableName,
    sources: [],
    transformations: [],
    destinations: []
  }
  
  // Find sources
  Object.entries(DATA_LINEAGE.sources).forEach(([sourceName, sourceInfo]) => {
    if (sourceInfo.tables.includes(tableName)) {
      lineage.sources.push({
        name: sourceName,
        description: sourceInfo.description
      })
    }
  })
  
  // Find transformations
  Object.entries(DATA_LINEAGE.transformations).forEach(([transformName, transformInfo]) => {
    if (transformInfo.input_tables.includes(tableName) || transformInfo.output_tables.includes(tableName)) {
      lineage.transformations.push({
        name: transformName,
        description: transformInfo.description,
        is_input: transformInfo.input_tables.includes(tableName),
        is_output: transformInfo.output_tables.includes(tableName)
      })
    }
  })
  
  // Find destinations
  Object.entries(DATA_LINEAGE.destinations).forEach(([destName, destInfo]) => {
    if (destInfo.source_tables.includes(tableName)) {
      lineage.destinations.push({
        name: destName,
        description: destInfo.description
      })
    }
  })
  
  return lineage
}

/**
 * Get impact analysis for schema change
 */
export function getImpactAnalysis(tableName, columnName = null) {
  const lineage = getTableLineage(tableName)
  const impact = {
    affected_tables: [tableName],
    affected_transformations: lineage.transformations.map(t => t.name),
    affected_destinations: lineage.destinations.map(d => d.name),
    recommendations: []
  }
  
  // Add recommendations
  if (lineage.transformations.length > 0) {
    impact.recommendations.push('Review and update transformation functions')
  }
  
  if (lineage.destinations.length > 0) {
    impact.recommendations.push('Update downstream consumers (analytics, ML models)')
  }
  
  if (columnName) {
    impact.recommendations.push(`Verify column '${columnName}' usage in all transformations`)
  }
  
  return impact
}

/**
 * Visualize lineage graph (returns data structure for visualization)
 */
export function visualizeLineage(startTable = null) {
  const graph = {
    nodes: [],
    edges: []
  }
  
  // Add all tables as nodes
  const allTables = new Set()
  Object.values(DATA_LINEAGE.sources).forEach(s => s.tables.forEach(t => allTables.add(t)))
  Object.values(DATA_LINEAGE.transformations).forEach(t => {
    t.input_tables.forEach(tbl => allTables.add(tbl))
    t.output_tables.forEach(tbl => allTables.add(tbl))
  })
  Object.values(DATA_LINEAGE.destinations).forEach(d => d.source_tables.forEach(t => allTables.add(t)))
  
  allTables.forEach(table => {
    graph.nodes.push({
      id: table,
      label: table,
      type: 'table'
    })
  })
  
  // Add transformation nodes
  Object.keys(DATA_LINEAGE.transformations).forEach(transform => {
    graph.nodes.push({
      id: transform,
      label: transform,
      type: 'transformation'
    })
  })
  
  // Add edges (source -> transformation -> destination)
  Object.entries(DATA_LINEAGE.transformations).forEach(([transformName, transformInfo]) => {
    transformInfo.input_tables.forEach(inputTable => {
      graph.edges.push({
        from: inputTable,
        to: transformName,
        type: 'input'
      })
    })
    
    transformInfo.output_tables.forEach(outputTable => {
      graph.edges.push({
        from: transformName,
        to: outputTable,
        type: 'output'
      })
    })
  })
  
  return graph
}

