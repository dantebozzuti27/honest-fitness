import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import styles from './CommandPalette.module.css'

export default function CommandPalette({ isOpen, onClose }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [exerciseIndex, setExerciseIndex] = useState([]) // local IndexedDB exercises
  const [templateIndex, setTemplateIndex] = useState([]) // local IndexedDB templates

  const actions = useMemo(() => ([
    { id: 'today', label: 'Go to Today', hint: '/', run: () => navigate('/') },
    { id: 'log', label: 'Go to Log', hint: '/log', run: () => navigate('/log') },
    { id: 'train', label: 'Start Workout', hint: '/workout/active', run: () => navigate('/workout/active', { state: { sessionType: 'workout' } }) },
    { id: 'recover', label: 'Start Recovery', hint: '/workout/active', run: () => navigate('/workout/active', { state: { sessionType: 'recovery' } }) },
    { id: 'search_exercises', label: 'Search Exercises', hint: 'opens picker', run: () => navigate('/workout/active', { state: { openPicker: true } }) },
    { id: 'search_recovery', label: 'Search Recovery', hint: 'opens picker', run: () => navigate('/workout/active', { state: { sessionType: 'recovery', openPicker: true } }) },
    { id: 'progress', label: 'Go to Progress', hint: '/progress', run: () => navigate('/progress') },
    { id: 'plan', label: 'Open Plan', hint: '/planner', run: () => navigate('/planner') },
    { id: 'fitness', label: 'Go to Train', hint: '/fitness', run: () => navigate('/fitness') },
    { id: 'recovery', label: 'Go to Recovery', hint: '/health', run: () => navigate('/health') },
    { id: 'nutrition', label: 'Go to Nutrition', hint: '/nutrition', run: () => navigate('/nutrition') },
    { id: 'calendar', label: 'Open Calendar', hint: '/calendar', run: () => navigate('/calendar') },
    { id: 'people', label: 'Find People', hint: 'search users', run: () => navigate('/', { state: { openAddFriend: true, addFriendQuery: query } }) },
    { id: 'profile', label: 'Open Profile', hint: '/profile', run: () => navigate('/profile') }
  ]), [navigate, query])

  const tokenize = (q) => q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    const tokens = q.split(/\s+/).filter(Boolean)
    return actions.filter(a => {
      const hay = `${a.label} ${a.hint}`.toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [actions, query])

  const exerciseResults = useMemo(() => {
    const tokens = tokenize(query)
    if (tokens.length === 0) return []
    const scored = (exerciseIndex || [])
      .filter(ex => ex?.name)
      .map(ex => {
        const hay = `${ex.name} ${ex.category || ''} ${ex.bodyPart || ''} ${(ex.equipment || '')}`.toLowerCase()
        const ok = tokens.every(t => hay.includes(t))
        if (!ok) return null
        // simple score: shorter names + more token hits earlier
        const score = (ex.name.length) + (ex.category ? 2 : 0)
        return { ex, score }
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map(({ ex }) => ({
        id: `ex_${ex.name}`,
        kind: 'exercise',
        label: ex.name,
        hint: `${ex.category || 'Strength'} · ${ex.bodyPart || 'Other'}${ex.equipment ? ` · ${ex.equipment}` : ''}`,
        run: () => navigate('/workout/active', { state: { quickAddExerciseName: ex.name } })
      }))
    return scored
  }, [exerciseIndex, query, navigate])

  const templateResults = useMemo(() => {
    const tokens = tokenize(query)
    if (tokens.length === 0) return []
    const scored = (templateIndex || [])
      .filter(t => t?.name)
      .map(t => {
        const hay = `${t.name}`.toLowerCase()
        const ok = tokens.every(tok => hay.includes(tok))
        if (!ok) return null
        return t
      })
      .filter(Boolean)
      .slice(0, 6)
      .map(t => ({
        id: `tpl_${t.id}`,
        kind: 'template',
        label: t.name,
        hint: `${(t.exercises?.length || 0)} exercises`,
        run: () => navigate('/workout/active', { state: { templateId: t.id } })
      }))
    return scored
  }, [templateIndex, query, navigate])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      return actions.map(a => ({ ...a, kind: 'action' }))
    }
    return [
      ...filteredActions.map(a => ({ ...a, kind: 'action' })),
      ...exerciseResults,
      ...templateResults
    ]
  }, [actions, filteredActions, exerciseResults, templateResults, query])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setActiveIndex(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [isOpen])

  // Load searchable indexes when opened (fast + local)
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    ;(async () => {
      try {
        const db = await import('../db')
        const [exs, tpls] = await Promise.all([
          db.getAllExercises?.() || [],
          db.getAllTemplates?.() || []
        ])
        if (!mounted) return
        setExerciseIndex(Array.isArray(exs) ? exs : [])
        setTemplateIndex(Array.isArray(tpls) ? tpls : [])
      } catch {
        // Silent fail: palette still useful for nav actions.
      }
    })()
    return () => {
      mounted = false
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => Math.min(results.length - 1, i + 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => Math.max(0, i - 1))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = results[activeIndex]
        if (item) {
          onClose()
          item.run()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, results, activeIndex, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.palette} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… (Try “recovery”, “calendar”, “profile”)"
            aria-label="Command palette"
          />
          <div className={styles.kbd}>Esc</div>
        </div>

        <div className={styles.results} role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <div className={styles.empty}>No results</div>
          ) : (
            results.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.result} ${idx === activeIndex ? styles.active : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onClose()
                  item.run()
                }}
              >
                <div className={styles.resultLeft}>
                  <div className={styles.resultLabel}>{item.label}</div>
                  <div className={styles.resultHint}>{item.hint}</div>
                </div>
                <div className={styles.resultKind}>{item.kind === 'exercise' ? 'Exercise' : item.kind === 'template' ? 'Template' : 'Action'}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}


