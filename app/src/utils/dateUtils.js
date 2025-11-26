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

