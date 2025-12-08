import { useState } from 'react'
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
  onToggleStack,
  onAddToStack,
  onRemoveFromStack,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragEnd,
  onDrop
}) {
  const [activeSet, setActiveSet] = useState(0)

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
      className={`${styles.card} ${exercise.expanded ? styles.expanded : ''} ${exercise.completed ? styles.completed : ''} ${isDragging ? styles.dragging : ''} ${stacked ? styles.stacked : ''}`}
      draggable
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
                    <div className={styles.inputGroup}>
                      <input
                        type="text"
                        placeholder="time"
                        value={set.time || ''}
                        onChange={(e) => onUpdateSet(idx, 'time', e.target.value)}
                        className={styles.input}
                      />
                    </div>
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

