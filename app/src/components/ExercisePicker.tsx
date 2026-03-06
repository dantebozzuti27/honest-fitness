import { useState, useMemo, useEffect, useRef } from 'react'
import { debounce } from '../utils/debounce'
import Button from './Button'
import InputField from './InputField'
import SearchField from './SearchField'
import SelectField from './SelectField'
import Modal from './Modal'
import styles from './ExercisePicker.module.css'

type ExercisePickerProps = {
  exercises?: any[]
  onSelect: (exercise: any) => void
  onClose: () => void
}

export default function ExercisePicker({ exercises = [], onSelect, onClose }: ExercisePickerProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debouncedSetSearch = useRef(debounce((value: any) => setDebouncedSearch(value), 300)).current

  useEffect(() => {
    debouncedSetSearch(search)
  }, [search, debouncedSetSearch])
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('Strength')

  const modalRef = useRef(null)
  const closeBtnRef = useRef(null)

  const normalize = (v: any) => (v || '').toString().toLowerCase()

  const dedupedExercises = useMemo(() => {
    const list = Array.isArray(exercises) ? exercises : []
    const byName = new Map()

    const score = (ex: any) => {
      // Prefer entries with more/better metadata.
      const bp = (ex?.bodyPart || '').toString()
      const cat = (ex?.category || '').toString()
      const eq = (ex?.equipment || '').toString()
      let s = 0
      if (bp && bp !== 'Other') s += 2
      if (cat) s += 1
      if (eq && eq !== 'Other') s += 1
      return s
    }

    for (const ex of list) {
      if (!ex || !ex.name) continue
      const key = normalize(ex.name).trim()
      if (!key) continue
      const prev = byName.get(key)
      if (!prev) {
        byName.set(key, ex)
      } else {
        if (score(ex) > score(prev)) byName.set(key, ex)
      }
    }

    return Array.from(byName.values())
  }, [exercises])

  const expandQueryAliases = (q: string) => {
    // Light aliases for common shorthand
    // Keep this small and predictable; we can expand later.
    return q
      .replace(/\bdb\b/g, 'dumbbell')
      .replace(/\bkbs?\b/g, 'kettlebell')
      .replace(/\bbb\b/g, 'barbell')
      .replace(/\bsmith\b/g, 'smith machine')
  }

  const tokenize = (q: string) => {
    const cleaned = expandQueryAliases(normalize(q))
      .replace(/[_/.,()-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return []
    return cleaned.split(' ').filter(Boolean)
  }

  const filtered = useMemo(() => {
    if (!dedupedExercises || !Array.isArray(dedupedExercises)) return []

    const tokens = tokenize(debouncedSearch)
    const matchesQuery = (ex: any) => {
      if (tokens.length === 0) return true
      const haystack = [
        ex.name,
        ex.bodyPart,
        ex.category,
        ex.equipment,
        ex.movement_pattern,
        ex.ml_exercise_type,
        ...(Array.isArray(ex.primary_muscles) ? ex.primary_muscles : []),
        ...(Array.isArray(ex.secondary_muscles) ? ex.secondary_muscles : []),
      ].map(normalize).join(' ')
      return tokens.every((t: string) => haystack.includes(t))
    }

    return dedupedExercises
      .filter(ex => ex && ex.name && matchesQuery(ex))
      .slice()
      .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)))
  }, [dedupedExercises, debouncedSearch])

  return (
    <Modal
      isOpen
      onClose={onClose}
      containerRef={modalRef}
      initialFocusRef={closeBtnRef}
      overlayClassName={styles.overlay}
      modalClassName={styles.modal}
      ariaLabel="Add exercise"
    >
        <div className={styles.header}>
          <h2>Add Exercise</h2>
          <Button ref={closeBtnRef} unstyled className={styles.closeBtn} onClick={onClose}>✕</Button>
        </div>

        <div className={styles.search}>
          <SearchField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises…"
            autoFocus
            onClear={() => setSearch('')}
          />
        </div>

        <div className={styles.list}>
          {!showCustom ? (
            <>
              <Button unstyled className={styles.customBtn} onClick={() => setShowCustom(true)}>
                + Add Custom Exercise
              </Button>

              {filtered.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>No matches</div>
                  <div className={styles.emptySubtitle}>Try a different search term.</div>
                </div>
              ) : (
                filtered.map(ex => {
                  const metaParts = [ex.bodyPart, ex.category, ex.equipment].filter(Boolean)
                  const muscles = Array.isArray(ex.primary_muscles) ? ex.primary_muscles : []
                  const hasMuscleData = muscles.length > 0
                  const muscleLabel = hasMuscleData
                    ? muscles.slice(0, 3).map((m: string) => m.replace(/_/g, ' ')).join(', ')
                    : null
                  const badges = [
                    ex.ml_exercise_type && ex.ml_exercise_type !== 'compound' ? ex.ml_exercise_type : null,
                    ex.movement_pattern ? ex.movement_pattern.replace(/_/g, ' ') : null,
                    ex.difficulty,
                  ].filter(Boolean)

                  return (
                    <Button
                      unstyled
                      key={ex.id || ex.name}
                      className={styles.exerciseBtn}
                      onClick={() => onSelect(ex)}
                    >
                      <span className={styles.exerciseName}>{ex.name}</span>
                      <span className={styles.exerciseMeta}>{metaParts.join(' • ')}</span>
                      {muscleLabel && (
                        <span className={styles.exerciseMeta} style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                          {muscleLabel}
                        </span>
                      )}
                      {badges.length > 0 && (
                        <span className={styles.exerciseMeta} style={{ fontSize: 10, marginTop: 2 }}>
                          {badges.join(' · ')}
                        </span>
                      )}
                    </Button>
                  )
                })
              )}
            </>
          ) : (
            <div className={styles.customForm}>
              <h3 className={styles.groupTitle}>Custom Exercise</h3>
              <InputField
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Exercise name"
                className={styles.customInput}
                autoFocus
              />
              <div className={styles.customCategoryRow}>
                <label>Category:</label>
                <SelectField
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  options={[
                    { value: 'Strength', label: 'Strength' },
                    { value: 'Cardio', label: 'Cardio' },
                    { value: 'Recovery', label: 'Recovery' }
                  ]}
                  className={styles.customSelect}
                />
              </div>
              <div className={styles.customActions}>
                <Button unstyled className={styles.customCancel} onClick={() => {
                  setShowCustom(false)
                  setCustomName('')
                }}>
                  Cancel
                </Button>
                <Button
                  unstyled
                  className={styles.customAdd}
                  disabled={!customName.trim()}
                  onClick={() => {
                    onSelect({
                      id: `custom-${Date.now()}`,
                      name: customName.trim(),
                      category: customCategory,
                      bodyPart: customCategory === 'Recovery' ? 'Recovery' : customCategory === 'Cardio' ? 'Cardio' : 'Other',
                      equipment: 'Other'
                    })
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
    </Modal>
  )
}

