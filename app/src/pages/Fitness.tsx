import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getAllTemplates, saveTemplate, deleteTemplate } from '../db/lazyDb'
import { getWorkoutsFromSupabase, deleteWorkoutFromSupabase } from '../lib/db/workoutsDb'
import { getPausedWorkoutFromSupabase, deletePausedWorkoutFromSupabase } from '../lib/db/pausedWorkoutsDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logDebug, logError, logWarn } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import ExercisePicker from '../components/ExercisePicker'
import TemplateEditor, { type TemplateRow } from '../components/TemplateEditor'
import HistoryCard from '../components/HistoryCard'
import { FitnessIcon } from '../components/Icons'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import SearchField from '../components/SearchField'
import BackButton from '../components/BackButton'
import styles from './Fitness.module.css'

const TABS = ['Workout', 'Templates', 'History']

type FitnessTab = (typeof TABS)[number]

function normalizeToTemplateRow(raw: unknown): TemplateRow {
  const r = raw as Record<string, unknown>
  return {
    ...r,
    id: String(r?.id ?? ''),
    name: String(r?.name ?? ''),
    exercises: r?.exercises
  } as TemplateRow
}

type PausedWorkout = {
  exercises?: unknown[]
  workout_time?: number | null
  paused_at?: string | null
  [key: string]: unknown
}

type WorkoutRow = {
  id: string
  date?: string
  duration?: number | null
  template_name?: string | null
  perceived_effort?: string | null
  mood_after?: string | null
  notes?: string | null
  workout_calories_burned?: number | null
  workout_steps?: number | null
  workout_exercises?: Array<{
    exercise_name?: string
    name?: string
    category?: string
    stacked?: boolean
    stack_group?: string | null
    workout_sets?: Array<{
      is_bodyweight?: boolean
      weight_label?: string | null
      weight?: number | string | null
      reps?: number | string | null
      time?: number | string | null
      speed?: number | string | null
      incline?: number | string | null
    }>
  }>
  [key: string]: unknown
}

type ConfirmState = {
  open: boolean
  title: string
  message: string
  action: 'delete_template' | 'delete_workout' | null
  payload: unknown
}

export default function Fitness() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<FitnessTab>('Workout')
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TemplateRow | null>(null)
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutRow[]>([])
  const [historyPageSize, setHistoryPageSize] = useState(30)
  const [historyExerciseQuery, setHistoryExerciseQuery] = useState('')
  const { toast, showToast, hideToast } = useToast()
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, title: '', message: '', action: null, payload: null })
  const [showWorkoutStartModal, setShowWorkoutStartModal] = useState(false)
  const [showTemplateSelection, setShowTemplateSelection] = useState(false)
  const subscriptionRef = useRef<{ workoutsChannel?: RealtimeChannel } | null>(null)
  const hasShownHistoryLoadErrorRef = useRef(false)
  const hasShownInitialLoadErrorRef = useRef(false)
  const [pausedWorkout, setPausedWorkout] = useState<PausedWorkout | null>(null)

  const loadTemplates = useCallback(async () => {
    try {
      const t = await getAllTemplates()
      setTemplates(Array.isArray(t) ? t.map(normalizeToTemplateRow) : [])
    } catch {
      setTemplates([])
    }
  }, [])

  const loadWorkoutHistory = useCallback(async () => {
    if (!user) return
    try {
      const workouts = await getWorkoutsFromSupabase(user.id)
      setWorkoutHistory((Array.isArray(workouts) ? workouts : []) as WorkoutRow[])
      setHistoryPageSize(30)
    } catch (e) {
      logError('Error loading workout history', e)
      if (!hasShownHistoryLoadErrorRef.current) {
        hasShownHistoryLoadErrorRef.current = true
        showToast('Failed to load workout history.', 'error')
      }
    }
  }, [user, showToast])

  const sortedWorkoutHistory = useMemo(() => {
    const list = Array.isArray(workoutHistory) ? workoutHistory.slice() : []
    return list.sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
  }, [workoutHistory])

  const historyTopExerciseChips = useMemo(() => {
    const counts = new Map()
    for (const w of Array.isArray(workoutHistory) ? workoutHistory : []) {
      for (const ex of Array.isArray(w?.workout_exercises) ? w.workout_exercises : []) {
        const name = (ex?.exercise_name || ex?.name || '').toString().trim()
        if (!name) continue
        counts.set(name, (counts.get(name) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]: any) => name)
  }, [workoutHistory])

  const filteredWorkoutHistory = useMemo(() => {
    const q = (historyExerciseQuery || '').toString().trim().toLowerCase()
    if (q.length < 2) return sortedWorkoutHistory
    const tokens = q.split(/\s+/).filter(Boolean)
    const matches = (w: WorkoutRow) => {
      const exs = Array.isArray(w?.workout_exercises) ? w.workout_exercises : []
      if (exs.length === 0) return false
      return exs.some((ex: any) => {
        const name = (ex?.exercise_name || ex?.name || '').toString().toLowerCase()
        if (!name) return false
        return tokens.every((t: string) => name.includes(t))
      })
    }
    return sortedWorkoutHistory.filter(matches)
  }, [historyExerciseQuery, sortedWorkoutHistory])

  const pagedWorkoutHistory = useMemo(() => {
    const list = Array.isArray(filteredWorkoutHistory) ? filteredWorkoutHistory : []
    const n = Number(historyPageSize)
    const size = Number.isFinite(n) ? Math.max(10, Math.min(300, n)) : 30
    return list.slice(0, size)
  }, [filteredWorkoutHistory, historyPageSize])

  const repeatYesterdayTemplate = useCallback(async () => {
    if (!user?.id) return
    try {
      const y = getYesterdayEST()
      const yesterday = (Array.isArray(workoutHistory) ? workoutHistory : []).find(w => String(w?.date || '') === String(y))
      if (!yesterday) {
        showToast('No workout found for yesterday.', 'info')
        return
      }
      const exs = Array.isArray(yesterday?.workout_exercises) ? yesterday.workout_exercises : []
      if (exs.length === 0) {
        showToast('Yesterday\'s workout had no exercises.', 'info')
        return
      }
      const template = {
        id: `repeat-${y}-${Date.now()}`,
        name: `Repeat: ${y}`,
        exercises: exs.map((ex: any) => {
          const name = (ex?.exercise_name || ex?.name || '').toString().trim()
          const setCount = Array.isArray(ex?.workout_sets) ? ex.workout_sets.length : 0
          const repsFromLast = (() => {
            const first = Array.isArray(ex?.workout_sets) ? ex.workout_sets.find((s: any) => s?.reps) : null
            return first?.reps ? String(first.reps) : ''
          })()
          const weightFromLast = (() => {
            const first = Array.isArray(ex?.workout_sets) ? ex.workout_sets.find((s: any) => s?.weight) : null
            return first?.weight ? String(first.weight) : ''
          })()
          return {
            name: name || 'Exercise',
            sets: Math.max(1, Math.min(12, setCount || 4)),
            reps: repsFromLast ? `${repsFromLast}` : '8-12',
            time: '',
            notes: weightFromLast ? `Last: ${repsFromLast || ''}\u00d7${weightFromLast}`.trim() : '',
            stackGroup: null
          }
        })
      }
      await saveTemplate(template)
      showToast('Template created from yesterday. Starting now\u2026', 'success', 1400)
      navigate('/workout/active', { state: { mode: 'template', sessionType: 'workout', templateId: template.id } })
    } catch (e) {
      logError('Repeat yesterday workout failed', e)
      showToast('Failed to repeat yesterday.', 'error')
    }
  }, [user?.id, workoutHistory, showToast, navigate])

  const loadPausedWorkout = useCallback(async () => {
    if (!user) return
    try {
      const paused = await getPausedWorkoutFromSupabase(user.id)
      setPausedWorkout((paused || null) as any)
    } catch (e) {
      const code = (e as any)?.code
      const message = (e as any)?.message
      if (code !== 'PGRST205' && !String(message || '').includes('Could not find the table')) {
        logError('Error loading paused workout', e)
      }
      setPausedWorkout(null)
    }
  }, [user])

  const handleResumePausedWorkout = () => {
    if (pausedWorkout) {
      navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout', resumePaused: true } })
    }
  }

  const handleDismissPausedWorkout = async () => {
    if (!user || !pausedWorkout) return
    try {
      const result = await deletePausedWorkoutFromSupabase(user.id)
      try {
        localStorage.removeItem(`pausedWorkout_${user.id}`)
        localStorage.removeItem('pausedWorkout')
      } catch {}
      if (result && (result as any).deleted === false) {
        throw new Error('Paused workout could not be deleted')
      }
      setPausedWorkout(null)
      showToast('Paused workout dismissed', 'info')
    } catch (error) {
      logError('Error dismissing paused workout', error)
      showToast('Failed to dismiss paused workout', 'error')
    }
  }

  useEffect(() => {
    if (location.state?.openWorkoutModal) {
      setShowWorkoutStartModal(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
    if (location.state?.openTemplates) {
      setActiveTab('Templates')
      setShowTemplateEditor(true)
      navigate(location.pathname, { replace: true, state: {} })
    }

    async function load() {
      const t = await getAllTemplates()
      setTemplates(Array.isArray(t) ? t.map(normalizeToTemplateRow) : [])
      if (user) {
        try {
          const workouts = await getWorkoutsFromSupabase(user.id)
          setWorkoutHistory(workouts as WorkoutRow[])
        } catch (e) {
          logError('Fitness initial load failed', e)
          if (!hasShownInitialLoadErrorRef.current) {
            hasShownInitialLoadErrorRef.current = true
            showToast('Failed to load data. Please refresh.', 'error')
          }
        }
      }
    }
    load()
    loadPausedWorkout()
  }, [user, location.state, loadPausedWorkout])

  useEffect(() => {
    const handleTemplatesUpdated = () => loadTemplates()
    window.addEventListener('templatesUpdated', handleTemplatesUpdated)
    return () => window.removeEventListener('templatesUpdated', handleTemplatesUpdated)
  }, [loadTemplates])

  useEffect(() => {
    if (!user) return
    const sb = supabase
    if (!sb) return
    
    const workoutsChannel = sb
      .channel(`fitness_workouts_changes_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workouts', filter: `user_id=eq.${user.id}` },
        () => loadWorkoutHistory()
      )
      .subscribe()

    subscriptionRef.current = { workoutsChannel }
    
    const handleWorkoutSaved = () => setTimeout(() => loadWorkoutHistory(), 500)
    window.addEventListener('workoutSaved', handleWorkoutSaved)
    
    const handleVisibilityChange = () => {
      if (!document.hidden) { loadWorkoutHistory(); loadTemplates() }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('workoutSaved', handleWorkoutSaved)
      if (subscriptionRef.current?.workoutsChannel) {
        sb.removeChannel(subscriptionRef.current.workoutsChannel)
        subscriptionRef.current = null
      }
    }
  }, [user, loadWorkoutHistory, loadTemplates])

  useEffect(() => {
    if (user && (location.pathname === '/fitness' || location.pathname === '/workout')) {
      const t = setTimeout(() => loadWorkoutHistory(), 100)
      return () => clearTimeout(t)
    }
  }, [location.pathname, user, loadWorkoutHistory])

  useEffect(() => {
    if (user && activeTab === 'History') loadWorkoutHistory()
  }, [activeTab, user, loadWorkoutHistory])

  const startWorkout = async (templateId: string | null, random = false) => {
    if (random) {
      navigate('/workout/active', { state: { mode: 'random', sessionType: 'workout' } })
      return
    }
    if (templateId) {
      navigate('/workout/active', { state: { mode: 'template', sessionType: 'workout', templateId } })
      return
    }
    navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout' } })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton />
        <h1>Fitness</h1>
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <Button
            unstyled
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab as FitnessTab)}
          >
            {tab}
          </Button>
        ))}
      </div>

      <div className={styles.content}>
        {activeTab === 'Workout' && (
          <div>
            {pausedWorkout && (
              <div className={styles.pausedWorkoutBanner}>
                <div className={styles.pausedWorkoutInfo}>
                  <span className={styles.pausedWorkoutIcon}>{'\u23F8'}</span>
                  <div className={styles.pausedWorkoutDetails}>
                    <div className={styles.pausedWorkoutTitle}>Paused Workout</div>
                    <div className={styles.pausedWorkoutSubtext}>
                      {(pausedWorkout.exercises as any[])?.length || 0} exercises {'\u2022'} {Math.floor((pausedWorkout.workout_time || 0) / 60)} min
                    </div>
                  </div>
                </div>
                <div className={styles.pausedWorkoutActions}>
                  <Button unstyled className={styles.resumePausedBtn} onClick={handleResumePausedWorkout}>Resume</Button>
                  <Button unstyled className={styles.dismissPausedBtn} onClick={handleDismissPausedWorkout} title="Dismiss">{'\u00d7'}</Button>
                </div>
              </div>
            )}

            <Button unstyled className={styles.startWorkoutBtn} onClick={() => setShowWorkoutStartModal(true)}>
              Start Workout
            </Button>

            {showWorkoutStartModal && (
              <div className={styles.workoutStartModalOverlay} onClick={() => { setShowWorkoutStartModal(false); setShowTemplateSelection(false) }}>
                <div className={styles.workoutStartModal} onClick={(e) => e.stopPropagation()}>
                  {!showTemplateSelection ? (
                    <>
                      <h3>Choose Workout Type</h3>
                      <div className={styles.workoutTypeOptions}>
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => { setShowWorkoutStartModal(false); navigate('/today-workout') }}>
                          AI Generated
                        </Button>
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => setShowTemplateSelection(true)}>
                          Choose Template
                        </Button>
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => { setShowWorkoutStartModal(false); startWorkout(null, false) }}>
                          Freestyle
                        </Button>
                      </div>
                      <Button unstyled className={styles.closeModalBtn} onClick={() => { setShowWorkoutStartModal(false); setShowTemplateSelection(false) }}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className={styles.modalHeader}>
                        <Button unstyled className={styles.backBtn} onClick={() => setShowTemplateSelection(false)} aria-label="Back">{'\u2190'}</Button>
                        <h3 className={styles.modalTitle}>Choose Template</h3>
                        <Button unstyled className={styles.closeModalBtn} onClick={() => { setShowWorkoutStartModal(false); setShowTemplateSelection(false) }} aria-label="Close">{'\u2715'}</Button>
                      </div>
                      <div className={styles.templateSelectionList}>
                        {templates.length === 0 ? (
                          <EmptyState title="No templates yet" message="Create a template in the Templates tab." actionLabel="Open templates" onAction={() => { setShowWorkoutStartModal(false); setShowTemplateSelection(false); setActiveTab('Templates') }} />
                        ) : (
                          templates.map(template => (
                            <Button unstyled key={template.id} className={styles.templateSelectionBtn} onClick={() => { setShowWorkoutStartModal(false); setShowTemplateSelection(false); startWorkout(template.id, false) }}>
                              <div className={styles.templateSelectionContent}>
                                <span className={styles.templateSelectionName}>{template.name}</span>
                                <span className={styles.templateSelectionCount}>{Array.isArray(template.exercises) ? (template.exercises as any[]).length : 0} exercises</span>
                              </div>
                            </Button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'Templates' && (
          <div>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Templates</h2>
              <Button unstyled className={styles.manageBtn} onClick={() => setShowTemplateEditor(true)}>Manage</Button>
            </div>
            <div className={styles.templateList}>
              {templates.map(template => (
                <div key={template.id} className={styles.templateItem}>
                  <Button unstyled className={styles.templateBtn} onClick={() => { setActiveTab('Workout'); startWorkout(template.id, false) }}>
                    <span className={styles.templateName}>{template.name}</span>
                    <span className={styles.templateCount}>{Array.isArray(template.exercises) ? (template.exercises as any[]).length : 0} exercises</span>
                  </Button>
                  <div className={styles.templateActions}>
                    <Button unstyled className={styles.editTemplateBtn} onClick={() => { setEditingTemplate(template); setShowTemplateEditor(true) }} title="Edit">Edit</Button>
                    <Button unstyled className={styles.deleteTemplateBtn} onClick={() => setConfirmState({ open: true, title: 'Delete template?', message: `Delete "${template.name}"?`, action: 'delete_template', payload: { templateId: template.id } })} title="Delete">Delete</Button>
                  </div>
                </div>
              ))}
              <Button unstyled className={styles.freestyleBtn} onClick={() => { setActiveTab('Workout'); startWorkout(null, false) }}>
                Freestyle Workout
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'History' && (
          <div className={styles.historyContent}>
            {/* Stats Bar */}
            {workoutHistory.length > 0 && (
              <div style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '4px',
              }}>
                <span style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                }}>
                  {workoutHistory.length} sessions
                </span>
                {(() => {
                  const totalMins = workoutHistory.reduce((s: number, w: any) => s + Math.floor((w?.duration || 0) / 60), 0)
                  return (
                    <span style={{
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}>
                      {totalMins >= 60 ? `${(totalMins / 60).toFixed(0)}h ${totalMins % 60}m` : `${totalMins}m`} total
                    </span>
                  )
                })()}
                {(() => {
                  const totalVol = workoutHistory.reduce((s: number, w: any) => {
                    const exs = Array.isArray(w?.workout_exercises) ? w.workout_exercises : []
                    return s + exs.reduce((es: number, ex: any) => {
                      const sets = Array.isArray(ex?.workout_sets) ? ex.workout_sets : []
                      return es + sets.reduce((ss: number, set: any) => {
                        const wt = Number(set?.weight)
                        const rp = Number(set?.reps)
                        return ss + (Number.isFinite(wt) && wt > 0 && Number.isFinite(rp) && rp > 0 ? wt * rp : 0)
                      }, 0)
                    }, 0)
                  }, 0)
                  if (totalVol <= 0) return null
                  return (
                    <span style={{
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}>
                      {totalVol >= 1_000_000 ? `${(totalVol / 1_000_000).toFixed(1)}M` : `${(totalVol / 1000).toFixed(0)}k`} lbs lifted
                    </span>
                  )
                })()}
              </div>
            )}

            <div className={styles.historyQuickActions}>
              <Button variant="secondary" onClick={() => repeatYesterdayTemplate()}>Repeat yesterday</Button>
            </div>
            <div className={styles.historySearch}>
              <SearchField value={historyExerciseQuery} onChange={(e: any) => setHistoryExerciseQuery(e.target.value)} onClear={() => setHistoryExerciseQuery('')} placeholder="Search by exercise\u2026" />
              {historyTopExerciseChips.length > 0 && (
                <div className={styles.historyChips}>
                  {historyTopExerciseChips.map((name: string) => (
                    <button key={name} type="button" className={styles.historyChip} onClick={() => setHistoryExerciseQuery(name)} title={`Filter by ${name}`}>{name}</button>
                  ))}
                </div>
              )}
              {historyExerciseQuery.trim().length >= 2 && (
                <div className={styles.historySearchMeta}>
                  Showing {filteredWorkoutHistory.length} session{filteredWorkoutHistory.length === 1 ? '' : 's'} matching &ldquo;{historyExerciseQuery.trim()}&rdquo;
                </div>
              )}
            </div>
            {workoutHistory.length === 0 ? (
              <EmptyState icon={<FitnessIcon size={24} />} title="No sessions yet" message="Log a workout to see your history here." actionLabel="Start workout" onAction={() => navigate('/workout/active', { state: { mode: 'picker', sessionType: 'workout' } })} />
            ) : (
              <div className={styles.historyCards}>
                {pagedWorkoutHistory.map((workout, index) => {
                  const previousWorkout = pagedWorkoutHistory[index + 1]
                  return (
                    <HistoryCard
                      key={workout.id}
                      type="fitness"
                      date={workout.date}
                      data={workout}
                      previousData={previousWorkout}
                      index={index}
                      onDelete={async () => setConfirmState({ open: true, title: 'Delete session?', message: `Delete session from ${workout.date}?`, action: 'delete_workout', payload: { workoutId: workout.id } })}
                    />
                  )
                })}
                {filteredWorkoutHistory.length > pagedWorkoutHistory.length && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                    <Button variant="secondary" onClick={() => setHistoryPageSize(s => (Number(s) || 30) + 30)}>Load more</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showTemplateEditor && (
          <TemplateEditor
            templates={templates}
            onClose={() => { setShowTemplateEditor(false); setEditingTemplate(null) }}
            onSave={async (template: TemplateRow) => {
              await saveTemplate(template)
              const updated = await getAllTemplates()
              setTemplates(Array.isArray(updated) ? updated.map(normalizeToTemplateRow) : [])
              setEditingTemplate(null)
            }}
            onDelete={async (id: string) => setConfirmState({ open: true, title: 'Delete template?', message: 'Delete this template?', action: 'delete_template', payload: { templateId: id } })}
            onEdit={(template: TemplateRow | null) => setEditingTemplate(template)}
            editingTemplate={editingTemplate}
          />
        )}

        {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}

        <ConfirmDialog
          isOpen={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.action?.startsWith('delete') ? 'Delete' : 'Confirm'}
          cancelText="Cancel"
          isDestructive={!!confirmState.action?.startsWith('delete')}
          onClose={() => setConfirmState({ open: false, title: '', message: '', action: null, payload: null })}
          onConfirm={async () => {
            const action = confirmState.action
            const payload = confirmState.payload
            try {
              if (action === 'delete_template') {
                const templateId = (payload as any)?.templateId
                if (!templateId) return
                await deleteTemplate(templateId)
                const updated = await getAllTemplates()
                setTemplates(Array.isArray(updated) ? updated.map(normalizeToTemplateRow) : [])
                showToast('Template deleted', 'success')
              } else if (action === 'delete_workout') {
                const workoutId = (payload as any)?.workoutId
                if (!workoutId || !user) return
                await deleteWorkoutFromSupabase(workoutId, user.id)
                await loadWorkoutHistory()
                showToast('Workout deleted', 'success')
              }
            } catch (e) {
              logError('Action failed', e)
              showToast('Action failed. Please try again.', 'error')
            } finally {
              setConfirmState({ open: false, title: '', message: '', action: null, payload: null })
            }
          }}
        />
      </div>
    </div>
  )
}
