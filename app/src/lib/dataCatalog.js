/**
 * Data Catalog
 * Centralized documentation of all data assets: tables, columns, metrics, definitions
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Data dictionary - all tables and columns
 */
export const DATA_DICTIONARY = {
  workouts: {
    description: 'User workout sessions',
    columns: {
      id: { type: 'UUID', description: 'Unique workout identifier', example: '123e4567-e89b-12d3-a456-426614174000' },
      user_id: { type: 'UUID', description: 'User who performed the workout', example: '123e4567-e89b-12d3-a456-426614174000' },
      date: { type: 'DATE', description: 'Date of workout', example: '2024-01-15' },
      duration: { type: 'INTEGER', description: 'Workout duration in minutes', example: 60 },
      template_name: { type: 'TEXT', description: 'Workout template used', example: 'Push Day' },
      perceived_effort: { type: 'INTEGER', description: 'Perceived effort (1-10 scale)', example: 7 },
      notes: { type: 'TEXT', description: 'User notes about the workout', example: 'Felt strong today' }
    },
    relationships: {
      workout_exercises: 'One-to-many relationship with workout_exercises',
      user: 'Many-to-one relationship with auth.users'
    }
  },
  health_metrics: {
    description: 'Daily health and fitness metrics',
    columns: {
      id: { type: 'UUID', description: 'Unique metric identifier', example: '123e4567-e89b-12d3-a456-426614174000' },
      user_id: { type: 'UUID', description: 'User who owns the metrics', example: '123e4567-e89b-12d3-a456-426614174000' },
      date: { type: 'DATE', description: 'Date of metrics', example: '2024-01-15' },
      sleep_score: { type: 'NUMERIC', description: 'Sleep quality score (0-100)', example: 85 },
      sleep_duration: { type: 'NUMERIC', description: 'Sleep duration in minutes', example: 480 },
      hrv: { type: 'NUMERIC', description: 'Heart rate variability in milliseconds', example: 45 },
      steps: { type: 'INTEGER', description: 'Daily step count', example: 10000 },
      weight: { type: 'NUMERIC', description: 'Body weight in pounds', example: 180 },
      resting_heart_rate: { type: 'NUMERIC', description: 'Resting heart rate in bpm', example: 65 },
      calories_burned: { type: 'NUMERIC', description: 'Calories burned during the day', example: 2500 },
      source_provider: { type: 'TEXT', description: 'Data source (manual, fitbit, oura, etc.)', example: 'fitbit' }
    },
    relationships: {
      user: 'Many-to-one relationship with auth.users'
    }
  },
  goals: {
    description: 'User fitness and health goals',
    columns: {
      id: { type: 'UUID', description: 'Unique goal identifier', example: '123e4567-e89b-12d3-a456-426614174000' },
      user_id: { type: 'UUID', description: 'User who owns the goal', example: '123e4567-e89b-12d3-a456-426614174000' },
      category: { type: 'TEXT', description: 'Goal category (fitness, nutrition, health)', example: 'fitness' },
      type: { type: 'TEXT', description: 'Goal type (calories, protein, workouts_per_week, etc.)', example: 'workouts_per_week' },
      target_value: { type: 'NUMERIC', description: 'Target value to achieve', example: 4 },
      current_value: { type: 'NUMERIC', description: 'Current progress value', example: 3 },
      progress_percentage: { type: 'NUMERIC', description: 'Progress percentage (0-100)', example: 75 },
      start_date: { type: 'DATE', description: 'Goal start date', example: '2024-01-01' },
      end_date: { type: 'DATE', description: 'Goal end date', example: '2024-12-31' },
      status: { type: 'TEXT', description: 'Goal status (active, completed, archived)', example: 'active' }
    },
    relationships: {
      user: 'Many-to-one relationship with auth.users'
    }
  },
  user_events: {
    description: 'User interaction and behavioral events',
    columns: {
      id: { type: 'UUID', description: 'Unique event identifier', example: '123e4567-e89b-12d3-a456-426614174000' },
      user_id: { type: 'UUID', description: 'User who triggered the event', example: '123e4567-e89b-12d3-a456-426614174000' },
      event_name: { type: 'TEXT', description: 'Event name (page_view, button_click, etc.)', example: 'button_click' },
      event_category: { type: 'TEXT', description: 'Event category (navigation, interaction, etc.)', example: 'interaction' },
      event_action: { type: 'TEXT', description: 'Event action (click, view, complete, etc.)', example: 'click' },
      event_label: { type: 'TEXT', description: 'Event label (specific element or page)', example: 'start_workout_button' },
      timestamp: { type: 'TIMESTAMPTZ', description: 'Event timestamp', example: '2024-01-15T10:30:00Z' },
      properties: { type: 'JSONB', description: 'Additional event properties', example: { button_name: 'Start Workout' } }
    },
    relationships: {
      user: 'Many-to-one relationship with auth.users'
    }
  }
}

/**
 * Metric definitions
 */
export const METRIC_DEFINITIONS = {
  workout_volume: {
    description: 'Total volume lifted in a workout (weight × reps for all sets)',
    unit: 'lbs',
    calculation: 'Sum of (weight × reps) for all sets in all exercises',
    example: 5000
  },
  workout_frequency: {
    description: 'Number of workouts per week',
    unit: 'workouts/week',
    calculation: 'Count of workouts in a 7-day period',
    example: 4
  },
  sleep_score: {
    description: 'Overall sleep quality score',
    unit: '0-100',
    calculation: 'Provider-specific algorithm (Oura, Fitbit, etc.)',
    example: 85
  },
  hrv: {
    description: 'Heart Rate Variability - measure of recovery and stress',
    unit: 'milliseconds',
    calculation: 'Average HRV from wearable device',
    example: 45
  },
  readiness_score: {
    description: 'Overall readiness to train based on multiple factors',
    unit: '0-100',
    calculation: 'Weighted combination of sleep, HRV, RHR, and activity',
    example: 75
  },
  data_completeness: {
    description: 'Percentage of expected data points that are present',
    unit: '0-100%',
    calculation: '(Actual data points / Expected data points) × 100',
    example: 85
  }
}

/**
 * Get data catalog entry
 */
export function getDataCatalogEntry(tableName) {
  return DATA_DICTIONARY[tableName] || null
}

/**
 * Get metric definition
 */
export function getMetricDefinition(metricName) {
  return METRIC_DEFINITIONS[metricName] || null
}

/**
 * Search data catalog
 */
export function searchDataCatalog(query) {
  const lowerQuery = query.toLowerCase()
  const results = []
  
  // Search table names and descriptions
  Object.entries(DATA_DICTIONARY).forEach(([tableName, tableInfo]) => {
    if (tableName.toLowerCase().includes(lowerQuery) || 
        tableInfo.description.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'table',
        name: tableName,
        description: tableInfo.description
      })
    }
    
    // Search column names
    Object.entries(tableInfo.columns).forEach(([columnName, columnInfo]) => {
      if (columnName.toLowerCase().includes(lowerQuery) ||
          columnInfo.description.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'column',
          table: tableName,
          name: columnName,
          description: columnInfo.description
        })
      }
    })
  })
  
  // Search metric definitions
  Object.entries(METRIC_DEFINITIONS).forEach(([metricName, metricInfo]) => {
    if (metricName.toLowerCase().includes(lowerQuery) ||
        metricInfo.description.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'metric',
        name: metricName,
        description: metricInfo.description
      })
    }
  })
  
  return results
}

