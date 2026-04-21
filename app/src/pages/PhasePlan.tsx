import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import styles from './PhasePlan.module.css'

interface Milestone {
  label: string
  target_weight: number
  target_date: string
  reached: boolean
  is_final: boolean
}

interface ChecklistItem {
  key: string
  label: string
  status: 'on_track' | 'needs_attention' | 'monitor'
}

interface DailyTargets {
  calories_eat: number
  calories_burn: number
  protein_g: number
  carbs_g: number
  fat_g: number
  steps: number
  sleep_hours: number
  training_days_per_week: number
  session_duration_min: number
  water_oz: number
}

interface WorkoutMilestone {
  label: string
  detail: string
  status: 'on_track' | 'needs_attention' | 'monitor'
}

interface PhasePlan {
  phase: 'cut' | 'bulk'
  start_weight: number
  current_weight: number
  goal_weight: number
  goal_date: string
  lbs_remaining: number
  progress_pct: number
  weeks_remaining: number
  actual_weekly_rate: number
  needed_weekly_rate: number
  pacing: 'on_track' | 'behind' | 'off_track' | 'no_data'
  milestones: Milestone[]
  checklist: ChecklistItem[]
  daily_targets: DailyTargets
  workout_milestones: WorkoutMilestone[]
  weight_chart: { date: string; weight: number }[]
  workout_stats: { total: number; avg_duration: number | null }
  nutrition_stats: { days_logged_30d: number; avg_calories: number | null; avg_protein: number | null }
}

async function apiFetch(path: string): Promise<any> {
  const { getIdToken } = await import('../lib/cognitoAuth')
  const token = await getIdToken().catch(() => '')
  const { apiUrl } = await import('../lib/urlConfig')
  const resp = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

const PACING_CONFIG = {
  on_track: { icon: '\u2713', text: 'On Track', desc: 'You\'re hitting the target rate. Keep it up.' },
  behind: { icon: '\u26A0', text: 'Behind Schedule', desc: 'Falling short of the needed rate. Adjust intake or extend your timeline.' },
  off_track: { icon: '\u2717', text: 'Off Track', desc: 'Weight is moving the wrong direction. Review your nutrition and training.' },
  no_data: { icon: '\u2014', text: 'Not Enough Data', desc: 'Log your weight for at least 2 weeks to see pacing.' },
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PhasePlan() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<PhasePlan | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadPlan = useCallback(async () => {
    if (!user) return
    try {
      const data = await apiFetch('/api/nutrition/phase-plan')
      setPlan(data.plan || null)
      setReason(data.reason || null)
    } catch (err) {
      console.error('Failed to load phase plan:', err)
      setReason('Failed to load phase plan')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadPlan() }, [loadPlan])

  if (loading) {
    return (
      <SafeAreaScaffold>
        <div className={styles.container}>
          <div className={styles.header}><h1>Phase Plan</h1></div>
          <div className={styles.content}>
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Loading...</div>
          </div>
        </div>
      </SafeAreaScaffold>
    )
  }

  if (!plan) {
    return (
      <SafeAreaScaffold>
        <div className={styles.container}>
          <div className={styles.header}>
            <BackButton />
            <h1>Phase Plan</h1>
            <div />
          </div>
          <div className={styles.content}>
            <div className={styles.emptyState}>
              <h2>No Active Phase</h2>
              <p>{reason || 'Set your Apollo phase to Cut or Bulk and add a goal weight + date in your Profile to see your phase plan.'}</p>
              <button className={styles.emptyBtn} onClick={() => navigate('/profile')}>Go to Profile</button>
            </div>
          </div>
        </div>
      </SafeAreaScaffold>
    )
  }

  const p = plan
  const pacing = PACING_CONFIG[p.pacing]
  const isCut = p.phase === 'cut'

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
        <div className={styles.header}>
          <BackButton />
          <h1>Phase Plan</h1>
          <span className={`${styles.phaseBadge} ${styles[p.phase]}`}>
            {isCut ? 'Cutting' : 'Building'}
          </span>
        </div>

        <div className={styles.content}>
          {/* Hero: weight progress */}
          <div className={styles.heroCard}>
            <div className={styles.heroNumbers}>
              <div className={styles.heroStat}>
                <div className={styles.heroStatLabel}>Start</div>
                <div className={styles.heroStatValue}>{p.start_weight}<span className={styles.heroStatUnit}> lbs</span></div>
              </div>
              <div className={styles.heroArrow}>{isCut ? '\u2193' : '\u2191'}</div>
              <div className={styles.heroStat}>
                <div className={styles.heroStatLabel}>Now</div>
                <div className={styles.heroStatValue}>{p.current_weight}<span className={styles.heroStatUnit}> lbs</span></div>
              </div>
              <div className={styles.heroArrow}>{isCut ? '\u2193' : '\u2191'}</div>
              <div className={styles.heroStat}>
                <div className={styles.heroStatLabel}>Goal</div>
                <div className={styles.heroStatValue}>{p.goal_weight}<span className={styles.heroStatUnit}> lbs</span></div>
              </div>
            </div>

            <div className={styles.progressBarOuter}>
              <div
                className={`${styles.progressBarFill} ${styles[p.phase]}`}
                style={{ width: `${p.progress_pct}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>{p.progress_pct}% complete</span>
              <span>{Math.abs(p.lbs_remaining).toFixed(1)} lbs {isCut ? 'to lose' : 'to gain'}</span>
            </div>
          </div>

          {/* Pacing banner */}
          <div className={`${styles.pacingBanner} ${styles[p.pacing]}`}>
            <span className={styles.pacingIcon}>{pacing.icon}</span>
            <div>
              <strong>{pacing.text}</strong>
              <div style={{ fontWeight: 400, marginTop: 2 }}>{pacing.desc}</div>
            </div>
          </div>

          {/* Rate details */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Rate Details</h3>
            <div className={styles.rateRow}>
              <span className={styles.rateLabel}>Needed rate</span>
              <span className={styles.rateValue}>{Math.abs(p.needed_weekly_rate).toFixed(2)} lbs/wk</span>
            </div>
            <div className={styles.rateRow}>
              <span className={styles.rateLabel}>Actual rate (14d)</span>
              <span className={styles.rateValue} style={{ color: p.pacing === 'on_track' ? '#22c55e' : p.pacing === 'off_track' ? '#ef4444' : 'var(--text-primary)' }}>
                {p.actual_weekly_rate > 0 ? '+' : ''}{p.actual_weekly_rate.toFixed(2)} lbs/wk
              </span>
            </div>
            <div className={styles.rateRow}>
              <span className={styles.rateLabel}>Weeks remaining</span>
              <span className={styles.rateValue}>{p.weeks_remaining.toFixed(0)}</span>
            </div>
            <div className={styles.rateRow}>
              <span className={styles.rateLabel}>Target date</span>
              <span className={styles.rateValue}>{formatDate(p.goal_date)}</span>
            </div>
            {p.workout_stats.total > 0 && (
              <div className={styles.rateRow}>
                <span className={styles.rateLabel}>Workouts completed</span>
                <span className={styles.rateValue}>{p.workout_stats.total}</span>
              </div>
            )}
          </div>

          {/* Daily targets */}
          {p.daily_targets && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Daily Targets</h3>
              <div className={styles.targetsGrid}>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.calories_eat.toLocaleString()}</div>
                  <div className={styles.targetLabel}>Cal to eat</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.calories_burn.toLocaleString()}</div>
                  <div className={styles.targetLabel}>Cal to burn</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.protein_g}g</div>
                  <div className={styles.targetLabel}>Protein</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.carbs_g}g</div>
                  <div className={styles.targetLabel}>Carbs</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.fat_g}g</div>
                  <div className={styles.targetLabel}>Fat</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{(p.daily_targets.steps / 1000).toFixed(0)}k</div>
                  <div className={styles.targetLabel}>Steps</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.sleep_hours}h</div>
                  <div className={styles.targetLabel}>Sleep</div>
                </div>
                <div className={styles.targetCard}>
                  <div className={styles.targetValue}>{p.daily_targets.water_oz}oz</div>
                  <div className={styles.targetLabel}>Water</div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className={styles.rateRow}>
                  <span className={styles.rateLabel}>Training days/week</span>
                  <span className={styles.rateValue}>{p.daily_targets.training_days_per_week}</span>
                </div>
                <div className={styles.rateRow}>
                  <span className={styles.rateLabel}>Session duration</span>
                  <span className={styles.rateValue}>{p.daily_targets.session_duration_min} min</span>
                </div>
              </div>
            </div>
          )}

          {/* Milestones */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Milestones</h3>
            <div className={styles.milestoneList}>
              {p.milestones.map((m, i) => (
                <div key={i} className={`${styles.milestone} ${m.reached ? styles.reached : ''} ${m.is_final ? styles.final : ''}`}>
                  <div className={styles.milestoneIcon}>
                    {m.reached ? '\u2713' : m.is_final ? '\u2605' : i + 1}
                  </div>
                  <div className={styles.milestoneBody}>
                    <div className={styles.milestoneLabel}>{m.label}</div>
                    <div className={styles.milestoneDetail}>by {formatDate(m.target_date)}</div>
                  </div>
                  <div className={styles.milestoneWeight}>{m.target_weight} lbs</div>
                </div>
              ))}
            </div>
          </div>

          {/* Checklist */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{isCut ? 'Cut Phase Checklist' : 'Bulk Phase Checklist'}</h3>
            {p.checklist.map((item) => (
              <div key={item.key} className={styles.checklistItem}>
                <div className={`${styles.checkDot} ${styles[item.status]}`} />
                <span className={styles.checkLabel}>{item.label}</span>
                <span className={`${styles.checkStatus} ${styles[item.status]}`}>
                  {item.status === 'on_track' ? 'Good' : item.status === 'needs_attention' ? 'Attention' : 'Monitor'}
                </span>
              </div>
            ))}
          </div>

          {/* Workout milestones */}
          {p.workout_milestones && p.workout_milestones.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Workout Milestones</h3>
              {p.workout_milestones.map((wm, i) => (
                <div key={i} className={styles.checklistItem}>
                  <div className={`${styles.checkDot} ${styles[wm.status]}`} />
                  <div style={{ flex: 1 }}>
                    <span className={styles.checkLabel}>{wm.label}</span>
                    <div className={styles.milestoneDetail}>{wm.detail}</div>
                  </div>
                  <span className={`${styles.checkStatus} ${styles[wm.status]}`}>
                    {wm.status === 'on_track' ? 'Good' : wm.status === 'needs_attention' ? 'Attention' : 'Monitor'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Nutrition snapshot */}
          {(p.nutrition_stats.avg_calories || p.nutrition_stats.avg_protein) && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>30-Day Nutrition Average</h3>
              <div className={styles.rateRow}>
                <span className={styles.rateLabel}>Days logged</span>
                <span className={styles.rateValue}>{p.nutrition_stats.days_logged_30d} / 30</span>
              </div>
              {p.nutrition_stats.avg_calories && (
                <div className={styles.rateRow}>
                  <span className={styles.rateLabel}>Avg calories</span>
                  <span className={styles.rateValue}>{p.nutrition_stats.avg_calories} kcal</span>
                </div>
              )}
              {p.nutrition_stats.avg_protein && (
                <div className={styles.rateRow}>
                  <span className={styles.rateLabel}>Avg protein</span>
                  <span className={styles.rateValue}>{p.nutrition_stats.avg_protein}g</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SafeAreaScaffold>
  )
}
