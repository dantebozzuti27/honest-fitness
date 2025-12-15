/**
 * Formats a database field name (with underscores) into a clean display name
 * @param {string} fieldName - The database field name (e.g., 'workouts_per_week')
 * @returns {string} - Formatted display name (e.g., 'Workouts Per Week')
 */
export function formatFieldName(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    return fieldName || ''
  }
  
  // Replace underscores with spaces and capitalize each word
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Formats a goal type for display, using custom name if available, otherwise formatting the type
 * @param {object} goal - The goal object with custom_name and type
 * @param {function} getLabelFromType - Optional function to get label from goal types array
 * @returns {string} - Formatted goal name for display
 */
export function formatGoalName(goal, getLabelFromType = null) {
  if (!goal) return ''
  
  // Use custom name if available
  if (goal.custom_name) {
    return goal.custom_name
  }
  
  // Try to get label from goal types array if function provided
  if (getLabelFromType && goal.type) {
    const label = getLabelFromType(goal.category)?.find(t => t.type === goal.type)?.label
    if (label) {
      return label
    }
  }
  
  // Fall back to formatting the type field name
  return formatFieldName(goal.type || '')
}

