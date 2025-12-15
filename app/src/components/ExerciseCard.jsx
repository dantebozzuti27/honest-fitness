import { useEffect, useRef, useState } from 'react'
import styles from './ExerciseCard.module.css'

export default function ExerciseCard({
  exercise,
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
  stacked,
  stackGroup,
  stackMembers,
  stackIndex,
  existingStacks = [],
  onToggleStack,
  onAddToStack,
  onRemoveFromStack,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragEnd,
  onDrop,
  draggable = true,
  showDragHandle = true,
  containerClassName = ''
}) {
  const [activeSet, setActiveSet] = useState(0)

  // Cardio timer (per exercise card; applied to the active set row)
  const cardioTimerIntervalRef = useRef(null)
  const cardioTimerStartMsRef = useRef(null)
  const cardioTimerBaseSecondsRef = useRef(0)
  const cardioTimerSetIdxRef = useRef(null)
  const [cardioTimerSeconds, setCardioTimerSeconds] = useState(0)

  useEffect(() => {
    return () => {
      if (cardioTimerIntervalRef.current) {
        clearInterval(cardioTimerIntervalRef.current)
        cardioTimerIntervalRef.current = null
      }
    }
  }, [])

  function parseCardioSeconds(raw) {
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
    // - <= 60: treat as MINUTES (what users usually mean when typing "20" for cardio)
    // - > 60: treat as SECONDS (what the system stores)
    const n = Number(s)
    if (!Number.isFinite(n)) return 0
    if (n <= 60) return Math.max(0, Math.floor(n * 60))
    return Math.max(0, Math.floor(n))
  }

  function secondsToMMSS(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return { mins, secs }
  }

  function startCardioTimer(setIdx, existingSeconds) {
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

  const handleNextSet = () => {
    if (activeSet < exercise.sets.length - 1) {
      setActiveSet(activeSet + 1)
      onStartRest()
    } else {
      // Last set - complete exercise and move to next
      onComplete()
      onStartRest()
    }
  }

  return (
    <div 
      className={`${styles.card} ${exercise.expanded ? styles.expanded : ''} ${exercise.completed ? styles.completed : ''} ${isDragging ? styles.dragging : ''} ${stacked ? styles.stacked : ''} ${containerClassName || ''}`}
      draggable={Boolean(draggable)}
      onDragStart={(e) => {
        if (onDragStart) {
          onDragStart(e, exercise.id)
        }
      }}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragEnd={(e) => {
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
        <span className={styles.name}>{exercise.name}</span>
        <span className={styles.summary}>
          {exercise.expanded ? '−' : `${exercise.sets.length} sets`}
        </span>
      </button>

      {exercise.expanded && (
        <div className={styles.content}>
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
                  
                  {/* Show existing stacks to join */}
                  {!stacked && existingStacks.length > 0 && (
                    <div className={styles.joinStackSection}>
                      <div className={styles.joinStackLabel}>Or join existing:</div>
                      <div className={styles.joinStackButtons}>
                        {existingStacks.map((stack) => (
                          <button
                            key={stack.group}
                            className={styles.joinStackBtn}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (onAddToStack) {
                                onAddToStack(stack.group)
                              }
                            }}
                            title={`Join ${stack.members.length === 1 ? 'this exercise' : stack.members.length === 2 ? 'superset' : 'circuit'}: ${stack.names.join(', ')}`}
                          >
                            {stack.members.length === 2 ? 'Superset' : 'Circuit'} ({stack.members.length})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {stacked && stackMembers && stackMembers.length > 1 && (
                <div className={styles.stackInfo}>
                  <div className={styles.stackInfoLabel}>
                    {stackMembers.length === 2 ? 'Superset' : 'Circuit'} ({stackIndex + 1}/{stackMembers.length}):
                  </div>
                  <div className={styles.stackMembers}>
                    {stackMembers.map((member, idx) => (
                      <span 
                        key={member.id} 
                        className={`${styles.stackMember} ${idx === stackIndex ? styles.activeStackMember : ''}`}
                        title={member.name}
                      >
                        {member.name.length > 15 ? member.name.substring(0, 15) + '...' : member.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.moveControls}>
              <button onClick={() => onMove('up')} disabled={index === 0}>↑</button>
              <button onClick={() => onMove('down')} disabled={index === total - 1}>↓</button>
              <button className={styles.removeBtn} onClick={onRemove}>✕</button>
            </div>
          </div>

          <div className={styles.sets}>
            {exercise.sets.map((set, idx) => (
              <div 
                key={idx} 
                className={`${styles.setRow} ${idx === activeSet ? styles.activeSet : ''} ${idx < activeSet ? styles.completedSet : ''}`}
              >
                <span className={styles.setNumber}>{idx + 1}</span>
                
                {exercise.category === 'Cardio' ? (
                  <>
                    {(() => {
                      const isTimerRunning = cardioTimerIntervalRef.current && cardioTimerSetIdxRef.current === idx
                      const storedSeconds = parseCardioSeconds(set.time)
                      const displaySeconds = isTimerRunning ? cardioTimerSeconds : storedSeconds
                      const { mins, secs } = secondsToMMSS(displaySeconds)

                      return (
                        <div className={styles.cardioTimeGroup}>
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
                                onUpdateSet(idx, 'time', String(total))
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
                                onUpdateSet(idx, 'time', String(total))
                              }}
                              className={`${styles.input} ${styles.cardioSecInput}`}
                            />
                          </div>

                          {idx === activeSet && (
                            <button
                              type="button"
                              className={styles.cardioTimerBtn}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()

                                if (isTimerRunning) {
                                  // Commit current timer value to this set and stop.
                                  onUpdateSet(idx, 'time', String(cardioTimerSeconds))
                                  stopCardioTimer()
                                } else {
                                  startCardioTimer(idx, storedSeconds)
                                }
                              }}
                              title={isTimerRunning ? 'Stop cardio timer (save time)' : 'Start cardio timer'}
                            >
                              {isTimerRunning ? 'Stop' : 'Start'}
                            </button>
                          )}
                        </div>
                      )
                    })()}
                    <div className={styles.inputGroup}>
                      <input
                        type="number"
                        placeholder="speed"
                        value={set.speed || ''}
                        onChange={(e) => onUpdateSet(idx, 'speed', e.target.value)}
                        className={styles.input}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <input
                        type="number"
                        placeholder="incline"
                        value={set.incline || ''}
                        onChange={(e) => onUpdateSet(idx, 'incline', e.target.value)}
                        className={styles.input}
                      />
                    </div>
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
                ) : (
                  <>
                    <div className={styles.inputGroup}>
                      <input
                        type="number"
                        placeholder="lbs"
                        value={set.weight}
                        onChange={(e) => onUpdateSet(idx, 'weight', e.target.value)}
                        className={styles.input}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <input
                        type="number"
                        placeholder="reps"
                        value={set.reps}
                        onChange={(e) => onUpdateSet(idx, 'reps', e.target.value)}
                        className={styles.input}
                      />
                    </div>
                  </>
                )}

                {idx === activeSet && (
                  <button className={styles.nextBtn} onClick={handleNextSet}>
                    {idx === exercise.sets.length - 1 ? 'Complete' : 'Next'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

