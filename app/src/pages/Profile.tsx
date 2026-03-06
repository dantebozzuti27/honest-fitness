import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportUserDataJSON, exportWorkoutsCSV, exportHealthMetricsCSV, downloadData } from '../lib/dataExport'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { connectFitbit } from '../lib/fitbitAuth'
import { getUserPreferences, saveUserPreferences } from '../lib/db/userPreferencesDb'
import { deleteUserAccount } from '../lib/accountDeletion'
import { supabase } from '../lib/supabase'
import { getTodayEST } from '../utils/dateUtils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import BackButton from '../components/BackButton'
import InputField from '../components/InputField'
import SelectField from '../components/SelectField'
import Button from '../components/Button'
import { logError } from '../utils/logger'
import styles from './Profile.module.css'

interface PerformanceGoal {
  exercise: string;
  targetWeight: string;
  targetReps: string;
}

interface TrainingProfileData {
  training_goal: string;
  session_duration_minutes: string;
  equipment_access: string;
  available_days_per_week: string;
  job_activity_level: string;
  injuries: Array<{ body_part: string; description: string; severity: string }>;
  exercises_to_avoid: string;
  performance_goals: PerformanceGoal[];
  preferred_split: string;
  date_of_birth: string;
  gender: string;
  height_feet: string;
  height_inches: string;
  body_weight_lbs: string;
  experience_level: string;
  cardio_preference: string;
  cardio_frequency_per_week: string;
  cardio_duration_minutes: string;
}

const GOAL_OPTIONS = [
  { value: '', label: 'Select goal...' },
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy (Muscle Growth)' },
  { value: 'general_fitness', label: 'General Fitness' },
  { value: 'fat_loss', label: 'Fat Loss' },
]

const EXPERIENCE_OPTIONS = [
  { value: '', label: 'Select level...' },
  { value: 'beginner', label: 'Beginner (< 1 year)' },
  { value: 'intermediate', label: 'Intermediate (1-3 years)' },
  { value: 'advanced', label: 'Advanced (3-7 years)' },
  { value: 'elite', label: 'Elite (7+ years / Competitive)' },
]

const GENDER_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

const CARDIO_OPTIONS = [
  { value: '', label: 'Select preference...' },
  { value: 'daily', label: 'Daily (part of every session)' },
  { value: 'most_days', label: 'Most days (4-6x/week)' },
  { value: 'few_days', label: 'A few days (2-3x/week)' },
  { value: 'minimal', label: 'Minimal (1x/week or less)' },
  { value: 'none', label: 'None' },
]

const EQUIPMENT_OPTIONS = [
  { value: '', label: 'Select access...' },
  { value: 'full_gym', label: 'Full Gym' },
  { value: 'home_gym', label: 'Home Gym' },
  { value: 'limited', label: 'Limited / Bodyweight' },
]

const ACTIVITY_OPTIONS = [
  { value: '', label: 'Select level...' },
  { value: 'sedentary', label: 'Sedentary (Desk Job)' },
  { value: 'lightly_active', label: 'Lightly Active' },
  { value: 'active', label: 'Active (On Feet)' },
  { value: 'very_active', label: 'Very Active (Manual Labor)' },
]

const DAYS_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: '2', label: '2 days' },
  { value: '3', label: '3 days' },
  { value: '4', label: '4 days' },
  { value: '5', label: '5 days' },
  { value: '6', label: '6 days' },
  { value: '7', label: '7 days' },
]

const SPLIT_OPTIONS = [
  { value: '', label: 'Auto-detect from history' },
  { value: 'push_pull_legs', label: 'Push / Pull / Legs' },
  { value: 'upper_lower', label: 'Upper / Lower' },
  { value: 'full_body', label: 'Full Body' },
  { value: 'bro_split', label: 'Bro Split (1 muscle/day)' },
  { value: 'custom', label: 'Custom' },
]

export default function Profile() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [exporting, setExporting] = useState(false)
  const [connectedAccounts, setConnectedAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [finalDeleteConfirmOpen, setFinalDeleteConfirmOpen] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [disconnectConfirm, setDisconnectConfirm] = useState<{ open: boolean; provider: string | null }>({ open: false, provider: null })
  const shownErrorsRef = useRef({ connected: false })

  const [trainingProfile, setTrainingProfile] = useState<TrainingProfileData>({
    training_goal: '',
    session_duration_minutes: '75',
    equipment_access: '',
    available_days_per_week: '',
    job_activity_level: '',
    injuries: [],
    exercises_to_avoid: '',
    performance_goals: [],
    preferred_split: '',
    date_of_birth: '',
    gender: '',
    height_feet: '',
    height_inches: '',
    body_weight_lbs: '',
    experience_level: '',
    cardio_preference: '',
    cardio_frequency_per_week: '',
    cardio_duration_minutes: '',
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [newInjury, setNewInjury] = useState({ body_part: '', description: '', severity: 'moderate' })
  const [newGoal, setNewGoal] = useState<PerformanceGoal>({ exercise: '', targetWeight: '', targetReps: '1' })

  useEffect(() => {
    if (user) {
      loadConnectedAccounts()
      loadTrainingProfile()
    }
  }, [user])

  const loadTrainingProfile = async () => {
    if (!user) return
    try {
      const prefs = await getUserPreferences(user.id)
      if (prefs) {
        const rawInjuries = prefs.injuries;
        const rawAvoid = prefs.exercises_to_avoid;
        const rawGoals = prefs.performance_goals;
        setTrainingProfile({
          training_goal: prefs.training_goal || '',
          session_duration_minutes: String(prefs.session_duration_minutes || 75),
          equipment_access: prefs.equipment_access || '',
          available_days_per_week: String(prefs.available_days_per_week || ''),
          job_activity_level: prefs.job_activity_level || '',
          injuries: Array.isArray(rawInjuries) ? rawInjuries : [],
          exercises_to_avoid: Array.isArray(rawAvoid) ? rawAvoid.join(', ') : (typeof rawAvoid === 'string' ? rawAvoid : ''),
          performance_goals: Array.isArray(rawGoals) ? rawGoals : [],
          preferred_split: prefs.preferred_split || '',
          date_of_birth: prefs.date_of_birth || '',
          gender: prefs.gender || '',
          height_feet: prefs.height_feet != null ? String(prefs.height_feet) : '',
          height_inches: prefs.height_inches != null ? String(prefs.height_inches) : '',
          body_weight_lbs: prefs.body_weight_lbs != null ? String(prefs.body_weight_lbs) : '',
          experience_level: prefs.experience_level || '',
          cardio_preference: prefs.cardio_preference || '',
          cardio_frequency_per_week: prefs.cardio_frequency_per_week != null ? String(prefs.cardio_frequency_per_week) : '',
          cardio_duration_minutes: prefs.cardio_duration_minutes != null ? String(prefs.cardio_duration_minutes) : '',
        })
      }
      setProfileLoaded(true)
    } catch (err) {
      logError('Training profile load error', err)
    }
  }

  const handleSaveTrainingProfile = async () => {
    if (!user) return
    setSavingProfile(true)
    try {
      const payload: Record<string, any> = {
        training_goal: trainingProfile.training_goal || null,
        session_duration_minutes: trainingProfile.session_duration_minutes ? Number(trainingProfile.session_duration_minutes) : null,
        equipment_access: trainingProfile.equipment_access || null,
        available_days_per_week: trainingProfile.available_days_per_week ? Number(trainingProfile.available_days_per_week) : null,
        job_activity_level: trainingProfile.job_activity_level || null,
        injuries: trainingProfile.injuries,
        exercises_to_avoid: trainingProfile.exercises_to_avoid
          ? trainingProfile.exercises_to_avoid.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        performance_goals: trainingProfile.performance_goals,
        preferred_split: trainingProfile.preferred_split || null,
        date_of_birth: trainingProfile.date_of_birth || null,
        gender: trainingProfile.gender || null,
        height_feet: trainingProfile.height_feet ? Number(trainingProfile.height_feet) : null,
        height_inches: trainingProfile.height_inches ? Number(trainingProfile.height_inches) : null,
        body_weight_lbs: trainingProfile.body_weight_lbs ? Number(trainingProfile.body_weight_lbs) : null,
        experience_level: trainingProfile.experience_level || null,
        cardio_preference: trainingProfile.cardio_preference || null,
        cardio_frequency_per_week: trainingProfile.cardio_frequency_per_week ? Number(trainingProfile.cardio_frequency_per_week) : null,
        cardio_duration_minutes: trainingProfile.cardio_duration_minutes ? Number(trainingProfile.cardio_duration_minutes) : null,
      }
      await saveUserPreferences(user.id, payload)
      showToast('Training profile saved', 'success')
    } catch (err) {
      logError('Training profile save error', err)
      showToast('Failed to save training profile', 'error')
    }
    setSavingProfile(false)
  }

  const addInjury = () => {
    if (!newInjury.body_part) return
    setTrainingProfile(prev => ({
      ...prev,
      injuries: [...prev.injuries, { ...newInjury }],
    }))
    setNewInjury({ body_part: '', description: '', severity: 'moderate' })
  }

  const removeInjury = (idx: number) => {
    setTrainingProfile(prev => ({
      ...prev,
      injuries: prev.injuries.filter((_, i) => i !== idx),
    }))
  }

  const loadConnectedAccounts = async () => {
    if (!user) return
    try {
      const accounts = await getAllConnectedAccounts(user.id)
      setConnectedAccounts(accounts || [])
    } catch (error) {
      logError('Connected accounts load error', error)
      if (!shownErrorsRef.current.connected) {
        shownErrorsRef.current.connected = true
        showToast('Failed to load connected accounts.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleConnectFitbit = async () => {
    if (!user) return
    try {
      await connectFitbit(user.id)
    } catch (error) {
      logError('Fitbit connect error', error)
      showToast('Failed to connect Fitbit. Please try again.', 'error')
    }
  }

  const handleDisconnect = async (provider: string) => {
    setDisconnectConfirm({ open: true, provider })
  }

  const confirmDisconnect = async () => {
    if (!user || !disconnectConfirm.provider) {
      setDisconnectConfirm({ open: false, provider: null })
      return
    }
    try {
      await disconnectAccount(user.id, disconnectConfirm.provider)
      await loadConnectedAccounts()
      showToast(`${disconnectConfirm.provider} disconnected`, 'success')
    } catch (error) {
      showToast('Failed to disconnect. Please try again.', 'error')
    } finally {
      setDisconnectConfirm({ open: false, provider: null })
    }
  }

  const handleExport = async (format = 'json') => {
    if (!user) return
    setExporting(true)
    try {
      if (format === 'json') {
        const data = await exportUserDataJSON(user.id)
        downloadData(data, `honest-fitness-data-${getTodayEST()}.json`, 'application/json')
        showToast('All data exported as JSON!', 'success')
      } else if (format === 'workouts-csv') {
        const csv = await exportWorkoutsCSV(user.id)
        downloadData(csv, `workouts-${getTodayEST()}.csv`, 'text/csv')
        showToast('Workouts exported as CSV!', 'success')
      } else if (format === 'metrics-csv') {
        const csv = await exportHealthMetricsCSV(user.id)
        downloadData(csv, `health-metrics-${getTodayEST()}.csv`, 'text/csv')
        showToast('Health metrics exported as CSV!', 'success')
      }
      setShowExportMenu(false)
    } catch (err) {
      logError('Export error', err)
      showToast('Failed to export data.', 'error')
    }
    setExporting(false)
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/auth')
  }

  const handleDeleteAccount = () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }
    if (deleteConfirmText !== 'DELETE') {
      showToast('Please type "DELETE" to confirm', 'error')
      return
    }
    setFinalDeleteConfirmOpen(true)
  }

  const performDeleteAccount = async () => {
    if (!user) return
    setDeleting(true)
    try {
      await deleteUserAccount(user.id)
      await signOut()
      showToast('Account permanently deleted.', 'success', 6000)
      navigate('/auth')
    } catch (error) {
      logError('Account deletion error', error)
      showToast('Failed to delete account.', 'error', 7000)
      setDeleting(false)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      setFinalDeleteConfirmOpen(false)
    }
  }

  const fitbitAccount = connectedAccounts.find((a: any) => a.provider === 'fitbit')

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Settings</h1>
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.content} style={{ paddingBottom: '120px' }}>
        {user && (
          <>
            {/* Account */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Account</h2>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {user.email}
              </div>
            </section>

            {/* Fitbit Connection */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Fitbit</h2>
              {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading...</div>
              ) : fitbitAccount ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: 'var(--success)', fontWeight: 600, fontSize: '14px' }}>Connected</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {fitbitAccount.provider_email || 'Fitbit account'}
                    </div>
                  </div>
                  <Button variant="destructive" onClick={() => handleDisconnect('fitbit')}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div>
                  <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    Connect Fitbit to automatically sync steps, sleep, and heart rate data.
                  </p>
                  <Button onClick={handleConnectFitbit}>Connect Fitbit</Button>
                </div>
              )}
            </section>

            {/* Training Profile */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Training Profile</h2>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
                Used by the workout generator to build personalized workouts.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <SelectField
                  label="Training Goal"
                  value={trainingProfile.training_goal}
                  onChange={e => setTrainingProfile(p => ({ ...p, training_goal: e.target.value }))}
                  options={GOAL_OPTIONS}
                />
                <SelectField
                  label="Equipment Access"
                  value={trainingProfile.equipment_access}
                  onChange={e => setTrainingProfile(p => ({ ...p, equipment_access: e.target.value }))}
                  options={EQUIPMENT_OPTIONS}
                />
                <SelectField
                  label="Available Days Per Week"
                  value={trainingProfile.available_days_per_week}
                  onChange={e => setTrainingProfile(p => ({ ...p, available_days_per_week: e.target.value }))}
                  options={DAYS_OPTIONS}
                />
                <InputField
                  label="Session Duration (minutes)"
                  type="number"
                  value={trainingProfile.session_duration_minutes}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, session_duration_minutes: e.target.value }))}
                />
                <SelectField
                  label="Experience Level"
                  value={trainingProfile.experience_level}
                  onChange={e => setTrainingProfile(p => ({ ...p, experience_level: e.target.value }))}
                  options={EXPERIENCE_OPTIONS}
                />
                <SelectField
                  label="Job Activity Level"
                  value={trainingProfile.job_activity_level}
                  onChange={e => setTrainingProfile(p => ({ ...p, job_activity_level: e.target.value }))}
                  options={ACTIVITY_OPTIONS}
                />

                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '-4px', marginTop: '4px' }}>
                  Body Stats
                </label>
                <SelectField
                  label="Gender"
                  value={trainingProfile.gender}
                  onChange={e => setTrainingProfile(p => ({ ...p, gender: e.target.value }))}
                  options={GENDER_OPTIONS}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <InputField
                      label="Height (ft)"
                      type="number"
                      value={trainingProfile.height_feet}
                      onChange={(e: any) => setTrainingProfile(p => ({ ...p, height_feet: e.target.value }))}
                      placeholder="5"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <InputField
                      label="Height (in)"
                      type="number"
                      value={trainingProfile.height_inches}
                      onChange={(e: any) => setTrainingProfile(p => ({ ...p, height_inches: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                </div>
                <InputField
                  label="Body Weight (lbs)"
                  type="number"
                  value={trainingProfile.body_weight_lbs}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, body_weight_lbs: e.target.value }))}
                  placeholder="185"
                />
                <InputField
                  label="Date of Birth"
                  type="date"
                  value={trainingProfile.date_of_birth}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, date_of_birth: e.target.value }))}
                />

                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '-4px', marginTop: '4px' }}>
                  Cardio
                </label>
                <SelectField
                  label="Cardio Preference"
                  value={trainingProfile.cardio_preference}
                  onChange={e => setTrainingProfile(p => ({ ...p, cardio_preference: e.target.value }))}
                  options={CARDIO_OPTIONS}
                />
                {trainingProfile.cardio_preference && trainingProfile.cardio_preference !== 'none' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <InputField
                        label="Cardio Sessions/Week"
                        type="number"
                        value={trainingProfile.cardio_frequency_per_week}
                        onChange={(e: any) => setTrainingProfile(p => ({ ...p, cardio_frequency_per_week: e.target.value }))}
                        placeholder="7"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <InputField
                        label="Duration (min)"
                        type="number"
                        value={trainingProfile.cardio_duration_minutes}
                        onChange={(e: any) => setTrainingProfile(p => ({ ...p, cardio_duration_minutes: e.target.value }))}
                        placeholder="60"
                      />
                    </div>
                  </div>
                )}

                <InputField
                  label="Exercises to Avoid (comma-separated)"
                  value={trainingProfile.exercises_to_avoid}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, exercises_to_avoid: e.target.value }))}
                  placeholder="e.g. Behind Neck Press, Good Morning"
                />
                <SelectField
                  label="Preferred Split"
                  value={trainingProfile.preferred_split}
                  onChange={e => setTrainingProfile(p => ({ ...p, preferred_split: e.target.value }))}
                  options={SPLIT_OPTIONS}
                />

                {/* Performance Goals */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Performance Goals
                  </label>
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    Set specific lift targets. The engine will prioritize these exercises and track your progress toward them.
                  </p>
                  {trainingProfile.performance_goals.length > 0 && (
                    <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {trainingProfile.performance_goals.map((goal, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '13px' }}>
                          <span style={{ color: 'var(--text-primary)' }}>
                            <strong>{goal.exercise}</strong> — {goal.targetWeight} lbs × {goal.targetReps} rep{Number(goal.targetReps) !== 1 ? 's' : ''}
                          </span>
                          <button onClick={() => setTrainingProfile(p => ({ ...p, performance_goals: p.performance_goals.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input
                      placeholder="Exercise (e.g. Bench Press)"
                      value={newGoal.exercise}
                      onChange={e => setNewGoal(p => ({ ...p, exercise: e.target.value }))}
                      style={{ flex: '2 1 140px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <input
                      placeholder="Weight (lbs)"
                      type="number"
                      value={newGoal.targetWeight}
                      onChange={e => setNewGoal(p => ({ ...p, targetWeight: e.target.value }))}
                      style={{ flex: '1 1 80px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <input
                      placeholder="Reps"
                      type="number"
                      value={newGoal.targetReps}
                      onChange={e => setNewGoal(p => ({ ...p, targetReps: e.target.value }))}
                      style={{ flex: '0 0 60px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!newGoal.exercise || !newGoal.targetWeight) return
                        setTrainingProfile(p => ({ ...p, performance_goals: [...p.performance_goals, { ...newGoal }] }))
                        setNewGoal({ exercise: '', targetWeight: '', targetReps: '1' })
                      }}
                      disabled={!newGoal.exercise || !newGoal.targetWeight}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    >Add</Button>
                  </div>
                </div>

                {/* Injuries */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '8px' }}>
                    Injuries / Limitations
                  </label>
                  {trainingProfile.injuries.length > 0 && (
                    <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {trainingProfile.injuries.map((inj, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '13px' }}>
                          <span style={{ color: 'var(--text-primary)' }}>
                            <strong>{inj.body_part}</strong> — {inj.description} ({inj.severity})
                          </span>
                          <button onClick={() => removeInjury(i)} style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <input
                      placeholder="Body part"
                      value={newInjury.body_part}
                      onChange={e => setNewInjury(p => ({ ...p, body_part: e.target.value }))}
                      style={{ flex: '1 1 100px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <input
                      placeholder="Description"
                      value={newInjury.description}
                      onChange={e => setNewInjury(p => ({ ...p, description: e.target.value }))}
                      style={{ flex: '2 1 140px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <select
                      value={newInjury.severity}
                      onChange={e => setNewInjury(p => ({ ...p, severity: e.target.value }))}
                      style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    >
                      <option value="mild">Mild</option>
                      <option value="moderate">Moderate</option>
                      <option value="severe">Severe</option>
                    </select>
                    <Button variant="secondary" onClick={addInjury} disabled={!newInjury.body_part} style={{ padding: '8px 12px', fontSize: '13px' }}>Add</Button>
                  </div>
                </div>

                <Button onClick={handleSaveTrainingProfile} loading={savingProfile} disabled={savingProfile}>
                  Save Training Profile
                </Button>
              </div>
            </section>

            {/* Data Export */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--text-primary)' }}>Export Data</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button variant="secondary" onClick={() => handleExport('json')} loading={exporting} disabled={exporting}>
                  Export All Data (JSON)
                </Button>
                <Button variant="secondary" onClick={() => handleExport('workouts-csv')} loading={exporting} disabled={exporting}>
                  Export Workouts (CSV)
                </Button>
                <Button variant="secondary" onClick={() => handleExport('metrics-csv')} loading={exporting} disabled={exporting}>
                  Export Health Metrics (CSV)
                </Button>
              </div>
            </section>

            {/* Sign Out */}
            <section style={{ padding: '16px', margin: '0 16px 16px' }}>
              <Button variant="secondary" onClick={handleLogout} style={{ width: '100%' }}>
                Sign Out
              </Button>
            </section>

            {/* Danger Zone */}
            <section style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', margin: '0 16px 16px', border: '1px solid var(--danger, #ef4444)' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: 'var(--danger, #ef4444)' }}>Danger Zone</h2>
              {!showDeleteConfirm ? (
                <Button variant="destructive" onClick={handleDeleteAccount}>
                  Delete Account
                </Button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
                    This will permanently delete all your data. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <InputField
                    label=""
                    value={deleteConfirmText}
                    onChange={(e: any) => setDeleteConfirmText(e.target.value)}
                    placeholder='Type "DELETE"'
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="destructive" onClick={handleDeleteAccount} loading={deleting} disabled={deleteConfirmText !== 'DELETE'}>
                      Confirm Delete
                    </Button>
                    <Button variant="secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Disconnect confirmation */}
      <ConfirmDialog
        isOpen={disconnectConfirm.open}
        title={`Disconnect ${disconnectConfirm.provider}?`}
        message="This will stop syncing data from this device."
        confirmText="Disconnect"
        cancelText="Cancel"
        isDestructive
        onClose={() => setDisconnectConfirm({ open: false, provider: null })}
        onConfirm={confirmDisconnect}
      />

      {/* Final delete confirmation */}
      <ConfirmDialog
        isOpen={finalDeleteConfirmOpen}
        title="Permanently delete account?"
        message="This action cannot be undone. All your workouts, metrics, and data will be permanently deleted."
        confirmText="Delete Everything"
        cancelText="Cancel"
        isDestructive
        onClose={() => setFinalDeleteConfirmOpen(false)}
        onConfirm={performDeleteAccount}
      />

      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
    </div>
  )
}
