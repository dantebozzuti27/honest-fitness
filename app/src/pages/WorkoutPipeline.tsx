import { useLocation, useNavigate } from 'react-router-dom'
import type { GeneratedWorkout, MuscleGroupDecision, ExerciseDecision, DecisionLogEntry } from '../lib/workoutEngine'
import type { TrainingProfile } from '../lib/trainingAnalysis'
import BackButton from '../components/BackButton'
import S from './WorkoutPipeline.module.css'

interface LocationState {
  workout: GeneratedWorkout
  profile: TrainingProfile
}

export default function WorkoutPipeline() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LocationState | null

  if (!state?.workout || !state?.profile) {
    return (
      <div className={S.page}>
        <div className={S.header}>
          <BackButton onClick={() => navigate(-1)} />
          <h1 className={S.title}>Workout Pipeline</h1>
        </div>
        <div className={S.empty}>No workout data. Generate a workout first.</div>
      </div>
    )
  }

  const { workout: w, profile: p } = state

  return (
    <div className={S.page}>
      <div className={S.header}>
        <BackButton onClick={() => navigate(-1)} />
        <h1 className={S.title}>Why This Workout</h1>
      </div>
      <div className={S.scroll}>
        <SummaryBanner workout={w} profile={p} />
        <RecoverySection workout={w} profile={p} />
        <MuscleGroupSection decisions={w.muscleGroupDecisions} profile={p} />
        <ExerciseSection decisions={w.exerciseDecisions} exercises={w.exercises} />
        <PrescriptionSection exercises={w.exercises} />
        <DecisionLogSection log={w.decisionLog} />
        {w.policyState && <PolicySection policy={w.policyState} />}
        <RationaleSection workout={w} />
      </div>
    </div>
  )
}

function SummaryBanner({ workout: w, profile: p }: { workout: GeneratedWorkout; profile: TrainingProfile }) {
  const readiness = Math.round(p.fitnessFatigueModel.readiness * 100)
  const volMult = p.sleepVolumeModifier.volumeMultiplier
  const utility = w.objectiveUtility?.utility ?? p.canonicalModelContext?.objectiveUtility ?? 0

  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Session Overview</h2>
      <div className={S.statsGrid}>
        <StatCard label="Readiness" value={`${readiness}%`} color={readiness >= 70 ? '#22c55e' : readiness >= 50 ? '#eab308' : '#ef4444'} />
        <StatCard label="Volume Scale" value={`×${volMult.toFixed(2)}`} color={volMult >= 0.9 ? '#22c55e' : '#eab308'} />
        <StatCard label="Utility" value={`${Math.round(utility * 100)}%`} color={utility >= 0.6 ? '#22c55e' : '#eab308'} />
        <StatCard label="Exercises" value={String(w.exercises.length)} color="#14b8a6" />
        <StatCard label="Duration" value={`${w.estimatedDurationMinutes}m`} color="#14b8a6" />
        <StatCard label="Goal" value={w.trainingGoal.replace(/_/g, ' ')} color="#a78bfa" />
      </div>
      {w.deloadActive && <div className={S.deloadBanner}>DELOAD ACTIVE — Volume and intensity reduced</div>}
    </section>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={S.statCard}>
      <div className={S.statLabel}>{label}</div>
      <div className={S.statValue} style={{ color }}>{value}</div>
    </div>
  )
}

function RecoverySection({ workout: w, profile: p }: { workout: GeneratedWorkout; profile: TrainingProfile }) {
  const ctx = p.recoveryContext
  const sleepRatio = ctx.sleepBaseline30d > 0 ? (ctx.sleepDurationLastNight ?? 0) / ctx.sleepBaseline30d : null
  const hrvRatio = ctx.hrvBaseline30d > 0 ? (ctx.hrvLastNight ?? 0) / ctx.hrvBaseline30d : null
  const rhrRatio = ctx.rhrBaseline30d > 0 ? (ctx.rhrLastNight ?? 0) / ctx.rhrBaseline30d : null

  const signals: Array<{ label: string; value: string; status: 'good' | 'warning' | 'danger' | 'neutral' }> = []

  if (ctx.sleepDurationLastNight != null) {
    signals.push({
      label: 'Sleep',
      value: `${ctx.sleepDurationLastNight.toFixed(1)}h (${sleepRatio ? Math.round(sleepRatio * 100) : '—'}% of baseline)`,
      status: sleepRatio == null ? 'neutral' : sleepRatio >= 0.9 ? 'good' : sleepRatio >= 0.75 ? 'warning' : 'danger',
    })
  }
  if (ctx.hrvLastNight != null) {
    signals.push({
      label: 'HRV',
      value: `${Math.round(ctx.hrvLastNight)} ms (${hrvRatio ? Math.round(hrvRatio * 100) : '—'}% of baseline)`,
      status: hrvRatio == null ? 'neutral' : hrvRatio >= 0.85 ? 'good' : hrvRatio >= 0.7 ? 'warning' : 'danger',
    })
  }
  if (ctx.rhrLastNight != null) {
    signals.push({
      label: 'RHR',
      value: `${Math.round(ctx.rhrLastNight)} bpm (${rhrRatio ? Math.round(rhrRatio * 100) : '—'}% of baseline)`,
      status: rhrRatio == null ? 'neutral' : rhrRatio <= 1.05 ? 'good' : rhrRatio <= 1.15 ? 'warning' : 'danger',
    })
  }

  const sleepDebt = p.cumulativeSleepDebt
  if (sleepDebt.sleepDebt3d != null) {
    signals.push({
      label: '3-Day Sleep Debt',
      value: `${sleepDebt.sleepDebt3d.toFixed(1)}h`,
      status: sleepDebt.sleepDebt3d <= 1 ? 'good' : sleepDebt.sleepDebt3d <= 3 ? 'warning' : 'danger',
    })
  }

  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Step 1 — Recovery Check</h2>
      <p className={S.sectionDesc}>{w.recoveryStatus}</p>
      {signals.length > 0 ? (
        <div className={S.signalGrid}>
          {signals.map(s => (
            <div key={s.label} className={`${S.signalCard} ${S[s.status]}`}>
              <div className={S.signalLabel}>{s.label}</div>
              <div className={S.signalValue}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={S.muted}>No wearable data available — using defaults.</div>
      )}
      {w.adjustmentsSummary.length > 0 && (
        <div className={S.adjustments}>
          <div className={S.adjustmentsTitle}>Volume Adjustments</div>
          {w.adjustmentsSummary.map((a, i) => <div key={i} className={S.adjustment}>{a}</div>)}
        </div>
      )}
    </section>
  )
}

function MuscleGroupSection({ decisions, profile }: { decisions: MuscleGroupDecision[]; profile: TrainingProfile }) {
  const sorted = [...decisions].sort((a, b) => b.priority - a.priority)

  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Step 2 — Muscle Group Selection</h2>
      <p className={S.sectionDesc}>Which muscles to train today, based on split, recovery, and volume status.</p>
      <div className={S.decisionTable}>
        <div className={S.tableHeader}>
          <span>Muscle Group</span>
          <span>Priority</span>
          <span>Sets Target</span>
          <span>Recovery</span>
          <span>Reason</span>
        </div>
        {sorted.map(d => (
          <div key={d.muscleGroup} className={S.tableRow}>
            <span className={S.muscleLabel}>{d.muscleGroup.replace(/_/g, ' ')}</span>
            <span className={S.priorityBadge} style={{ background: d.priority >= 8 ? '#14b8a644' : d.priority >= 5 ? '#eab30844' : '#44444444', color: d.priority >= 8 ? '#14b8a6' : d.priority >= 5 ? '#eab308' : '#888' }}>
              {d.priority.toFixed(1)}
            </span>
            <span>{d.targetSets} sets</span>
            <span style={{ color: (d.recoveryPercent ?? 100) >= 85 ? '#22c55e' : '#eab308' }}>
              {d.recoveryPercent != null ? `${Math.round(d.recoveryPercent)}%` : '—'}
            </span>
            <span className={S.reasonText}>{d.reason}</span>
          </div>
        ))}
      </div>
      {profile.detectedSplit && (
        <div className={S.splitInfo}>
          Detected split: <strong>{profile.detectedSplit.type.replace(/_/g, ' ')}</strong> ({Math.round(profile.detectedSplit.confidence * 100)}% confidence)
        </div>
      )}
    </section>
  )
}

function ExerciseSection({ decisions, exercises }: { decisions: ExerciseDecision[]; exercises: GeneratedWorkout['exercises'] }) {
  const selectedNames = new Set(exercises.map(e => e.exerciseName.toLowerCase()))
  const selected = decisions.filter(d => selectedNames.has(d.exerciseName.toLowerCase()))
  const rejected = decisions.filter(d => !selectedNames.has(d.exerciseName.toLowerCase()))

  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Step 3 — Exercise Selection</h2>
      <p className={S.sectionDesc}>
        Scored {decisions.length} candidates. Selected {selected.length}, rejected {rejected.length}.
      </p>

      <div className={S.subsection}>
        <h3 className={S.subsectionTitle}>Selected ({selected.length})</h3>
        {selected.sort((a, b) => b.score - a.score).map(d => (
          <ExerciseDecisionCard key={d.exerciseName} decision={d} selected />
        ))}
      </div>

      {rejected.length > 0 && (
        <details className={S.rejectedDetails}>
          <summary className={S.rejectedSummary}>
            Rejected Candidates ({rejected.length})
          </summary>
          <div className={S.rejectedList}>
            {rejected.sort((a, b) => b.score - a.score).slice(0, 30).map(d => (
              <ExerciseDecisionCard key={d.exerciseName} decision={d} selected={false} />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function ExerciseDecisionCard({ decision: d, selected }: { decision: ExerciseDecision; selected: boolean }) {
  return (
    <div className={`${S.exerciseCard} ${selected ? S.exerciseSelected : S.exerciseRejected}`}>
      <div className={S.exerciseHeader}>
        <span className={S.exerciseName}>{d.exerciseName}</span>
        <span className={S.exerciseGroup}>{d.muscleGroup.replace(/_/g, ' ')}</span>
        <span className={S.exerciseScore} style={{ color: d.score >= 10 ? '#22c55e' : d.score >= 0 ? '#eab308' : '#ef4444' }}>
          {d.score >= 0 ? '+' : ''}{d.score.toFixed(1)}
        </span>
      </div>
      <div className={S.factorList}>
        {d.factors.map((f, i) => (
          <span key={i} className={`${S.factor} ${f.startsWith('-') || f.includes('(-') ? S.factorNeg : S.factorPos}`}>{f}</span>
        ))}
      </div>
    </div>
  )
}

function PrescriptionSection({ exercises }: { exercises: GeneratedWorkout['exercises'] }) {
  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Step 4 — Prescription</h2>
      <p className={S.sectionDesc}>Sets, reps, weight, tempo, and rest for each selected exercise.</p>
      <div className={S.prescriptionGrid}>
        {exercises.map((ex, i) => (
          <div key={i} className={S.prescriptionCard}>
            <div className={S.prescriptionHeader}>
              <span className={S.prescriptionName}>{ex.exerciseName}</span>
              <span className={S.prescriptionRole}>{ex.exerciseRole}</span>
            </div>
            <div className={S.prescriptionStats}>
              <span>{ex.sets} × {ex.targetReps}</span>
              {ex.targetWeight != null && <span>{ex.targetWeight} lbs</span>}
              {ex.targetRir != null && <span>RIR {ex.targetRir}</span>}
              <span>{ex.tempo}</span>
              <span>{ex.restSeconds}s rest</span>
            </div>
            {ex.rationale && <div className={S.prescriptionRationale}>{ex.rationale}</div>}
            {ex.adjustments.length > 0 && (
              <div className={S.prescriptionAdjustments}>
                {ex.adjustments.map((a, j) => <div key={j} className={S.adjustment}>{a}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function DecisionLogSection({ log }: { log: DecisionLogEntry[] }) {
  if (!log || log.length === 0) return null
  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Decision Log</h2>
      <p className={S.sectionDesc}>Chronological log of every decision the engine made.</p>
      <div className={S.logList}>
        {log.map((entry, i) => (
          <div key={i} className={S.logEntry}>
            <div className={S.logStep}>{entry.step}</div>
            <div className={S.logLabel}>{entry.label}</div>
            {entry.details.length > 0 && (
              <div className={S.logDetails}>
                {entry.details.map((d, j) => <div key={j}>{d}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function PolicySection({ policy }: { policy: NonNullable<GeneratedWorkout['policyState']> }) {
  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Policy State</h2>
      <div className={S.policyGrid}>
        {policy.pid && (
          <div className={S.policyCard}>
            <div className={S.policyLabel}>Fat-Loss PID Controller</div>
            <div className={S.policyStats}>
              <span>Error: {policy.pid.error.toFixed(3)}</span>
              <span>Integral: {policy.pid.integral.toFixed(3)}</span>
              <span>Derivative: {policy.pid.derivative.toFixed(3)}</span>
              <span>Signal: {policy.pid.controlSignal.toFixed(3)}</span>
            </div>
          </div>
        )}
        {policy.fusion && (
          <div className={S.policyCard}>
            <div className={S.policyLabel}>Policy Fusion</div>
            <div className={S.policyStats}>
              <span>Nutrition: ×{policy.fusion.nutritionMultiplier.toFixed(2)}</span>
              <span>Readiness: ×{policy.fusion.readinessMultiplier.toFixed(2)}</span>
              <span>Strength: ×{policy.fusion.strengthMultiplier.toFixed(2)}</span>
              <span>Progression: ×{policy.fusion.progressionMultiplier.toFixed(2)}</span>
              <span>Confidence: {Math.round(policy.fusion.confidence * 100)}%</span>
            </div>
          </div>
        )}
        {policy.guardrails && policy.guardrails.length > 0 && (
          <div className={S.policyCard}>
            <div className={S.policyLabel}>Guardrails Triggered</div>
            {policy.guardrails.map((g, i) => <div key={i} className={S.adjustment}>{g}</div>)}
          </div>
        )}
      </div>
    </section>
  )
}

function RationaleSection({ workout: w }: { workout: GeneratedWorkout }) {
  if (!w.sessionRationale) return null
  return (
    <section className={S.section}>
      <h2 className={S.sectionTitle}>Session Rationale</h2>
      <div className={S.rationaleText}>{w.sessionRationale}</div>
    </section>
  )
}
