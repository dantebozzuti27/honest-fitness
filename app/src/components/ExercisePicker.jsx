import { useState, useMemo, useEffect, useRef } from 'react'
import { debounce } from '../utils/debounce'
import Button from './Button'
import InputField from './InputField'
import SelectField from './SelectField'
import styles from './ExercisePicker.module.css'

export default function ExercisePicker({ exercises = [], onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debouncedSetSearch = useRef(debounce((value) => setDebouncedSearch(value), 300)).current

  useEffect(() => {
    debouncedSetSearch(search)
  }, [search, debouncedSetSearch])
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('Strength')

  const normalize = (v) => (v || '').toString().toLowerCase()

  const expandQueryAliases = (q) => {
    // Light aliases for common shorthand
    // Keep this small and predictable; we can expand later.
    return q
      .replace(/\bdb\b/g, 'dumbbell')
      .replace(/\bkbs?\b/g, 'kettlebell')
      .replace(/\bbb\b/g, 'barbell')
      .replace(/\bsmith\b/g, 'smith machine')
  }

  const tokenize = (q) => {
    const cleaned = expandQueryAliases(normalize(q))
      .replace(/[_/.,()-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return []
    return cleaned.split(' ').filter(Boolean)
  }

  const filtered = useMemo(() => {
    if (!exercises || !Array.isArray(exercises)) return []

    const tokens = tokenize(debouncedSearch)
    const matchesQuery = (ex) => {
      if (tokens.length === 0) return true
      const haystack = [
        ex.name,
        ex.bodyPart,
        ex.category,
        ex.equipment
      ].map(normalize).join(' ')
      // Token-based search: user can type "lat cable machine" and it matches regardless of word order/spacing.
      return tokens.every(t => haystack.includes(t))
    }

    return exercises
      .filter(ex => ex && ex.name && matchesQuery(ex))
      .slice()
      .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)))
  }, [exercises, debouncedSearch])

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Add Exercise</h2>
          <Button unstyled className={styles.closeBtn} onClick={onClose}>✕</Button>
        </div>

        <div className={styles.search}>
          <InputField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises..."
            autoFocus
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
                  return (
                    <Button
                      unstyled
                      key={ex.id || ex.name}
                      className={styles.exerciseBtn}
                      onClick={() => onSelect(ex)}
                    >
                      <span className={styles.exerciseName}>{ex.name}</span>
                      <span className={styles.exerciseMeta}>{metaParts.join(' • ')}</span>
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
      </div>
    </div>
  )
}

