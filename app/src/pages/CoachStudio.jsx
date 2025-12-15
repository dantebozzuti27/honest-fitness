import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import InputField from '../components/InputField'
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
      notes: ''
    }
  }
}

export default function CoachStudio() {
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingProgram, setSavingProgram] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [programs, setPrograms] = useState([])

  const [coachDisplayName, setCoachDisplayName] = useState('')
  const [coachBio, setCoachBio] = useState('')

  const [draft, setDraft] = useState(emptyDraft())
  const [showTemplatesEditor, setShowTemplatesEditor] = useState(false)

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
    setDraft(emptyDraft())
  }

  const onEditProgram = (p) => {
    setDraft({
      id: p.id,
      title: p.title || '',
      description: p.description || '',
      priceCents: Number(p.priceCents || 0),
      currency: p.currency || 'usd',
      tags: Array.isArray(p.tags) ? p.tags : [],
      content: p.content || emptyDraft().content
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
          <div className={styles.card}>
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


