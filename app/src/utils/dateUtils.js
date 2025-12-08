// Get current date in Eastern Standard Time as YYYY-MM-DD
export function getESTDate(date = new Date()) {
  const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(date)
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  const day = parts.find(p => p.type === 'day').value
  return `${year}-${month}-${day}`
}

// Get today's date in EST
export function getTodayEST() {
  return getESTDate(new Date())
}

// Get yesterday's date in EST
export function getYesterdayEST() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return getESTDate(yesterday)
}

// Format date as MM-DD-YYYY (standardized format)
export function formatDateMMDDYYYY(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T12:00:00')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()
  return `${month}-${day}-${year}`
}

// Format date for display (Today, Yesterday, or short date)
export function formatDateDisplay(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString + 'T12:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

// Format date for history tables (short format)
export function formatDateShort(dateStr, includeYear = false) {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined
  })
}

