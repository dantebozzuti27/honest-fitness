import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getIdToken } from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
import styles from './Nutrition.module.css'

interface ParsedFood {
  name: string
  quantity: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

interface ParsedMeal {
  meal_name: string
  foods: ParsedFood[]
  total_calories: number
  total_protein_g: number
  total_carbs_g: number
  total_fat_g: number
  total_fiber_g: number
}

interface MealLog {
  id: string
  meal_name: string
  meal_time: string | null
  foods: ParsedFood[]
  total_calories: number
  total_protein_g: number
  total_carbs_g: number
  total_fat_g: number
  total_fiber_g: number
  notes: string | null
  source: string
  created_at: string
}

interface DailyTotals {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

interface Targets {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

interface WeightGoalInfo {
  target_lbs: number
  target_date: string
  lbs_to_goal: number | null
  weeks_remaining: number | null
  weekly_rate_lbs: number
  timeline_status: string | null
}

interface FitbitData {
  avg_steps: number | null
  avg_sleep_hours: number | null
  avg_active_minutes: number | null
  avg_calories_burned: number | null
}

interface PhysiqueData {
  body_fat_pct: number | null
  lean_mass_lbs: number | null
  shoulder_to_waist_ratio: number | null
  weak_points: string[]
  assessment_date: string
}

interface TargetsResponse {
  targets: Targets | null
  phase: string
  body_weight_lbs: number
  bmr: number
  bmr_method?: 'katch_mcardle' | 'mifflin_st_jeor'
  tdee: number
  tdee_source?: 'fitbit' | 'estimated'
  tdee_estimated?: number
  tdee_fitbit?: number | null
  caloric_adjustment?: number
  fitbit?: FitbitData | null
  physique?: PhysiqueData | null
  weight_goal?: WeightGoalInfo | null
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-')
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2])
  const today = new Date()
  const todayStr = localDateStr(today)
  if (dateStr === todayStr) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === localDateStr(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const token = await getIdToken().catch(() => '')
  const resp = await fetch(apiUrl(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

export default function Nutrition() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState(localDateStr(new Date()))
  const [meals, setMeals] = useState<MealLog[]>([])
  const [totals, setTotals] = useState<DailyTotals>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 })
  const [targets, setTargets] = useState<Targets | null>(null)
  const [phase, setPhase] = useState<string>('maintain')
  const [weightGoal, setWeightGoal] = useState<WeightGoalInfo | null>(null)
  const [caloricAdjustment, setCaloricAdjustment] = useState<number>(0)
  const [tdeeSource, setTdeeSource] = useState<string>('estimated')
  const [fitbitData, setFitbitData] = useState<FitbitData | null>(null)
  const [tdeeValue, setTdeeValue] = useState<number>(0)
  const [bmrMethod, setBmrMethod] = useState<string>('mifflin_st_jeor')
  const [physiqueData, setPhysiqueData] = useState<PhysiqueData | null>(null)
  const [loading, setLoading] = useState(true)

  // AI parse state
  const [inputText, setInputText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedMeal | null>(null)
  const [saving, setSaving] = useState(false)

  // Quick add state
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickCal, setQuickCal] = useState('')
  const [quickProtein, setQuickProtein] = useState('')
  const [quickCarbs, setQuickCarbs] = useState('')
  const [quickFat, setQuickFat] = useState('')

  const loadDay = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const data = await apiFetch(`/api/nutrition/daily?date=${date}`)
      setMeals(data.meals ?? [])
      setTotals(data.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 })
    } catch (err) {
      console.error('Failed to load nutrition:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTargets = useCallback(async () => {
    try {
      const data: TargetsResponse = await apiFetch('/api/nutrition/targets')
      if (data.targets) setTargets(data.targets)
      if (data.phase) setPhase(data.phase)
      setWeightGoal(data.weight_goal ?? null)
      setCaloricAdjustment(data.caloric_adjustment ?? 0)
      setTdeeSource(data.tdee_source ?? 'estimated')
      setFitbitData(data.fitbit ?? null)
      setTdeeValue(data.tdee ?? 0)
      setBmrMethod(data.bmr_method ?? 'mifflin_st_jeor')
      setPhysiqueData(data.physique ?? null)
    } catch (err) {
      console.error('Failed to load targets:', err)
    }
  }, [])

  useEffect(() => {
    if (user) {
      loadDay(selectedDate)
      loadTargets()
    }
  }, [user, selectedDate, loadDay, loadTargets])

  const shiftDate = (delta: number) => {
    const parts = selectedDate.split('-')
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2])
    d.setDate(d.getDate() + delta)
    setSelectedDate(localDateStr(d))
    setParsed(null)
  }

  const handleParse = async () => {
    if (!inputText.trim()) return
    setParsing(true)
    try {
      const data = await apiFetch('/api/nutrition/parse', {
        method: 'POST',
        body: JSON.stringify({ text: inputText.trim() }),
      })
      setParsed(data.parsed)
    } catch (err) {
      console.error('Parse failed:', err)
      alert('Failed to parse meal. Try again or use Quick Add.')
    } finally {
      setParsing(false)
    }
  }

  const handleConfirmSave = async () => {
    if (!parsed) return
    setSaving(true)
    try {
      await apiFetch('/api/nutrition/log', {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          meal_name: parsed.meal_name,
          foods: parsed.foods,
          total_calories: parsed.total_calories,
          total_protein_g: parsed.total_protein_g,
          total_carbs_g: parsed.total_carbs_g,
          total_fat_g: parsed.total_fat_g,
          total_fiber_g: parsed.total_fiber_g,
          source: 'ai_parsed',
        }),
      })
      setParsed(null)
      setInputText('')
      loadDay(selectedDate)
    } catch (err) {
      console.error('Save failed:', err)
      alert('Failed to save meal.')
    } finally {
      setSaving(false)
    }
  }

  const handleQuickAdd = async () => {
    if (!quickName.trim()) return
    setSaving(true)
    try {
      await apiFetch('/api/nutrition/log', {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          meal_name: quickName.trim(),
          foods: [],
          total_calories: Number(quickCal) || 0,
          total_protein_g: Number(quickProtein) || 0,
          total_carbs_g: Number(quickCarbs) || 0,
          total_fat_g: Number(quickFat) || 0,
          source: 'quick_add',
        }),
      })
      setShowQuickAdd(false)
      setQuickName('')
      setQuickCal('')
      setQuickProtein('')
      setQuickCarbs('')
      setQuickFat('')
      loadDay(selectedDate)
    } catch (err) {
      console.error('Quick add failed:', err)
      alert('Failed to save meal.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteMeal = async (id: string) => {
    try {
      await apiFetch(`/api/nutrition/meal/${id}`, { method: 'DELETE' })
      loadDay(selectedDate)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const pct = (current: number, target: number) =>
    target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0

  const phaseClass = phase === 'bulk' ? styles.phaseBulk
    : phase === 'cut' ? styles.phaseCut
    : styles.phaseMaintain

  const phaseLabel = phase === 'bulk' ? 'Building' : phase === 'cut' ? 'Cutting' : 'Maintaining'

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Nutrition</h1>
        <span className={`${styles.phaseBadge} ${phaseClass}`}>{phaseLabel}</span>
      </div>
      <div className={styles.content}>
        {/* Date navigator */}
        <div className={styles.dateNav}>
          <button className={styles.dateBtn} onClick={() => shiftDate(-1)}>&larr;</button>
          <span className={styles.dateLabel}>{formatDate(selectedDate)}</span>
          <button className={styles.dateBtn} onClick={() => shiftDate(1)}>&rarr;</button>
        </div>

        {/* TDEE source + Fitbit actuals */}
        {targets && (
          <div style={{ fontSize: 11, fontWeight: 600, color: tdeeSource === 'fitbit' ? '#22c55e' : 'var(--text-tertiary)', marginBottom: -8 }}>
            {tdeeSource === 'fitbit'
              ? `Targets based on Fitbit data \u2014 TDEE: ${tdeeValue.toLocaleString()} cal/day`
              : 'Targets estimated \u2014 connect Fitbit for personalized data'}
          </div>
        )}
        {fitbitData && tdeeSource === 'fitbit' && (
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap', marginBottom: -4 }}>
            {fitbitData.avg_calories_burned != null && (
              <span>Burn avg: {fitbitData.avg_calories_burned.toLocaleString()} cal</span>
            )}
            {fitbitData.avg_steps != null && (
              <span>Steps avg: {(fitbitData.avg_steps / 1000).toFixed(1)}k</span>
            )}
            {fitbitData.avg_sleep_hours != null && (
              <span>Sleep avg: {fitbitData.avg_sleep_hours}h</span>
            )}
            {fitbitData.avg_active_minutes != null && (
              <span>Active avg: {fitbitData.avg_active_minutes} min</span>
            )}
          </div>
        )}

        {/* Physique intelligence banner */}
        {physiqueData && physiqueData.body_fat_pct != null && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.06))',
            border: '1px solid rgba(139,92,246,0.2)',
            borderRadius: 12, padding: '10px 14px', fontSize: 12, lineHeight: 1.5,
            color: 'var(--text-secondary)',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Physique-Tuned Targets
            </div>
            <span>BF: {physiqueData.body_fat_pct.toFixed(1)}%</span>
            {physiqueData.lean_mass_lbs != null && <span> · Lean: {physiqueData.lean_mass_lbs.toFixed(0)} lbs</span>}
            {bmrMethod === 'katch_mcardle' && <span> · BMR via lean mass</span>}
            {physiqueData.weak_points.length > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-tertiary)' }}>
                Focus areas: {physiqueData.weak_points.slice(0, 3).map(w => w.replace(/_/g, ' ')).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Macro summary */}
        <div className={styles.macroGrid}>
          <div className={`${styles.macroCard} ${styles.full}`}>
            <div className={styles.macroLabel}>Calories</div>
            <div>
              <span className={styles.macroValue}>{Math.round(totals.calories)}</span>
              {targets && <span className={styles.macroTarget}>/ {targets.calories}</span>}
            </div>
            <div className={styles.macroBar}>
              <div
                className={`${styles.macroBarFill} ${styles.calFill}`}
                style={{ width: `${pct(totals.calories, targets?.calories ?? 0)}%` }}
              />
            </div>
          </div>
          <div className={styles.macroCard}>
            <div className={styles.macroLabel}>Protein</div>
            <div>
              <span className={styles.macroValue}>{Math.round(totals.protein_g)}g</span>
              {targets && <span className={styles.macroTarget}>/ {targets.protein_g}g</span>}
            </div>
            <div className={styles.macroBar}>
              <div
                className={`${styles.macroBarFill} ${styles.proteinFill}`}
                style={{ width: `${pct(totals.protein_g, targets?.protein_g ?? 0)}%` }}
              />
            </div>
          </div>
          <div className={styles.macroCard}>
            <div className={styles.macroLabel}>Carbs</div>
            <div>
              <span className={styles.macroValue}>{Math.round(totals.carbs_g)}g</span>
              {targets && <span className={styles.macroTarget}>/ {targets.carbs_g}g</span>}
            </div>
            <div className={styles.macroBar}>
              <div
                className={`${styles.macroBarFill} ${styles.carbFill}`}
                style={{ width: `${pct(totals.carbs_g, targets?.carbs_g ?? 0)}%` }}
              />
            </div>
          </div>
          <div className={styles.macroCard}>
            <div className={styles.macroLabel}>Fat</div>
            <div>
              <span className={styles.macroValue}>{Math.round(totals.fat_g)}g</span>
              {targets && <span className={styles.macroTarget}>/ {targets.fat_g}g</span>}
            </div>
            <div className={styles.macroBar}>
              <div
                className={`${styles.macroBarFill} ${styles.fatFill}`}
                style={{ width: `${pct(totals.fat_g, targets?.fat_g ?? 0)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Weight goal timeline */}
        {weightGoal && weightGoal.lbs_to_goal != null && (
          <div className={styles.macroCard} style={{ background: 'var(--bg-secondary)' }}>
            <div className={styles.macroLabel}>
              {weightGoal.lbs_to_goal < 0 ? 'Weight Loss Goal' : 'Weight Gain Goal'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className={styles.macroValue}>
                {Math.abs(weightGoal.lbs_to_goal).toFixed(1)} lbs
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                {weightGoal.lbs_to_goal < 0 ? 'to lose' : 'to gain'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
              <div>
                Target: {weightGoal.target_lbs} lbs by {new Date(weightGoal.target_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div>
                Rate: {Math.abs(weightGoal.weekly_rate_lbs).toFixed(2)} lbs/week
                {weightGoal.weeks_remaining != null && ` · ${Math.round(weightGoal.weeks_remaining)} weeks left`}
              </div>
              <div>
                Daily adjustment: {caloricAdjustment > 0 ? '+' : ''}{caloricAdjustment} cal
                {weightGoal.timeline_status === 'aggressive' && (
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}> — timeline is aggressive, rate clamped for safety</span>
                )}
                {weightGoal.timeline_status === 'past_deadline' && (
                  <span style={{ color: '#ef4444', fontWeight: 600 }}> — past target date, using default rate</span>
                )}
                {weightGoal.timeline_status === 'at_goal' && (
                  <span style={{ color: '#22c55e', fontWeight: 600 }}> — at goal weight</span>
                )}
              </div>
            </div>
            {weightGoal.weeks_remaining != null && weightGoal.weeks_remaining > 0 && Math.abs(weightGoal.lbs_to_goal) > 0.5 && (
              <div className={styles.macroBar} style={{ marginTop: 10 }}>
                <div
                  className={`${styles.macroBarFill}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, 100 - (Math.abs(weightGoal.lbs_to_goal) / (Math.abs(weightGoal.weekly_rate_lbs * (weightGoal.weeks_remaining + (weightGoal.weeks_remaining > 0 ? weightGoal.weeks_remaining * 0.1 : 0))))) * 100))}%`,
                    background: weightGoal.lbs_to_goal < 0 ? '#ef4444' : '#22c55e',
                  }}
                />
              </div>
            )}
            <button
              onClick={() => navigate('/phase-plan')}
              style={{
                marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 10,
                background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              View Full Phase Plan &rarr;
            </button>
          </div>
        )}

        {/* AI input */}
        <div className={styles.inputSection}>
          <h3>Log a Meal</h3>
          <textarea
            className={styles.textInput}
            placeholder="Describe your meal... e.g. '8oz chicken breast, cup of rice, side salad with olive oil'"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
          />
          <div className={styles.inputActions}>
            <button
              className={styles.parseBtn}
              onClick={handleParse}
              disabled={parsing || !inputText.trim()}
            >
              {parsing ? <><span className={styles.spinner} />Analyzing...</> : 'Analyze Meal'}
            </button>
            <button
              className={styles.quickBtn}
              onClick={() => setShowQuickAdd(!showQuickAdd)}
            >
              Quick Add
            </button>
          </div>

          {/* Quick add form */}
          {showQuickAdd && (
            <div className={styles.quickAddForm}>
              <input
                className={styles.quickInput}
                placeholder="Meal name"
                value={quickName}
                onChange={e => setQuickName(e.target.value)}
              />
              <div className={styles.quickRow}>
                <input className={styles.quickInput} placeholder="Calories" type="number" value={quickCal} onChange={e => setQuickCal(e.target.value)} />
                <input className={styles.quickInput} placeholder="Protein (g)" type="number" value={quickProtein} onChange={e => setQuickProtein(e.target.value)} />
              </div>
              <div className={styles.quickRow}>
                <input className={styles.quickInput} placeholder="Carbs (g)" type="number" value={quickCarbs} onChange={e => setQuickCarbs(e.target.value)} />
                <input className={styles.quickInput} placeholder="Fat (g)" type="number" value={quickFat} onChange={e => setQuickFat(e.target.value)} />
              </div>
              <button
                className={styles.parseBtn}
                onClick={handleQuickAdd}
                disabled={saving || !quickName.trim()}
              >
                {saving ? 'Saving...' : 'Save Quick Entry'}
              </button>
            </div>
          )}
        </div>

        {/* AI confirmation */}
        {parsed && (
          <div className={styles.confirmCard}>
            <h4>{parsed.meal_name}</h4>
            <ul className={styles.foodList}>
              {parsed.foods.map((f, i) => (
                <li key={i} className={styles.foodItem}>
                  <span>{f.name} ({f.quantity})</span>
                  <span className={styles.foodMacros}>
                    <span>{f.calories} cal</span>
                    <span>{f.protein_g}p</span>
                    <span>{f.carbs_g}c</span>
                    <span>{f.fat_g}f</span>
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Total: {parsed.total_calories} cal | {parsed.total_protein_g}g protein | {parsed.total_carbs_g}g carbs | {parsed.total_fat_g}g fat
            </div>
            <div className={styles.confirmActions}>
              <button
                className={`${styles.confirmBtn} ${styles.confirmSave}`}
                onClick={handleConfirmSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Meal'}
              </button>
              <button
                className={`${styles.confirmBtn} ${styles.confirmCancel}`}
                onClick={() => setParsed(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Meals logged today */}
        <div className={styles.mealSection}>
          <h3>Meals — {formatDate(selectedDate)}</h3>
          {loading ? (
            <div className={styles.emptyState}>Loading...</div>
          ) : meals.length === 0 ? (
            <div className={styles.emptyState}>No meals logged for this day</div>
          ) : (
            meals.map(meal => (
              <div key={meal.id} className={styles.mealEntry}>
                <div className={styles.mealHeader}>
                  <span className={styles.mealName}>{meal.meal_name}</span>
                  {meal.meal_time && (
                    <span className={styles.mealTime}>{meal.meal_time.slice(0, 5)}</span>
                  )}
                </div>
                <div className={styles.mealMacros}>
                  <span>{Math.round(Number(meal.total_calories))} cal</span>
                  <span>{Math.round(Number(meal.total_protein_g))}g P</span>
                  <span>{Math.round(Number(meal.total_carbs_g))}g C</span>
                  <span>{Math.round(Number(meal.total_fat_g))}g F</span>
                </div>
                <div className={styles.mealActions}>
                  <button
                    className={`${styles.mealActionBtn} ${styles.deleteBtn}`}
                    onClick={() => handleDeleteMeal(meal.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
