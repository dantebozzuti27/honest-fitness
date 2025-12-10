/**
 * Data Testing Framework
 * Unit tests for transformations, integration tests for pipelines, data quality tests
 */

import { logError } from '../utils/logger'
import { validateData } from './dataValidation'
import { cleanData } from './dataCleaning'
import { enrichWorkoutData, enrichHealthMetrics } from './dataEnrichment'

/**
 * Test data transformation
 */
export async function testTransformation(transformationName, inputData, expectedOutput) {
  try {
    let actualOutput
    
    switch (transformationName) {
      case 'clean_workout':
        actualOutput = cleanData('workout', inputData)
        break
      case 'clean_health_metrics':
        actualOutput = cleanData('health', inputData)
        break
      case 'validate_workout':
        actualOutput = validateData('workout', inputData)
        break
      case 'enrich_workout':
        actualOutput = await enrichWorkoutData(inputData)
        break
      case 'enrich_health':
        actualOutput = await enrichHealthMetrics(inputData)
        break
      default:
        throw new Error(`Unknown transformation: ${transformationName}`)
    }
    
    // Compare outputs
    const passed = deepEqual(actualOutput, expectedOutput)
    
    return {
      transformation: transformationName,
      passed,
      input: inputData,
      expected: expectedOutput,
      actual: actualOutput,
      errors: passed ? [] : ['Output does not match expected result']
    }
  } catch (error) {
    logError('Error testing transformation', error)
    return {
      transformation: transformationName,
      passed: false,
      error: error.message
    }
  }
}

/**
 * Test data quality rules
 */
export function testDataQuality(data, qualityRules) {
  const results = []
  
  qualityRules.forEach(rule => {
    let passed = false
    let actualValue = null
    
    switch (rule.type) {
      case 'not_null':
        actualValue = data[rule.field]
        passed = actualValue !== null && actualValue !== undefined
        break
      
      case 'range':
        actualValue = data[rule.field]
        passed = actualValue >= rule.min && actualValue <= rule.max
        break
      
      case 'format':
        actualValue = data[rule.field]
        passed = rule.pattern.test(actualValue)
        break
      
      case 'relationship':
        // Cross-field validation
        const field1 = data[rule.field1]
        const field2 = data[rule.field2]
        passed = rule.operator === '>' ? field1 > field2 :
                 rule.operator === '<' ? field1 < field2 :
                 rule.operator === '==' ? field1 === field2 : false
        break
    }
    
    results.push({
      rule: rule.name,
      type: rule.type,
      passed,
      actual_value: actualValue,
      expected: rule.expected || null
    })
  })
  
  return {
    total_rules: qualityRules.length,
    passed_rules: results.filter(r => r.passed).length,
    failed_rules: results.filter(r => !r.passed).length,
    results
  }
}

/**
 * Test schema compatibility
 */
export function testSchemaCompatibility(data, schema) {
  const errors = []
  
  // Check required fields
  schema.required?.forEach(field => {
    if (!(field in data) || data[field] === null || data[field] === undefined) {
      errors.push(`Missing required field: ${field}`)
    }
  })
  
  // Check field types
  Object.entries(schema.properties || {}).forEach(([field, definition]) => {
    if (field in data && data[field] !== null && data[field] !== undefined) {
      const actualType = typeof data[field]
      const expectedType = definition.type === 'integer' ? 'number' : definition.type
      
      if (actualType !== expectedType) {
        errors.push(`Field ${field}: expected type ${expectedType}, got ${actualType}`)
      }
    }
  })
  
  return {
    compatible: errors.length === 0,
    errors
  }
}

/**
 * Run regression tests for schema changes
 */
export async function runRegressionTests(testSuite) {
  const results = []
  
  for (const test of testSuite) {
    try {
      let result
      
      if (test.type === 'transformation') {
        result = await testTransformation(test.transformation, test.input, test.expected)
      } else if (test.type === 'quality') {
        result = testDataQuality(test.input, test.rules)
      } else if (test.type === 'schema') {
        result = testSchemaCompatibility(test.input, test.schema)
      }
      
      results.push({
        test_name: test.name,
        type: test.type,
        ...result
      })
    } catch (error) {
      results.push({
        test_name: test.name,
        type: test.type,
        passed: false,
        error: error.message
      })
    }
  }
  
  return {
    total_tests: testSuite.length,
    passed_tests: results.filter(r => r.passed !== false).length,
    failed_tests: results.filter(r => r.passed === false).length,
    results
  }
}

// Helper function for deep equality
function deepEqual(a, b) {
  if (a === b) return true
  
  if (a == null || b == null) return false
  
  if (typeof a !== 'object' || typeof b !== 'object') return false
  
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  
  if (keysA.length !== keysB.length) return false
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  
  return true
}

/**
 * Example test suite
 */
export const EXAMPLE_TEST_SUITE = [
  {
    name: 'Workout cleaning test',
    type: 'transformation',
    transformation: 'clean_workout',
    input: {
      date: '2024-01-15',
      duration: 60.5,
      exercises: [{
        name: 'bench press',
        sets: [{
          weight: 225.123,
          reps: 10.7
        }]
      }]
    },
    expected: {
      date: '2024-01-15',
      duration: 61,
      exercises: [{
        name: 'Bench Press',
        sets: [{
          weight: 225.12,
          reps: 11
        }]
      }]
    }
  },
  {
    name: 'Workout validation test',
    type: 'quality',
    input: {
      date: '2024-01-15',
      duration: 60,
      exercises: [{ name: 'Bench Press', sets: [{ weight: 225, reps: 10 }] }]
    },
    rules: [
      {
        name: 'Date is required',
        type: 'not_null',
        field: 'date'
      },
      {
        name: 'Duration is reasonable',
        type: 'range',
        field: 'duration',
        min: 0,
        max: 1440
      }
    ]
  }
]

