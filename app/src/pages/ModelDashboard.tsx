import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { computeTrainingProfile, type TrainingProfile } from '../lib/trainingAnalysis'
import BackButton from '../components/BackButton'
import Spinner from '../components/Spinner'
import { logError } from '../utils/logger'

const S = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' } as const,
  header: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderBottom: '1px solid #222' } as const,
  title: { fontSize: '20px', fontWeight: 700, margin: 0, color: '#fff' } as const,
  content: { padding: '16px', maxWidth: '720px', margin: '0 auto' } as const,
  section: { marginBottom: '24px', background: '#111', borderRadius: '12px', border: '1px solid #222', overflow: 'hidden' } as const,
  sectionHeader: { padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: '15px', color: '#fff' } as const,
  sectionBody: { padding: '0 16px 16px', fontSize: '13px', lineHeight: 1.6 } as const,
  badge: { fontSize: '11px', padding: '2px 8px', borderRadius: '8px', fontWeight: 500 } as const,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px', marginTop: '8px' },
  th: { textAlign: 'left' as const, padding: '6px 8px', borderBottom: '1px solid #333', color: '#999', fontWeight: 500 },
  td: { padding: '6px 8px', borderBottom: '1px solid #1a1a1a' },
  loading: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' } as const,
  explain: { color: '#999', fontSize: '12px', lineHeight: 1.5, marginBottom: '12px', borderLeft: '2px solid #333', paddingLeft: '10px' } as const,
  cite: { color: '#666', fontSize: '11px', fontStyle: 'italic' as const, marginTop: '8px' } as const,
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    below_mev: '#ff6b6b', in_mev_mav: '#ffa726', in_mav: '#66bb6a',
    approaching_mrv: '#ffa726', above_mrv: '#ff6b6b',
  }
  return <span style={{ ...S.badge, background: colors[status] || '#555', color: '#000' }}>{status.replace(/_/g, ' ')}</span>
}

export default function ModelDashboard() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<TrainingProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!user) return
    computeTrainingProfile(user.id)
      .then(setProfile)
      .catch(e => logError('ModelDashboard profile load failed', e))
      .finally(() => setLoading(false))
  }, [user])

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  if (loading) return <div style={S.page}><div style={S.loading}><Spinner /></div></div>
  if (!profile) return <div style={S.page}><div style={S.content}>Failed to load profile data.</div></div>

  return (
    <div style={S.page}>
      <div style={S.header}>
        <BackButton />
        <h1 style={S.title}>ML Pipeline Dashboard</h1>
      </div>
      <div style={S.content}>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginBottom: '20px', padding: '12px', background: '#111', borderRadius: '12px', border: '1px solid #222' }}>
          {[
            { key: 'data', label: 'Data In' },
            { key: 'features', label: 'Features' },
            { key: 'recovery', label: 'Recovery' },
            { key: 'volume', label: 'Muscle Groups' },
            { key: 'exerciseSelection', label: 'Exercises' },
            { key: 'prescription', label: 'Prescription' },
            { key: 'timeFit', label: 'Time Fit' },
            { key: 'validation', label: 'Validation' },
            { key: 'llmReview', label: 'LLM Review' },
            { key: 'llm', label: 'Final' },
          ].map((step, i, arr) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                onClick={() => toggle(step.key)}
                style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: expanded[step.key] ? '#2563eb' : '#222', color: expanded[step.key] ? '#fff' : '#aaa', transition: 'all 0.2s' }}
              >
                {step.label}
              </span>
              {i < arr.length - 1 && <span style={{ color: '#444', fontSize: '14px' }}>→</span>}
            </span>
          ))}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('data')}>
            <span>1. Data Collection</span>
            <span>{expanded.data ? '−' : '+'}</span>
          </div>
          {expanded.data && (
            <div style={S.sectionBody}>
              <div style={S.explain}>The model ingests your workout logs, wearable data (sleep, HRV, steps, heart rate), and body composition to build a complete picture of your training state. More data = better predictions.</div>
              <table style={S.table}>
                <tbody>
                  <tr><td style={S.td}>Total workouts logged</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.totalWorkoutCount}</td></tr>
                  <tr><td style={S.td}>Health data days</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.healthDataDays}</td></tr>
                  <tr><td style={S.td}>Training age</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.trainingAgeDays} days</td></tr>
                  <tr><td style={S.td}>Frequency</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.trainingFrequency} sessions/week</td></tr>
                  <tr><td style={S.td}>Avg session</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.avgSessionDuration} min</td></tr>
                  <tr><td style={S.td}>Consistency</td><td style={{ ...S.td, fontWeight: 600 }}>{Math.round(profile.consistencyScore * 100)}%</td></tr>
                  <tr>
                    <td style={S.td}>Connected wearables</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      {profile.connectedWearables.length > 0
                        ? profile.connectedWearables.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ')
                        : <span style={{ color: '#666' }}>None</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('features')}>
            <span>2. Feature Engineering</span>
            <span>{expanded.features ? '−' : '+'}</span>
          </div>
          {expanded.features && (
            <div style={S.sectionBody}>
              <div style={S.explain}>Raw data is transformed into actionable training signals. The engine computes estimated 1RM trends (Epley formula), per-muscle volume trajectories, and compares your sleep/HRV/RHR against your own 30-day baselines — not population averages.</div>
              <div style={S.cite}>Epley (1985). Poundage Chart. // Plews et al. (2013). HRV-Guided Training. Int J Sports Physiol Perf.</div>

              <p style={{ fontWeight: 600, marginTop: '12px', marginBottom: '4px', color: '#fff' }}>Health Metrics vs Baselines</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Metric</th>
                    <th style={S.th}>Current</th>
                    <th style={S.th}>30d Avg</th>
                    <th style={S.th}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: 'Sleep (hrs)', t: profile.rolling30DayTrends.sleep },
                    { label: 'HRV (ms)', t: profile.rolling30DayTrends.hrv },
                    { label: 'RHR (bpm)', t: profile.rolling30DayTrends.rhr },
                  ] as const).map(({ label, t }) => (
                    <tr key={label}>
                      <td style={S.td}>{label}</td>
                      <td style={S.td}>{t.current?.toFixed(1) ?? '—'}</td>
                      <td style={S.td}>{t.avg30d?.toFixed(1) ?? '—'}</td>
                      <td style={S.td}>
                        <span style={{ color: t.direction === 'up' ? '#66bb6a' : t.direction === 'down' ? '#ff6b6b' : '#999' }}>
                          {t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '→'} {t.slopePct !== 0 ? `${t.slopePct > 0 ? '+' : ''}${t.slopePct.toFixed(1)}%/wk` : 'flat'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ fontWeight: 600, marginTop: '16px', marginBottom: '4px', color: '#fff' }}>Top Exercise 1RM Trends</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Exercise</th>
                    <th style={S.th}>e1RM</th>
                    <th style={S.th}>30d Avg</th>
                    <th style={S.th}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.rolling30DayTrends.exerciseTrends || []).slice(0, 8).map(et => (
                    <tr key={et.exerciseName}>
                      <td style={S.td}>{et.exerciseName}</td>
                      <td style={S.td}>{et.estimated1RM.current?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{et.estimated1RM.avg30d?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>
                        <span style={{ color: et.estimated1RM.direction === 'up' ? '#66bb6a' : et.estimated1RM.direction === 'down' ? '#ff6b6b' : '#999' }}>
                          {et.estimated1RM.direction === 'up' ? '↑' : et.estimated1RM.direction === 'down' ? '↓' : '→'} {et.estimated1RM.slopePct !== 0 ? `${et.estimated1RM.slopePct > 0 ? '+' : ''}${et.estimated1RM.slopePct.toFixed(1)}%/wk` : 'flat'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ fontWeight: 600, marginTop: '16px', marginBottom: '4px', color: '#fff' }}>Volume by Muscle Group (sets/wk trend)</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Group</th>
                    <th style={S.th}>Current</th>
                    <th style={S.th}>30d Avg</th>
                    <th style={S.th}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.rolling30DayTrends.muscleGroupTrends || []).map(mg => (
                    <tr key={mg.muscleGroup}>
                      <td style={S.td}>{mg.muscleGroup.replace(/_/g, ' ')}</td>
                      <td style={S.td}>{mg.weeklySetsTrend.current?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{mg.weeklySetsTrend.avg30d?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>
                        <span style={{ color: mg.weeklySetsTrend.direction === 'up' ? '#66bb6a' : mg.weeklySetsTrend.direction === 'down' ? '#ff6b6b' : '#999' }}>
                          {mg.weeklySetsTrend.direction === 'up' ? '↑' : mg.weeklySetsTrend.direction === 'down' ? '↓' : '→'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('volume')}>
            <span>3. Volume Status by Muscle Group</span>
            <span>{expanded.volume ? '−' : '+'}</span>
          </div>
          {expanded.volume && (() => {
            const statusPriority: Record<string, number> = { below_mev: 4, in_mev_mav: 3, in_mav: 1, approaching_mrv: 2, above_mrv: 2 };
            const rows = (profile.muscleVolumeStatuses || []).map(v => {
              const deficit = v.mavLow - v.weeklyDirectSets;
              const freq = profile.muscleGroupFrequency[v.muscleGroup] ?? 0;
              const priority = (statusPriority[v.status] ?? 0) * 10 + Math.max(0, deficit) * 2 + (v.daysSinceLastTrained > 5 ? 5 : 0);
              return { ...v, deficit, freq, priority };
            }).sort((a, b) => b.priority - a.priority);
            return (
              <div style={S.sectionBody}>
                <div style={S.explain}>Each muscle group has research-derived volume landmarks: MEV (minimum to maintain), MAV (productive range), and MRV (max recoverable). Priority score determines which groups the engine targets first — higher = more undertrained. Sorted by priority.</div>
                <div style={S.cite}>Israetel, Hoffmann & Smith (2021). Scientific Principles of Hypertrophy Training. Renaissance Periodization.</div>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Group</th>
                      <th style={S.th}>Sets/wk</th>
                      <th style={S.th}>MEV</th>
                      <th style={S.th}>MAV</th>
                      <th style={S.th}>MRV</th>
                      <th style={S.th}>Deficit</th>
                      <th style={S.th}>Freq/wk</th>
                      <th style={S.th}>Priority</th>
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(v => (
                      <tr key={v.muscleGroup}>
                        <td style={S.td}>{v.muscleGroup.replace(/_/g, ' ')}</td>
                        <td style={S.td}>{v.weeklyDirectSets}</td>
                        <td style={S.td}>{v.mev}</td>
                        <td style={S.td}>{v.mavLow}–{v.mavHigh}</td>
                        <td style={S.td}>{v.mrv}</td>
                        <td style={{ ...S.td, color: v.deficit > 0 ? '#ff6b6b' : '#66bb6a' }}>{v.deficit > 0 ? `−${v.deficit}` : v.deficit === 0 ? '0' : `+${Math.abs(v.deficit)}`}</td>
                        <td style={S.td}>{v.freq.toFixed(1)}</td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{Math.round(v.priority)}</td>
                        <td style={S.td}><StatusBadge status={v.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('recovery')}>
            <span>4. Recovery State</span>
            <span>{expanded.recovery ? '−' : '+'}</span>
          </div>
          {expanded.recovery && (
            <div style={S.sectionBody}>
              <div style={S.explain}>Uses the Banister Fitness-Fatigue model: performance = fitness − fatigue. Fitness accumulates slowly and decays slowly; fatigue accumulates quickly and decays quickly. Sleep debt and HRV further modulate readiness, volume capacity, and rest periods.</div>
              <div style={S.cite}>Banister et al. (1975). A systems model of training. Canadian J. Applied Sport Sciences.</div>
              <table style={S.table}>
                <tbody>
                  <tr><td style={S.td}>Readiness</td><td style={{ ...S.td, fontWeight: 600 }}>{Math.round(profile.fitnessFatigueModel.readiness * 100)}%</td></tr>
                  <tr><td style={S.td}>Fitness level</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.fitnessFatigueModel.fitnessLevel.toFixed(1)}</td></tr>
                  <tr><td style={S.td}>Fatigue level</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.fitnessFatigueModel.fatigueLevel.toFixed(1)}</td></tr>
                  <tr><td style={S.td}>Volume multiplier</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.sleepVolumeModifier.volumeMultiplier.toFixed(2)}x <span style={{ color: '#999', fontWeight: 400 }}>— {profile.sleepVolumeModifier.reason}</span></td></tr>
                  <tr><td style={S.td}>Rest time multiplier</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.sleepVolumeModifier.restTimeMultiplier.toFixed(2)}x</td></tr>
                  <tr><td style={S.td}>Last night sleep</td><td style={{ ...S.td, fontWeight: 600 }}>{profile.sleepVolumeModifier.lastNightSleepHours?.toFixed(1) ?? '—'} hrs {profile.sleepVolumeModifier.lastNightSleepQuality ? `(${profile.sleepVolumeModifier.lastNightSleepQuality})` : ''}</td></tr>
                  <tr>
                    <td style={S.td}>Sleep debt (7d)</td>
                    <td style={{ ...S.td, fontWeight: 600, color: (profile.cumulativeSleepDebt.sleepDebt7d ?? 0) < -1 ? '#ff6b6b' : '#e0e0e0' }}>
                      {profile.cumulativeSleepDebt.sleepDebt7d != null ? `${profile.cumulativeSleepDebt.sleepDebt7d.toFixed(1)} hrs` : '—'}
                      <span style={{ color: '#999', fontWeight: 400 }}> (recovery mod: {profile.cumulativeSleepDebt.recoveryModifier.toFixed(2)}x)</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={S.td}>HRV intensity modifier</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      {profile.hrvIntensityModifier.intensityMultiplier.toFixed(2)}x
                      <span style={{ color: '#999', fontWeight: 400 }}> — {profile.hrvIntensityModifier.recommendation}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={S.td}>Deload</td>
                    <td style={{ ...S.td, fontWeight: 600, color: profile.deloadRecommendation.needed ? '#ffa726' : '#66bb6a' }}>
                      {profile.deloadRecommendation.needed ? `Recommended (${profile.deloadRecommendation.suggestedDurationDays}d at ${profile.deloadRecommendation.suggestedVolumeMultiplier}x volume)` : 'Not needed'}
                    </td>
                  </tr>
                </tbody>
              </table>
              {profile.deloadRecommendation.needed && profile.deloadRecommendation.signals.length > 0 && (
                <div style={{ marginTop: '8px', padding: '8px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px' }}>
                  <span style={{ color: '#ffa726', fontWeight: 600 }}>Deload signals:</span>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, color: '#aaa' }}>
                    {profile.deloadRecommendation.signals.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('progressions')}>
            <span>5. Exercise Progressions (top 10)</span>
            <span>{expanded.progressions ? '−' : '+'}</span>
          </div>
          {expanded.progressions && (
            <div style={S.sectionBody}>
              <div style={S.explain}>Estimated 1RM is computed using the Epley formula: 1RM = weight × (1 + reps/30). Target weights are derived as a percentage of 1RM adjusted for the prescribed rep range and RIR target.</div>
              <div style={S.cite}>Epley (1985). Poundage Chart. Boyd Epley Workout. // Helms et al. (2016). Application of the Repetition in Reserve-Based RPE Scale. NSCA.</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Exercise</th>
                    <th style={S.th}>Est. 1RM</th>
                    <th style={S.th}>Last Wt</th>
                    <th style={S.th}>Trend</th>
                    <th style={S.th}>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.exerciseProgressions || []).slice(0, 10).map(p => (
                    <tr key={p.exerciseName}>
                      <td style={S.td}>{p.exerciseName}</td>
                      <td style={S.td}>{p.estimated1RM?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{p.lastWeight?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{p.status ?? '—'}</td>
                      <td style={S.td}>{p.sessionsTracked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('exerciseSelection')}>
            <span>6. Exercise Selection Scoring</span>
            <span>{expanded.exerciseSelection ? '−' : '+'}</span>
          </div>
          {expanded.exerciseSelection && (
            <div style={S.sectionBody}>
              <div style={S.explain}>For each muscle group, the engine scores every candidate exercise using weighted factors. The highest-scoring exercises are selected. User history is the dominant signal — exercises you actually perform consistently are strongly preferred over library defaults.</div>
              <div style={S.cite}>Factors derived from user behavior analysis + exercise science principles (compound preference, periodization, recovery interference).</div>

              <p style={{ fontWeight: 600, marginTop: '12px', marginBottom: '4px', color: '#fff' }}>Scoring Factors & Weights</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Factor</th>
                    <th style={S.th}>Weight</th>
                    <th style={S.th}>Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { factor: 'Performance goal match', weight: '+6', cond: 'User has a specific target for this exercise' },
                    { factor: 'Staple exercise', weight: '+4', cond: 'Consistently used across training history' },
                    { factor: 'User preference (recency)', weight: '+0 to ~8', cond: 'recencyScore × 2.5 — proportional to recent usage' },
                    { factor: 'Recently used (<14d)', weight: '+2', cond: 'Last performed within 14 days' },
                    { factor: 'Progressing', weight: '+3', cond: 'Positive slope on estimated 1RM trend' },
                    { factor: 'Compound movement', weight: '+2', cond: 'Multi-joint exercise' },
                    { factor: 'Stalled progression', weight: '+1', cond: 'No progress but not regressing' },
                    { factor: 'Regressing', weight: '−1', cond: 'Negative slope on estimated 1RM trend' },
                    { factor: 'Ordering interference', weight: '−2', cond: 'Negative interaction with preceding exercise' },
                    { factor: 'Movement pattern fatigue (mod)', weight: '−2', cond: 'Pattern used recently with moderate fatigue' },
                    { factor: 'Plateaued (swap suggested)', weight: '−3', cond: 'Plateau detected, variation strategy recommended' },
                    { factor: 'Never used', weight: '−3', cond: 'Exercise not in user training history' },
                    { factor: 'Equipment unavailable', weight: '−5', cond: 'Requires barbell/cable/smith with limited access' },
                    { factor: 'Rotation suggested (4+ wks)', weight: '−5', cond: 'Same exercise used 4+ consecutive weeks' },
                    { factor: 'Swap learning (1–2×)', weight: '−5 to −10', cond: 'User previously swapped this exercise out' },
                    { factor: 'Movement pattern fatigue (high)', weight: '−6', cond: 'Pattern used recently with high fatigue' },
                    { factor: 'Stale exercise (6+ wks)', weight: '−10', cond: 'Forced rotation — exercise used 6+ weeks' },
                    { factor: 'Frequently swapped (3+×)', weight: '−15', cond: 'User consistently rejects this exercise' },
                  ].map(r => (
                    <tr key={r.factor}>
                      <td style={S.td}>{r.factor}</td>
                      <td style={{ ...S.td, fontWeight: 600, color: r.weight.startsWith('+') || r.weight.startsWith('−') ? (r.weight.startsWith('+') ? '#66bb6a' : '#ff6b6b') : '#999' }}>{r.weight}</td>
                      <td style={{ ...S.td, color: '#aaa' }}>{r.cond}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ fontWeight: 600, marginTop: '16px', marginBottom: '4px', color: '#fff' }}>Your Top Exercise Preferences</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Exercise</th>
                    <th style={S.th}>Sessions</th>
                    <th style={S.th}>Recency</th>
                    <th style={S.th}>Staple</th>
                    <th style={S.th}>Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.exercisePreferences || []).slice(0, 12).map(ep => (
                    <tr key={ep.exerciseName}>
                      <td style={S.td}>{ep.exerciseName}</td>
                      <td style={S.td}>{ep.totalSessions} ({ep.recentSessions} recent)</td>
                      <td style={S.td}>{ep.recencyScore.toFixed(1)}</td>
                      <td style={S.td}>{ep.isStaple ? '★' : '—'}</td>
                      <td style={S.td}>{ep.lastUsedDaysAgo}d ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('prescription')}>
            <span>7. Prescription Logic</span>
            <span>{expanded.prescription ? '−' : '+'}</span>
          </div>
          {expanded.prescription && (
            <div style={S.sectionBody}>
              <div style={S.explain}>For each selected exercise, the engine prescribes sets, reps, weight, rest, and tempo. Your actual training data is the primary source — textbook tables are only used when you have no history. Weight is derived from estimated 1RM scaled to the target rep range + RIR buffer.</div>
              <div style={S.cite}>Epley (1985): 1RM = weight × (1 + reps/30). Helms et al. (2016): RIR-based RPE. Schoenfeld et al. (2017): rep range meta-analysis.</div>

              <p style={{ fontWeight: 600, marginTop: '12px', marginBottom: '4px', color: '#fff' }}>Prescription Pipeline</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Parameter</th>
                    <th style={S.th}>Primary Source</th>
                    <th style={S.th}>Fallback</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={S.td}>Reps</td><td style={S.td}>Learned median reps (≥2 recent sessions)</td><td style={S.td}>Table by role × goal</td></tr>
                  <tr><td style={S.td}>Sets</td><td style={S.td}>Learned median sets (≥2 recent sessions)</td><td style={S.td}>Tiered by role, goal, priority, deload</td></tr>
                  <tr><td style={S.td}>Weight</td><td style={S.td}>Epley e1RM → weightForReps(e1RM, reps, RIR)</td><td style={S.td}>Safety floor: never &lt; 50% of last working weight</td></tr>
                  <tr><td style={S.td}>Rest</td><td style={S.td}>Learned inter-set rest from timestamps</td><td style={S.td}>Movement-pattern-aware table by role × goal</td></tr>
                  <tr><td style={S.td}>Tempo</td><td style={S.td}>Exercise default_tempo</td><td style={S.td}>Goal-based default (e.g. hypertrophy: 3-1-2)</td></tr>
                  <tr><td style={S.td}>RIR</td><td style={S.td}>Role × goal lookup</td><td style={S.td}>Deload override → RIR 4</td></tr>
                </tbody>
              </table>

              <p style={{ fontWeight: 600, marginTop: '16px', marginBottom: '4px', color: '#fff' }}>Your Learned Prescriptions (top exercises)</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Exercise</th>
                    <th style={S.th}>Learned Reps</th>
                    <th style={S.th}>Learned Sets</th>
                    <th style={S.th}>Learned Wt</th>
                    <th style={S.th}>Increment</th>
                    <th style={S.th}>Rest (s)</th>
                    <th style={S.th}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(profile.exercisePreferences || []).filter(ep => ep.recentSessions >= 2).slice(0, 10).map(ep => (
                    <tr key={ep.exerciseName}>
                      <td style={S.td}>{ep.exerciseName}</td>
                      <td style={S.td}>{ep.learnedReps?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{ep.learnedSets?.toFixed(0) ?? '—'}</td>
                      <td style={S.td}>{ep.learnedWeight != null ? `${ep.learnedWeight} lbs` : '—'}</td>
                      <td style={S.td}>{ep.learnedIncrement != null ? `${ep.learnedIncrement} lbs` : '—'}</td>
                      <td style={S.td}>{ep.learnedRestSeconds ?? '—'}</td>
                      <td style={{ ...S.td, color: '#66bb6a' }}>learned</td>
                    </tr>
                  ))}
                  {(profile.exercisePreferences || []).filter(ep => ep.recentSessions < 2).slice(0, 3).map(ep => (
                    <tr key={ep.exerciseName}>
                      <td style={S.td}>{ep.exerciseName}</td>
                      <td style={{ ...S.td, color: '#666' }}>—</td>
                      <td style={{ ...S.td, color: '#666' }}>—</td>
                      <td style={{ ...S.td, color: '#666' }}>—</td>
                      <td style={{ ...S.td, color: '#666' }}>—</td>
                      <td style={{ ...S.td, color: '#666' }}>—</td>
                      <td style={{ ...S.td, color: '#ffa726' }}>table fallback</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('timeFit')}>
            <span>8. Time Constraints & Greedy Expansion</span>
            <span>{expanded.timeFit ? '−' : '+'}</span>
          </div>
          {expanded.timeFit && (
            <div style={S.sectionBody}>
              <div style={S.explain}>After initial prescription, the engine checks total estimated time against your session budget. If there's extra time, a greedy loop adds volume by picking the highest marginal-value action (add a set to an existing exercise vs. add a new exercise). If over time, the lowest-value exercises are trimmed. This replaces the old 3-phase expansion with a unified, research-driven approach.</div>
              <div style={S.cite}>Krieger (2010): dose-response for sets and hypertrophy. Israetel (2021): SFR-based volume allocation.</div>

              <p style={{ fontWeight: 600, marginTop: '12px', marginBottom: '4px', color: '#fff' }}>SFR Curve Formula</p>
              <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: '#e0e0e0', marginBottom: '12px' }}>
                stimulus = e<sup>−k × currentSets</sup><br />
                k = 0.18 + (5 − exerciseSFR) × 0.06<br /><br />
                <span style={{ color: '#999' }}>Higher SFR → slower decay → more sets before diminishing returns.<br />
                Lower SFR → faster decay → engine prefers adding a new exercise instead.</span>
              </div>

              <p style={{ fontWeight: 600, marginBottom: '4px', color: '#fff' }}>Marginal Value: Add Set</p>
              <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: '#e0e0e0', marginBottom: '12px' }}>
                value = sfrCurve(currentSets, SFR) × volumeStatusModifier<br /><br />
                <span style={{ color: '#999' }}>Volume status modifiers:</span><br />
                below_mev: ×1.3 &nbsp;|&nbsp; in_mev_mav: ×1.0 &nbsp;|&nbsp; in_mav: ×0.8<br />
                approaching_mrv: ×0.4 &nbsp;|&nbsp; above_mrv: ×0.1
              </div>

              <p style={{ fontWeight: 600, marginBottom: '4px', color: '#fff' }}>Marginal Value: Add Exercise</p>
              <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: '#e0e0e0', marginBottom: '12px' }}>
                value = sfrCurve(0, SFR) × volMod × freqBonus × varietyBonus<br /><br />
                <span style={{ color: '#999' }}>Frequency bonus:</span> &lt;2/wk: ×1.3 &nbsp;|&nbsp; 2–3/wk: ×1.0 &nbsp;|&nbsp; &gt;3/wk: ×0.8<br />
                <span style={{ color: '#999' }}>Variety bonus:</span> new group: ×1.2 &nbsp;|&nbsp; already in session: ×0.7<br />
                <span style={{ color: '#999' }}>Volume mods:</span> below_mev: ×1.5 &nbsp;|&nbsp; approaching_mrv: ×0.5 &nbsp;|&nbsp; above_mrv: ×0.15
              </div>

              <p style={{ fontWeight: 600, marginBottom: '4px', color: '#fff' }}>Decision Logic</p>
              <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px', color: '#aaa', lineHeight: 1.6 }}>
                1. Compute estimated time for all prescribed exercises<br />
                2. <strong style={{ color: '#e0e0e0' }}>If under budget:</strong> greedily pick highest-value action until time is filled<br />
                3. <strong style={{ color: '#e0e0e0' }}>If over budget:</strong> remove lowest-value exercises until within budget<br />
                4. Post-validation caps any single exercise at per-session research max (weeklyTarget ÷ frequency)
              </div>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('validation')}>
            <span>9. Post-Generation Validation</span>
            <span>{expanded.validation ? '−' : '+'}</span>
          </div>
          {expanded.validation && (
            <div style={S.sectionBody}>
              <div style={S.explain}>After time fitting, the engine runs four deterministic safety checks. These catch edge cases the scoring and prescription logic might miss — like set inflation on a single exercise or compounds ending up after isolations.</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Check</th>
                    <th style={S.th}>Rule</th>
                    <th style={S.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={S.td}>Per-exercise set cap</td><td style={S.td}>Sets &gt; weeklyTarget ÷ frequency</td><td style={S.td}>Redistribute excess sets to underdosed groups</td></tr>
                  <tr><td style={S.td}>Compound ordering</td><td style={S.td}>Compound appears after isolation</td><td style={S.td}>Re-sort: all compounds first, then isolations</td></tr>
                  <tr><td style={S.td}>Volume concentration</td><td style={S.td}>One exercise has &gt;40% of total sets</td><td style={S.td}>Redistribute to other exercises in session</td></tr>
                  <tr><td style={S.td}>Time budget</td><td style={S.td}>Estimated time deviates &gt;20% from session budget</td><td style={S.td}>Trim lowest-value or expand with highest-value</td></tr>
                </tbody>
              </table>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>All corrections are logged to each exercise's <code style={{ color: '#aaa' }}>adjustments</code> array, visible in the inline "Why?" breakdowns on the workout page.</div>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('llmReview')}>
            <span>10. LLM Workout Review</span>
            <span>{expanded.llmReview ? '−' : '+'}</span>
          </div>
          {expanded.llmReview && (
            <div style={S.sectionBody}>
              <div style={S.explain}>After rules-based validation, the workout is sent to an LLM (GPT-4o-mini) acting as an exercise science auditor. It produces two categories of output: immediate corrections (applied silently) and pattern observations (stored for future workouts).</div>
              <div style={S.cite}>Cost controls: one call per workout, 5-minute cache, profile summarization to reduce token count. No additional serverless functions — uses existing /api/insights route.</div>

              <p style={{ fontWeight: 600, marginTop: '12px', marginBottom: '4px', color: '#fff' }}>Immediate Corrections (applied this workout)</p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Correction Type</th>
                    <th style={S.th}>Example</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={S.td}>Weight adjustment</td><td style={{ ...S.td, color: '#aaa' }}>Reduce deadlift from 315 to 275 — volume too high for current fatigue</td></tr>
                  <tr><td style={S.td}>Set adjustment</td><td style={{ ...S.td, color: '#aaa' }}>Reduce lateral raises from 5 sets to 3 — diminishing returns past 3</td></tr>
                  <tr><td style={S.td}>Exercise swap</td><td style={{ ...S.td, color: '#aaa' }}>Replace barbell row with cable row — lower spinal fatigue after deadlift</td></tr>
                  <tr><td style={S.td}>Order change</td><td style={{ ...S.td, color: '#aaa' }}>Move face pulls before overhead press — better shoulder warm-up</td></tr>
                </tbody>
              </table>

              <p style={{ fontWeight: 600, marginTop: '16px', marginBottom: '4px', color: '#fff' }}>Pattern Observations (stored for future workouts)</p>
              <div style={{ padding: '10px', background: '#1a1a1a', borderRadius: '6px', fontSize: '12px', color: '#aaa', lineHeight: 1.6 }}>
                Observations are stored in the <code style={{ color: '#aaa' }}>model_feedback</code> table with type <code style={{ color: '#aaa' }}>pattern_observation</code>. On the next workout generation, <code style={{ color: '#aaa' }}>computeTrainingProfile()</code> fetches the last 10 observations from the past 30 days. <code style={{ color: '#aaa' }}>parseLlmPatternObservations()</code> extracts actionable hints — currently: exercises to avoid — which are injected into the engine's avoid list before exercise selection.
              </div>
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionHeader} onClick={() => toggle('llm')}>
            <span>11. LLM Feedback History</span>
            <span>{expanded.llm ? '−' : '+'}</span>
          </div>
          {expanded.llm && (() => {
            const obs = profile.llmPatternObservations || [];
            const avoidExercises: string[] = [];
            const preferExercises: string[] = [];
            for (const o of obs) {
              const s = (o.suggestion ?? '').toLowerCase();
              if (s.includes('avoid') || s.includes('remove') || s.includes('swap out') || s.includes('stop')) {
                const m = s.match(/(?:avoid|remove|swap out|stop)\s+(?:using\s+)?(.+?)(?:\s*[-—]|\.|$)/);
                if (m) avoidExercises.push(m[1].trim());
              }
              if (s.includes('add') || s.includes('consider') || s.includes('default to') || s.includes('prefer')) {
                const m = s.match(/(?:add|consider|default to|prefer)\s+(.+?)(?:\s*[-—]|\.|$)/);
                if (m) preferExercises.push(m[1].trim());
              }
            }
            return (
              <div style={S.sectionBody}>
                <div style={S.explain}>Stored pattern observations from recent LLM reviews. The engine parses these into actionable hints (exercises to avoid/prefer) that influence future workout generation.</div>

                {(avoidExercises.length > 0 || preferExercises.length > 0) && (
                  <div style={{ marginBottom: '16px', padding: '10px', background: '#1a1a1a', borderRadius: '8px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 600, color: '#fff' }}>Extracted Hints (applied to next workout):</span>
                    {avoidExercises.length > 0 && (
                      <div style={{ marginTop: '6px' }}>
                        <span style={{ color: '#ff6b6b' }}>Avoid:</span>{' '}
                        {avoidExercises.map((e, i) => (
                          <span key={i} style={{ ...S.badge, background: '#3a1a1a', color: '#ff6b6b', marginRight: '4px' }}>{e}</span>
                        ))}
                      </div>
                    )}
                    {preferExercises.length > 0 && (
                      <div style={{ marginTop: '6px' }}>
                        <span style={{ color: '#66bb6a' }}>Prefer:</span>{' '}
                        {preferExercises.map((e, i) => (
                          <span key={i} style={{ ...S.badge, background: '#1a3a1a', color: '#66bb6a', marginRight: '4px' }}>{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {obs.length === 0
                  ? <p style={{ color: '#666' }}>No LLM pattern observations yet.</p>
                  : obs.map((o, i) => (
                      <div key={i} style={{ marginBottom: '12px', padding: '10px', background: '#1a1a1a', borderRadius: '8px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{o.pattern}</div>
                        <div style={{ color: '#aaa' }}>{o.suggestion}</div>
                        <div style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>Confidence: {o.confidence}</div>
                      </div>
                    ))
                }
              </div>
            );
          })()}
        </div>

      </div>
    </div>
  )
}
