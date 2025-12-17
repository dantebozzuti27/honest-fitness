import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import ConfirmDialog from '../components/ConfirmDialog'
import { logError } from '../utils/logger'
import { normalizeTemplateExercises } from '../utils/templateUtils'
import SearchField from '../components/SearchField'
import { getSystemFoods } from '../lib/foodLibrary'
import {
  archiveProgram,
  createProgram,
  deleteProgram,
  getCoachProfile,
  listMyPrograms,
  listProgramEnrollmentsForCoach,
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
  const n = Number(cents)
  if (!Number.isFinite(n) || n < 0) return ''
  // Explicitly show zero so coaches can set free programs without the UI “clearing” the value.
  if (n === 0) return '0.00'
  return String((n / 100).toFixed(2))
}

function deepClone(value) {
  try {
    // structuredClone is supported in modern browsers; fall back for older environments.
    // eslint-disable-next-line no-undef
    if (typeof structuredClone === 'function') return structuredClone(value)
  } catch {
    // ignore
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
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

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
]

function newDayPlan(nextDayNumber = 1) {
  return {
    id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    dayNumber: nextDayNumber,
    title: `Day ${nextDayNumber}`,
    weekday: null, // 0-6 (Sun-Sat) optional; used to schedule by day-of-week at enrollment time
    notes: '',
    workout: {
      templateId: '',
      title: '',
      notes: '',
      steps: [] // [{ title, notes }]
    },
    meals: [], // [{ name, time, notes, targets: { calories, proteinG, carbsG, fatG }, items: [{ food, grams, notes, calories, proteinG, carbsG, fatG }] }]
    healthMetrics: [], // [{ name, target, unit, notes }]
    healthNotes: ''
  }
}

export default function CoachStudio() {
  const navigate = useNavigate()
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
  const [programEditingTemplate, setProgramEditingTemplate] = useState(null)
  const [importTemplateOpen, setImportTemplateOpen] = useState(false)
  const [myTemplates, setMyTemplates] = useState([])
  const [myTemplateSearch, setMyTemplateSearch] = useState('')
  const [foodSearchOpen, setFoodSearchOpen] = useState(false)
  const [foodSearchQuery, setFoodSearchQuery] = useState('')
  const [foodSearchLoading, setFoodSearchLoading] = useState(false)
  const [foodSearchResults, setFoodSearchResults] = useState([])
  const [foodSearchTarget, setFoodSearchTarget] = useState(null) // { dayId, mealIndex, itemIndex }
  const [templatesHubOpen, setTemplatesHubOpen] = useState(false)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [duplicateWeekOpen, setDuplicateWeekOpen] = useState(false)
  const [duplicateWeekIndex, setDuplicateWeekIndex] = useState(0)
  const [duplicateWeekCopies, setDuplicateWeekCopies] = useState('1')
  const [bulkApplyTemplateOpen, setBulkApplyTemplateOpen] = useState(false)
  const [bulkApplyTemplateId, setBulkApplyTemplateId] = useState('')
  const [bulkApplyDayIds, setBulkApplyDayIds] = useState([])
  const [copyMealsOpen, setCopyMealsOpen] = useState(false)
  const [copyMealsTargetDayId, setCopyMealsTargetDayId] = useState(null)
  const [copyMealsSourceDayId, setCopyMealsSourceDayId] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState(emptyDraft())
  const [editorTab, setEditorTab] = useState('overview') // overview | schedule | publish
  const [dayEditorOpen, setDayEditorOpen] = useState(false)
  const [dayEditorId, setDayEditorId] = useState(null)
  const [dayEditorTab, setDayEditorTab] = useState('day') // day | workout | meals | health
  const [deleteProgramConfirm, setDeleteProgramConfirm] = useState({ open: false, program: null })
  const [discardConfirm, setDiscardConfirm] = useState({ open: false, action: null, payload: null })
  const [enrollmentsOpen, setEnrollmentsOpen] = useState(false)
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false)
  const [enrollments, setEnrollments] = useState([])
  const [weeklyScheduleConfirm, setWeeklyScheduleConfirm] = useState({ open: false })
  const editorTabs = ['overview', 'schedule', 'publish']

  const weekDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const weekDayLabels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
  const [weeklyWeeksCount, setWeeklyWeeksCount] = useState('6')
  const [weeklyWeekStart, setWeeklyWeekStart] = useState('mon') // mon..sun
  const [weeklyPattern, setWeeklyPattern] = useState({ mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' }) // templateId per weekday ('' = rest)

  const goPrevEditorTab = () => {
    const idx = editorTabs.indexOf(editorTab)
    if (idx <= 0) return
    setEditorTab(editorTabs[idx - 1])
    requestAnimationFrame(() => {
      try { editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) } catch {}
    })
  }

  const goNextEditorTab = () => {
    const idx = editorTabs.indexOf(editorTab)
    if (idx === -1 || idx >= editorTabs.length - 1) return
    setEditorTab(editorTabs[idx + 1])
    requestAnimationFrame(() => {
      try { editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) } catch {}
    })
  }

  const selectedProgram = useMemo(() => {
    if (!draft?.id) return null
    return (programs || []).find(p => p.id === draft.id) || null
  }, [draft?.id, programs])

  const isDirty = useMemo(() => {
    // If no program is selected and draft is empty-ish, treat as not dirty.
    if (!draft) return false
    const baseline = selectedProgram
      ? {
          id: selectedProgram.id,
          title: selectedProgram.title || '',
          description: selectedProgram.description || '',
          priceCents: Number(selectedProgram.priceCents || 0),
          currency: selectedProgram.currency || 'usd',
          tags: Array.isArray(selectedProgram.tags) ? selectedProgram.tags : [],
          content: normalizeContent(selectedProgram.content)
        }
      : emptyDraft()
    const a = JSON.stringify({ ...baseline, content: baseline.content })
    const b = JSON.stringify({ ...draft, content: normalizeContent(draft.content) })
    return a !== b
  }, [draft, selectedProgram])

  const requestDiscard = (action, payload) => {
    if (!isDirty) {
      action?.(payload)
      return
    }
    setDiscardConfirm({ open: true, action, payload })
  }

  const openEnrollments = async () => {
    if (!draft?.id) {
      showToast('Save the program first.', 'error')
      return
    }
    setEnrollmentsOpen(true)
    setEnrollmentsLoading(true)
    try {
      const rows = await listProgramEnrollmentsForCoach(draft.id)
      setEnrollments(Array.isArray(rows) ? rows : [])
    } catch (e) {
      logError('Load enrollments failed', e)
      showToast('Failed to load enrollments. Make sure `coach_program_enrollments` exists and RLS is applied.', 'error', 6500)
      setEnrollments([])
    } finally {
      setEnrollmentsLoading(false)
    }
  }

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
    requestDiscard(() => {
      setDraft({
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        priceCents: Number(p.priceCents || 0),
        currency: p.currency || 'usd',
        tags: Array.isArray(p.tags) ? p.tags : [],
        content: normalizeContent(p.content)
      })
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
      if (publishChecklist.blockers.length > 0) {
        showToast(publishChecklist.blockers[0], 'error', 6500)
        return
      }
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
      if (!String(p?.title || '').trim()) {
        showToast('Title is required before publishing.', 'error', 6500)
        return
      }
      const dp = Array.isArray(p?.content?.dayPlans) ? p.content.dayPlans : []
      if (dp.length === 0) {
        showToast('Add at least one day before publishing.', 'error', 6500)
        return
      }
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

  const onDeleteProgram = async (programObj) => {
    if (!user?.id || !programObj?.id) return
    try {
      await deleteProgram(user.id, programObj.id)
      showToast('Program deleted.', 'success')
      if (draft?.id === programObj.id) {
        setDraft(emptyDraft())
      }
      await loadAll()
    } catch (e) {
      logError('Delete program failed', e)
      showToast('Failed to delete program.', 'error')
    } finally {
      setDeleteProgramConfirm({ open: false, program: null })
    }
  }

  const exportProgramTemplatesToFitness = async () => {
    if (!draft?.id) {
      showToast('Save the program first, then export templates.', 'error')
      return
    }
    const programTemplates = Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []
    if (programTemplates.length === 0) {
      showToast('No workout templates to export yet.', 'error')
      return
    }
    try {
      const db = await import('../db/lazyDb')
      const bulkAddTemplates = db.bulkAddTemplates
      if (typeof bulkAddTemplates !== 'function') {
        showToast('Template storage is not available yet in this build.', 'error')
        return
      }
      const safeTemplates = programTemplates.map((t, idx) => {
        const baseId = t?.id ? String(t.id) : `t${idx + 1}`
        return {
          id: `cs_${draft.id}_${baseId}`,
          name: t?.name || `Template ${idx + 1}`,
          exercises: normalizeTemplateExercises(t?.exercises)
        }
      })
      await bulkAddTemplates(safeTemplates)
      try {
        window.dispatchEvent(new CustomEvent('templatesUpdated'))
      } catch {}
      showToast(`Exported ${safeTemplates.length} templates to Fitness.`, 'success', 4500)
    } catch (e) {
      logError('Export program templates failed', e)
      showToast('Failed to export templates. Please try again.', 'error')
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

  const openNewProgramTemplate = () => {
    const id = `program-template-${Date.now()}`
    setProgramEditingTemplate({ id, name: '', exercises: [] })
    setShowTemplatesEditor(true)
  }

  const openTemplatesHub = () => {
    setTemplatesHubOpen(true)
  }

  const openProgramTemplatesEditor = () => {
    setTemplatesHubOpen(false)
    setShowTemplatesEditor(true)
  }

  const openImportFromMyTemplates = async () => {
    try {
      const db = await import('../db/lazyDb')
      const list = await db.getAllTemplates()
      setMyTemplates(Array.isArray(list) ? list : [])
    } catch {
      setMyTemplates([])
    }
    setMyTemplateSearch('')
    setImportTemplateOpen(true)
  }

  const computeScaledFood = (food, grams) => {
    const g = Math.max(0, Number(grams) || 0)
    const scale = g / 100
    const calories = (Number(food?.calories_per_100g) || 0) * scale
    const protein = (Number(food?.protein_per_100g) || 0) * scale
    const carbs = (Number(food?.carbs_per_100g) || 0) * scale
    const fat = (Number(food?.fat_per_100g) || 0) * scale
    return {
      calories,
      protein,
      carbs,
      fat
    }
  }

  const openFoodSearchForMealItem = (dayId, mealIndex, itemIndex) => {
    setFoodSearchTarget({ dayId, mealIndex, itemIndex })
    setFoodSearchQuery('')
    setFoodSearchResults([])
    setFoodSearchOpen(true)
  }

  useEffect(() => {
    if (!foodSearchOpen) return
    const q = (foodSearchQuery || '').toString().trim()
    let cancelled = false

    const t = setTimeout(async () => {
      try {
        setFoodSearchLoading(true)
        const rows = q.length >= 2 ? await getSystemFoods({ search: q, limit: 50 }) : await getSystemFoods({ limit: 50 })
        if (cancelled) return
        setFoodSearchResults(Array.isArray(rows) ? rows : [])
      } catch (e) {
        if (cancelled) return
        setFoodSearchResults([])
      } finally {
        if (!cancelled) setFoodSearchLoading(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [foodSearchOpen, foodSearchQuery])

  const importMyTemplateIntoProgram = (template) => {
    if (!template || !template.id) return
    const copied = {
      id: `prog_${draft?.id || 'draft'}_${String(template.id)}`,
      name: template.name || 'Template',
      exercises: normalizeTemplateExercises(template.exercises)
    }
    templateOnSave(copied)
    if (dayEditorOpen && dayEditorId) {
      patchDayWorkout(dayEditorId, { templateId: copied.id })
    }
    setImportTemplateOpen(false)
    showToast('Template added to program.', 'success', 2000)
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

  const dayPlans = Array.isArray(draft.content?.dayPlans) ? draft.content.dayPlans : []

  const generateDayPlansFromWeeklyPattern = () => {
    const weeks = Math.min(52, Math.max(1, Number(weeklyWeeksCount) || 1))
    const startKey = weekDayKeys.includes(weeklyWeekStart) ? weeklyWeekStart : 'mon'
    const startIdx = Math.max(0, weekDayKeys.indexOf(startKey))
    const orderedKeys = [...weekDayKeys.slice(startIdx), ...weekDayKeys.slice(0, startIdx)]

    const next = []
    let dayNumber = 1
    for (let w = 1; w <= weeks; w += 1) {
      for (const k of orderedKeys) {
        const templateId = String(weeklyPattern?.[k] || '')
        const label = weekDayLabels[k] || k
        const isRest = !templateId
        next.push({
          ...newDayPlan(dayNumber),
          dayNumber,
          title: `Week ${w} · ${label}`,
          notes: isRest ? 'Rest day' : '',
          workout: {
            templateId,
            title: '',
            notes: '',
            steps: []
          },
          meals: [],
          healthMetrics: [],
          healthNotes: ''
        })
        dayNumber += 1
      }
    }
    updateDayPlans(() => next)
    showToast(`Generated ${next.length} days (${weeks} weeks).`, 'success', 3500)
  }

  const weekGroups = useMemo(() => {
    const weeks = []
    const dp = Array.isArray(draft?.content?.dayPlans) ? draft.content.dayPlans : []
    const totalWeeks = Math.max(1, Math.ceil(dp.length / 7))
    for (let w = 0; w < totalWeeks; w += 1) {
      const start = w * 7
      const slice = dp.slice(start, start + 7)
      if (slice.length === 0) continue
      const firstDay = slice[0]?.dayNumber || (start + 1)
      const lastDay = slice[slice.length - 1]?.dayNumber || (start + slice.length)
      weeks.push({ index: w, start, endExclusive: start + slice.length, firstDay, lastDay, days: slice })
    }
    return weeks
  }, [draft?.content?.dayPlans])

  const publishChecklist = useMemo(() => {
    const blockers = []
    const warnings = []

    const titleOk = Boolean(String(draft?.title || '').trim())
    if (!titleOk) blockers.push('Title is required.')
    if (!draft?.id) blockers.push('Save the program before publishing.')
    if (Number(draft?.priceCents || 0) > 0) blockers.push('Paid checkout is not wired yet. Set price to $0 to publish for now.')

    const dp = Array.isArray(draft?.content?.dayPlans) ? draft.content.dayPlans : []
    if (dp.length === 0) blockers.push('Add at least one day to the schedule.')

    const templates = Array.isArray(draft?.content?.workoutTemplates) ? draft.content.workoutTemplates : []
    const templateIds = new Set(templates.map(t => t?.id).filter(Boolean))
    let emptyDays = 0
    let missingTemplates = 0
    dp.forEach((d) => {
      const hasWorkoutTemplate = Boolean(d?.workout?.templateId)
      const hasWorkoutSteps = Array.isArray(d?.workout?.steps) && d.workout.steps.some(s => String(s?.title || '').trim() || String(s?.notes || '').trim())
      const hasMeals = Array.isArray(d?.meals) && d.meals.length > 0
      const hasMetrics = Array.isArray(d?.healthMetrics) && d.healthMetrics.length > 0
      const hasAny = hasWorkoutTemplate || hasWorkoutSteps || hasMeals || hasMetrics || String(d?.notes || '').trim()
      if (!hasAny) emptyDays += 1
      if (hasWorkoutTemplate && !templateIds.has(d.workout.templateId)) missingTemplates += 1
    })
    if (emptyDays > 0) warnings.push(`${emptyDays} day${emptyDays === 1 ? '' : 's'} have no workout/meals/metrics yet.`)
    if (missingTemplates > 0) warnings.push(`${missingTemplates} day${missingTemplates === 1 ? '' : 's'} reference a workout template that is missing from this program.`)

    return { blockers, warnings }
  }, [draft?.id, draft?.title, draft?.priceCents, draft?.content?.dayPlans, draft?.content?.workoutTemplates])

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
  }

  const removeDay = (dayId) => {
    updateDayPlans((current) => {
      const filtered = current.filter(d => d.id !== dayId)
      // Renumber days so UI stays intuitive
      return filtered.map((d, idx) => ({ ...d, dayNumber: idx + 1, title: d.title || `Day ${idx + 1}` }))
    })
    if (dayEditorId === dayId) {
      setDayEditorOpen(false)
      setDayEditorId(null)
    }
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

  const duplicateDay = (dayId) => {
    updateDayPlans((current) => {
      const idx = current.findIndex(d => d.id === dayId)
      if (idx < 0) return current
      const d = deepClone(current[idx] || {})
      const copy = {
        ...(d || {}),
        id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        title: d?.title ? `${d.title} (copy)` : `Day ${(d?.dayNumber || idx + 1)} (copy)`
      }
      const next = [...current.slice(0, idx + 1), copy, ...current.slice(idx + 1)]
      return next.map((x, i) => ({ ...x, dayNumber: i + 1 }))
    })
  }

  const duplicateLastWeek = () => {
    updateDayPlans((current) => {
      if (!Array.isArray(current) || current.length === 0) return current
      const take = Math.min(7, current.length)
      const slice = current.slice(current.length - take)
      const clones = slice.map((day, i) => {
        const c = deepClone(day || {})
        return {
          ...(c || {}),
          id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}_${i}`,
          title: c?.title ? `${c.title} (copy)` : `Day ${(c?.dayNumber || i + 1)} (copy)`
        }
      })
      const next = [...current, ...clones]
      return next.map((x, i) => ({ ...x, dayNumber: i + 1, title: x?.title || `Day ${i + 1}` }))
    })
    showToast('Duplicated last week.', 'success', 1800)
  }

  const duplicateWeek = (weekIdx, copiesRaw) => {
    const copies = Math.min(12, Math.max(1, Number(copiesRaw) || 1))
    updateDayPlans((current) => {
      if (!Array.isArray(current) || current.length === 0) return current
      const totalWeeks = Math.max(1, Math.ceil(current.length / 7))
      const safeWeekIdx = Math.min(totalWeeks - 1, Math.max(0, Number(weekIdx) || 0))
      const start = safeWeekIdx * 7
      const slice = current.slice(start, start + 7)
      if (slice.length === 0) return current

      const next = [...current]
      for (let c = 0; c < copies; c += 1) {
        slice.forEach((day, i) => {
          const base = deepClone(day || {})
          const suffix = copies === 1 ? ' (copy)' : ` (copy ${c + 1})`
          next.push({
            ...(base || {}),
            id: `day_${Date.now()}_${Math.random().toString(16).slice(2)}_${c}_${i}`,
            title: base?.title ? `${base.title}${suffix}` : `Day ${(base?.dayNumber || (start + i + 1))}${suffix}`
          })
        })
      }

      return next.map((x, i) => ({ ...x, dayNumber: i + 1, title: x?.title || `Day ${i + 1}` }))
    })
    showToast('Week duplicated.', 'success', 1800)
  }

  const openDayEditor = (dayId) => {
    setDayEditorTab('day')
    setDayEditorId(dayId)
    setDayEditorOpen(true)
  }

  const currentDay = useMemo(() => {
    if (!dayEditorId) return null
    return (Array.isArray(draft.content?.dayPlans) ? draft.content.dayPlans : []).find(d => d.id === dayEditorId) || null
  }, [dayEditorId, draft.content?.dayPlans])

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
      return { ...d, meals: [...meals, { name: '', time: '', notes: '', targets: { calories: '', proteinG: '', carbsG: '', fatG: '' }, items: [] }] }
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

  const duplicateMeal = (dayId, mealIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const m = meals[mealIndex]
      if (!m) return d
      const copy = JSON.parse(JSON.stringify(m))
      copy.name = copy.name ? `${copy.name} (copy)` : 'Meal (copy)'
      const next = [...meals.slice(0, mealIndex + 1), copy, ...meals.slice(mealIndex + 1)]
      return { ...d, meals: next }
    }))
  }

  const copyMealTargetsToItems = (dayId, mealIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const m = meals[mealIndex]
      if (!m) return d
      const targets = m.targets || {}
      const items = Array.isArray(m.items) ? m.items : []
      // Best-effort: if an item field is empty, fill it with the meal target.
      const nextItems = items.map(it => ({
        ...(it || {}),
        calories: (it?.calories ?? '') || (targets.calories ?? ''),
        proteinG: (it?.proteinG ?? '') || (targets.proteinG ?? ''),
        carbsG: (it?.carbsG ?? '') || (targets.carbsG ?? ''),
        fatG: (it?.fatG ?? '') || (targets.fatG ?? '')
      }))
      const nextMeals = meals.map((x, i) => (i === mealIndex ? { ...(x || {}), items: nextItems } : x))
      return { ...d, meals: nextMeals }
    }))
  }

  const addMealItem = (dayId, mealIndex) => {
    updateDayPlans((current) => current.map(d => {
      if (d.id !== dayId) return d
      const meals = Array.isArray(d?.meals) ? d.meals : []
      const nextMeals = meals.map((m, i) => {
        if (i !== mealIndex) return m
        const items = Array.isArray(m?.items) ? m.items : []
        return { ...(m || {}), items: [...items, { food: '', grams: '', notes: '', calories: '', proteinG: '', carbsG: '', fatG: '' }] }
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
          onMouseDown={() => {
            // Creating a program doesn't affect the main editor draft; no dirty guard needed.
            setCreateModalOpen(false)
          }}
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
                      <Button
                        className={styles.btn}
                        variant="destructive"
                        onClick={() => setDeleteProgramConfirm({ open: true, program: p })}
                      >
                        Delete
                      </Button>
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
                <Button className={styles.btn} variant="secondary" onClick={() => requestDiscard(() => setDraft(emptyDraft()))}>
                  Clear
                </Button>
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.segmented} style={{ marginBottom: 12 }}>
              <Button
                variant="secondary"
                className={`${styles.segBtn} ${editorTab === 'overview' ? styles.segBtnActive : ''}`}
                onClick={() => setEditorTab('overview')}
              >
                Overview
              </Button>
              <Button
                variant="secondary"
                className={`${styles.segBtn} ${editorTab === 'schedule' ? styles.segBtnActive : ''}`}
                onClick={() => setEditorTab('schedule')}
              >
                Schedule
              </Button>
              <Button
                variant="secondary"
                className={`${styles.segBtn} ${editorTab === 'publish' ? styles.segBtnActive : ''}`}
                onClick={() => setEditorTab('publish')}
              >
                Publish
              </Button>
            </div>

            {editorTab === 'overview' ? (
              <>
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
                    onClick={openTemplatesHub}
                  >
                    Templates… ({Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0})
                  </Button>
                </div>
              </>
            ) : null}

            <div style={{ height: 12 }} />
            <div className={styles.btnRow}>
              <Button
                className={styles.btn}
                onClick={onSaveProgram}
                loading={savingProgram}
                disabled={!user?.id || savingProgram}
              >
                Save
              </Button>
            </div>
            <div className={styles.muted} style={{ marginTop: 8 }}>
              <b>Program templates</b> live inside this program (Save to persist). <b>Fitness templates</b> are your personal template library. Use <b>Export to Fitness</b> to copy program templates into your library.
            </div>

            <div className={styles.hr} />
            {editorTab === 'schedule' ? (
              <>
                <div className={styles.dayPlansHeader} style={{ marginTop: 0 }}>
                  <div style={{ fontWeight: 900 }}>Day-by-day plan</div>
                  <div className={styles.miniBtnRow}>
                    <Button variant="secondary" className={styles.miniBtn} onClick={openTemplatesHub}>
                      Templates…
                    </Button>
                    <Button variant="secondary" className={styles.miniBtn} onClick={() => setBulkActionsOpen(true)}>
                      Bulk actions
                    </Button>
                    <Button variant="secondary" className={styles.miniBtn} onClick={addDay}>
                      + Add day
                    </Button>
                  </div>
                </div>
                <div className={styles.muted}>
                  Edit one day at a time in a focused modal (Day / Workout / Meals / Health).
                </div>
                <div className={styles.muted} style={{ marginTop: 6 }}>
                  Tip: To make a multi-week program fast, use <b>Bulk actions</b> → <b>Duplicate week…</b>
                </div>

                <div className={styles.hr} />
                <div className={styles.subSectionTitle}>Weekly scheduling (by day of week)</div>
                <div className={styles.muted} style={{ marginBottom: 8 }}>
                  Pick templates for Mon–Sun and generate a multi-week program instantly. (This replaces the current day-by-day plan.)
                </div>
                <div className={styles.inlineRow3}>
                  <SelectField
                    label="Week starts on"
                    value={weeklyWeekStart}
                    onChange={(e) => setWeeklyWeekStart(e.target.value)}
                  >
                    {weekDayKeys.map((k) => (
                      <option key={k} value={k}>{weekDayLabels[k]}</option>
                    ))}
                  </SelectField>
                  <InputField
                    label="# of weeks"
                    inputMode="numeric"
                    value={weeklyWeeksCount}
                    onChange={(e) => setWeeklyWeeksCount(e.target.value)}
                    placeholder="6"
                  />
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => setWeeklyScheduleConfirm({ open: true })}
                      disabled={(Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0) === 0}
                    >
                      Generate day plans
                    </Button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  {weekDayKeys.map((k) => (
                    <SelectField
                      key={k}
                      label={weekDayLabels[k]}
                      value={weeklyPattern?.[k] || ''}
                      onChange={(e) => setWeeklyPattern(prev => ({ ...(prev || {}), [k]: e.target.value }))}
                    >
                      <option value="">(Rest)</option>
                      {(Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []).map((t) => (
                        <option key={t.id} value={t.id}>{t.name || 'Template'}</option>
                      ))}
                    </SelectField>
                  ))}
                </div>

                {dayPlans.length === 0 ? (
                  <div className={styles.muted} style={{ marginTop: 10 }}>
                    No days yet. Add Day 1 to start.
                  </div>
                ) : (
                  dayPlans.map((day, dayIdx) => {
                    const workoutTemplates = Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []
                    const templateName = workoutTemplates.find(t => t.id === day?.workout?.templateId)?.name
                    const stepsCount = Array.isArray(day?.workout?.steps) ? day.workout.steps.length : 0
                    const mealsCount = Array.isArray(day?.meals) ? day.meals.length : 0
                    const metricsCount = Array.isArray(day?.healthMetrics) ? day.healthMetrics.length : 0
                    const weekdayLabel = (day?.weekday != null && Number.isFinite(Number(day.weekday)))
                      ? (WEEKDAYS.find(w => w.value === Number(day.weekday))?.label || null)
                      : null
                    return (
                      <div key={day.id} className={styles.dayCard}>
                        <div className={styles.dayHeader}>
                          <div>
                            <div className={styles.dayTitle}>
                              Day {day.dayNumber}{day.title ? ` — ${day.title}` : ''}
                            </div>
                            <div className={styles.dayMeta}>
                              {templateName ? <span className={styles.chip}>Workout: {templateName}</span> : <span className={styles.chip}>Workout: (not set)</span>}
                              {weekdayLabel ? <span className={styles.chip}>Weekday: {weekdayLabel}</span> : null}
                              <span className={styles.chip}>{stepsCount} steps</span>
                              <span className={styles.chip}>{mealsCount} meals</span>
                              <span className={styles.chip}>{metricsCount} metrics</span>
                            </div>
                          </div>
                          <div className={styles.miniBtnRow}>
                            <Button variant="secondary" className={styles.miniBtn} onClick={() => openDayEditor(day.id)}>
                              Edit day
                            </Button>
                            <Button variant="secondary" className={styles.miniBtn} onClick={() => duplicateDay(day.id)}>
                              Duplicate
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
                        {day.notes ? <div className={styles.muted} style={{ marginTop: 8 }}>{day.notes.slice(0, 180)}{day.notes.length > 180 ? '…' : ''}</div> : null}
                      </div>
                    )
                  })
                )}
              </>
            ) : null}

            {dayEditorOpen && currentDay ? (
              <div
                className={styles.modalOverlay}
                onMouseDown={() => setDayEditorOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-label="Edit day"
              >
                <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                  <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>Edit Day {currentDay.dayNumber}</h2>
                    <Button unstyled onClick={() => setDayEditorOpen(false)}>✕</Button>
                  </div>

                  <div className={styles.dayEditTabs}>
                    <Button variant="secondary" className={`${styles.segBtn} ${dayEditorTab === 'day' ? styles.segBtnActive : ''}`} onClick={() => setDayEditorTab('day')}>
                      Day
                    </Button>
                    <Button variant="secondary" className={`${styles.segBtn} ${dayEditorTab === 'workout' ? styles.segBtnActive : ''}`} onClick={() => setDayEditorTab('workout')}>
                      Workout
                    </Button>
                    <Button variant="secondary" className={`${styles.segBtn} ${dayEditorTab === 'meals' ? styles.segBtnActive : ''}`} onClick={() => setDayEditorTab('meals')}>
                      Meals
                    </Button>
                    <Button variant="secondary" className={`${styles.segBtn} ${dayEditorTab === 'health' ? styles.segBtnActive : ''}`} onClick={() => setDayEditorTab('health')}>
                      Health
                    </Button>
                  </div>

                  <div className={styles.modalBody}>
                    {dayEditorTab === 'day' ? (
                      <>
                        <InputField
                          label="Day title"
                          value={currentDay.title || ''}
                          onChange={(e) => patchDay(currentDay.id, { title: e.target.value })}
                          placeholder={`Day ${currentDay.dayNumber}: focus / theme`}
                        />
                        <div style={{ height: 10 }} />
                        <SelectField
                          label="Day of week (optional)"
                          value={currentDay.weekday == null ? '' : String(currentDay.weekday)}
                          onChange={(e) => {
                            const v = e.target.value
                            patchDay(currentDay.id, { weekday: v === '' ? null : Number(v) })
                          }}
                        >
                          <option value="">(Not set)</option>
                          {WEEKDAYS.map(w => (
                            <option key={w.value} value={String(w.value)}>{w.label}</option>
                          ))}
                        </SelectField>
                        <TextAreaField
                          label="Day notes"
                          value={currentDay.notes || ''}
                          onChange={(e) => patchDay(currentDay.id, { notes: e.target.value })}
                          placeholder="Context, coaching notes, substitutions, constraints…"
                          rows={6}
                        />
                      </>
                    ) : null}

                    {dayEditorTab === 'workout' ? (
                      <>
                        <div className={styles.btnRow} style={{ marginTop: 0 }}>
                          <Button
                            className={styles.btn}
                            variant="secondary"
                            onClick={openTemplatesHub}
                          >
                            Templates…
                          </Button>
                        </div>
                        <div className={styles.muted}>
                          Choose a template below (program templates only). Use “Templates…” to create/import/manage program templates.
                        </div>
                        <SelectField
                          label="Workout template"
                          value={currentDay?.workout?.templateId || ''}
                          onChange={(e) => patchDayWorkout(currentDay.id, { templateId: e.target.value })}
                        >
                          <option value="">(Optional) Choose a template</option>
                          {(Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []).map((t) => (
                            <option key={t.id} value={t.id}>{t.name || 'Template'}</option>
                          ))}
                        </SelectField>
                        <InputField
                          label="Workout title (optional override)"
                          value={currentDay?.workout?.title || ''}
                          onChange={(e) => patchDayWorkout(currentDay.id, { title: e.target.value })}
                          placeholder="e.g., Lower Strength + Core"
                        />
                        <TextAreaField
                          label="Workout notes"
                          value={currentDay?.workout?.notes || ''}
                          onChange={(e) => patchDayWorkout(currentDay.id, { notes: e.target.value })}
                          placeholder="Warm-up, technique cues, RPE targets, substitutions…"
                          rows={5}
                        />
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addWorkoutStep(currentDay.id)}>
                            + Add workout step
                          </Button>
                        </div>
                        {(Array.isArray(currentDay?.workout?.steps) ? currentDay.workout.steps : []).map((s, i) => (
                          <div key={i} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label={`Step ${i + 1} title`}
                                value={s?.title || ''}
                                onChange={(e) => patchWorkoutStep(currentDay.id, i, { title: e.target.value })}
                                placeholder="e.g., 10 min bike @ Zone 2"
                              />
                              <div style={{ display: 'flex', alignItems: 'end' }}>
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeWorkoutStep(currentDay.id, i)}>
                                  Remove step
                                </Button>
                              </div>
                            </div>
                            <TextAreaField
                              label="Step notes"
                              value={s?.notes || ''}
                              onChange={(e) => patchWorkoutStep(currentDay.id, i, { notes: e.target.value })}
                              placeholder="Exact cues, rest, tempo, breathing, modifications…"
                              rows={3}
                            />
                          </div>
                        ))}
                      </>
                    ) : null}

                    {dayEditorTab === 'meals' ? (
                      <>
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addMeal(currentDay.id)}>
                            + Add meal
                          </Button>
                          <Button
                            variant="secondary"
                            className={styles.miniBtn}
                            onClick={() => {
                              setCopyMealsTargetDayId(currentDay.id)
                              setCopyMealsSourceDayId('')
                              setCopyMealsOpen(true)
                            }}
                            disabled={dayPlans.length <= 1}
                          >
                            Copy meals from…
                          </Button>
                        </div>
                        {(Array.isArray(currentDay?.meals) ? currentDay.meals : []).map((meal, mi) => (
                          <div key={mi} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label={`Meal ${mi + 1} name`}
                                value={meal?.name || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { name: e.target.value })}
                                placeholder="e.g., Breakfast"
                              />
                              <InputField
                                label="Time (optional)"
                                value={meal?.time || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { time: e.target.value })}
                                placeholder="e.g., 7:30am"
                              />
                              <div style={{ display: 'flex', alignItems: 'end' }}>
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeMeal(currentDay.id, mi)}>
                                  Remove meal
                                </Button>
                              </div>
                            </div>
                            <div className={styles.miniBtnRow} style={{ marginTop: 8 }}>
                              <Button variant="secondary" className={styles.miniBtn} onClick={() => duplicateMeal(currentDay.id, mi)}>
                                Duplicate meal
                              </Button>
                              <Button variant="secondary" className={styles.miniBtn} onClick={() => copyMealTargetsToItems(currentDay.id, mi)}>
                                Copy meal macros → items
                              </Button>
                            </div>
                            <div className={styles.inlineRow3} style={{ marginTop: 8 }}>
                              <InputField
                                label="Meal calories"
                                inputMode="numeric"
                                value={meal?.targets?.calories || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { targets: { ...(meal?.targets || {}), calories: e.target.value } })}
                                placeholder="e.g., 650"
                              />
                              <InputField
                                label="Protein (g)"
                                inputMode="numeric"
                                value={meal?.targets?.proteinG || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { targets: { ...(meal?.targets || {}), proteinG: e.target.value } })}
                                placeholder="e.g., 45"
                              />
                              <InputField
                                label="Carbs (g)"
                                inputMode="numeric"
                                value={meal?.targets?.carbsG || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { targets: { ...(meal?.targets || {}), carbsG: e.target.value } })}
                                placeholder="e.g., 70"
                              />
                            </div>
                            <div className={styles.inlineRow3} style={{ marginTop: 8 }}>
                              <InputField
                                label="Fat (g)"
                                inputMode="numeric"
                                value={meal?.targets?.fatG || ''}
                                onChange={(e) => patchMeal(currentDay.id, mi, { targets: { ...(meal?.targets || {}), fatG: e.target.value } })}
                                placeholder="e.g., 20"
                              />
                              <div />
                              <div />
                            </div>
                            <TextAreaField
                              label="Meal notes"
                              value={meal?.notes || ''}
                              onChange={(e) => patchMeal(currentDay.id, mi, { notes: e.target.value })}
                              placeholder="Exact macros, substitutions, prep instructions…"
                              rows={3}
                            />
                            <div className={styles.miniBtnRow}>
                              <Button variant="secondary" className={styles.miniBtn} onClick={() => addMealItem(currentDay.id, mi)}>
                                + Add food item
                              </Button>
                            </div>
                            {(Array.isArray(meal?.items) ? meal.items : []).map((it, ii) => (
                              <div key={ii} className={styles.inlineRow3} style={{ marginTop: 8 }}>
                                <InputField
                                  label="Food"
                                  value={it?.food || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { food: e.target.value })}
                                  placeholder="e.g., Greek yogurt 2%"
                                />
                                <InputField
                                  label="Grams"
                                  inputMode="numeric"
                                  value={it?.grams || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { grams: e.target.value })}
                                  placeholder="e.g., 250"
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', justifyContent: 'flex-end' }}>
                                  <Button
                                    variant="secondary"
                                    className={styles.miniBtn}
                                    onClick={() => openFoodSearchForMealItem(currentDay.id, mi, ii)}
                                  >
                                    Search
                                  </Button>
                                  <Button variant="destructive" className={styles.miniBtn} onClick={() => removeMealItem(currentDay.id, mi, ii)}>
                                    Remove
                                  </Button>
                                </div>
                                <InputField
                                  label="Calories"
                                  inputMode="numeric"
                                  value={it?.calories || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { calories: e.target.value })}
                                  placeholder="e.g., 220"
                                />
                                <InputField
                                  label="Protein (g)"
                                  inputMode="numeric"
                                  value={it?.proteinG || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { proteinG: e.target.value })}
                                  placeholder="e.g., 20"
                                />
                                <InputField
                                  label="Carbs (g)"
                                  inputMode="numeric"
                                  value={it?.carbsG || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { carbsG: e.target.value })}
                                  placeholder="e.g., 30"
                                />
                                <InputField
                                  label="Fat (g)"
                                  inputMode="numeric"
                                  value={it?.fatG || ''}
                                  onChange={(e) => patchMealItem(currentDay.id, mi, ii, { fatG: e.target.value })}
                                  placeholder="e.g., 8"
                                />
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <TextAreaField
                                    label="Item notes"
                                    value={it?.notes || ''}
                                    onChange={(e) => patchMealItem(currentDay.id, mi, ii, { notes: e.target.value })}
                                    placeholder="Brand, prep, swaps, micronutrient focus…"
                                    rows={3}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    ) : null}

                    {dayEditorTab === 'health' ? (
                      <>
                        <div className={styles.miniBtnRow}>
                          <Button variant="secondary" className={styles.miniBtn} onClick={() => addHealthMetric(currentDay.id)}>
                            + Add health metric
                          </Button>
                        </div>
                        {(Array.isArray(currentDay?.healthMetrics) ? currentDay.healthMetrics : []).map((m, hi) => (
                          <div key={hi} style={{ marginTop: 10 }}>
                            <div className={styles.inlineRow3}>
                              <InputField
                                label="Metric"
                                value={m?.name || ''}
                                onChange={(e) => patchHealthMetric(currentDay.id, hi, { name: e.target.value })}
                                placeholder="e.g., Water"
                              />
                              <InputField
                                label="Target"
                                value={m?.target || ''}
                                onChange={(e) => patchHealthMetric(currentDay.id, hi, { target: e.target.value })}
                                placeholder="e.g., 3"
                              />
                              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                                <InputField
                                  label="Unit"
                                  value={m?.unit || ''}
                                  onChange={(e) => patchHealthMetric(currentDay.id, hi, { unit: e.target.value })}
                                  placeholder="e.g., L"
                                />
                                <Button variant="destructive" className={styles.miniBtn} onClick={() => removeHealthMetric(currentDay.id, hi)}>
                                  Remove
                                </Button>
                              </div>
                            </div>
                            <TextAreaField
                              label="Metric notes"
                              value={m?.notes || ''}
                              onChange={(e) => patchHealthMetric(currentDay.id, hi, { notes: e.target.value })}
                              placeholder="How to hit it, why it matters, what to do if missed…"
                              rows={3}
                            />
                          </div>
                        ))}
                        <TextAreaField
                          label="Health notes (day)"
                          value={currentDay.healthNotes || ''}
                          onChange={(e) => patchDay(currentDay.id, { healthNotes: e.target.value })}
                          placeholder="Recovery focus, stress management, wearable expectations…"
                          rows={4}
                        />
                      </>
                    ) : null}
                  </div>

                  <div className={styles.modalFooter}>
                    <Button className={styles.modalBtn} variant="secondary" onClick={() => setDayEditorOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {editorTab === 'publish' ? (
              <>
                <div className={styles.btnRow} style={{ marginTop: 0 }}>
                  <Button
                    className={styles.btn}
                    variant="secondary"
                    onClick={openTemplatesHub}
                  >
                    Templates…
                  </Button>
                </div>
                <div style={{ height: 10 }} />
                <div className={styles.checklistCard}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Publish checklist</div>
                  {publishChecklist.blockers.length === 0 ? (
                    <div className={styles.checklistItemOk}>Ready to publish.</div>
                  ) : (
                    publishChecklist.blockers.map((b, i) => (
                      <div key={`b_${i}`} className={styles.checklistItemBad}>• {b}</div>
                    ))
                  )}
                  {publishChecklist.warnings.length > 0 ? (
                    <div style={{ marginTop: 8 }}>
                      <div className={styles.muted} style={{ marginBottom: 4 }}>Warnings (you can still publish):</div>
                      {publishChecklist.warnings.map((w, i) => (
                        <div key={`w_${i}`} className={styles.checklistItemWarn}>• {w}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ height: 10 }} />
                <div className={styles.btnRow}>
                  <Button
                    className={styles.btn}
                    onClick={onPublish}
                    loading={publishing}
                    disabled={!draft?.id || publishing || publishChecklist.blockers.length > 0}
                  >
                    Publish
                  </Button>
                  <Button
                    className={styles.btn}
                    variant="secondary"
                    onClick={openEnrollments}
                    disabled={!draft?.id}
                  >
                    Enrollments
                  </Button>
                  <Button
                    className={styles.btn}
                    variant="secondary"
                    onClick={onArchive}
                    disabled={!draft?.id}
                  >
                    Archive
                  </Button>
                  <Button
                    className={styles.btn}
                    variant="destructive"
                    onClick={() => setDeleteProgramConfirm({ open: true, program: { id: draft?.id, title: draft?.title || 'Program' } })}
                    disabled={!draft?.id}
                  >
                    Delete
                  </Button>
                </div>
              </>
            ) : null}

            {/* Guided navigation: one clear primary action per step */}
            <div className={styles.wizardFooter}>
              <Button
                variant="secondary"
                className={styles.wizardBtn}
                onClick={goPrevEditorTab}
                disabled={editorTab === 'overview'}
              >
                Back
              </Button>
              <Button
                className={styles.wizardBtn}
                onClick={goNextEditorTab}
                disabled={editorTab === 'publish'}
              >
                {editorTab === 'overview' ? 'Next: Schedule' : editorTab === 'schedule' ? 'Next: Publish' : 'Done'}
              </Button>
            </div>

            <div className={styles.muted} style={{ marginTop: 10 }}>
              MVP behavior: free programs can be “claimed” by users. Paid checkout will be wired with Stripe Connect next.
            </div>
          </div>

          {showTemplatesEditor && (
            <TemplateEditor
              templates={Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []}
              onClose={() => {
                setShowTemplatesEditor(false)
                setProgramEditingTemplate(null)
              }}
              onSave={(t) => {
                templateOnSave(t)
                setProgramEditingTemplate(null)
              }}
              onDelete={templateOnDelete}
              onEdit={(t) => setProgramEditingTemplate(t)}
              editingTemplate={programEditingTemplate}
            />
          )}

          {templatesHubOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setTemplatesHubOpen(false)} role="dialog" aria-modal="true" aria-label="Templates">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Templates</h2>
                  <Button unstyled onClick={() => setTemplatesHubOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <div className={styles.muted}>
                    Program templates ship with this program. “My templates” are your personal Fitness library.
                  </div>
                  <div className={styles.btnRow} style={{ marginTop: 10 }}>
                    <Button className={styles.btn} onClick={openProgramTemplatesEditor}>
                      Manage program templates ({Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0})
                    </Button>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => {
                        setTemplatesHubOpen(false)
                        openNewProgramTemplate()
                      }}
                    >
                      Create new program template
                    </Button>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => {
                        setTemplatesHubOpen(false)
                        openImportFromMyTemplates()
                      }}
                    >
                      Import from My templates
                    </Button>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => navigate('/fitness', { state: { openTemplates: true } })}
                    >
                      Open My templates
                    </Button>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => {
                        setTemplatesHubOpen(false)
                        exportProgramTemplatesToFitness()
                      }}
                    >
                      Export program templates → Fitness
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {bulkActionsOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setBulkActionsOpen(false)} role="dialog" aria-modal="true" aria-label="Bulk actions">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Bulk actions</h2>
                  <Button unstyled onClick={() => setBulkActionsOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <div className={styles.btnRow} style={{ marginTop: 0 }}>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => {
                        setBulkActionsOpen(false)
                        const lastIdx = weekGroups.length > 0 ? weekGroups[weekGroups.length - 1].index : 0
                        setDuplicateWeekIndex(lastIdx)
                        setDuplicateWeekCopies('1')
                        setDuplicateWeekOpen(true)
                      }}
                      disabled={dayPlans.length === 0}
                    >
                      Duplicate week…
                    </Button>
                    <Button
                      className={styles.btn}
                      variant="secondary"
                      onClick={() => {
                        setBulkActionsOpen(false)
                        setBulkApplyTemplateId('')
                        setBulkApplyDayIds([])
                        setBulkApplyTemplateOpen(true)
                      }}
                      disabled={dayPlans.length === 0 || (Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates.length : 0) === 0}
                    >
                      Apply workout template to days…
                    </Button>
                  </div>
                  <div className={styles.muted} style={{ marginTop: 8 }}>
                    Tip: Use “Copy meals from…” inside a day to reuse meal plans.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {duplicateWeekOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setDuplicateWeekOpen(false)} role="dialog" aria-modal="true" aria-label="Duplicate week">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Duplicate a week</h2>
                  <Button unstyled onClick={() => setDuplicateWeekOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <SelectField
                    label="Week"
                    value={String(duplicateWeekIndex)}
                    onChange={(e) => setDuplicateWeekIndex(Number(e.target.value) || 0)}
                  >
                    {weekGroups.map((w) => (
                      <option key={w.index} value={String(w.index)}>
                        Week {w.index + 1} (Days {w.firstDay}–{w.lastDay})
                      </option>
                    ))}
                    {weekGroups.length === 0 ? <option value="0">Week 1</option> : null}
                  </SelectField>
                  <div style={{ height: 10 }} />
                  <InputField
                    label="Copies"
                    inputMode="numeric"
                    value={duplicateWeekCopies}
                    onChange={(e) => setDuplicateWeekCopies(e.target.value)}
                    placeholder="1"
                  />
                  <div className={styles.muted} style={{ marginTop: 6 }}>
                    This appends the selected week to the end of the program.
                  </div>
                  <div style={{ height: 12 }} />
                  <div className={styles.btnRow}>
                    <Button
                      className={styles.btn}
                      onClick={() => {
                        duplicateWeek(duplicateWeekIndex, duplicateWeekCopies)
                        setDuplicateWeekOpen(false)
                      }}
                      disabled={dayPlans.length === 0}
                    >
                      Duplicate
                    </Button>
                    <Button className={styles.btn} variant="secondary" onClick={() => setDuplicateWeekOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {bulkApplyTemplateOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setBulkApplyTemplateOpen(false)} role="dialog" aria-modal="true" aria-label="Apply workout template">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Apply template to days</h2>
                  <Button unstyled onClick={() => setBulkApplyTemplateOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <SelectField
                    label="Workout template"
                    value={bulkApplyTemplateId}
                    onChange={(e) => setBulkApplyTemplateId(e.target.value)}
                  >
                    <option value="">Choose a program template</option>
                    {(Array.isArray(draft.content?.workoutTemplates) ? draft.content.workoutTemplates : []).map((t) => (
                      <option key={t.id} value={t.id}>{t.name || 'Template'}</option>
                    ))}
                  </SelectField>
                  <div style={{ height: 8 }} />
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Days</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <Button variant="secondary" className={styles.miniBtn} onClick={() => setBulkApplyDayIds(dayPlans.map(d => d.id))} disabled={dayPlans.length === 0}>
                      Select all
                    </Button>
                    <Button variant="secondary" className={styles.miniBtn} onClick={() => setBulkApplyDayIds([])} disabled={bulkApplyDayIds.length === 0}>
                      Clear
                    </Button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflow: 'auto' }}>
                    {dayPlans.map((d) => {
                      const checked = bulkApplyDayIds.includes(d.id)
                      return (
                        <label key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...bulkApplyDayIds, d.id]
                                : bulkApplyDayIds.filter(x => x !== d.id)
                              setBulkApplyDayIds(next)
                            }}
                          />
                          <span>Day {d.dayNumber}{d.title ? ` — ${d.title}` : ''}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ height: 12 }} />
                  <div className={styles.btnRow}>
                    <Button
                      className={styles.btn}
                      onClick={() => {
                        if (!bulkApplyTemplateId || bulkApplyDayIds.length === 0) {
                          showToast('Choose a template and at least one day.', 'error')
                          return
                        }
                        updateDayPlans((current) => current.map((d) => {
                          if (!bulkApplyDayIds.includes(d.id)) return d
                          return { ...d, workout: { ...(d.workout || {}), templateId: bulkApplyTemplateId } }
                        }))
                        setBulkApplyTemplateOpen(false)
                        showToast('Applied template to selected days.', 'success', 1800)
                      }}
                      disabled={!bulkApplyTemplateId || bulkApplyDayIds.length === 0}
                    >
                      Apply
                    </Button>
                    <Button className={styles.btn} variant="secondary" onClick={() => setBulkApplyTemplateOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {copyMealsOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setCopyMealsOpen(false)} role="dialog" aria-modal="true" aria-label="Copy meals">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Copy meals from another day</h2>
                  <Button unstyled onClick={() => setCopyMealsOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <SelectField
                    label="Source day"
                    value={copyMealsSourceDayId}
                    onChange={(e) => setCopyMealsSourceDayId(e.target.value)}
                  >
                    <option value="">Choose a day</option>
                    {dayPlans
                      .filter(d => d.id !== copyMealsTargetDayId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          Day {d.dayNumber}{d.title ? ` — ${d.title}` : ''}
                        </option>
                      ))}
                  </SelectField>
                  <div className={styles.muted} style={{ marginTop: 8 }}>
                    This replaces the current day’s meals. You can still edit everything after copying.
                  </div>
                  <div style={{ height: 12 }} />
                  <div className={styles.btnRow}>
                    <Button
                      className={styles.btn}
                      onClick={() => {
                        if (!copyMealsTargetDayId || !copyMealsSourceDayId) {
                          showToast('Choose a source day.', 'error')
                          return
                        }
                        const src = dayPlans.find(d => d.id === copyMealsSourceDayId) || null
                        const nextMeals = deepClone(Array.isArray(src?.meals) ? src.meals : [])
                        patchDay(copyMealsTargetDayId, { meals: nextMeals })
                        setCopyMealsOpen(false)
                        showToast('Meals copied.', 'success', 1500)
                      }}
                      disabled={!copyMealsSourceDayId}
                    >
                      Copy meals
                    </Button>
                    <Button className={styles.btn} variant="secondary" onClick={() => setCopyMealsOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {enrollmentsOpen ? (
            <div className={styles.modalOverlay} onMouseDown={() => setEnrollmentsOpen(false)} role="dialog" aria-modal="true" aria-label="Program enrollments">
              <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Enrollments</h2>
                  <Button unstyled onClick={() => setEnrollmentsOpen(false)}>✕</Button>
                </div>
                <div className={styles.modalBody}>
                  <div className={styles.muted}>
                    Coaches can see enrollment records for their programs. More detailed “stats” (adherence, workouts completed, nutrition/health) can be layered on next.
                  </div>
                  <div style={{ height: 10 }} />
                  {enrollmentsLoading ? (
                    <div className={styles.muted}>Loading…</div>
                  ) : enrollments.length === 0 ? (
                    <div className={styles.muted}>No enrollments yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {enrollments.map((r) => (
                        <div key={r.id} className={styles.card} style={{ padding: 12 }}>
                          <div style={{ fontWeight: 900 }}>{String(r.user_id)}</div>
                          <div className={styles.muted} style={{ marginTop: 4 }}>
                            Start: {String(r.start_date || '')} · Scheduled: {Number(r.scheduled_count || 0)}
                          </div>
                          <div className={styles.muted} style={{ marginTop: 4 }}>
                            Updated: {r.updated_at ? new Date(r.updated_at).toLocaleString() : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.modalFooter}>
                  <Button className={styles.modalBtn} variant="secondary" onClick={() => setEnrollmentsOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

        {importTemplateOpen ? (
          <div className={styles.modalOverlay} onMouseDown={() => setImportTemplateOpen(false)} role="dialog" aria-modal="true" aria-label="Import template">
            <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Import from My templates</h2>
                <Button unstyled onClick={() => setImportTemplateOpen(false)}>✕</Button>
              </div>
              <div className={styles.modalBody}>
                <SearchField
                  value={myTemplateSearch}
                  onChange={(e) => setMyTemplateSearch(e.target.value)}
                  placeholder="Search your templates…"
                  onClear={() => setMyTemplateSearch('')}
                />
                <div className={styles.muted}>
                  This copies a Fitness template into the program so it can ship with the plan.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(Array.isArray(myTemplates) ? myTemplates : [])
                    .filter(t => {
                      const q = (myTemplateSearch || '').toString().toLowerCase().trim()
                      if (!q) return true
                      return (t?.name || '').toString().toLowerCase().includes(q)
                    })
                    .map((t) => (
                      <Button
                        key={t.id}
                        variant="secondary"
                        className={styles.btn}
                        onClick={() => importMyTemplateIntoProgram(t)}
                      >
                        {t.name || 'Template'}
                      </Button>
                    ))}
                  {(Array.isArray(myTemplates) ? myTemplates : []).length === 0 ? (
                    <div className={styles.muted}>No templates found in your library yet. Create one in Fitness → Templates.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {foodSearchOpen ? (
          <div
            className={styles.modalOverlay}
            style={{ zIndex: 12000 }}
            onMouseDown={() => setFoodSearchOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Search foods"
          >
            <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Search foods</h2>
                <Button unstyled onClick={() => setFoodSearchOpen(false)}>✕</Button>
              </div>
              <div className={styles.modalBody}>
                <SearchField
                  value={foodSearchQuery}
                  onChange={(e) => setFoodSearchQuery(e.target.value)}
                  placeholder="Search food library…"
                  onClear={() => setFoodSearchQuery('')}
                  autoFocus
                />
                <div className={styles.muted}>
                  Pick a food to fill the item (name + macros). Adjust grams anytime.
                </div>
                {foodSearchLoading ? (
                  <div className={styles.muted}>Searching…</div>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(Array.isArray(foodSearchResults) ? foodSearchResults : []).slice(0, 40).map((f) => {
                    const cals = Number(f?.calories_per_100g) || 0
                    const p = Number(f?.protein_per_100g) || 0
                    const c = Number(f?.carbs_per_100g) || 0
                    const fat = Number(f?.fat_per_100g) || 0
                    return (
                      <Button
                        key={f.id || f.name}
                        variant="secondary"
                        className={styles.btn}
                        onClick={() => {
                          const target = foodSearchTarget
                          if (!target) return
                          const { dayId, mealIndex, itemIndex } = target
                          const currentItems = Array.isArray(currentDay?.meals?.[mealIndex]?.items) ? currentDay.meals[mealIndex].items : []
                          const existingGrams = currentItems?.[itemIndex]?.grams
                          const grams = Number(existingGrams) > 0 ? Number(existingGrams) : 100
                          const scaled = computeScaledFood(f, grams)
                          patchMealItem(dayId, mealIndex, itemIndex, {
                            food: f?.name || '',
                            grams: String(grams),
                            calories: String(Math.round(scaled.calories)),
                            proteinG: String(Math.round(scaled.protein)),
                            carbsG: String(Math.round(scaled.carbs)),
                            fatG: String(Math.round(scaled.fat))
                          })
                          setFoodSearchOpen(false)
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
                          <span style={{ fontWeight: 800 }}>{f?.name || 'Food'}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                            {Math.round(cals)} cal · P {Math.round(p)} · C {Math.round(c)} · F {Math.round(fat)} (per 100g)
                          </span>
                        </div>
                      </Button>
                    )
                  })}
                  {(Array.isArray(foodSearchResults) ? foodSearchResults : []).length === 0 && !foodSearchLoading ? (
                    <div className={styles.muted}>No results. Try a different search.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

          <ConfirmDialog
            isOpen={deleteProgramConfirm.open}
            title="Delete program?"
            message={deleteProgramConfirm.program?.title ? `Delete "${deleteProgramConfirm.program.title}"? This cannot be undone.` : 'Delete this program? This cannot be undone.'}
            confirmText="Delete"
            cancelText="Cancel"
            isDestructive
            onClose={() => setDeleteProgramConfirm({ open: false, program: null })}
            onConfirm={() => onDeleteProgram(deleteProgramConfirm.program)}
          />

          <ConfirmDialog
            isOpen={discardConfirm.open}
            title="Discard unsaved changes?"
            message="You have unsaved changes. Discard them?"
            confirmText="Discard"
            cancelText="Keep editing"
            isDestructive
            onClose={() => setDiscardConfirm({ open: false, action: null, payload: null })}
            onConfirm={() => {
              const action = discardConfirm.action
              const payload = discardConfirm.payload
              setDiscardConfirm({ open: false, action: null, payload: null })
              try {
                action?.(payload)
              } catch {
                // ignore
              }
            }}
          />

          <ConfirmDialog
            isOpen={weeklyScheduleConfirm.open}
            title="Generate from weekly schedule?"
            message={`This will replace your current day-by-day plan (${dayPlans.length} days). Continue?`}
            confirmText="Generate"
            cancelText="Cancel"
            isDestructive
            onClose={() => setWeeklyScheduleConfirm({ open: false })}
            onConfirm={() => {
              setWeeklyScheduleConfirm({ open: false })
              try {
                generateDayPlansFromWeeklyPattern()
              } catch (e) {
                logError('Weekly schedule generation failed', e)
                showToast('Failed to generate schedule. Please try again.', 'error')
              }
            }}
          />
        </>
      )}
    </div>
  )
}


