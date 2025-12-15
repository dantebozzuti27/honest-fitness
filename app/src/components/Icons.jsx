/**
 * Icon Components - Apple-inspired SVG icons
 */

export function FitnessIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Dumbbell with three segmented plates on each side */}
      {/* Center bar */}
      <rect x="6" y="10" width="12" height="4" rx="1"/>
      {/* Left side plates - three decreasing sizes */}
      <rect x="1" y="8" width="5" height="8" rx="1"/>
      <rect x="2" y="9" width="3" height="6" rx="0.5"/>
      <rect x="3" y="10" width="2" height="4" rx="0.5"/>
      {/* Right side plates - three decreasing sizes */}
      <rect x="18" y="8" width="5" height="8" rx="1"/>
      <rect x="19" y="9" width="3" height="6" rx="0.5"/>
      <rect x="20" y="10" width="2" height="4" rx="0.5"/>
      {/* Separator lines */}
      <line x1="3" y1="8" x2="3" y2="16"/>
      <line x1="4.5" y1="8" x2="4.5" y2="16"/>
      <line x1="19.5" y1="8" x2="19.5" y2="16"/>
      <line x1="21" y1="8" x2="21" y2="16"/>
    </svg>
  )
}

export function NutritionIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Clean fork and knife */}
      <path d="M7 2v20M7 2h1.5v5.5M7 7.5h1.5"/>
      <path d="M17 2v7.5c0 1.5-1 3-2.5 3S12 11 12 9.5V2h5z"/>
      <path d="M14.5 13.5v8"/>
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

