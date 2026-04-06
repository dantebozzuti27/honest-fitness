import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportUserDataJSON, exportWorkoutsCSV, exportHealthMetricsCSV, downloadData } from '../lib/dataExport'
import { getAllConnectedAccounts, disconnectAccount } from '../lib/wearables'
import { connectFitbit } from '../lib/fitbitAuth'
import { getUserPreferences, saveUserPreferences } from '../lib/db/userPreferencesDb'
import { ageRecoveryFactor } from '../lib/recoveryModel'
import { deleteUserAccount } from '../lib/accountDeletion'
import { getTodayEST } from '../utils/dateUtils'
import { getAllMetricsFromSupabase, saveMetricsToSupabase } from '../lib/db/metricsDb'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import BackButton from '../components/BackButton'
import InputField from '../components/InputField'
import SelectField from '../components/SelectField'
import Button from '../components/Button'
import { logError } from '../utils/logger'
import styles from './Profile.module.css'
import s from '../styles/shared.module.css'

interface PerformanceGoal {
  exercise: string;
  targetWeight: string;
  targetReps: string;
}

interface GymProfile {
  name: string;
  equipment: string[];
}

interface TrainingProfileData {
  training_goal: string;
  session_duration_minutes: string;
  equipment_access: string;
  available_days_per_week: string;
  job_activity_level: string;
  injuries: Array<{ body_part: string; description: string; severity: string }>;
  exercises_to_avoid: string[];
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
  recovery_speed: string;
  weight_goal_lbs: string;
  weight_goal_date: string;
  primary_goal: string;
  secondary_goal: string;
  priority_muscles: string[];
  weekday_deadlines: Record<string, string>;
  age: string;
  gym_profiles: GymProfile[];
  active_gym_profile: string;
  rest_days: number[];
  sport_focus: string;
  sport_season: string;
  hotel_mode: boolean;
}

const SPORT_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'golf', label: 'Golf' },
]

const SEASON_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'off_season', label: 'Off-Season (build strength)' },
  { value: 'pre_season', label: 'Pre-Season (ramp up)' },
  { value: 'in_season', label: 'In-Season (maintain)' },
]

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

const DURATION_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
  { value: '75', label: '75 min' },
  { value: '90', label: '90 min' },
  { value: '120', label: '120 min' },
]

const HEIGHT_FT_OPTIONS = [
  { value: '', label: 'ft' },
  { value: '4', label: "4'" },
  { value: '5', label: "5'" },
  { value: '6', label: "6'" },
  { value: '7', label: "7'" },
]

const HEIGHT_IN_OPTIONS = [
  { value: '', label: 'in' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `${i}"` })),
]

const CARDIO_FREQ_OPTIONS = [
  { value: '', label: 'Select...' },
  ...Array.from({ length: 7 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}x / week` })),
]

const CARDIO_DURATION_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: '15', label: '15 min' },
  { value: '20', label: '20 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
  { value: '90', label: '90 min' },
  { value: '120', label: '120 min' },
]

const REPS_OPTIONS = [
  ...Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` })),
]

const BODY_PART_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'Shoulder', label: 'Shoulder' },
  { value: 'Knee', label: 'Knee' },
  { value: 'Lower Back', label: 'Lower Back' },
  { value: 'Upper Back', label: 'Upper Back' },
  { value: 'Neck', label: 'Neck' },
  { value: 'Hip', label: 'Hip' },
  { value: 'Elbow', label: 'Elbow' },
  { value: 'Wrist', label: 'Wrist' },
  { value: 'Ankle', label: 'Ankle' },
  { value: 'Chest', label: 'Chest' },
  { value: 'Hamstring', label: 'Hamstring' },
  { value: 'Quad', label: 'Quad' },
  { value: 'Calf', label: 'Calf' },
  { value: 'Bicep', label: 'Bicep' },
  { value: 'Tricep', label: 'Tricep' },
  { value: 'Forearm', label: 'Forearm' },
  { value: 'Glute', label: 'Glute' },
  { value: 'Core / Abs', label: 'Core / Abs' },
  { value: 'Other', label: 'Other' },
]

const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
]

const RECOVERY_SPEED_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: '0.75', label: 'Slow (longer recovery needed)' },
  { value: '1.0', label: 'Normal (population average)' },
  { value: '1.5', label: 'Fast (well-conditioned)' },
  { value: '2.0', label: 'Very Fast (elite athlete)' },
  { value: '2.5', label: 'Extreme (daily training tolerance)' },
]

const PRIMARY_GOAL_OPTIONS = [
  { value: '', label: 'Select goal...' },
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'fat_loss', label: 'Fat Loss' },
  { value: 'endurance', label: 'Endurance' },
]

const MUSCLE_GROUPS = [
  { value: 'upper_chest', label: 'Upper Chest' },
  { value: 'mid_chest', label: 'Mid Chest' },
  { value: 'lower_chest', label: 'Lower Chest' },
  { value: 'back_lats', label: 'Lats' },
  { value: 'back_upper', label: 'Upper Back' },
  { value: 'upper_traps', label: 'Upper Traps' },
  { value: 'mid_traps', label: 'Mid Traps' },
  { value: 'lower_traps', label: 'Lower Traps' },
  { value: 'anterior_deltoid', label: 'Front Delt' },
  { value: 'lateral_deltoid', label: 'Side Delt' },
  { value: 'posterior_deltoid', label: 'Rear Delt' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'quadriceps', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'rotator_cuff', label: 'Rotator Cuff' },
  { value: 'hip_flexors', label: 'Hip Flexors' },
  { value: 'abductors', label: 'Hip Abductors' },
  { value: 'adductors', label: 'Hip Adductors' },
  { value: 'core', label: 'Core' },
  { value: 'forearms', label: 'Forearms' },
  { value: 'erector_spinae', label: 'Erectors' },
]

const GYM_EQUIPMENT_OPTIONS = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'cable', label: 'Cable' },
  { value: 'machine', label: 'Machine' },
  { value: 'pull_up_bar', label: 'Pull-up Bar' },
  { value: 'dip_station', label: 'Dip Station' },
  { value: 'smith_machine', label: 'Smith Machine' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'bands', label: 'Bands' },
  { value: 'bodyweight', label: 'Bodyweight' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
    session_duration_minutes: '120',
    equipment_access: '',
    available_days_per_week: '',
    job_activity_level: '',
    injuries: [],
    exercises_to_avoid: [],
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
    recovery_speed: '',
    weight_goal_lbs: '',
    weight_goal_date: '',
    primary_goal: '',
    secondary_goal: '',
    priority_muscles: [],
    weekday_deadlines: {},
    age: '',
    gym_profiles: [],
    active_gym_profile: '',
    rest_days: [],
    sport_focus: '',
    sport_season: '',
    hotel_mode: false,
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [newInjury, setNewInjury] = useState({ body_part: '', description: '', severity: 'moderate' })
  const [newGymProfile, setNewGymProfile] = useState<GymProfile>({ name: '', equipment: [] })
  const [newGoal, setNewGoal] = useState<PerformanceGoal>({ exercise: '', targetWeight: '', targetReps: '1' })
  const [exerciseNames, setExerciseNames] = useState<string[]>([])
  const [avoidSearch, setAvoidSearch] = useState('')

  useEffect(() => {
    fetch('/api/ping').catch(() => {})
    // Keep the serverless container warm while the user is on this page.
    // Vercel Hobby can freeze functions within seconds of inactivity.
    const keepalive = setInterval(() => { fetch('/api/ping').catch(() => {}) }, 25_000)

    if (user) {
      loadConnectedAccounts()
      loadTrainingProfile()
      loadExerciseNames()
      loadLatestWeight()
    }
    return () => clearInterval(keepalive)
  }, [user])

  const loadExerciseNames = async () => {
    try {
      const { getAllExercises } = await import('../db/lazyDb')
      const exercises = await getAllExercises()
      const names = (exercises || [])
        .map((e: any) => e?.name)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b))
      setExerciseNames([...new Set(names)] as string[])
    } catch {
      // exercises will just be empty
    }
  }

  const loadLatestWeight = async () => {
    if (!user) return
    try {
      const metrics = await getAllMetricsFromSupabase(user.id)
      if (Array.isArray(metrics) && metrics.length > 0) {
        const withWeight = metrics.filter((m: any) => m?.weight != null)
        if (withWeight.length > 0) {
          const latest = withWeight[withWeight.length - 1]
          setTrainingProfile(prev => {
            if (prev.body_weight_lbs) return prev
            return { ...prev, body_weight_lbs: String(latest.weight) }
          })
        }
      }
    } catch {
      // non-critical
    }
  }

  const loadTrainingProfile = async () => {
    if (!user) return
    try {
      const prefs = await getUserPreferences(user.id)
      if (prefs) {
        const rawInjuries = prefs.injuries;
        const rawAvoid = prefs.exercises_to_avoid;
        const rawGoals = prefs.performance_goals;
        const avoidArr: string[] = Array.isArray(rawAvoid)
          ? rawAvoid
          : typeof rawAvoid === 'string' && rawAvoid.trim()
            ? rawAvoid.split(',').map((s: string) => s.trim()).filter(Boolean)
            : []
        setTrainingProfile({
          training_goal: prefs.training_goal || '',
          session_duration_minutes: String(Number(prefs.session_duration_minutes || 120)),
          equipment_access: prefs.equipment_access || '',
          available_days_per_week: String(prefs.available_days_per_week || ''),
          job_activity_level: prefs.job_activity_level || '',
          injuries: Array.isArray(rawInjuries) ? rawInjuries : [],
          exercises_to_avoid: avoidArr,
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
          recovery_speed: prefs.recovery_speed != null ? String(prefs.recovery_speed) : '',
          weight_goal_lbs: prefs.weight_goal_lbs != null ? String(prefs.weight_goal_lbs) : '',
          weight_goal_date: prefs.weight_goal_date || '',
          primary_goal: prefs.primary_goal || '',
          secondary_goal: prefs.secondary_goal || '',
          priority_muscles: Array.isArray(prefs.priority_muscles) ? prefs.priority_muscles : [],
          weekday_deadlines: (prefs.weekday_deadlines && typeof prefs.weekday_deadlines === 'object') ? prefs.weekday_deadlines : {},
          age: prefs.age != null ? String(prefs.age) : '',
          gym_profiles: Array.isArray(prefs.gym_profiles) ? prefs.gym_profiles : [],
          active_gym_profile: prefs.active_gym_profile || '',
          rest_days: Array.isArray(prefs.rest_days) ? prefs.rest_days : [],
          sport_focus: prefs.sport_focus || '',
          sport_season: prefs.sport_season || '',
          hotel_mode: Boolean(prefs.hotel_mode),
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
    // Await pre-warm so the container is guaranteed warm before the save request
    await fetch('/api/ping').catch(() => {})
    try {
      const payload: Record<string, any> = {
        training_goal: trainingProfile.training_goal || null,
        session_duration_minutes: trainingProfile.session_duration_minutes
          ? Number(trainingProfile.session_duration_minutes)
          : 120,
        equipment_access: trainingProfile.equipment_access || null,
        available_days_per_week: trainingProfile.available_days_per_week ? Number(trainingProfile.available_days_per_week) : null,
        job_activity_level: trainingProfile.job_activity_level || null,
        injuries: trainingProfile.injuries,
        exercises_to_avoid: trainingProfile.exercises_to_avoid,
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
        recovery_speed: trainingProfile.recovery_speed ? Number(trainingProfile.recovery_speed) : null,
        weight_goal_lbs: trainingProfile.weight_goal_lbs ? Number(trainingProfile.weight_goal_lbs) : null,
        weight_goal_date: trainingProfile.weight_goal_date || null,
        primary_goal: trainingProfile.primary_goal || null,
        secondary_goal: trainingProfile.secondary_goal || null,
        priority_muscles: trainingProfile.priority_muscles.length > 0 ? trainingProfile.priority_muscles : null,
        weekday_deadlines: Object.values(trainingProfile.weekday_deadlines).some(v => v) ? trainingProfile.weekday_deadlines : null,
        age: trainingProfile.age ? Number(trainingProfile.age) : null,
        gym_profiles: trainingProfile.gym_profiles.length > 0 ? trainingProfile.gym_profiles : null,
        active_gym_profile: trainingProfile.active_gym_profile || null,
        rest_days: trainingProfile.rest_days.length > 0 ? trainingProfile.rest_days : null,
        sport_focus: trainingProfile.sport_focus || null,
        sport_season: trainingProfile.sport_season || null,
        hotel_mode: Boolean(trainingProfile.hotel_mode),
      }
      await saveUserPreferences(user.id, payload)

      // Write weight to health_metrics time-series so the trend computation stays current
      const weightLbs = trainingProfile.body_weight_lbs ? Number(trainingProfile.body_weight_lbs) : null
      if (weightLbs && weightLbs > 0) {
        try {
          await saveMetricsToSupabase(user.id, getTodayEST(), { weight: weightLbs }, { allowOutbox: false })
        } catch {
          // non-critical — profile was already saved
        }
      }

      showToast('Training profile saved', 'success')
    } catch (err: unknown) {
      logError('Training profile save error', err)
      const detail = err instanceof Error ? err.message : ''
      showToast(`Failed to save training profile${detail ? `: ${detail}` : ''}`, 'error')
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
                  label="Primary Goal"
                  value={trainingProfile.primary_goal}
                  onChange={e => setTrainingProfile(p => ({ ...p, primary_goal: e.target.value }))}
                  options={PRIMARY_GOAL_OPTIONS}
                />
                <SelectField
                  label="Secondary Goal"
                  value={trainingProfile.secondary_goal}
                  onChange={e => setTrainingProfile(p => ({ ...p, secondary_goal: e.target.value }))}
                  options={[
                    { value: '', label: 'None' },
                    ...PRIMARY_GOAL_OPTIONS.filter(o => o.value && o.value !== trainingProfile.primary_goal),
                  ]}
                />
                <SelectField
                  label="Equipment Access"
                  value={trainingProfile.equipment_access}
                  onChange={e => setTrainingProfile(p => ({ ...p, equipment_access: e.target.value }))}
                  options={EQUIPMENT_OPTIONS}
                />
                <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg-tertiary)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Hotel Mode</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        Restrict workouts to treadmill, bodyweight, and dumbbell exercises capped at 50 lbs.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={trainingProfile.hotel_mode}
                      onChange={e => setTrainingProfile(p => ({ ...p, hotel_mode: e.target.checked }))}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                  </label>
                </div>
                <SelectField
                  label="Available Days Per Week"
                  value={trainingProfile.available_days_per_week}
                  onChange={e => setTrainingProfile(p => ({ ...p, available_days_per_week: e.target.value }))}
                  options={DAYS_OPTIONS}
                />
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Rest Days
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {[
                      { value: 0, label: 'Sun' },
                      { value: 1, label: 'Mon' },
                      { value: 2, label: 'Tue' },
                      { value: 3, label: 'Wed' },
                      { value: 4, label: 'Thu' },
                      { value: 5, label: 'Fri' },
                      { value: 6, label: 'Sat' },
                    ].map(day => {
                      const selected = trainingProfile.rest_days.includes(day.value)
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              setTrainingProfile(p => ({ ...p, rest_days: p.rest_days.filter(d => d !== day.value) }))
                            } else {
                              setTrainingProfile(p => ({ ...p, rest_days: [...p.rest_days, day.value].sort() }))
                            }
                          }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '16px',
                            border: selected ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                            background: selected ? 'var(--accent, #3b82f6)' : 'var(--bg-tertiary)',
                            color: selected ? '#fff' : 'var(--text-primary)',
                            fontSize: '13px',
                            cursor: 'pointer',
                            fontWeight: selected ? 600 : 400,
                          }}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    No workouts will be generated on selected days
                  </p>
                </div>
                <SelectField
                  label="Session Duration"
                  value={trainingProfile.session_duration_minutes}
                  onChange={e => setTrainingProfile(p => ({ ...p, session_duration_minutes: e.target.value }))}
                  options={DURATION_OPTIONS}
                />
                <SelectField
                  label="Experience Level"
                  value={trainingProfile.experience_level}
                  onChange={e => setTrainingProfile(p => ({ ...p, experience_level: e.target.value }))}
                  options={EXPERIENCE_OPTIONS}
                />
                <SelectField
                  label="Preferred Split"
                  value={trainingProfile.preferred_split}
                  onChange={e => setTrainingProfile(p => ({ ...p, preferred_split: e.target.value }))}
                  options={SPLIT_OPTIONS}
                />
                <SelectField
                  label="Recovery Speed"
                  value={trainingProfile.recovery_speed}
                  onChange={e => setTrainingProfile(p => ({ ...p, recovery_speed: e.target.value }))}
                  options={RECOVERY_SPEED_OPTIONS}
                />
                <SelectField
                  label="Sport Focus"
                  value={trainingProfile.sport_focus}
                  onChange={e => setTrainingProfile(p => ({ ...p, sport_focus: e.target.value }))}
                  options={SPORT_OPTIONS}
                />
                {trainingProfile.sport_focus && (
                  <SelectField
                    label="Sport Season"
                    value={trainingProfile.sport_season}
                    onChange={e => setTrainingProfile(p => ({ ...p, sport_season: e.target.value }))}
                    options={SEASON_OPTIONS}
                  />
                )}
                <SelectField
                  label="Job Activity Level"
                  value={trainingProfile.job_activity_level}
                  onChange={e => setTrainingProfile(p => ({ ...p, job_activity_level: e.target.value }))}
                  options={ACTIVITY_OPTIONS}
                />

                {/* Priority Muscles */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Priority Muscles (extra volume, max 3)
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {MUSCLE_GROUPS.map(mg => {
                      const selected = trainingProfile.priority_muscles.includes(mg.value)
                      const atMax = trainingProfile.priority_muscles.length >= 3 && !selected
                      return (
                        <button
                          key={mg.value}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              setTrainingProfile(p => ({ ...p, priority_muscles: p.priority_muscles.filter(v => v !== mg.value) }))
                            } else if (!atMax) {
                              setTrainingProfile(p => ({ ...p, priority_muscles: [...p.priority_muscles, mg.value] }))
                            }
                          }}
                          disabled={atMax}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '16px',
                            border: selected ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                            background: selected ? 'var(--accent, #3b82f6)' : 'var(--bg-tertiary)',
                            color: selected ? '#fff' : atMax ? 'var(--text-tertiary)' : 'var(--text-primary)',
                            fontSize: '13px',
                            cursor: atMax ? 'not-allowed' : 'pointer',
                            opacity: atMax ? 0.5 : 1,
                          }}
                        >
                          {mg.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

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
                    <SelectField
                      label="Height (ft)"
                      value={trainingProfile.height_feet}
                      onChange={e => setTrainingProfile(p => ({ ...p, height_feet: e.target.value }))}
                      options={HEIGHT_FT_OPTIONS}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <SelectField
                      label="Height (in)"
                      value={trainingProfile.height_inches}
                      onChange={e => setTrainingProfile(p => ({ ...p, height_inches: e.target.value }))}
                      options={HEIGHT_IN_OPTIONS}
                    />
                  </div>
                </div>
                <InputField
                  label="Body Weight (lbs)"
                  type="number"
                  value={trainingProfile.body_weight_lbs}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, body_weight_lbs: e.target.value }))}
                  placeholder="Auto-filled from your logs"
                  inputMode="decimal"
                />
                <InputField
                  label="Date of Birth"
                  type="date"
                  value={trainingProfile.date_of_birth}
                  onChange={(e: any) => setTrainingProfile(p => ({ ...p, date_of_birth: e.target.value }))}
                />
                {!trainingProfile.date_of_birth && (
                  <InputField
                    label="Age (for heart rate zones)"
                    type="number"
                    value={trainingProfile.age}
                    onChange={(e: any) => setTrainingProfile(p => ({ ...p, age: e.target.value }))}
                    placeholder="e.g. 30"
                    inputMode="numeric"
                  />
                )}

                {/* Age impact summary */}
                {(() => {
                  let derivedAge: number | null = null;
                  if (trainingProfile.date_of_birth) {
                    const dob = new Date(trainingProfile.date_of_birth);
                    if (!isNaN(dob.getTime())) {
                      derivedAge = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                    }
                  } else if (trainingProfile.age) {
                    derivedAge = Number(trainingProfile.age);
                  }
                  if (derivedAge == null || derivedAge <= 0) return null;

                  const recoveryFactor = ageRecoveryFactor(derivedAge);
                  const volumeScale = derivedAge <= 25 ? 1.05 : derivedAge > 30 ? Math.max(0.80, 1.0 - (derivedAge - 30) * 0.005) : 1.0;
                  const progressionScale = derivedAge <= 25 ? 1.08 : derivedAge > 30 ? Math.max(0.75, 1.0 - (derivedAge - 30) * 0.008) : 1.0;
                  const maxHr = 220 - derivedAge;

                  const fmt = (v: number) => v >= 1 ? `+${((v - 1) * 100).toFixed(0)}%` : `${((v - 1) * 100).toFixed(0)}%`;
                  const items = [
                    { label: 'Max Heart Rate', value: `${maxHr} bpm` },
                    { label: 'Recovery Speed', value: fmt(recoveryFactor) },
                    { label: 'Volume Tolerance', value: fmt(volumeScale) },
                    { label: 'Progression Rate', value: fmt(progressionScale) },
                  ];

                  return (
                    <div className={s.cardCompact} style={{ marginTop: '4px', marginBottom: '4px' }}>
                      <div className={s.sectionLabel}>Age Impact (age {derivedAge})</div>
                      <table className={s.dataTable}>
                        <tbody>
                          {items.map(item => (
                            <tr key={item.label}>
                              <td>{item.label}</td>
                              <td>{item.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '-4px', marginTop: '4px' }}>
                  Weight Goal
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <InputField
                      label="Target Weight (lbs)"
                      type="number"
                      value={trainingProfile.weight_goal_lbs}
                      onChange={(e: any) => setTrainingProfile(p => ({ ...p, weight_goal_lbs: e.target.value }))}
                      placeholder="e.g. 195"
                      inputMode="decimal"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <InputField
                      label="Target Date"
                      type="date"
                      value={trainingProfile.weight_goal_date}
                      onChange={(e: any) => setTrainingProfile(p => ({ ...p, weight_goal_date: e.target.value }))}
                    />
                  </div>
                </div>

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
                      <SelectField
                        label="Sessions / Week"
                        value={trainingProfile.cardio_frequency_per_week}
                        onChange={e => setTrainingProfile(p => ({ ...p, cardio_frequency_per_week: e.target.value }))}
                        options={CARDIO_FREQ_OPTIONS}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <SelectField
                        label="Duration"
                        value={trainingProfile.cardio_duration_minutes}
                        onChange={e => setTrainingProfile(p => ({ ...p, cardio_duration_minutes: e.target.value }))}
                        options={CARDIO_DURATION_OPTIONS}
                      />
                    </div>
                  </div>
                )}

                {/* Weekday Deadlines */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Finish By (leave blank for no deadline)
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '6px' }}>
                    {DAY_LABELS.map((day, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', minWidth: '32px' }}>{day}</span>
                        <input
                          type="time"
                          value={trainingProfile.weekday_deadlines[String(i)] || ''}
                          onChange={e => setTrainingProfile(p => ({
                            ...p,
                            weekday_deadlines: { ...p.weekday_deadlines, [String(i)]: e.target.value },
                          }))}
                          style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gym Profiles */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Gym Profiles
                  </label>
                  {trainingProfile.gym_profiles.length > 0 && (
                    <>
                      <SelectField
                        label="Active Gym"
                        value={trainingProfile.active_gym_profile}
                        onChange={e => setTrainingProfile(p => ({ ...p, active_gym_profile: e.target.value }))}
                        options={[
                          { value: '', label: 'Select active gym...' },
                          ...trainingProfile.gym_profiles.map(gp => ({ value: gp.name, label: gp.name })),
                        ]}
                      />
                      <div style={{ marginTop: '8px', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {trainingProfile.gym_profiles.map((gp, i) => (
                          <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '13px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <strong style={{ color: 'var(--text-primary)' }}>{gp.name}</strong>
                              <button
                                onClick={() => setTrainingProfile(p => ({
                                  ...p,
                                  gym_profiles: p.gym_profiles.filter((_, idx) => idx !== i),
                                  active_gym_profile: p.active_gym_profile === gp.name ? '' : p.active_gym_profile,
                                }))}
                                style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                              >×</button>
                            </div>
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {gp.equipment.length > 0 ? gp.equipment.map(e => GYM_EQUIPMENT_OPTIONS.find(o => o.value === e)?.label || e).join(', ') : 'No equipment selected'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                    <input
                      placeholder="Gym name"
                      value={newGymProfile.name}
                      onChange={e => setNewGymProfile(p => ({ ...p, name: e.target.value }))}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {GYM_EQUIPMENT_OPTIONS.map(eq => {
                        const sel = newGymProfile.equipment.includes(eq.value)
                        return (
                          <button
                            key={eq.value}
                            type="button"
                            onClick={() => setNewGymProfile(p => ({
                              ...p,
                              equipment: sel ? p.equipment.filter(v => v !== eq.value) : [...p.equipment, eq.value],
                            }))}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '14px',
                              border: sel ? '1px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                              background: sel ? 'var(--accent, #3b82f6)' : 'var(--bg-primary)',
                              color: sel ? '#fff' : 'var(--text-primary)',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {eq.label}
                          </button>
                        )
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!newGymProfile.name.trim()) return
                        setTrainingProfile(p => ({ ...p, gym_profiles: [...p.gym_profiles, { ...newGymProfile, name: newGymProfile.name.trim() }] }))
                        setNewGymProfile({ name: '', equipment: [] })
                      }}
                      disabled={!newGymProfile.name.trim()}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    >Add Gym</Button>
                  </div>
                </div>

                {/* Exercises to Avoid — multi-select from library */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Exercises to Avoid
                  </label>
                  {trainingProfile.exercises_to_avoid.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      {trainingProfile.exercises_to_avoid.map((ex, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--bg-tertiary)', borderRadius: '16px', fontSize: '13px', color: 'var(--text-primary)' }}>
                          {ex}
                          <button
                            onClick={() => setTrainingProfile(p => ({ ...p, exercises_to_avoid: p.exercises_to_avoid.filter((_, idx) => idx !== i) }))}
                            style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    <input
                      placeholder="Search exercises..."
                      value={avoidSearch}
                      onChange={e => setAvoidSearch(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                    {avoidSearch.length >= 2 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '160px', overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', marginTop: '2px', zIndex: 10 }}>
                        {exerciseNames
                          .filter(n => n.toLowerCase().includes(avoidSearch.toLowerCase()) && !trainingProfile.exercises_to_avoid.includes(n))
                          .slice(0, 15)
                          .map(n => (
                            <div
                              key={n}
                              onClick={() => {
                                setTrainingProfile(p => ({ ...p, exercises_to_avoid: [...p.exercises_to_avoid, n] }))
                                setAvoidSearch('')
                              }}
                              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}
                            >
                              {n}
                            </div>
                          ))}
                        {exerciseNames.filter(n => n.toLowerCase().includes(avoidSearch.toLowerCase()) && !trainingProfile.exercises_to_avoid.includes(n)).length === 0 && (
                          <div style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--text-tertiary)' }}>No matches</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Performance Goals */}
                <div>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                    Performance Goals
                  </label>
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    Set specific lift targets. The engine will prioritize these exercises.
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
                    <div style={{ flex: '2 1 140px', position: 'relative' }}>
                      <select
                        value={newGoal.exercise}
                        onChange={e => setNewGoal(p => ({ ...p, exercise: e.target.value }))}
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                      >
                        <option value="">Select exercise...</option>
                        {exerciseNames.map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      placeholder="Weight (lbs)"
                      type="number"
                      inputMode="numeric"
                      value={newGoal.targetWeight}
                      onChange={e => setNewGoal(p => ({ ...p, targetWeight: e.target.value }))}
                      style={{ flex: '1 1 80px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <select
                      value={newGoal.targetReps}
                      onChange={e => setNewGoal(p => ({ ...p, targetReps: e.target.value }))}
                      style={{ flex: '0 0 60px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    >
                      {REPS_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label} rep{Number(o.value) !== 1 ? 's' : ''}</option>
                      ))}
                    </select>
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
                            <strong>{inj.body_part}</strong>{inj.description ? ` — ${inj.description}` : ''} ({inj.severity})
                          </span>
                          <button onClick={() => removeInjury(i)} style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <select
                      value={newInjury.body_part}
                      onChange={e => setNewInjury(p => ({ ...p, body_part: e.target.value }))}
                      style={{ flex: '1 1 100px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    >
                      {BODY_PART_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      placeholder="Description (optional)"
                      value={newInjury.description}
                      onChange={e => setNewInjury(p => ({ ...p, description: e.target.value }))}
                      style={{ flex: '2 1 140px', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    />
                    <select
                      value={newInjury.severity}
                      onChange={e => setNewInjury(p => ({ ...p, severity: e.target.value }))}
                      style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '13px' }}
                    >
                      {SEVERITY_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
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

            {/* How It Works */}
            <section style={{ padding: '16px', margin: '0 16px 16px' }}>
              <Button variant="secondary" onClick={() => navigate('/how-it-works')} style={{ width: '100%' }}>
                How the Model Works
              </Button>
            </section>

            {/* ML Pipeline Dashboard */}
            <section style={{ padding: '16px', margin: '0 16px 16px' }}>
              <Button variant="secondary" onClick={() => navigate('/model')} style={{ width: '100%' }}>
                ML Pipeline Dashboard
              </Button>
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
