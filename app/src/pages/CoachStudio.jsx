import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import InputField from '../components/InputField'
import SelectField from '../components/SelectField'
import TextAreaField from '../components/TextAreaField'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import Skeleton from '../components/Skeleton'
import TemplateEditor from '../components/TemplateEditor'
import { logError } from '../utils/logger'
import {
  archiveProgram,
  createProgram,
  getCoachProfile,
  listMyPrograms,
  publishProgram,
  updateProgram,
  upsertCoachProfile
} from '../lib/db/marketplaceDb'
import styles from './CoachStudio.module.css'

function dollarsToCents(dollars) {
  const n = Number(dollars || 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function centsToDollars(cents) {
  const n = Number(cents || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  return String((n / 100).toFixed(2))
}

function emptyDraft() {
  return {
    id: null,
    title: '',
    description: '',
    priceCents: 0,
    currency: 'usd',
    tags: [],
    content: {
      workoutTemplates: [],
      nutrition: { caloriesTarget: '', proteinG: '', carbsG: '', fatG: '', notes: '' },
      health: { sleepHoursTarget: '', stepsTarget: '', habits: '' },
      notes: '',
      dayPlans: []
    }
  }
}

function normalizeContent(raw) {
  const base = emptyDraft().content
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    ...base,
    ...c,
    nutrition: { ...base.nutrition, ...(c.nutrition || {}) },
    health: { ...base.health, ...(c.health || {}) },
    dayPlans: Array.isArray(c.dayPlans) ? c.dayPlans : []
  }
}

function newDayPlan(nextDayNumber = 1) {
  return {
    id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    dayNumber: nextDayNumber,
    title: `Day ${nextDayNumber}`,
    notes: '',
    workout: {
      templateId: '',
      title: '',
      notes: '',
      steps: [] // [{ title, notes }]
    },
    meals: [], // [{ name, time, notes, items: [{ food, grams, notes }] }]
    healthMetrics: [], // [{ name, target, unit, notes }]
    healthNotes: ''
  }
}

export default function CoachStudio() {
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const editorRef = useRef(null)
  const titleInputId = 'coach-program-title'
  const createTitleInputId = 'create-program-title'

  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingProgram, setSavingProgram] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [programs, setPrograms] = useState([])

  const [coachDisplayName, setCoachDisplayName] = useState('')
  const [coachBio, setCoachBio] = useState('')

  const [draft, setDraft] = useState(emptyDraft())
  const [showTemplatesEditor, setShowTemplatesEditor] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState(emptyDraft())

  const selectedProgram = useMemo(() => {
    if (!draft?.id) return null
    return (programs || []).find(p => p.id === draft.id) || null
  }, [draft?.id, programs])

  const loadAll = async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const [profile, myPrograms] = await Promise.all([
        getCoachProfile(user.id).catch(() => null),
        listMyPrograms(user.id).catch(() => [])
      ])
      setPrograms(Array.isArray(myPrograms) ? myPrograms : [])
      setCoachDisplayName(profile?.displayName || '')
      setCoachBio(profile?.bio || '')
    } catch (e) {
      logError('Coach studio load failed', e)
      showToast('Failed to load Coach Studio.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const onSaveProfile = async () => {
    if (!user?.id) return
    setSavingProfile(true)
    try {
      await upsertCoachProfile(user.id, { displayName: coachDisplayName, bio: coachBio })
      showToast('Coach profile saved.', 'success')
    } catch (e) {
      logError('Coach profile save failed', e)
      showToast('Failed to save coach profile.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  const onNewProgram = () => {
    setShowTemplatesEditor(false)
    setCreateDraft(emptyDraft())
    setCreateModalOpen(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(createTitleInputId)
        el?.focus?.()
      })
    })
  }

  useEffect(() => {
    if (!createModalOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setCreateModalOpen(false)
        return
      }
      if (e.key === 'Enter') {
        const tag = String(document?.activeElement?.tagName || '').toLowerCase()
        // Allow line breaks in multi-line fields.
        if (tag === 'textarea') return
        // Ignore IME composition Enter.
        if (e.isComposing) return
        e.preventDefault()
        onCreateFromModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createModalOpen, createDraft?.title])

  const onEditProgram = (p) => {
    setDraft({
      id: p.id,
      title: p.title || '',
      description: p.description || '',
      priceCents: Number(p.priceCents || 0),
      currency: p.currency || 'usd',
      tags: Array.isArray(p.tags) ? p.tags : [],
      content: normalizeContent(p.content)
    })
  }

  const onSaveProgram = async () => {
    if (!user?.id) return
    if (!String(draft?.title || '').trim()) {
      showToast('Title is required.', 'error')
      return
    }
    setSavingProgram(true)
    try {
      let saved
      if (!draft?.id) {
        saved = await createProgram(user.id, {
          title: draft.title,
          description: draft.description,
          priceCents: Number(draft.priceCents || 0),
          currency: draft.currency,
          tags: draft.tags,
          content: draft.content,
          preview: { workoutTemplateCount: Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0 }
        })
      } else {
        saved = await updateProgram(user.id, draft.id, {
          title: draft.title,
          description: draft.description,
          priceCents: Number(draft.priceCents || 0),
          currency: draft.currency,
          tags: draft.tags,
          content: draft.content,
          preview: { workoutTemplateCount: Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0 }
        })
      }
      showToast('Program saved.', 'success')
      await loadAll()
      if (saved?.id) onEditProgram(saved)
    } catch (e) {
      logError('Program save failed', e)
      showToast('Failed to save program.', 'error')
    } finally {
      setSavingProgram(false)
    }
  }

  const onPublish = async () => {
    if (!user?.id || !draft?.id) return
    setPublishing(true)
    try {
      if (Number(draft.priceCents || 0) > 0) {
        showToast('Paid checkout is not wired yet. Set price to $0 for now to test.', 'error', 6500)
        return
      }
      await publishProgram(user.id, draft.id)
      showToast('Program published.', 'success')
      await loadAll()
    } catch (e) {
      logError('Publish failed', e)
      showToast('Failed to publish program.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const publishFromList = async (p) => {
    if (!user?.id || !p?.id) return
    setPublishing(true)
    try {
      if (Number(p.priceCents || 0) > 0) {
        showToast('Paid checkout is not wired yet. Set price to $0 for now to test.', 'error', 6500)
        return
      }
      await publishProgram(user.id, p.id)
      showToast('Program published.', 'success')
      await loadAll()
      // Keep editor in sync with the published program
      const updated = await listMyPrograms(user.id).then(list => (list || []).find(x => x.id === p.id) || null).catch(() => null)
      if (updated) onEditProgram(updated)
    } catch (e) {
      logError('Publish from list failed', e)
      showToast('Failed to publish program.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const onArchive = async () => {
    if (!user?.id || !draft?.id) return
    try {
      await archiveProgram(user.id, draft.id)
      showToast('Program archived.', 'success')
      await loadAll()
    } catch (e) {
      logError('Archive failed', e)
      showToast('Failed to archive program.', 'error')
    }
  }

  const templateOnSave = (tpl) => {
    setDraft(prev => {
      const current = Array.isArray(prev?.content?.workoutTemplates) ? prev.content.workoutTemplates : []
      const idx = current.findIndex(t => t.id === tpl.id)
      const next = idx >= 0
        ? current.map(t => (t.id === tpl.id ? tpl : t))
        : [...current, tpl]
      return { ...prev, content: { ...(prev.content || {}), workoutTemplates: next } }
    })
  }

  const templateOnDelete = (templateId) => {
    setDraft(prev => {
      const current = Array.isArray(prev?.content?.workoutTemplates) ? prev.content.workoutTemplates : []
      const next = current.filter(t => t.id !== templateId)
      return { ...prev, content: { ...(prev.content || {}), workoutTemplates: next } }
    })
  }

  const onCreateFromModal = () => {
    if (!String(createDraft?.title || '').trim()) {
      showToast('Title is required.', 'error')
      return
    }
    setDraft({
      ...createDraft,
      title: String(createDraft.title || '').trim()
    })
    setCreateModalOpen(false)
    showToast('New program started', 'success', 1800)
    requestAnimationFrame(() => {
      try {
        editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      } catch {
        // ignore
      }
      requestAnimationFrame(() => {
        const el = document.getElementById(titleInputId)
        el?.focus?.()
      })
    })
  }

  const [expandedDayId, setExpandedDayId] = useState(null)

  const dayPlans = Array.isArray(draft.content?.dayPlans) ? draft.content.dayPlans : []

  const updateDayPlans = (updater) => {
    setDraft(prev => {
      const current = Array.isArray(prev?.content?.dayPlans) ? prev.content.dayPlans : []
      const next = typeof updater === 'function' ? updater(current) : current
      return { ...prev, content: { ...(prev.content || {}), dayPlans: next } }
    })
  }

  const addDay = () => {
    updateDayPlans((current) => {
      const nextDayNumber = (current?.length || 0) + 1
      const next = [...current, newDayPlan(nextDayNumber)]
      return next
    })
    requestAnimationFrame(() => {
      setExpandedDayId((prev) => prev) // no-op; keeps state stable
    })
  }

  const removeDay = (dayId) => {
    updateDayPlans((current) => {
      const filtered = current.filter(d => d.id !== dayId)
      // Renumber days so UI stays intuitive
      return filtered.map((d, idx) => ({ ...d, dayNumber: idx + 1, title: d.title || `Day ${idx + 1}` }))
    })
    if (expandedDayId === dayId) setExpandedDayId(null)
  }

  const moveDay = (dayId, direction) => {
    updateDayPlans((current) => {
      const idx = current.findIndex(d => d.id === dayId)
      if (idx < 0) return current
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next.map((d, i) => ({ ...d, dayNumber: i + 1 }))
    })
  }

  const patchDay = (dayId, patch) => {
    updateDayPlans((current) => current.map(d => (d.id === dayId ? { ...d, ...patch } : d)))
  }

  const patchDayWorkout = (dayId, patch) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      return { ...d, workout: { ...(d.workout || {}), ...patch } }
    }))
  }

  const addWorkoutStep = (dayId) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const steps = Array.isArray(d?.workout?.steps) ? d.workout.steps : []
      return { ...d, workout: { ...(d.workout || {}), steps: [...steps, { title: '', notes: '' }] } }
    }))
  }

  const patchWorkoutStep = (dayId, stepIndex, patch) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const steps = Array.isArray(d?.workout?.steps) ? d.workout.steps : []
      const next = steps.map((s, i) => (i === stepIndex ? { ...(s || {}), ...patch } : s))
      return { ...d, workout: { ...(d.workout || {}), steps: next } }
    }))
  }

  const removeWorkoutStep = (dayId, stepIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const steps = Array.isArray(d?.workout?.steps) ? d.workout.steps : []
      return { ...d, workout: { ...(d.workout || {}), steps: steps.filter((_, i) => i !== stepIndex) } }
    }))
  }

  const addMeal = (dayId) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      return { ...d, meals: [...meals, { name: '', time: '', notes: '', items: [] }] }
    }))
  }

  const patchMeal = (dayId, mealIndex, patch) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      return { ...d, meals: meals.map((m, i) => (i === mealIndex ? { ...(m || {}), ...patch } : m)) }
    }))
  }

  const removeMeal = (dayId, mealIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      return { ...d, meals: meals.filter((_, i) => i !== mealIndex) }
    }))
  }

  const addMealItem = (dayId, mealIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const nextMeals = meals.map((m, i) => {
        if (i !== mealIndex) return m
        const items = Array.isArray(m?.items) ? m.items : []
        return { ...(m || {}), items: [...items, { food: '', grams: '', notes: '' }] }
      })
      return { ...d, meals: nextMeals }
    }))
  }

  const patchMealItem = (dayId, mealIndex, itemIndex, patch) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const nextMeals = meals.map((m, i) => {
        if (i !== mealIndex) return m
        const items = Array.isArray(m?.items) ? m.items : []
        return { ...(m || {}), items: items.map((it, j) => (j === itemIndex ? { ...(it || {}), ...patch } : it)) }
      })
      return { ...d, meals: nextMeals }
    }))
  }

  const removeMealItem = (dayId, mealIndex, itemIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const nextMeals = meals.map((m, i) => {
        if (i !== mealIndex) return m
        const items = Array.isArray(m?.items) ? m.items : []
        return { ...(m || {}), items: items.filter((_, j) => j !== itemIndex) }
      })
      return { ...d, meals: nextMeals }
    }))
  }

  const addHealthMetric = (dayId) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const list = Array.isArray(d?.healthMetrics) ? d.healthMetrics : []
      return { ...d, healthMetrics: [...list, { name: '', target: '', unit: '', notes: '' }] }
    }))
  }

  const patchHealthMetric = (dayId, metricIndex, patch) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const list = Array.isArray(d?.healthMetrics) ? d.healthMetrics : []
      return { ...d, healthMetrics: list.map((m, i) => (i === metricIndex ? { ...(m || {}), ...patch } : m)) }
    }))
  }

  const removeHealthMetric = (dayId, metricIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const list = Array.isArray(d?.healthMetrics) ? d.healthMetrics : []
      return { ...d, healthMetrics: list.filter((_, i) => i !== metricIndex) }
    }))
  }

  return (
    <div className={styles.container}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}

      <div className={styles.headerRow}>
        <BackButton fallbackPath="/profile" />
        <h1 className={styles.title}>Coach Studio</h1>
        <div style={{ width: 32 }} />
      </div>

      {createModalOpen && (
        <div
          className={styles.modalOverlay}
          onMouseDown={() => setCreateModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Create program"
        >
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Create program</h2>
              <Button unstyled onClick={() => setCreateModalOpen(false)}>✕</Button>
            </div>

            <div className={styles.modalBody}>
              <InputField
                id={createTitleInputId}
                label="Title"
                value={createDraft.title}
                onChange={(e) => setCreateDraft(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., 8-Week Strength & Nutrition Reset"
              />

              <TextAreaField
                label="Description"
                value={createDraft.description}
                onChange={(e) => setCreateDraft(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Who is this for? What results should they expect?"
                rows={3}
              />

              <InputField
                label="Price (USD)"
                inputMode="decimal"
                value={centsToDollars(createDraft.priceCents)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '') {
                    setCreateDraft(prev => ({ ...prev, priceCents: 0 }))
                  } else {
                    setCreateDraft(prev => ({ ...prev, priceCents: dollarsToCents(v) }))
                  }
                }}
                placeholder="0.00"
              />

              <TextAreaField
                label="Coach notes (optional)"
                value={createDraft.content?.notes || ''}
                onChange={(e) => setCreateDraft(prev => ({ ...prev, content: { ...(prev.content || {}), notes: e.target.value } }))}
                placeholder="Coaching notes, expectations, schedule, etc."
                rows={3}
              />

              <div style={{ fontWeight: 800, marginTop: 2 }}>Nutrition</div>
              <div className={styles.twoCol}>
                <InputField
                  label="Calories"
                  inputMode="numeric"
                  value={createDraft.content?.nutrition?.caloriesTarget || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), caloriesTarget: e.target.value } }
                  }))}
                  placeholder="2200"
                />
                <InputField
                  label="Protein (g)"
                  inputMode="numeric"
                  value={createDraft.content?.nutrition?.proteinG || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), proteinG: e.target.value } }
                  }))}
                  placeholder="160"
                />
              </div>
              <div className={styles.twoCol}>
                <InputField
                  label="Carbs (g)"
                  inputMode="numeric"
                  value={createDraft.content?.nutrition?.carbsG || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), carbsG: e.target.value } }
                  }))}
                  placeholder="220"
                />
                <InputField
                  label="Fat (g)"
                  inputMode="numeric"
                  value={createDraft.content?.nutrition?.fatG || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), fatG: e.target.value } }
                  }))}
                  placeholder="70"
                />
              </div>
              <TextAreaField
                label="Nutrition notes"
                value={createDraft.content?.nutrition?.notes || ''}
                onChange={(e) => setCreateDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), notes: e.target.value } }
                }))}
                placeholder="Meal structure, micronutrient focus, food swaps, etc."
                rows={2}
              />

              <div style={{ fontWeight: 800, marginTop: 2 }}>Health</div>
              <div className={styles.twoCol}>
                <InputField
                  label="Sleep (hours)"
                  inputMode="decimal"
                  value={createDraft.content?.health?.sleepHoursTarget || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), sleepHoursTarget: e.target.value } }
                  }))}
                  placeholder="8"
                />
                <InputField
                  label="Steps"
                  inputMode="numeric"
                  value={createDraft.content?.health?.stepsTarget || ''}
                  onChange={(e) => setCreateDraft(prev => ({
                    ...prev,
                    content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), stepsTarget: e.target.value } }
                  }))}
                  placeholder="10000"
                />
              </div>
              <TextAreaField
                label="Habits"
                value={createDraft.content?.health?.habits || ''}
                onChange={(e) => setCreateDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), habits: e.target.value } }
                }))}
                placeholder={"e.g.\n- 10 min mobility\n- Walk after lunch"}
                rows={3}
              />
            </div>

            <div className={styles.modalFooter}>
              <Button className={styles.modalBtn} variant="secondary" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button className={styles.modalBtn} onClick={onCreateFromModal}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <>
          <Skeleton style={{ width: '100%', height: 120, marginBottom: 12 }} />
          <Skeleton style={{ width: '100%', height: 220, marginBottom: 12 }} />
          <Skeleton style={{ width: '100%', height: 160 }} />
        </>
      ) : (
        <>
          <div className={styles.sectionTitle}>Coach profile</div>
          <div className={styles.card}>
            <InputField
              label="Display name"
              value={coachDisplayName}
              onChange={(e) => setCoachDisplayName(e.target.value)}
              placeholder="e.g., Coach Dante"
            />
            <div style={{ height: 10 }} />
            <TextAreaField
              label="Bio"
              value={coachBio}
              onChange={(e) => setCoachBio(e.target.value)}
              placeholder="What do you specialize in?"
              rows={3}
            />
            <div style={{ height: 12 }} />
            <Button onClick={onSaveProfile} loading={savingProfile} disabled={!user?.id || savingProfile}>
              Save coach profile
            </Button>
            <div className={styles.muted} style={{ marginTop: 8 }}>
              Stripe payouts are not wired yet (MVP). We’ll add Stripe Connect next.
            </div>
          </div>

          <div className={styles.sectionTitle}>Your programs</div>
          <div className={styles.programList}>
            {(programs || []).length === 0 ? (
              <div className={styles.card}>
                <div className={styles.muted}>No programs yet. Create your first one.</div>
                <div style={{ height: 10 }} />
                <Button onClick={onNewProgram}>+ New program</Button>
              </div>
            ) : (
              <>
                <Button onClick={onNewProgram}>+ New program</Button>
                {programs.map((p) => (
                  <div key={p.id} className={styles.programCard}>
                    <div className={styles.programTitle}>{p.title}</div>
                    <div className={styles.programMeta}>
                      {p.status.toUpperCase()} · {p.priceCents > 0 ? `$${(p.priceCents / 100).toFixed(2)}` : 'Free'}
                    </div>
                    <div className={styles.btnRow}>
                      <Button className={styles.btn} variant="secondary" onClick={() => onEditProgram(p)}>
                        Edit
                      </Button>
                      {p.status !== 'published' ? (
                        <Button className={styles.btn} onClick={() => publishFromList(p)} loading={publishing} disabled={publishing}>
                          Publish
                        </Button>
                      ) : (
                        <Button className={styles.btn} variant="secondary" onClick={() => window.open(`/market/${p.id}`, '_blank')}>
                          View listing
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className={styles.sectionTitle}>Editor</div>
          <div ref={editorRef} className={styles.card}>
            <div className={styles.rowSpace}>
              <div>
                <div style={{ fontWeight: 700 }}>{draft?.id ? 'Edit program' : 'New program'}</div>
                <div className={styles.muted}>
                  {selectedProgram?.status ? `Status: ${selectedProgram.status}` : 'Draft'}
                </div>
              </div>
              <div className={styles.btnRow} style={{ width: 220 }}>
                <Button className={styles.btn} variant="secondary" onClick={() => setDraft(emptyDraft())}>
                  Clear
                </Button>
              </div>
            </div>

            <div className={styles.divider} />

            <InputField
              label="Title"
              id={titleInputId}
              value={draft.title}
              onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g., 8-Week Strength & Nutrition Reset"
            />
            <div style={{ height: 10 }} />
            <TextAreaField
              label="Description"
              value={draft.description}
              onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Who is this for? What results should they expect?"
              rows={3}
            />

            <div style={{ height: 10 }} />
            <InputField
              label="Price (USD)"
              inputMode="decimal"
              value={centsToDollars(draft.priceCents)}
              onChange={(e) => {
                const v = e.target.value
                // Allow clearing the input
                if (v === '') {
                  setDraft(prev => ({ ...prev, priceCents: 0 }))
                } else {
                  setDraft(prev => ({ ...prev, priceCents: dollarsToCents(v) }))
                }
              }}
              placeholder="0.00"
            />

            <div style={{ height: 10 }} />
            <TextAreaField
              label="Program notes (optional)"
              value={draft.content?.notes || ''}
              onChange={(e) => setDraft(prev => ({ ...prev, content: { ...(prev.content || {}), notes: e.target.value } }))}
              placeholder="Coaching notes, expectations, schedule, etc."
              rows={4}
            />

            <div style={{ height: 12 }} />
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Nutrition</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <InputField
                label="Calories target"
                inputMode="numeric"
                value={draft.content?.nutrition?.caloriesTarget || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), caloriesTarget: e.target.value } }
                }))}
                placeholder="e.g., 2200"
              />
              <InputField
                label="Protein (g)"
                inputMode="numeric"
                value={draft.content?.nutrition?.proteinG || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), proteinG: e.target.value } }
                }))}
                placeholder="e.g., 160"
              />
              <InputField
                label="Carbs (g)"
                inputMode="numeric"
                value={draft.content?.nutrition?.carbsG || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), carbsG: e.target.value } }
                }))}
                placeholder="e.g., 220"
              />
              <InputField
                label="Fat (g)"
                inputMode="numeric"
                value={draft.content?.nutrition?.fatG || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), fatG: e.target.value } }
                }))}
                placeholder="e.g., 70"
              />
            </div>
            <div style={{ height: 10 }} />
            <TextAreaField
              label="Nutrition notes"
              value={draft.content?.nutrition?.notes || ''}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                content: { ...(prev.content || {}), nutrition: { ...(prev.content?.nutrition || {}), notes: e.target.value } }
              }))}
              placeholder="Meal structure, micronutrient focus, food swaps, etc."
              rows={3}
            />

            <div style={{ height: 12 }} />
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Health</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <InputField
                label="Sleep target (hours)"
                inputMode="decimal"
                value={draft.content?.health?.sleepHoursTarget || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), sleepHoursTarget: e.target.value } }
                }))}
                placeholder="e.g., 8"
              />
              <InputField
                label="Steps target"
                inputMode="numeric"
                value={draft.content?.health?.stepsTarget || ''}
                onChange={(e) => setDraft(prev => ({
                  ...prev,
                  content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), stepsTarget: e.target.value } }
                }))}
                placeholder="e.g., 10000"
              />
            </div>
            <div style={{ height: 10 }} />
            <TextAreaField
              label="Habits / recovery checklist"
              value={draft.content?.health?.habits || ''}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                content: { ...(prev.content || {}), health: { ...(prev.content?.health || {}), habits: e.target.value } }
              }))}
              placeholder={"e.g.\n- Walk 20 min after lunch\n- 10 min mobility\n- Magnesium before bed"}
              rows={4}
            />

            <div style={{ height: 12 }} />
            <div className={styles.btnRow}>
              <Button
                className={styles.btn}
                variant="secondary"
                onClick={() => setShowTemplatesEditor(true)}
              >
                Edit workout templates ({Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0})
              </Button>
              <Button
                className={styles.btn}
                onClick={onSaveProgram}
                loading={savingProgram}
                disabled={!user?.id || savingProgram}
              >
                Save
              </Button>
            </div>

            <div className={styles.hr} />

            <div className={styles.dayPlansHeader}>
              <div style={{ fontWeight: 900 }}>Day-by-day plan</div>
              <Button variant="secondary" className={styles.miniBtn} onClick={addDay}>
                + Add day
              </Button>
            </div>
            <div className={styles.muted}>
              Coaches can be extremely specific here: workouts + meals + health metrics, with notes on every step.
            </div>

            {dayPlans.length === 0 ? (
              <div className={styles.muted} style={{ marginTop: 10 }}>
                No days yet. Add Day 1 to start building the schedule.
              </div>
            ) : (
              dayPlans.map((day, dayIdx) => {
                const isOpen = expandedDayId === day.id
                const workoutTemplates = Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []
                return (
                  <div key={day.id} className={styles.dayCard}>
                    <div className={styles.dayHeader}>
                      <div>
                        <div className={styles.dayTitle}>
                          Day {day.dayNumber}{day.title ? ` — ${day.title}` : ''}
                        </div>
                        {day.notes ? <div className={styles.muted}>{day.notes.slice(0, 120)}{day.notes.length > 120 ? '…' : ''}</div> : null}
                      </div>
                      <div className={styles.miniBtnRow}>
                        <Button
                          variant="secondary"
                          className={styles.miniBtn}
                          onClick={() => setExpandedDayId(isOpen ? null : day.id)}
                        >
                          {isOpen ? 'Collapse' : 'Edit'}
                        </Button>
                        <Button variant="secondary" className={styles.miniBtn} onClick={() => moveDay(day.id, 'up')} disabled={dayIdx === 0}>
                          ↑
                        </Button>
                        <Button variant="secondary" className={styles.miniBtn} onClick={() => moveDay(day.id, 'down')} disabled={dayIdx === dayPlans.length - 1}>
                          ↓
                        </Button>
                        <Button variant="destructive" className={styles.miniBtn} onClick={() => removeDay(day.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>

                    {isOpen ? (
                      <>
                        <div style={{ height: 10 }} />
                        <InputField
                          label="Day title"
                          value={day.title || ''}
                          onChange={(e) => patchDay(day.id, { title: e.target.value })}
                          placeholder={`Day ${day.dayNumber}: focus / theme`}
                        />
                        <TextAreaField
                          label="Day notes"
                          value={day.notes || ''}
                          onChange={(e) => patchDay(day.id, { notes: e.target.value })}
                          placeholder="Context, coaching notes, substitutions, constraints…"
                          rows={3}
                        />

                        <div className={styles.subSectionTitle}>Workout plan</div>
                        <SelectField
                          label="Workout template"
                          value={day?.workout?.templateId || ''}
                          onChange={(e) => patchDayWorkout(day.id, { templateId: e.target.value })}
                        >
                          <option value="">(Optional) Choose a template</option>
                          {workoutTemplates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name || 'Template'}</option>
                          ))}
                        </SelectField>
                        <InputField
                          label="Workout title (optional override)"
                          value={day?.workout?.title || ''}
                          onChange={(e) => patchDayWorkout(day.id, { title: e.target.value })}
                          placeholder="e.g., Lower Strength + Core"
                        />
                        <TextAreaField
                          label="Workout notes"
                          value={day?.workout?.notes || ''}
                          onChange={(e) => patchDayWorkout(day.id, { notes: e.target.value })}
                          placeholder="Warm-up, technique cues, RPE targets, substitutions…"
                          rows={3}
                        />
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addWorkoutStep(day.id)}>
                            + Add workout step
                          </Button>
                        </div>
                        {(Array.isArray(day?.workout?.steps) ? day.workout.steps : []).map((s, i) => (
                          <div key={i} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label={`Step ${i + 1} title`}
                                value={s?.title || ''}
                                onChange={(e) => patchWorkoutStep(day.id, i, { title: e.target.value })}
                                placeholder="e.g., 10 min bike @ Zone 2"
                              />
                              <div style={{ display: 'flex', alignItems: 'end' }}>
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeWorkoutStep(day.id, i)}>
                                  Remove step
                                </Button>
                              </div>
                            </div>
                            <TextAreaField
                              label="Step notes"
                              value={s?.notes || ''}
                              onChange={(e) => patchWorkoutStep(day.id, i, { notes: e.target.value })}
                              placeholder="Exact cues, rest, tempo, breathing, modifications…"
                              rows={2}
                            />
                          </div>
                        ))}

                        <div className={styles.subSectionTitle}>Meal plan</div>
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addMeal(day.id)}>
                            + Add meal
                          </Button>
                        </div>
                        {(Array.isArray(day?.meals) ? day.meals : []).map((meal, mi) => (
                          <div key={mi} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label={`Meal ${mi + 1} name`}
                                value={meal?.name || ''}
                                onChange={(e) => patchMeal(day.id, mi, { name: e.target.value })}
                                placeholder="e.g., Breakfast"
                              />
                              <InputField
                                label="Time (optional)"
                                value={meal?.time || ''}
                                onChange={(e) => patchMeal(day.id, mi, { time: e.target.value })}
                                placeholder="e.g., 7:30am"
                              />
                              <div style={{ display: 'flex', alignItems: 'end' }}>
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeMeal(day.id, mi)}>
                                  Remove meal
                                </Button>
                              </div>
                            </div>
                            <TextAreaField
                              label="Meal notes"
                              value={meal?.notes || ''}
                              onChange={(e) => patchMeal(day.id, mi, { notes: e.target.value })}
                              placeholder="Exact macros, substitutions, prep instructions…"
                              rows={2}
                            />
                            <div className={styles.miniBtnRow}>
                              <Button variant="secondary" className={styles.miniBtn} onClick={() => addMealItem(day.id, mi)}>
                                + Add food item
                              </Button>
                            </div>
                            {(Array.isArray(meal?.items) ? meal.items : []).map((it, ii) => (
                              <div key={ii} className={styles.inlineRow3} style={{ marginTop: 8 }}>
                                <InputField
                                  label="Food"
                                  value={it?.food || ''}
                                  onChange={(e) => patchMealItem(day.id, mi, ii, { food: e.target.value })}
                                  placeholder="e.g., Greek yogurt 2%"
                                />
                                <InputField
                                  label="Grams"
                                  inputMode="numeric"
                                  value={it?.grams || ''}
                                  onChange={(e) => patchMealItem(day.id, mi, ii, { grams: e.target.value })}
                                  placeholder="e.g., 250"
                                />
                                <div style={{ display: 'flex', alignItems: 'end' }}>
                                  <Button variant="destructive" className={styles.miniBtn} onClick={() => removeMealItem(day.id, mi, ii)}>
                                    Remove
                                  </Button>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <TextAreaField
                                    label="Item notes"
                                    value={it?.notes || ''}
                                    onChange={(e) => patchMealItem(day.id, mi, ii, { notes: e.target.value })}
                                    placeholder="Brand, prep, swaps, micronutrient focus…"
                                    rows={2}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}

                        <div className={styles.subSectionTitle}>Health metrics</div>
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addHealthMetric(day.id)}>
                            + Add health metric
                          </Button>
                        </div>
                        {(Array.isArray(day?.healthMetrics) ? day.healthMetrics : []).map((m, hi) => (
                          <div key={hi} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label="Metric"
                                value={m?.name || ''}
                                onChange={(e) => patchHealthMetric(day.id, hi, { name: e.target.value })}
                                placeholder="e.g., Water"
                              />
                              <InputField
                                label="Target"
                                value={m?.target || ''}
                                onChange={(e) => patchHealthMetric(day.id, hi, { target: e.target.value })}
                                placeholder="e.g., 3"
                              />
                              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                                <InputField
                                  label="Unit"
                                  value={m?.unit || ''}
                                  onChange={(e) => patchHealthMetric(day.id, hi, { unit: e.target.value })}
                                  placeholder="e.g., L"
                                />
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeHealthMetric(day.id, hi)}>
                                  Remove
                                </Button>
                              </div>
                            </div>
                            <TextAreaField
                              label="Metric notes"
                              value={m?.notes || ''}
                              onChange={(e) => patchHealthMetric(day.id, hi, { notes: e.target.value })}
                              placeholder="How to hit it, why it matters, what to do if missed…"
                              rows={2}
                            />
                          </div>
                        ))}
                        <TextAreaField
                          label="Health notes (day)"
                          value={day.healthNotes || ''}
                          onChange={(e) => patchDay(day.id, { healthNotes: e.target.value })}
                          placeholder="Recovery focus, stress management, wearable expectations…"
                          rows={3}
                        />
                      </>
                    ) : null}
                  </div>
                )
              })
            )}

            <div style={{ height: 10 }} />
            <div className={styles.btnRow}>
              <Button
                className={styles.btn}
                onClick={onPublish}
                loading={publishing}
                disabled={!draft?.id || publishing}
              >
                Publish
              </Button>
              <Button
                className={styles.btn}
                variant="secondary"
                onClick={onArchive}
                disabled={!draft?.id}
              >
                Archive
              </Button>
            </div>

            <div className={styles.muted} style={{ marginTop: 10 }}>
              MVP behavior: free programs can be “claimed” by users. Paid checkout will be wired with Stripe Connect next.
            </div>
          </div>

          {showTemplatesEditor && (
            <TemplateEditor
              templates={Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []}
              onClose={() => setShowTemplatesEditor(false)}
              onSave={templateOnSave}
              onDelete={templateOnDelete}
              onEdit={() => {}}
              editingTemplate={null}
            />
          )}
        </>
      )}
    </div>
  )
}


