// Get current date in user's local timezone as YYYY-MM-DD
export function getLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Get today's date in user's local timezone
export function getTodayEST(): string {
  return getLocalDate(new Date())
}

// Get yesterday's date in user's local timezone
export function getYesterdayEST(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return getLocalDate(yesterday)
}

// Legacy function name - kept for compatibility, but now uses local timezone
export function getESTDate(date: Date = new Date()): string {
  return getLocalDate(date)
}

// Format date as MM-DD-YYYY (standardized format)
// Uses local timezone for proper date parsing
export function formatDateMMDDYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const parts = dateStr.split('-')
  if (parts.length < 3) return ''
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
  const date = new Date(year, month - 1, day)
  const formattedMonth = String(date.getMonth() + 1).padStart(2, '0')
  const formattedDay = String(date.getDate()).padStart(2, '0')
  const formattedYear = date.getFullYear()
  return `${formattedMonth}-${formattedDay}-${formattedYear}`
}

// Format date for display (Today, Yesterday, or short date)
// Uses local timezone for proper comparison
export function formatDateDisplay(dateString: string | null | undefined): string {
  if (!dateString) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const parts = dateString.split('-')
  if (parts.length < 3) return ''
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
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
export function formatDateShort(dateStr: string | null | undefined, includeYear = false): string {
  if (!dateStr) return ''
  // Parse date string (YYYY-MM-DD) in local timezone
  const parts = dateStr.split('-')
  if (parts.length < 3) return ''
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined
  })
}

