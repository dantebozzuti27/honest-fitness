/**
 * Icon Components - Apple-inspired SVG icons
 */

export function FitnessIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Dumbbell icon */}
      <path d="M6.5 6.5h11v11h-11z" />
      <path d="M6.5 6.5l-3-3M17.5 6.5l3-3M6.5 17.5l-3 3M17.5 17.5l3 3" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

export function NutritionIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Apple icon */}
      <path d="M17.5 8.5c-.5-2.5-2-4.5-4.5-5-1.5-.3-3 .2-4 1.2-1-1-2.5-1.5-4-1.2-2.5.5-4 2.5-4.5 5-1 4.5 1.5 7.5 3.5 9.5 1.5 1.5 3.5 2.5 5.5 2.5s4-1 5.5-2.5c2-2 4.5-5 3.5-9.5z" />
      <path d="M12 2c.5 1.5 1.5 2.5 3 3" />
    </svg>
  )
}

export function HealthIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

export function AnalyticsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 18 9 12 13 16 21 6" />
      <polyline points="21 6 21 12 21 18" />
    </svg>
  )
}

