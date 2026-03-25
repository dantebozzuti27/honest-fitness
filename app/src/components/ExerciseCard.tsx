import { useEffect, useRef, useState } from 'react'
import Card from './ui/Card'
import styles from './ExerciseCard.module.css'

type ExistingStack = { group: any; members: any[]; names: any[] }

type ExerciseCardProps = {
  exercise: any
  lastInfo: any
  adjustmentFactor?: number
  index: any
  total: any
  onToggle: () => void
  onUpdateSet: (setIdx: number, field: any, value: any) => void
  onAddSet: () => void
  onRemoveSet: () => void
  onRemove: () => void
  onMove: (dir: any) => void
  onStartRest: (seconds?: number) => void
  onComplete: () => void
  onStackNext: (args: any) => void
  stacked: any
  stackGroup: any
  stackMembers: any
  stackIndex: any
  existingStacks?: ExistingStack[]
  onToggleStack: () => void
  onAddToStack: (targetGroup: any) => void
  onRemoveFromStack: () => void
  isDragging: any
  onDragStart?: (...args: any[]) => void
  onDragOver?: (...args: any[]) => void
  onDragEnter?: (...args: any[]) => void
  onDragEnd?: (...args: any[]) => void
  onDrop?: (...args: any[]) => void
  draggable?: boolean
  showDragHandle?: boolean
  containerClassName?: string
}

export default function ExerciseCard({
  exercise,
  lastInfo,
  adjustmentFactor = 1,
  index,
  total,
  onToggle,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onRemove,
  onMove,
  onStartRest,
  onComplete,
  onStackNext,
  stacked,
  stackGroup,
  stackMembers,
  stackIndex,
  existingStacks = [],
  onToggleStack,
  onAddToStack,
  onRemoveFromStack,
  isDragging,
  onDragStart = () => {},
  onDragOver = () => {},
  onDragEnter = () => {},
  onDragEnd = () => {},
  onDrop = () => {},
  draggable = true,
  showDragHandle = true,
  containerClassName = ''
}: ExerciseCardProps) {
  const autoAdvance = (() => {
    try { return localStorage.getItem('workout_auto_advance') !== '0' } catch { return true }
  })()
  const autoNext = (() => {
    try { return localStorage.getItem('workout_auto_next') === '1' } catch { return false }
  })()

  const [activeSet, setActiveSet] = useState(0)
  const setRowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    // Keep refs array aligned with current set count.
    setRowRefs.current = Array.isArray(exercise?.sets) ? setRowRefs.current.slice(0, exercise.sets.length) : []
  }, [exercise?.sets?.length])

  useEffect(() => {
    if (!exercise?.expanded) return
    const el = setRowRefs.current?.[activeSet]
    if (!el || typeof el.scrollIntoView !== 'function') return

    // Respect reduced motion where possible.
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Defer to let layout settle (especially when expanding/collapsing cards).
    const id = window.requestAnimationFrame
      ? window.requestAnimationFrame(() => {
          try {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' })
          } catch {
            try { el.scrollIntoView() } catch {}
          }
        })
      : setTimeout(() => {
          try {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' })
          } catch {
            try { el.scrollIntoView() } catch {}
          }
        }, 0)

    return () => {
      try {
        if (window.cancelAnimationFrame && typeof id === 'number') window.cancelAnimationFrame(id)
        else clearTimeout(id)
      } catch {}
    }
  }, [activeSet, exercise?.expanded])

  const headerHint = (() => {
    const parts = []
    if (lastInfo?.summary) parts.push(`Last ${lastInfo.summary}`)
    if (lastInfo?.best?.e1rm) parts.push(`Best ${Math.round(lastInfo.best.e1rm)} e1RM`)
    return parts.join(' · ')
  })()

  const roundTo2_5 = (n: number | string | null | undefined) => {
    const x = Number(n)
    if (!Number.isFinite(x)) return null
    return Math.round(x / 2.5) * 2.5
  }

  const computeStrengthSuggestion = (set: any) => {
    const cat = (exercise?.category || '').toString()
    if (cat === 'Cardio' || cat === 'Recovery') return null

    const weightFilled = set?.weight != null && String(set.weight).trim() !== ''
    if (weightFilled) return null

    const best = lastInfo?.best
    const e1rm = Number(best?.e1rm)
    if (!Number.isFinite(e1rm) || e1rm <= 0) return null

    const repsFilled = set?.reps != null && String(set.reps).trim() !== ''
    const desiredRepsRaw = repsFilled ? Number(set.reps) : Number(best?.reps)
    const desiredReps = Number.isFinite(desiredRepsRaw) && desiredRepsRaw > 0
      ? Math.max(1, Math.min(20, Math.floor(desiredRepsRaw)))
      : 5

    const base = e1rm / (1 + desiredReps / 30)
    const factor = Number(adjustmentFactor)
    const safeFactor = Number.isFinite(factor) ? Math.max(0.6, Math.min(1.0, factor)) : 1
    const adjusted = base * safeFactor
    const weight = roundTo2_5(adjusted)
    if (weight == null || !Number.isFinite(weight) || weight <= 0) return null

    return { weight, reps: desiredReps }
  }

  // Determine cardio input configuration based on exercise name.
  // The `speed` DB column stores the contextual value (mph, level, watts, resistance).
  // The `incline` column is only relevant for treadmill exercises.
  const cardioInputConfig = (() => {
    const name = (exercise?.name || '').toLowerCase()
    if (name.includes('stairmaster') || name.includes('stair master'))
      return { speedLabel: 'Level', speedPlaceholder: '1-20', speedStep: '1', speedUnit: '', showIncline: false, showSpeed: true }
    if (name.includes('rowing') || name.includes('row erg') || name.includes('ski erg'))
      return { speedLabel: 'Watts', speedPlaceholder: 'watts', speedStep: '1', speedUnit: 'W', showIncline: false, showSpeed: true }
    if (name.includes('bike') || name.includes('cycling') || name.includes('stationary'))
      return { speedLabel: 'Resistance', speedPlaceholder: 'lvl', speedStep: '1', speedUnit: '', showIncline: false, showSpeed: true }
    if (name.includes('elliptical'))
      return { speedLabel: 'Resistance', speedPlaceholder: 'lvl', speedStep: '1', speedUnit: '', showIncline: name.includes('incline'), showSpeed: true }
    if (name.includes('treadmill'))
      return { speedLabel: 'Speed', speedPlaceholder: 'mph', speedStep: '0.1', speedUnit: 'mph', showIncline: true, showSpeed: true }
    return { speedLabel: '', speedPlaceholder: '', speedStep: '1', speedUnit: '', showIncline: false, showSpeed: false }
  })()

  // Cardio timer (per exercise card; applied to the active set row)
  const cardioTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cardioTimerStartMsRef = useRef<number | null>(null)
  const cardioTimerBaseSecondsRef = useRef<number>(0)
  const cardioTimerSetIdxRef = useRef<number | null>(null)
  const [cardioTimerSeconds, setCardioTimerSeconds] = useState(0)

  // Commit running timer value to parent state every 10 seconds so it's never lost
  const lastCommitRef = useRef<number>(0)
  useEffect(() => {
    const commitInterval = setInterval(() => {
      if (!cardioTimerIntervalRef.current || cardioTimerSetIdxRef.current == null) return
      const startMs = cardioTimerStartMsRef.current
      const base = cardioTimerBaseSecondsRef.current
      if (!startMs) return
      const elapsed = Math.floor((Date.now() - startMs) / 1000)
      const total = base + Math.max(0, elapsed)
      if (total !== lastCommitRef.current) {
        lastCommitRef.current = total
        onUpdateSet(cardioTimerSetIdxRef.current, 'time_seconds', total)
        onUpdateSet(cardioTimerSetIdxRef.current, 'time', `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`)
      }
    }, 10000)

    return () => {
      clearInterval(commitInterval)
      // On unmount, commit any running timer value one final time
      if (cardioTimerIntervalRef.current && cardioTimerSetIdxRef.current != null) {
        const startMs = cardioTimerStartMsRef.current
        const base = cardioTimerBaseSecondsRef.current
        if (startMs) {
          const elapsed = Math.floor((Date.now() - startMs) / 1000)
          const total = base + Math.max(0, elapsed)
          onUpdateSet(cardioTimerSetIdxRef.current, 'time_seconds', total)
          onUpdateSet(cardioTimerSetIdxRef.current, 'time', `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`)
        }
        clearInterval(cardioTimerIntervalRef.current)
        cardioTimerIntervalRef.current = null
      }
    }
  }, [])

  function parseCardioSeconds(raw: any) {
    if (raw == null) return 0
    const s = String(raw).trim()
    if (!s) return 0

    // Accept "MM:SS"
    if (s.includes(':')) {
      const [mm, ss] = s.split(':').map(v => v.trim())
      const m = Number(mm)
      const sec = Number(ss)
      if (Number.isFinite(m) && Number.isFinite(sec)) {
        return Math.max(0, Math.floor(m * 60 + sec))
      }
    }

    // Accept "15 min", "15m", "90s"
    const minMatch = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)$/i)
    if (minMatch) {
      const m = Number(minMatch[1])
      return Number.isFinite(m) ? Math.max(0, Math.floor(m * 60)) : 0
    }
    const secMatch = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)$/i)
    if (secMatch) {
      const sec = Number(secMatch[1])
      return Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0
    }

    // Plain number heuristic:
    // We store cardio time as SECONDS in the system.
    // Treat bare numbers as seconds to avoid mis-reading "30" (meaning 0:30) as 30 minutes.
    const n = Number(s)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.floor(n))
  }

  function secondsToMMSS(totalSeconds: number) {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return { mins, secs }
  }

  function secondsToMMSSString(totalSeconds: number | string | null | undefined) {
    const safe = Number.isFinite(Number(totalSeconds)) ? Math.max(0, Math.floor(Number(totalSeconds))) : 0
    const { mins, secs } = secondsToMMSS(safe)
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  function startCardioTimer(setIdx: number, existingSeconds: number) {
    if (cardioTimerIntervalRef.current) {
      clearInterval(cardioTimerIntervalRef.current)
      cardioTimerIntervalRef.current = null
    }

    cardioTimerSetIdxRef.current = setIdx
    cardioTimerBaseSecondsRef.current = existingSeconds
    cardioTimerStartMsRef.current = Date.now()
    setCardioTimerSeconds(existingSeconds)

    cardioTimerIntervalRef.current = setInterval(() => {
      const startMs = cardioTimerStartMsRef.current
      const base = cardioTimerBaseSecondsRef.current
      if (!startMs) return
      const elapsed = Math.floor((Date.now() - startMs) / 1000)
      setCardioTimerSeconds(base + Math.max(0, elapsed))
    }, 250)
  }

  function stopCardioTimer() {
    if (cardioTimerIntervalRef.current) {
      clearInterval(cardioTimerIntervalRef.current)
      cardioTimerIntervalRef.current = null
    }
    cardioTimerStartMsRef.current = null
  }

  const getSuggestedRestSeconds = () => {
    const raw = Number(exercise?._prescription?.restSeconds)
    if (!Number.isFinite(raw) || raw <= 0) return undefined
    // Keep rest timers within a practical training range.
    return Math.max(20, Math.min(600, Math.round(raw)))
  }

  const handleNextSet = () => {
    const suggestedRestSeconds = getSuggestedRestSeconds()
    // Stacked flow: alternate to the next exercise after *every* set.
    if (stacked && stackGroup && Array.isArray(stackMembers) && stackMembers.length > 1 && onStackNext) {
      const isLastSet = activeSet >= (exercise.sets.length - 1)
      const nextSetIndex = Math.min(activeSet + 1, Math.max(0, exercise.sets.length - 1))
      if (!isLastSet) {
        setActiveSet(nextSetIndex)
      }
      onStartRest?.(suggestedRestSeconds)
      onStackNext({
        exerciseId: exercise.id,
        stackGroup,
        isLastSet
      })
      return
    }

    if (activeSet < exercise.sets.length - 1) {
      setActiveSet(activeSet + 1)
      onStartRest(suggestedRestSeconds)
    } else {
      // Last set - complete exercise and move to next
      onComplete()
      onStartRest(suggestedRestSeconds)
    }
  }

  const toNum = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const isBodyweightValue = (v: any) => String(v ?? '').trim().toUpperCase() === 'BW'

  const adjustFieldNumber = (setIdx: number, field: string, delta: number, { min = 0, max = null as number | null, step = 1 } = {}) => {
    const current = exercise?.sets?.[setIdx]?.[field]
    const n = toNum(current)
    const base = n == null ? 0 : n
    let next = base + delta
    if (step != null) next = Math.round(next / step) * step
    if (min != null) next = Math.max(min, next)
    if (max != null) next = Math.min(max, next)
    // Preserve "" for zero if the user hasn't entered anything yet? Here we always set a number.
    onUpdateSet(setIdx, field, String(next))
  }

  const copyPreviousSet = (setIdx: number) => {
    if (!exercise?.sets || setIdx <= 0) return
    const prev = exercise.sets[setIdx - 1] || {}
    // Copy only the relevant fields for the exercise type.
    if (exercise.category === 'Cardio') {
      onUpdateSet(setIdx, 'time', prev.time ?? '')
      if (prev.time_seconds != null) onUpdateSet(setIdx, 'time_seconds', prev.time_seconds)
      onUpdateSet(setIdx, 'speed', prev.speed ?? '')
      onUpdateSet(setIdx, 'incline', prev.incline ?? '')
      return
    }
    if (exercise.category === 'Recovery') {
      onUpdateSet(setIdx, 'time', prev.time ?? '')
      return
    }
    onUpdateSet(setIdx, 'weight', prev.weight ?? '')
    onUpdateSet(setIdx, 'reps', prev.reps ?? '')
  }

  const weightInputRef = useRef<HTMLInputElement | null>(null)
  const repsInputRef = useRef<HTMLInputElement | null>(null)
  const lastNumericWeightBySetRef = useRef(new Map<number, string>())

  const toggleBodyweight = (setIdx: number) => {
    const currentRaw = exercise?.sets?.[setIdx]?.weight
    const current = String(currentRaw ?? '')

    if (isBodyweightValue(currentRaw)) {
      const prev = lastNumericWeightBySetRef.current.get(setIdx)
      onUpdateSet(setIdx, 'weight', prev != null ? String(prev) : '')
      // Prefer returning focus to weight input when switching back.
      if (setIdx === activeSet) setTimeout(() => weightInputRef.current?.focus?.(), 0)
      return
    }

    // Stash current numeric entry so the user can toggle back without losing it.
    const trimmed = current.trim()
    if (trimmed) lastNumericWeightBySetRef.current.set(setIdx, trimmed)
    onUpdateSet(setIdx, 'weight', 'BW')
    // BW implies weight is "filled" → move to reps for fast entry.
    if (setIdx === activeSet) setTimeout(() => repsInputRef.current?.focus?.(), 0)
  }

  // Auto-next should never fire while the user is mid-typing (mobile keyboards in particular).
  // We call this only on "commit" events (blur / Enter), not onChange.
  const maybeAutoNext = (setIdx: number, nextWeight: any, nextReps: any) => {
    if (!autoNext) return
    if (setIdx !== activeSet) return
    const w = String(nextWeight ?? '').trim()
    const r = String(nextReps ?? '').trim()
    if (!w || !r) return
    // Let the state update land before advancing.
    setTimeout(() => {
      try { handleNextSet() } catch {}
    }, 0)
  }

  return (
    <Card
      className={`${styles.card} ${exercise.expanded ? styles.expanded : ''} ${exercise.completed ? styles.completed : ''} ${isDragging ? styles.dragging : ''} ${stacked ? styles.stacked : ''} ${containerClassName || ''}`}
      draggable={Boolean(draggable)}
      onDragStart={(e: React.DragEvent) => {
        if (onDragStart) {
          onDragStart(e, exercise.id)
        }
      }}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragEnd={(e: React.DragEvent) => {
        if (onDragEnd) {
          onDragEnd(e)
        }
      }}
      onDrop={onDrop}
    >
      {stacked && stackMembers && stackMembers.length > 1 && (
        <div className={styles.stackBadge}>
          {stackMembers.length === 2 ? 'Superset' : 'Circuit'} {stackIndex + 1}/{stackMembers.length}
        </div>
      )}
      {showDragHandle && (
        <div 
          className={styles.dragHandle}
          onMouseDown={(e) => {
            // Make the card draggable when clicking the handle
            e.stopPropagation()
          }}
          onTouchStart={(e) => {
            // For touch, allow dragging from handle
            e.stopPropagation()
          }}
        >
          ⋮⋮
        </div>
      )}
      <button className={styles.header} onClick={onToggle}>
        <span className={styles.headerMain}>
          <span className={styles.name}>{exercise.name}</span>
          {headerHint ? (
            <span className={styles.subline}>{headerHint}</span>
          ) : null}
        </span>
        <span className={styles.summary}>{exercise.expanded ? '−' : `${exercise.sets.length} sets`}</span>
      </button>

      {exercise.expanded && (
        <div className={styles.content}>
          {/* Prescription targets from the workout generator */}
          {exercise._prescription && (
            <div className={styles.prescriptionBlock}>
              <div className={styles.prescriptionHeader}>
                <span className={styles.prescriptionRole} data-role={exercise._prescription.exerciseRole}>
                  {exercise._prescription.exerciseRole}
                </span>
                {exercise._prescription.rirLabel && (
                  <span className={styles.prescriptionRir}>
                    RIR {exercise._prescription.targetRir} — {exercise._prescription.rirLabel}
                  </span>
                )}
                {exercise._prescription.restSeconds > 0 && (
                  <span className={styles.prescriptionRest}>
                    Rest {exercise._prescription.restSeconds >= 60
                      ? `${Math.round(exercise._prescription.restSeconds / 60)}m`
                      : `${exercise._prescription.restSeconds}s`}
                  </span>
                )}
              </div>
              {exercise._prescription.targetHrZone && (
                <div className={styles.prescriptionHr}>
                  Zone {exercise._prescription.targetHrZone}
                  {exercise._prescription.targetHrBpmRange
                    ? ` (${exercise._prescription.targetHrBpmRange.min}–${exercise._prescription.targetHrBpmRange.max} bpm)`
                    : ''}
                </div>
              )}
              {exercise._prescription.warmupSets?.length > 0 && (
                <div className={styles.prescriptionWarmup}>
                  <span className={styles.prescriptionWarmupLabel}>Warmup:</span>
                  {exercise._prescription.warmupSets.map((ws: any, i: number) => (
                    <span key={i} className={styles.prescriptionWarmupSet}>
                      {ws.weight}×{ws.reps}
                    </span>
                  ))}
                </div>
              )}
              {exercise._prescription.adjustments?.length > 0 && (
                <div className={styles.prescriptionAdjustments}>
                  {exercise._prescription.adjustments.map((adj: string, i: number) => (
                    <div key={i} className={styles.prescriptionAdj}>{adj}</div>
                  ))}
                </div>
              )}
              {exercise._prescription.supersetGroupId != null && (
                <div className={styles.prescriptionSuperset}>
                  Superset ({exercise._prescription.supersetType?.replace('_', '-')})
                </div>
              )}
            </div>
          )}
          {lastInfo?.summary ? (
            <div className={styles.lastInfo}>
              <span className={styles.lastInfoLabel}>Last:</span> {lastInfo.summary}
              {lastInfo?.date ? <span className={styles.lastInfoDate}> · {lastInfo.date}</span> : null}
            </div>
          ) : null}
          {lastInfo?.best?.e1rm ? (
            <div className={styles.bestInfo}>
              <span className={styles.bestInfoLabel}>Best:</span> {Math.round(lastInfo.best.e1rm)} e1RM
              {lastInfo.best?.reps != null && lastInfo.best?.weight != null
                ? <span className={styles.bestInfoDate}> · {lastInfo.best.reps}×{Math.round(lastInfo.best.weight)} · {lastInfo.best.date || ''}</span>
                : null}
            </div>
          ) : null}
          <div className={styles.controls}>
            <div className={styles.setControls}>
              <button onClick={onRemoveSet} disabled={exercise.sets.length <= 1}>−</button>
              <span>{exercise.sets.length} sets</span>
              <button onClick={onAddSet}>+</button>
            </div>
            <div className={styles.stackControls}>
              {onToggleStack && (
                <>
                  <button 
                    className={`${styles.stackBtn} ${stacked ? styles.stackedActive : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleStack()
                    }}
                    title={stacked 
                      ? `Remove from ${stackMembers?.length === 2 ? 'superset' : stackMembers?.length >= 3 ? 'circuit' : 'stack'}` 
                      : 'Click to stack this exercise. Stack 2 exercises for a superset, 3+ for a circuit.'}
                    aria-label={stacked ? 'Remove from stack' : 'Add to stack'}
                  >
                    {stacked ? (
                      <span className={styles.stackBtnContent}>
                        <span className={styles.stackIcon}>🔗</span>
                        <span className={styles.stackLabel}>
                          {stackMembers?.length === 2 ? 'Superset' : stackMembers?.length >= 3 ? 'Circuit' : 'Stacked'}
                        </span>
                      </span>
                    ) : (
                      <span className={styles.stackBtnContent}>
                        <span className={styles.stackIcon}>🔗</span>
                        <span className={styles.stackLabel}>Stack</span>
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>
            <div className={styles.moveControls}>
              <button onClick={() => onMove('up')} disabled={index === 0}>↑</button>
              <button onClick={() => onMove('down')} disabled={index === total - 1}>↓</button>
              <button className={styles.removeBtn} onClick={onRemove}>✕</button>
            </div>
          </div>

          {/* Stack / Superset UI (full-width, never collapses into vertical text) */}
          {!stacked && Array.isArray(existingStacks) && existingStacks.length > 0 && onAddToStack ? (
            <div className={styles.stackSection} aria-label="Join an existing superset or circuit">
              <div className={styles.stackSectionTitle}>Join existing</div>
              <div className={styles.stackSectionChips}>
                {existingStacks.map((stack) => (
                  <button
                    key={stack.group}
                    type="button"
                    className={styles.joinStackBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddToStack(stack.group)
                    }}
                    title={`Join ${stack.names.join(', ')}`}
                  >
                    {stack.members.length === 2 ? 'Superset' : 'Circuit'} ({stack.members.length})
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {stacked && stackMembers && stackMembers.length > 1 ? (
            <div className={styles.stackSection} aria-label="Superset or circuit details">
              <div className={styles.stackSectionTitle}>
                {(stackMembers.length === 2 ? 'Superset' : 'Circuit')} {stackIndex + 1}/{stackMembers.length}
              </div>
              <div className={styles.stackSectionSub}>
                Next: {stackMembers[(stackIndex + 1) % stackMembers.length]?.name || ''}
              </div>
              <div className={styles.stackSectionChips}>
                {stackMembers.map((member: any, idx: number) => (
                  <span
                    key={member.id}
                    className={`${styles.stackMember} ${idx === stackIndex ? styles.activeStackMember : ''}`}
                    title={member?.name || ''}
                  >
                    {member?.name || ''}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.sets}>
            {exercise.sets.map((set: any, idx: number) => (
              <div 
                key={idx} 
                ref={(node: HTMLDivElement | null) => { setRowRefs.current[idx] = node }}
                className={`${styles.setRow} ${idx === activeSet ? styles.activeSet : ''} ${idx < activeSet ? styles.completedSet : ''}`}
              >
                <div className={styles.setMainRow}>
                  <span className={styles.setNumber}>{idx + 1}</span>

                  {exercise.category === 'Cardio' ? (
                  <>
                    {(() => {
                      const isTimerRunning = cardioTimerIntervalRef.current && cardioTimerSetIdxRef.current === idx
                      // Recorded time is stored in time_seconds/time. Template "targets" live in target_time* fields.
                      const storedSeconds = Number.isFinite(Number(set?.time_seconds))
                        ? Math.max(0, Math.floor(Number(set.time_seconds)))
                        : 0
                      const displaySeconds = isTimerRunning ? cardioTimerSeconds : storedSeconds
                      const { mins, secs } = secondsToMMSS(displaySeconds)

                      return (
                        <div className={styles.cardioMainGroup}>
                          <div className={styles.cardioTimeRow}>
                            <div className={styles.cardioTimeInputs}>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="min"
                                value={Number.isFinite(mins) ? String(mins) : ''}
                                disabled={Boolean(isTimerRunning)}
                                onChange={(e) => {
                                  const nextMins = Number(e.target.value || 0)
                                  const safeMins = Number.isFinite(nextMins) ? Math.max(0, Math.floor(nextMins)) : 0
                                  const total = safeMins * 60 + (Number.isFinite(secs) ? secs : 0)
                                  onUpdateSet(idx, 'time_seconds', total)
                                  onUpdateSet(idx, 'time', secondsToMMSSString(total))
                                }}
                                className={`${styles.input} ${styles.cardioMinInput}`}
                              />
                              <span className={styles.cardioTimeColon}>:</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="sec"
                                value={Number.isFinite(secs) ? String(secs).padStart(2, '0') : ''}
                                disabled={Boolean(isTimerRunning)}
                                onChange={(e) => {
                                  const nextSecs = Number(e.target.value || 0)
                                  const safeSecs = Number.isFinite(nextSecs) ? Math.max(0, Math.min(59, Math.floor(nextSecs))) : 0
                                  const total = (Number.isFinite(mins) ? mins : 0) * 60 + safeSecs
                                  onUpdateSet(idx, 'time_seconds', total)
                                  onUpdateSet(idx, 'time', secondsToMMSSString(total))
                                }}
                                className={`${styles.input} ${styles.cardioSecInput}`}
                              />
                            </div>

                            {idx === activeSet && (
                              <button
                                type="button"
                                className={styles.cardioTimerIconBtn}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()

                                  if (isTimerRunning) {
                                    // Commit current timer value to this set and stop.
                                    onUpdateSet(idx, 'time_seconds', cardioTimerSeconds)
                                    onUpdateSet(idx, 'time', secondsToMMSSString(cardioTimerSeconds))
                                    stopCardioTimer()
                                  } else {
                                    // Always start from 0 (fresh timer) on user request.
                                    startCardioTimer(idx, 0)
                                  }
                                }}
                                title={isTimerRunning ? 'Stop cardio timer (save time)' : 'Start cardio timer'}
                                aria-label={isTimerRunning ? 'Stop cardio timer' : 'Start cardio timer'}
                              >
                                {isTimerRunning ? '■' : '⏱'}
                              </button>
                            )}
                          </div>

                          <div className={styles.cardioSubTimer}>
                            {isTimerRunning ? 'Running' : 'Time'}: {secondsToMMSSString(displaySeconds)}
                            {(() => {
                              const t = set?.target_time
                              const ts = Number(set?.target_time_seconds)
                              const show = (t != null && String(t).trim() !== '') || (Number.isFinite(ts) && ts > 0)
                              if (!show) return null
                              const label = Number.isFinite(ts) && ts > 0 ? secondsToMMSSString(ts) : String(t)
                              return <span className={styles.cardioTarget}> · Target {label}</span>
                            })()}
                          </div>

                          {(cardioInputConfig.showSpeed || cardioInputConfig.showIncline) && (
                          <div className={styles.cardioMetaRow}>
                            {cardioInputConfig.showSpeed && (
                            <div className={styles.cardioMetaGroup}>
                              <input
                                type="number"
                                inputMode="decimal"
                                step={cardioInputConfig.speedStep}
                                placeholder={cardioInputConfig.speedPlaceholder}
                                value={set.speed || ''}
                                onChange={(e) => onUpdateSet(idx, 'speed', e.target.value)}
                                className={`${styles.input} ${styles.cardioMetaInput}`}
                              />
                              {cardioInputConfig.speedUnit && (
                                <span className={styles.cardioMetaUnit}>{cardioInputConfig.speedUnit}</span>
                              )}
                              {!cardioInputConfig.speedUnit && (
                                <span className={styles.cardioMetaUnit}>{cardioInputConfig.speedLabel}</span>
                              )}
                            </div>
                            )}
                            {cardioInputConfig.showIncline && (
                            <div className={styles.cardioMetaGroup}>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                placeholder="%"
                                value={set.incline || ''}
                                onChange={(e) => onUpdateSet(idx, 'incline', e.target.value)}
                                className={`${styles.input} ${styles.cardioMetaInput}`}
                              />
                              <span className={styles.cardioMetaUnit}>% incline</span>
                            </div>
                            )}
                          </div>
                          )}
                        </div>
                      )
                    })()}
                  </>
                ) : exercise.category === 'Recovery' ? (
                  <div className={styles.inputGroup} style={{flex: 2}}>
                    <input
                      type="text"
                      placeholder="time (e.g. 15 min)"
                      value={set.time || ''}
                      onChange={(e) => onUpdateSet(idx, 'time', e.target.value)}
                      className={styles.input}
                    />
                  </div>
                ) : (Number(set?.target_time_seconds ?? set?._target_time_seconds) || 0) > 0 ? (
                  <div className={styles.inputGroup} style={{ flex: 2 }}>
                    <div className={styles.cardioTimerRow}>
                      <div className={styles.cardioTimeInputs}>
                        {(() => {
                          const totalSeconds = Number(set?.time_seconds || 0)
                          const safeTotal = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
                          const mins = Math.floor(safeTotal / 60)
                          const secs = safeTotal % 60
                          const isTimerRunning = cardioTimerSetIdxRef.current === idx && cardioTimerStartMsRef.current != null
                          return (
                            <>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="min"
                                value={Number.isFinite(mins) ? String(mins) : ''}
                                disabled={Boolean(isTimerRunning)}
                                onChange={(e) => {
                                  const nextMins = Number(e.target.value || 0)
                                  const safeMins = Number.isFinite(nextMins) ? Math.max(0, Math.floor(nextMins)) : 0
                                  const total = safeMins * 60 + (Number.isFinite(secs) ? secs : 0)
                                  onUpdateSet(idx, 'time_seconds', total)
                                  onUpdateSet(idx, 'time', secondsToMMSSString(total))
                                }}
                                className={`${styles.input} ${styles.cardioMinInput}`}
                              />
                              <span className={styles.cardioColon}>:</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="sec"
                                value={Number.isFinite(secs) ? String(secs).padStart(2, '0') : ''}
                                disabled={Boolean(isTimerRunning)}
                                onChange={(e) => {
                                  const nextSecs = Number(e.target.value || 0)
                                  const safeSecs = Number.isFinite(nextSecs) ? Math.max(0, Math.min(59, Math.floor(nextSecs))) : 0
                                  const total = (Number.isFinite(mins) ? mins : 0) * 60 + safeSecs
                                  onUpdateSet(idx, 'time_seconds', total)
                                  onUpdateSet(idx, 'time', secondsToMMSSString(total))
                                }}
                                className={`${styles.input} ${styles.cardioSecInput}`}
                              />
                            </>
                          )
                        })()}
                      </div>

                      {idx === activeSet && (
                        <button
                          type="button"
                          className={styles.cardioTimerIconBtn}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const isTimerRunning = cardioTimerSetIdxRef.current === idx && cardioTimerStartMsRef.current != null
                            if (isTimerRunning) {
                              onUpdateSet(idx, 'time_seconds', cardioTimerSeconds)
                              onUpdateSet(idx, 'time', secondsToMMSSString(cardioTimerSeconds))
                              stopCardioTimer()
                            } else {
                              startCardioTimer(idx, 0)
                            }
                          }}
                          title="Start/stop timer"
                          aria-label="Start/stop timer"
                        >
                          {(cardioTimerSetIdxRef.current === idx && cardioTimerStartMsRef.current != null) ? '■' : '⏱'}
                        </button>
                      )}
                    </div>
                    <div className={styles.cardioSubTimer}>
                      {(() => {
                        const isTimerRunning = cardioTimerSetIdxRef.current === idx && cardioTimerStartMsRef.current != null
                        const total = Number(set?.time_seconds || 0)
                        const display = isTimerRunning ? cardioTimerSeconds : (Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0)
                        const ts = Number(set?.target_time_seconds ?? set?._target_time_seconds)
                        const targetLabel = Number.isFinite(ts) && ts > 0 ? secondsToMMSSString(ts) : ''
                        return (
                          <>
                            {isTimerRunning ? 'Running' : 'Time'}: {secondsToMMSSString(display)}
                            {targetLabel ? <span className={styles.cardioTarget}> · Target {targetLabel}</span> : null}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.inputGroup}>
                      {(() => {
                        const isBW = isBodyweightValue(set?.weight)
                        return (
                          <div className={styles.weightInputWrap}>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              placeholder={isBW ? 'BW' : 'lbs'}
                              value={isBW ? '' : (set.weight || '')}
                              disabled={Boolean(isBW)}
                              aria-label="Weight"
                              ref={idx === activeSet ? weightInputRef : null}
                              onChange={(e) => {
                                const next = e.target.value
                                onUpdateSet(idx, 'weight', next)
                              }}
                              onBlur={() => {
                                if (!autoAdvance) return
                                if (idx !== activeSet) return
                                const next = String(exercise?.sets?.[idx]?.weight ?? '').trim()
                                if (!next) return
                                // Move to reps only after the user is done editing weight.
                                setTimeout(() => repsInputRef.current?.focus?.(), 0)
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return
                                if (!autoAdvance) return
                                if (idx !== activeSet) return
                                const next = String(exercise?.sets?.[idx]?.weight ?? '').trim()
                                if (!next) return
                                e.preventDefault()
                                setTimeout(() => repsInputRef.current?.focus?.(), 0)
                              }}
                              className={`${styles.input} ${styles.bigNumberInput}`}
                            />
                            <button
                              type="button"
                              className={`${styles.bwBtn} ${isBW ? styles.bwBtnOn : ''}`}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleBodyweight(idx)
                              }}
                              aria-pressed={isBW ? 'true' : 'false'}
                              title={isBW ? 'Use external weight' : 'Use bodyweight'}
                            >
                              BW
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                    <div className={styles.inputGroup}>
                      <input
                        type="number"
                        inputMode="numeric"
                        step="1"
                        placeholder="reps"
                        value={set.reps || ''}
                        ref={idx === activeSet ? repsInputRef : null}
                        onChange={(e) => {
                          const next = e.target.value
                          onUpdateSet(idx, 'reps', next)
                        }}
                        onBlur={() => {
                          // "Done" on mobile typically blurs the input.
                          maybeAutoNext(idx, exercise?.sets?.[idx]?.weight, exercise?.sets?.[idx]?.reps)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          maybeAutoNext(idx, exercise?.sets?.[idx]?.weight, exercise?.sets?.[idx]?.reps)
                        }}
                        className={`${styles.input} ${styles.bigNumberInput}`}
                      />
                    </div>
                  </>
                )}

                  <div className={styles.setActionRail}>
                    {/* Generated workout target indicator */}
                    {set._target_reps != null && (set._target_weight != null || set._is_bodyweight) && (
                      <div className={styles.targetHint} title={`Model prescribed: ${set._target_reps} reps${set._is_bodyweight ? ' (bodyweight)' : ` @ ${set._target_weight} lbs`}${set._tempo ? ` (tempo: ${set._tempo})` : ''}`}>
                        <span className={styles.targetLabel}>Rx</span>
                        <span className={styles.targetValue}>{set._target_reps}{set._is_bodyweight ? ' BW' : `×${set._target_weight}`}</span>
                      </div>
                    )}

                    {idx === activeSet && (
                      <button
                        type="button"
                        className={`${styles.nextBtn} ${styles.setNextBtn}`}
                        onClick={handleNextSet}
                      >
                        {idx === exercise.sets.length - 1 ? 'Complete' : 'Next'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Elite set-entry quick actions (active set only) */}
                {idx === activeSet ? (
                  <div className={styles.setQuickRow}>
                    {(() => {
                      const s = computeStrengthSuggestion(set)
                      if (!s) return null
                      return (
                        <button
                          type="button"
                          className={styles.suggestBtn}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onUpdateSet(idx, 'reps', String(s.reps))
                            onUpdateSet(idx, 'weight', String(s.weight))
                          }}
                          title="Apply suggested next set from your recent best"
                        >
                          Apply {s.reps}×{s.weight}
                        </button>
                      )
                    })()}
                    <button
                      type="button"
                      className={styles.nextBtn}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        copyPreviousSet(idx)
                      }}
                      title="Copy previous set"
                    >
                      Copy
                    </button>
                    {exercise.category !== 'Cardio' && exercise.category !== 'Recovery' ? (
                      <>
                        <button
                          type="button"
                          className={styles.nextBtn}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            adjustFieldNumber(idx, 'reps', 1, { min: 0, step: 1 })
                          }}
                          title="Increase reps by 1"
                        >
                          +1 rep
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

