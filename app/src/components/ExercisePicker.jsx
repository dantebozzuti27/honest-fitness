import { useState, useMemo, useEffect, useRef } from 'react'
import { debounce } from '../utils/debounce'
import styles from './ExercisePicker.module.css'

export default function ExercisePicker({ exercises = [], onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debouncedSetSearch = useRef(debounce((value) => setDebouncedSearch(value), 300)).current

  useEffect(() => {
    debouncedSetSearch(search)
  }, [search, debouncedSetSearch])
  const [bodyPartFilter, setBodyPartFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [equipmentFilter, setEquipmentFilter] = useState('all')
  const [showCustom, setShowCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('Strength')

  const bodyParts = useMemo(() => {
    if (!exercises || !Array.isArray(exercises)) return []
    const parts = [...new Set(exercises.map(e => e.bodyPart).filter(Boolean))]
    return parts.sort()
  }, [exercises])

  const categories = useMemo(() => {
    if (!exercises || !Array.isArray(exercises)) return []
    const cats = [...new Set(exercises.map(e => e.category).filter(Boolean))]
    return cats.sort()
  }, [exercises])

  const equipments = useMemo(() => {
    if (!exercises || !Array.isArray(exercises)) return []
    const equips = [...new Set(exercises.map(e => e.equipment).filter(Boolean))]
    return equips.sort()
  }, [exercises])

  const filtered = useMemo(() => {
    if (!exercises || !Array.isArray(exercises)) return []
    return exercises.filter(ex => {
      if (!ex || !ex.name) return false
      const matchesSearch = ex.name.toLowerCase().includes(debouncedSearch.toLowerCase())
      const matchesBodyPart = bodyPartFilter === 'all' || ex.bodyPart === bodyPartFilter
      const matchesCategory = categoryFilter === 'all' || ex.category === categoryFilter
      const matchesEquipment = equipmentFilter === 'all' || ex.equipment === equipmentFilter
      return matchesSearch && matchesBodyPart && matchesCategory && matchesEquipment
    })
  }, [exercises, debouncedSearch, bodyPartFilter, categoryFilter, equipmentFilter])

  const grouped = useMemo(() => {
    const groups = {}
    filtered.forEach(ex => {
      const key = ex.bodyPart || 'Other'
      if (!groups[key]) groups[key] = []
      groups[key].push(ex)
    })
    return groups
  }, [filtered])

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Add Exercise</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.search}>
          <input
            type="text"
            placeholder="Search exercises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Body Part</label>
          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${bodyPartFilter === 'all' ? styles.active : ''}`}
              onClick={() => setBodyPartFilter('all')}
            >
              All
            </button>
            {bodyParts.map(part => (
              <button
                key={part}
                className={`${styles.filterBtn} ${bodyPartFilter === part ? styles.active : ''}`}
                onClick={() => setBodyPartFilter(part)}
              >
                {part}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Category</label>
          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${categoryFilter === 'all' ? styles.active : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`${styles.filterBtn} ${categoryFilter === cat ? styles.active : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Equipment</label>
          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${equipmentFilter === 'all' ? styles.active : ''}`}
              onClick={() => setEquipmentFilter('all')}
            >
              All
            </button>
            {equipments.map(equip => (
              <button
                key={equip}
                className={`${styles.filterBtn} ${equipmentFilter === equip ? styles.active : ''}`}
                onClick={() => setEquipmentFilter(equip)}
              >
                {equip}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.list}>
          {!showCustom ? (
            <>
              <button className={styles.customBtn} onClick={() => setShowCustom(true)}>
                + Add Custom Exercise
              </button>
              {Object.entries(grouped).map(([group, exs]) => (
                <div key={group} className={styles.group}>
                  <h3 className={styles.groupTitle}>{group}</h3>
                  {exs.map(ex => (
                    <button
                      key={ex.id}
                      className={styles.exerciseBtn}
                      onClick={() => onSelect(ex)}
                    >
                      <span className={styles.exerciseName}>{ex.name}</span>
                      <span className={styles.exerciseEquip}>{ex.equipment}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <div className={styles.customForm}>
              <h3 className={styles.groupTitle}>Custom Exercise</h3>
              <input
                type="text"
                placeholder="Exercise name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className={styles.customInput}
                autoFocus
              />
              <div className={styles.customCategoryRow}>
                <label>Category:</label>
                <select 
                  value={customCategory} 
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className={styles.customSelect}
                >
                  <option value="Strength">Strength</option>
                  <option value="Cardio">Cardio</option>
                  <option value="Recovery">Recovery</option>
                </select>
              </div>
              <div className={styles.customActions}>
                <button className={styles.customCancel} onClick={() => {
                  setShowCustom(false)
                  setCustomName('')
                }}>
                  Cancel
                </button>
                <button 
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
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

