// Get current date in user's local timezone as YYYY-MM-DD
export function getLocalDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Get today's date in user's local timezone
export function getTodayEST() {
  return getLocalDate(new Date())
}

// Get yesterday's date in user's local timezone
export function getYesterdayEST() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return getLocalDate(yesterday)
}

// Legacy function name - kept for compatibility, but now uses local timezone
export function getESTDate(date = new Date()) {
  return getLocalDate(date)
}

// Format date as MM-DD-YYYY (standardized format)
// Uses local timezone for proper date parsing
export function formatDateMMDDYYYY(dateStr) {
  if (!dateStr) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const formattedMonth = String(date.getMonth() + 1).padStart(2, '0')
  const formattedDay = String(date.getDate()).padStart(2, '0')
  const formattedYear = date.getFullYear()
  return `${formattedMonth}-${formattedDay}-${formattedYear}`
}

// Format date for display (Today, Yesterday, or short date)
// Uses local timezone for proper comparison
export function formatDateDisplay(dateString) {
  if (!dateString) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  const compareDate = new Date(date)
  compareDate.setHours(0, 0, 0, 0)

  if (compareDate.getTime() === today.getTime()) {
    return 'Today'
  } else if (compareDate.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

// Format date for history tables (short format)
// Uses local timezone for proper date parsing
export function formatDateShort(dateStr, includeYear = false) {
  if (!dateStr) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined
  })
}

