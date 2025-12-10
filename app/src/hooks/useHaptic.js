import { useCallback } from 'react'
import { haptic, hapticLight, hapticMedium, hapticStrong, hapticSuccess, hapticError, hapticWarning, hapticSelection, hapticImpact } from '../utils/haptics'

export function useHaptic() {
  const trigger = useCallback((pattern) => {
    return haptic(pattern)
  }, [])

  const light = useCallback(() => {
    return hapticLight()
  }, [])

  const medium = useCallback(() => {
    return hapticMedium()
  }, [])

  const strong = useCallback(() => {
    return hapticStrong()
  }, [])

  const success = useCallback(() => {
    return hapticSuccess()
  }, [])

  const error = useCallback(() => {
    return hapticError()
  }, [])

  const warning = useCallback(() => {
    return hapticWarning()
  }, [])

  const selection = useCallback(() => {
    return hapticSelection()
  }, [])

  const impact = useCallback(() => {
    return hapticImpact()
  }, [])

  return {
    trigger,
    light,
    medium,
    strong,
    success,
    error,
    warning,
    selection,
    impact
  }
}

