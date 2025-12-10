/**
 * Haptic Feedback Utility
 * Provides consistent haptic feedback following Apple's HIG guidelines
 */

const HAPTIC_INTENSITY = {
  LIGHT: 5,      // Subtle feedback (hover, threshold crossing)
  MEDIUM: 10,    // Standard feedback (button tap, selection)
  STRONG: 20,    // Important feedback (success, error)
  HEAVY: 30      // Critical feedback (destructive actions)
}

const HAPTIC_PATTERNS = {
  SUCCESS: [10, 20, 10],      // Success pattern
  ERROR: [20, 10, 20],        // Error pattern
  WARNING: [15, 10],          // Warning pattern
  SELECTION: [5],              // Selection feedback
  IMPACT: [10]                 // Impact feedback
}

/**
 * Trigger haptic feedback
 * @param {number|number[]} pattern - Vibration pattern (duration in ms or array of durations)
 * @returns {boolean} - Whether haptic feedback was supported and triggered
 */
export function haptic(pattern = HAPTIC_INTENSITY.MEDIUM) {
  if (!navigator.vibrate) {
    return false
  }

  try {
    const vibrationPattern = Array.isArray(pattern) ? pattern : [pattern]
    navigator.vibrate(vibrationPattern)
    return true
  } catch (error) {
    console.warn('Haptic feedback failed:', error)
    return false
  }
}

/**
 * Light haptic feedback (for subtle interactions)
 */
export function hapticLight() {
  return haptic(HAPTIC_INTENSITY.LIGHT)
}

/**
 * Medium haptic feedback (for standard interactions)
 */
export function hapticMedium() {
  return haptic(HAPTIC_INTENSITY.MEDIUM)
}

/**
 * Strong haptic feedback (for important interactions)
 */
export function hapticStrong() {
  return haptic(HAPTIC_INTENSITY.STRONG)
}

/**
 * Success haptic pattern
 */
export function hapticSuccess() {
  return haptic(HAPTIC_PATTERNS.SUCCESS)
}

/**
 * Error haptic pattern
 */
export function hapticError() {
  return haptic(HAPTIC_PATTERNS.ERROR)
}

/**
 * Warning haptic pattern
 */
export function hapticWarning() {
  return haptic(HAPTIC_PATTERNS.WARNING)
}

/**
 * Selection haptic feedback
 */
export function hapticSelection() {
  return haptic(HAPTIC_PATTERNS.SELECTION)
}

/**
 * Impact haptic feedback
 */
export function hapticImpact() {
  return haptic(HAPTIC_PATTERNS.IMPACT)
}

export { HAPTIC_INTENSITY, HAPTIC_PATTERNS }

