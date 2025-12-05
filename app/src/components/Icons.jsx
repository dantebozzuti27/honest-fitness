/**
 * Icon Components - Apple-inspired SVG icons
 */

export function FitnessIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.4 14.4L9.6 9.6" />
      <path d="M16.5 7.5l-1.1-1.1a2 2 0 0 0-2.8 0L9.6 9.6a2 2 0 0 0 0 2.8l1.1 1.1" />
      <path d="M7.5 16.5l1.1 1.1a2 2 0 0 0 2.8 0l2.8-2.8a2 2 0 0 0 0-2.8L14.4 11.4" />
      <path d="M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />
    </svg>
  )
}

export function NutritionIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C9 2 7 4 7 7c0 3.5 2.5 6.5 5 9.5 2.5-3 5-6 5-9.5 0-3-2-5-5-5z" />
      <path d="M12 7v-1M10 6.5h4" />
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

