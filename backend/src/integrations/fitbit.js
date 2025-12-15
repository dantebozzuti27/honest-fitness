/**
 * Fitbit API Integration
 * Handles all Fitbit API interactions
 */

/**
 * Fetch Fitbit data for a user and date
 */
export async function fetchFitbitData(userId, date, accessToken) {
  const data = {}
  
  try {
    // Fetch sleep data
    const sleepResponse = await fetch(
      `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    if (sleepResponse.ok) {
      const sleepJson = await sleepResponse.json()
      if (sleepJson.sleep && sleepJson.sleep.length > 0) {
        const sleep = sleepJson.sleep[0]
        data.sleepDuration = sleep.minutesAsleep || null
        data.sleepEfficiency = sleep.efficiency || null
      }
    }
  } catch (e) {
    console.error('Error fetching Fitbit sleep:', e)
  }
  
  try {
    // Fetch heart rate data
    const hrResponse = await fetch(
      `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    if (hrResponse.ok) {
      const hrJson = await hrResponse.json()
      if (hrJson['activities-heart'] && hrJson['activities-heart'].length > 0) {
        const heartData = hrJson['activities-heart'][0].value
        data.restingHeartRate = heartData?.restingHeartRate || null
      }
    }
  } catch (e) {
    console.error('Error fetching Fitbit heart rate:', e)
  }
  
  try {
    // Fetch HRV data
    const hrvResponse = await fetch(
      `https://api.fitbit.com/1/user/-/hrv/date/${date}.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    if (hrvResponse.ok) {
      const hrvJson = await hrvResponse.json()
      if (hrvJson.hrv && hrvJson.hrv.length > 0) {
        const hrvValues = hrvJson.hrv
          .map(entry => entry.value?.dailyRmssd || entry.value?.rmssd)
          .filter(v => v != null)
        
        if (hrvValues.length > 0) {
          data.hrv = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
        }
      }
    }
  } catch (e) {
    console.error('Error fetching Fitbit HRV:', e)
  }
  
  try {
    // Fetch activity data
    const activityResponse = await fetch(
      `https://api.fitbit.com/1/user/-/activities/date/${date}.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    if (activityResponse.ok) {
      const activityJson = await activityResponse.json()
      const summary = activityJson.summary || {}
      data.steps = summary.steps || null
      data.caloriesBurned = summary.caloriesOut || null
      data.activeCalories = summary.activityCalories || null
      data.distance = summary.distances && summary.distances.length > 0 
        ? summary.distances[0].distance || null 
        : null
      data.floors = summary.floors || null
    }
  } catch (e) {
    console.error('Error fetching Fitbit activity:', e)
  }
  
  return data
}

