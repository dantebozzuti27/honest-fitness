import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type OnSelectionChangeParams,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAuth } from '../context/AuthContext'
import { computeTrainingProfile, type TrainingProfile } from '../lib/trainingAnalysis'
import { getIdToken } from '../lib/cognitoAuth'
import { db } from '../lib/dbClient'
import { apiUrl } from '../lib/urlConfig'
import BackButton from '../components/BackButton'
import Spinner from '../components/Spinner'
import { logError } from '../utils/logger'
import S from './ModelDashboard.module.css'

const EDGE_COLOR = '#14b8a6'

/* ── Custom Node ── */

type PipelineNodeData = {
  num: number
  label: string
  preview: string
}

type PolicyEpisodeSummary = {
  sampleSize: number
  promoteReady: boolean
  promoteReadyCount: number
}

type PolicyEpisodeEval = {
  episode_key: string
  status: string
  metrics: {
    sampleSize: number
    avgObjective: number
    avgRegret: number
    avgAdherence: number
  }
  promoteReady: boolean
}

type ReplayScenarioSummary = {
  id: string
  scenario_name: string
  status: string
  baseline_policy_version: string
  candidate_policy_version: string
  created_at: string
  config?: Record<string, unknown>
}

const PipelineNode = memo(({ data, selected }: NodeProps & { data: PipelineNodeData }) => (
  <div className={`${S.nodeCard} ${selected ? S.nodeCardSelected : ''}`}>
    <Handle type="target" position={Position.Left} style={{ background: EDGE_COLOR, border: 'none', width: 6, height: 6 }} />
    <div className={S.nodeBadge}>{data.num}</div>
    <div className={S.nodeLabel}>{data.label}</div>
    <div className={S.nodePreview}>{data.preview}</div>
    <Handle type="source" position={Position.Right} style={{ background: EDGE_COLOR, border: 'none', width: 6, height: 6 }} />
  </div>
))

const nodeTypes = { pipeline: PipelineNode }

/* ── Node preview text (algorithm actions) ── */

function computeNodePreviews(p: TrainingProfile): Record<number, string> {
  const belowMev = (p.muscleVolumeStatuses || []).filter(v => v.status === 'below_mev').length
  const topPriority = (p.muscleVolumeStatuses || [])
    .sort((a, b) => (b.mavLow - b.weeklyDirectSets) - (a.mavLow - a.weeklyDirectSets))[0]
  const progressing = (p.exerciseProgressions || []).filter(ep => ep.status === 'progressing').length
  const stalled = (p.exerciseProgressions || []).filter(ep => ep.status === 'stalled').length
  const learned = (p.exercisePreferences || []).filter(ep => ep.recentSessions >= 2).length
  const fallback = (p.exercisePreferences || []).filter(ep => ep.recentSessions < 2).length
  const volMult = p.sleepVolumeModifier.volumeMultiplier
  const readiness = Math.round(p.fitnessFatigueModel.readiness * 100)
  const obs = (p.llmPatternObservations || []).length
  const trendCount = (p.rolling30DayTrends.exerciseTrends || []).length
  const mgCount = (p.rolling30DayTrends.muscleGroupTrends || []).length
  const utilityPct = Math.round((p.canonicalModelContext?.objectiveUtility ?? 0) * 100)
  const setAccPct = Math.round((p.prescribedVsActual?.avgSetExecutionAccuracy ?? 0) * 100)
  const cardioCaps = (p.cardioCapabilityProfiles || []).length
  const nutritionCov = p.nutritionLoggingCoverage14d
  const affinityPairs = (p.substitutionAffinities || []).length

  return {
    1: `Ingested ${p.totalWorkoutCount} sessions, ${p.healthDataDays} health days`,
    2: `Computed ${trendCount} 1RM trends, ${mgCount} volume trajectories`,
    3: `Scaled volume ×${volMult.toFixed(2)} (readiness ${readiness}%)`,
    4: `${belowMev} groups below MEV${topPriority ? `, priority: ${topPriority.muscleGroup.replace(/_/g, ' ')}` : ''}`,
    5: `Scored ${(p.exercisePreferences || []).length} candidates`,
    6: `${progressing} progressing, ${stalled} stalled`,
    7: `${learned} learned, ${fallback} fallback (${cardioCaps} cardio capability profiles)${
      nutritionCov != null ? `, nutrition log ${Math.round(nutritionCov * 100)}% (14d)` : ''
    }${affinityPairs ? `, ${affinityPairs} sub-affinity pairs` : ''}`,
    8: `Budget: ${p.avgSessionDuration} min`,
    9: `4 rules checked`,
    10: `${obs} stored observations`,
    11: `Utility ${utilityPct}% | Set accuracy ${setAccPct}%`,
  }
}

/* ── Node positions (static) ── */

const NODE_POSITIONS: { x: number; y: number }[] = [
  { x: 0,    y: 200 },  // 1
  { x: 260,  y: 200 },  // 2
  { x: 540,  y: 100 },  // 3
  { x: 540,  y: 300 },  // 4
  { x: 820,  y: 200 },  // 5
  { x: 1100, y: 200 },  // 6
  { x: 1380, y: 200 },  // 7
  { x: 1660, y: 200 },  // 8
  { x: 1940, y: 100 },  // 9
  { x: 1940, y: 300 },  // 10
  { x: 2220, y: 200 },  // 11
]

const NODE_LABELS = [
  'Data Collection',
  'Feature Engineering',
  'Recovery State',
  'Volume Status',
  'Exercise Selection',
  'Progressions',
  'Prescription',
  'Time Fit',
  'Validation',
  'LLM Review',
  'Final Output',
]

function buildNodes(previews: Record<number, string>): Node[] {
  return NODE_LABELS.map((label, i) => ({
    id: String(i + 1),
    type: 'pipeline',
    position: NODE_POSITIONS[i],
    data: { num: i + 1, label, preview: previews[i + 1] || '' } as PipelineNodeData,
  }))
}

const EDGE_STYLE = { stroke: EDGE_COLOR }
const EDGE_MARKER = { type: MarkerType.ArrowClosed, color: EDGE_COLOR }
const EDGE_LABEL_STYLE = { fill: '#888', fontSize: 9 }

/* ── Panel metadata per node ── */

const PANEL_META: Record<string, { title: string; subtitle: string }> = {
  '1':  { title: 'Data Collection',       subtitle: 'Ingest workout logs, wearable data, body composition' },
  '2':  { title: 'Feature Engineering',    subtitle: 'Epley 1RM, volume trajectories, baseline comparisons' },
  '3':  { title: 'Recovery State',         subtitle: 'Banister fitness-fatigue model + sleep/HRV modifiers' },
  '4':  { title: 'Volume Status',          subtitle: 'MEV/MAV/MRV landmarks + priority scoring' },
  '5':  { title: 'Exercise Selection',     subtitle: 'Weighted scoring across preference, progression, fatigue' },
  '6':  { title: 'Progressions',           subtitle: 'Epley 1RM trends + progression/stall/regression detection' },
  '7':  { title: 'Prescription',           subtitle: 'Learned medians vs. table fallbacks per parameter' },
  '8':  { title: 'Time Fit',              subtitle: 'SFR-based greedy expansion/trimming to session budget' },
  '9':  { title: 'Validation',            subtitle: '4 deterministic safety checks on generated workout' },
  '10': { title: 'LLM Review',            subtitle: 'GPT-4o-mini exercise science audit (1 call/workout)' },
  '11': { title: 'Final Output',          subtitle: 'Aggregate adjustments from all pipeline stages' },
}

function buildEdges(p: TrainingProfile): Edge[] {
  const readiness = Math.round(p.fitnessFatigueModel.readiness * 100)
  const volMult = p.sleepVolumeModifier.volumeMultiplier.toFixed(2)
  const belowMev = (p.muscleVolumeStatuses || []).filter(v => v.status === 'below_mev').length
  const progressing = (p.exerciseProgressions || []).filter(ep => ep.status === 'progressing').length
  const learned = (p.exercisePreferences || []).filter(ep => ep.recentSessions >= 2).length
  const cardioCaps = (p.cardioCapabilityProfiles || []).length
  const obs = (p.llmPatternObservations || []).length

  const base = { type: 'smoothstep' as const, animated: true, style: EDGE_STYLE, markerEnd: EDGE_MARKER, labelStyle: EDGE_LABEL_STYLE }

  return [
    { ...base, id: 'e1-2',   source: '1',  target: '2',  label: `${p.totalWorkoutCount} workouts, ${p.healthDataDays}d health` },
    { ...base, id: 'e2-3',   source: '2',  target: '3',  label: 'sleep, HRV, RHR trends' },
    { ...base, id: 'e2-4',   source: '2',  target: '4',  label: '1RM + volume trends' },
    { ...base, id: 'e3-5',   source: '3',  target: '5',  label: `readiness ${readiness}%, vol ×${volMult}` },
    { ...base, id: 'e4-5',   source: '4',  target: '5',  label: `${belowMev} groups below MEV` },
    { ...base, id: 'e5-6',   source: '5',  target: '6',  label: 'selected exercises' },
    { ...base, id: 'e6-7',   source: '6',  target: '7',  label: `${progressing} progressing` },
    { ...base, id: 'e7-8',   source: '7',  target: '8',  label: `${learned} learned + ${cardioCaps} cardio envelopes` },
    { ...base, id: 'e8-9',   source: '8',  target: '9',  label: 'fitted workout' },
    { ...base, id: 'e8-10',  source: '8',  target: '10', label: 'fitted workout' },
    { ...base, id: 'e9-11',  source: '9',  target: '11', label: 'validated' },
    { ...base, id: 'e10-11', source: '10', target: '11', label: `${obs} observations` },
  ]
}

async function fetchAuthedJson(path: string, init?: RequestInit): Promise<any> {
  const token = await getIdToken()
  if (!token) throw new Error('Not authenticated')
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || err?.error?.message || `Request failed (${res.status})`)
  }
  return res.json()
}

/* ── Panel content renderer ── */

function renderPanelContent(nodeId: string, p: TrainingProfile) {
  switch (nodeId) {
    case '1': return <DataCollectionPanel profile={p} />
    case '2': return <FeatureEngineeringPanel profile={p} />
    case '3': return <RecoveryStatePanel profile={p} />
    case '4': return <VolumeStatusPanel profile={p} />
    case '5': return <ExerciseSelectionPanel profile={p} />
    case '6': return <ProgressionsPanel profile={p} />
    case '7': return <PrescriptionPanel profile={p} />
    case '8': return <TimeFitPanel profile={p} />
    case '9': return <ValidationPanel />
    case '10': return <LlmReviewPanel />
    case '11': return <FinalOutputPanel profile={p} />
    default: return <p style={{ color: '#666', fontStyle: 'italic' }}>Detail content coming soon.</p>
  }
}

/* ── Section 1: Data Collection ── */

function DataCollectionPanel({ profile: p }: { profile: TrainingProfile }) {
  const wkCount = p.totalWorkoutCount
  const tier = wkCount < 10 ? 'bootstrap' : wkCount < 30 ? 'learning' : 'personalized'
  const healthDays = p.healthDataDays
  const wearables = p.connectedWearables
  const consistency = Math.round(p.consistencyScore * 100)
  const cardioCaps = (p.cardioCapabilityProfiles || []).length

  const nextTierThreshold = tier === 'bootstrap' ? 10 : tier === 'learning' ? 30 : null
  const workoutsToNext = nextTierThreshold ? nextTierThreshold - wkCount : 0

  return (
    <>
      <div className={S.summary}>
        Model is in <strong>{tier}</strong> mode with {wkCount} logged workouts.
        {tier !== 'personalized'
          ? ` ${workoutsToNext} more workouts until ${tier === 'bootstrap' ? 'learning' : 'fully personalized'} mode.`
          : ' All predictions use your personal training data as the primary source.'}
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Confidence Tier — Decision Tree</div>
        <div className={`${S.decisionBranch} ${tier === 'bootstrap' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${tier === 'bootstrap' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>If workouts &lt; 10:</span>
            <span className={S.branchResult}> Bootstrap mode — mostly table defaults, minimal personalization</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${tier === 'learning' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${tier === 'learning' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>If 10–29 workouts:</span>
            <span className={S.branchResult}> Learning mode — mix of learned data and fallbacks</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${tier === 'personalized' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${tier === 'personalized' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>If ≥ 30 workouts:</span>
            <span className={S.branchResult}> Fully personalized — your data is primary source for all prescriptions</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Data Sources & Coverage</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Source</th><th>Status</th><th>Impact</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Workout logs</td>
            <td style={{ fontWeight: 600 }}>{wkCount} sessions</td>
            <td>Exercise selection, prescription, progression</td>
          </tr>
          <tr>
            <td>Health metrics</td>
            <td style={{ fontWeight: 600 }}>{healthDays} days</td>
            <td>Recovery state, volume modifiers, deload triggers</td>
          </tr>
          <tr>
            <td>Wearables</td>
            <td style={{ fontWeight: 600 }}>{wearables.length > 0 ? wearables.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ') : 'None'}</td>
            <td>{wearables.length > 0 ? 'HRV, sleep quality, RHR baselines' : 'No wearable data — recovery uses workout-only signals'}</td>
          </tr>
          <tr>
            <td>Consistency</td>
            <td style={{ fontWeight: 600, color: consistency >= 75 ? '#66bb6a' : consistency >= 50 ? '#ffa726' : '#ff6b6b' }}>{consistency}%</td>
            <td>Higher consistency = more reliable trend detection</td>
          </tr>
          <tr>
            <td>Cardio capability envelopes</td>
            <td style={{ fontWeight: 600 }}>{cardioCaps}</td>
            <td>Personalized modality caps + preferred HR zone windows</td>
          </tr>
        </tbody>
      </table>

      {tier !== 'personalized' && (
        <div className={S.counterfactual}>
          With {workoutsToNext} more workout{workoutsToNext !== 1 ? 's' : ''}, the model will
          switch to {tier === 'bootstrap' ? 'learning' : 'fully personalized'} mode —
          {tier === 'bootstrap'
            ? ' exercise preferences and learned reps/sets will begin influencing prescriptions.'
            : ' all prescriptions will use your personal data as the primary source, table fallbacks become secondary.'}
        </div>
      )}
      {tier === 'personalized' && (
        <div className={S.counterfactual}>
          If your data dropped below 30 workouts (e.g., account reset), the model would revert
          to learning mode and rely more heavily on textbook defaults until sufficient history rebuilds.
        </div>
      )}
    </>
  )
}

/* ── Section 2: Feature Engineering ── */

function FeatureEngineeringPanel({ profile: p }: { profile: TrainingProfile }) {
  const t = p.rolling30DayTrends
  const exerciseTrends = t.exerciseTrends || []
  const mgTrends = t.muscleGroupTrends || []
  const progressingE1rm = exerciseTrends.filter(et => et.estimated1RM.direction === 'up').length
  const decliningE1rm = exerciseTrends.filter(et => et.estimated1RM.direction === 'down').length

  const sleepFlag = t.sleep.current != null && t.sleep.avg30d != null
    ? ((t.sleep.current - t.sleep.avg30d) / t.sleep.avg30d * 100)
    : null
  const hrvFlag = t.hrv.current != null && t.hrv.avg30d != null
    ? ((t.hrv.current - t.hrv.avg30d) / t.hrv.avg30d * 100)
    : null

  return (
    <>
      <div className={S.summary}>
        Transformed raw data into {exerciseTrends.length} exercise 1RM trends
        and {mgTrends.length} muscle group volume trajectories.
        {progressingE1rm > 0 && ` ${progressingE1rm} exercises trending up.`}
        {decliningE1rm > 0 && ` ${decliningE1rm} exercises trending down.`}
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Feature Thresholds — What Triggers Action</div>
        <div className={`${S.decisionBranch} ${progressingE1rm > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${progressingE1rm > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>1RM slope &gt; 0 for 2+ weeks:</span>
            <span className={S.branchResult}> Progression detected → +3 selection score for that exercise</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${decliningE1rm > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${decliningE1rm > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>1RM slope &lt; 0:</span>
            <span className={S.branchResult}> Regression detected → −1 selection score, rotation considered</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${(hrvFlag != null && hrvFlag < -15) ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${(hrvFlag != null && hrvFlag < -15) ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>HRV drops &gt; 15% below baseline:</span>
            <span className={S.branchResult}> Recovery flag → HRV intensity modifier reduces volume</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${(sleepFlag != null && sleepFlag < -10) ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${(sleepFlag != null && sleepFlag < -10) ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>Sleep drops &gt; 10% below baseline:</span>
            <span className={S.branchResult}> Sleep debt flag → volume multiplier reduced</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Health Metrics vs Baselines</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Metric</th><th>Current</th><th>30d Avg</th><th>Deviation</th><th>Trend</th></tr>
        </thead>
        <tbody>
          {([
            { label: 'Sleep (hrs)', m: t.sleep },
            { label: 'HRV (ms)', m: t.hrv },
            { label: 'RHR (bpm)', m: t.rhr },
          ]).map(({ label, m }) => {
            const dev = m.current != null && m.avg30d != null && m.avg30d !== 0
              ? ((m.current - m.avg30d) / m.avg30d * 100) : null
            return (
              <tr key={label}>
                <td>{label}</td>
                <td style={{ fontWeight: 600 }}>{m.current?.toFixed(1) ?? '—'}</td>
                <td>{m.avg30d?.toFixed(1) ?? '—'}</td>
                <td style={{ color: dev != null ? (dev >= 0 ? '#66bb6a' : '#ff6b6b') : '#666' }}>
                  {dev != null ? `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%` : '—'}
                </td>
                <td>
                  <span style={{ color: m.direction === 'up' ? '#66bb6a' : m.direction === 'down' ? '#ff6b6b' : '#999' }}>
                    {m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→'} {m.slopePct !== 0 ? `${m.slopePct > 0 ? '+' : ''}${m.slopePct.toFixed(1)}%/wk` : 'flat'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className={S.sectionLabel}>Top Exercise 1RM Trends</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Exercise</th><th>e1RM</th><th>30d Avg</th><th>Trend</th></tr>
        </thead>
        <tbody>
          {exerciseTrends.slice(0, 6).map(et => (
            <tr key={et.exerciseName}>
              <td>{et.exerciseName}</td>
              <td style={{ fontWeight: 600 }}>{et.estimated1RM.current?.toFixed(0) ?? '—'}</td>
              <td>{et.estimated1RM.avg30d?.toFixed(0) ?? '—'}</td>
              <td>
                <span style={{ color: et.estimated1RM.direction === 'up' ? '#66bb6a' : et.estimated1RM.direction === 'down' ? '#ff6b6b' : '#999' }}>
                  {et.estimated1RM.direction === 'up' ? '↑' : et.estimated1RM.direction === 'down' ? '↓' : '→'} {et.estimated1RM.slopePct !== 0 ? `${et.estimated1RM.slopePct > 0 ? '+' : ''}${et.estimated1RM.slopePct.toFixed(1)}%/wk` : 'flat'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={S.counterfactual}>
        {progressingE1rm > 0
          ? `${progressingE1rm} exercise${progressingE1rm > 1 ? 's are' : ' is'} progressing — these get a +3 selection bonus, making them more likely to appear in workouts. If they stalled, the bonus would drop to +1 and rotation pressure would increase.`
          : 'No exercises are currently progressing. The model will rely more on table defaults and may suggest exercise rotations to break through plateaus.'}
      </div>
    </>
  )
}

/* ── Section 3: Recovery State ── */

function RecoveryStatePanel({ profile: p }: { profile: TrainingProfile }) {
  const readiness = p.fitnessFatigueModel.readiness
  const readinessPct = Math.round(readiness * 100)
  const fitness = p.fitnessFatigueModel.fitnessLevel
  const fatigue = p.fitnessFatigueModel.fatigueLevel
  const volMult = p.sleepVolumeModifier.volumeMultiplier
  const restMult = p.sleepVolumeModifier.restTimeMultiplier
  const hrvMult = p.hrvIntensityModifier.intensityMultiplier
  const sleepDebt = p.cumulativeSleepDebt.sleepDebt7d
  const recoveryMod = p.cumulativeSleepDebt.recoveryModifier
  const deload = p.deloadRecommendation

  const readinessTier = readiness < 0.6 ? 'deload' : readiness < 0.75 ? 'reduced' : readiness < 0.9 ? 'normal' : 'push'

  return (
    <>
      <div className={S.summary}>
        Readiness is {readinessPct}% (fitness {fitness.toFixed(1)} − fatigue {fatigue.toFixed(1)}).
        Volume scaled ×{volMult.toFixed(2)}, rest ×{restMult.toFixed(2)}.
        {deload.needed ? ` Deload recommended (${deload.suggestedDurationDays}d).` : ''}
        {' '}Mesocycle phase: {readinessTier === 'deload' ? 'Deload' : readiness < 0.75 ? 'Accumulation' : readiness < 0.9 ? 'Loading' : 'Overreach'}.
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Readiness → Volume Decision Tree</div>
        <div className={`${S.decisionBranch} ${readinessTier === 'deload' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${readinessTier === 'deload' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>Readiness &lt; 60%:</span>
            <span className={S.branchResult}> Deload triggered — volume ×{deload.suggestedVolumeMultiplier ?? '0.5'}, RIR → 4, easy cardio only</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${readinessTier === 'reduced' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${readinessTier === 'reduced' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>60–74% readiness:</span>
            <span className={S.branchResult}> Reduced volume — vol ×0.85, longer rest periods, compound focus</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${readinessTier === 'normal' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${readinessTier === 'normal' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>75–89% readiness:</span>
            <span className={S.branchResult}> Normal training — standard volume and intensity targets</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${readinessTier === 'push' ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${readinessTier === 'push' ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>≥ 90% readiness:</span>
            <span className={S.branchResult}> Push day — can handle higher volume, heavier weights, shorter rest</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Recovery Modifiers — Weights Applied</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Factor</th><th>Value</th><th>Effect</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Banister readiness</td>
            <td style={{ fontWeight: 600 }}>{readinessPct}%</td>
            <td>Primary signal — fitness ({fitness.toFixed(1)}) minus fatigue ({fatigue.toFixed(1)})</td>
          </tr>
          <tr>
            <td>Sleep volume modifier</td>
            <td style={{ fontWeight: 600, color: volMult < 0.9 ? '#ff6b6b' : '#66bb6a' }}>×{volMult.toFixed(2)}</td>
            <td>{p.sleepVolumeModifier.reason}</td>
          </tr>
          <tr>
            <td>Sleep rest modifier</td>
            <td style={{ fontWeight: 600 }}>×{restMult.toFixed(2)}</td>
            <td>{restMult > 1 ? 'Rest periods extended due to poor sleep' : 'Normal rest periods'}</td>
          </tr>
          <tr>
            <td>HRV intensity modifier</td>
            <td style={{ fontWeight: 600, color: hrvMult < 0.9 ? '#ff6b6b' : '#66bb6a' }}>×{hrvMult.toFixed(2)}</td>
            <td>{p.hrvIntensityModifier.recommendation}</td>
          </tr>
          <tr>
            <td>Sleep debt (7d)</td>
            <td style={{ fontWeight: 600, color: (sleepDebt ?? 0) < -1 ? '#ff6b6b' : '#e0e0e0' }}>
              {sleepDebt != null ? `${sleepDebt.toFixed(1)} hrs` : '—'}
            </td>
            <td>Recovery modifier: ×{recoveryMod.toFixed(2)}</td>
          </tr>
          <tr>
            <td>Deload status</td>
            <td style={{ fontWeight: 600, color: deload.needed ? '#ffa726' : '#66bb6a' }}>
              {deload.needed ? 'Recommended' : 'Not needed'}
            </td>
            <td>{deload.needed ? `${deload.suggestedDurationDays}d at ×${deload.suggestedVolumeMultiplier} volume` : 'Training load sustainable'}</td>
          </tr>
        </tbody>
      </table>

      {deload.needed && deload.signals.length > 0 && (
        <>
          <div className={S.sectionLabel}>Deload Signals Triggered</div>
          {deload.signals.map((sig, i) => (
            <div key={i} className={`${S.decisionBranch} ${S.decisionBranchActive}`} style={{ marginBottom: 4 }}>
              <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
              <div>{sig}</div>
            </div>
          ))}
        </>
      )}

      <div className={S.counterfactual}>
        {readinessTier === 'normal'
          ? `If readiness dropped below 75% (currently ${readinessPct}%), volume would be scaled to ×0.85 and rest periods extended. ${100 - readinessPct < 11 ? `You're ${90 - readinessPct}% away from push territory where the model would increase volume targets.` : ''}`
          : readinessTier === 'push'
          ? `If readiness dropped below 90% (currently ${readinessPct}%), the model would revert to normal training volume instead of the current elevated targets.`
          : readinessTier === 'reduced'
          ? `If readiness recovered above 75% (needs +${75 - readinessPct}%), volume would return to normal. If it drops below 60%, a full deload would be triggered.`
          : `Readiness is critically low. If it recovers above 60% (needs +${60 - readinessPct}%), reduced training would resume. Above 75% for normal training.`
        }
      </div>
    </>
  )
}

/* ── Section 4: Volume Status ── */

function VolumeStatusPanel({ profile: p }: { profile: TrainingProfile }) {
  const statusPriority: Record<string, number> = { below_mev: 4, in_mev_mav: 3, in_mav: 1, approaching_mrv: 2, above_mrv: 2 }
  const rows = (p.muscleVolumeStatuses || []).map(v => {
    const deficit = v.mavLow - v.weeklyDirectSets
    const freq = p.muscleGroupFrequency[v.muscleGroup] ?? 0
    const priority = (statusPriority[v.status] ?? 0) * 10 + Math.max(0, deficit) * 2 + (v.daysSinceLastTrained > 5 ? 5 : 0)
    return { ...v, deficit, freq, priority }
  }).sort((a, b) => b.priority - a.priority)

  const belowMev = rows.filter(r => r.status === 'below_mev').length
  const inMav = rows.filter(r => r.status === 'in_mav').length
  const approachingMrv = rows.filter(r => r.status === 'approaching_mrv' || r.status === 'above_mrv').length
  const topGroup = rows[0]

  const statusColors: Record<string, string> = {
    below_mev: '#ff6b6b', in_mev_mav: '#ffa726', in_mav: '#66bb6a',
    approaching_mrv: '#ffa726', above_mrv: '#ff6b6b',
  }

  return (
    <>
      <div className={S.summary}>
        {belowMev} group{belowMev !== 1 ? 's' : ''} below MEV, {inMav} in productive MAV range, {approachingMrv} near/above MRV.
        {topGroup ? ` Top priority: ${topGroup.muscleGroup.replace(/_/g, ' ')} (score ${Math.round(topGroup.priority)}).` : ''}
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Priority Scoring Formula</div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>Base = status × 10:</span>
            <span className={S.branchResult}> below_mev ×4, in_mev_mav ×3, approaching_mrv ×2, in_mav ×1</span>
          </div>
        </div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>+ deficit × 2:</span>
            <span className={S.branchResult}> sets below MAV low-end (0 if already in MAV+)</span>
          </div>
        </div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>+ staleness bonus:</span>
            <span className={S.branchResult}> +5 if days since last trained &gt; 5</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>All Muscle Groups — Sorted by Priority</div>
      <table className={S.weightsTable}>
        <thead>
          <tr>
            <th>Group</th>
            <th>Sets/wk</th>
            <th>MEV</th>
            <th>MAV</th>
            <th>MRV</th>
            <th>Deficit</th>
            <th>Freq</th>
            <th>Priority</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(v => (
            <tr key={v.muscleGroup}>
              <td>{v.muscleGroup.replace(/_/g, ' ')}</td>
              <td style={{ fontWeight: 600 }}>{v.weeklyDirectSets}</td>
              <td>{v.mev}</td>
              <td>{v.mavLow}–{v.mavHigh}</td>
              <td>{v.mrv}</td>
              <td style={{ color: v.deficit > 0 ? '#ff6b6b' : '#66bb6a', fontWeight: 600 }}>
                {v.deficit > 0 ? `−${v.deficit}` : v.deficit === 0 ? '0' : `+${Math.abs(v.deficit)}`}
              </td>
              <td>{v.freq.toFixed(1)}</td>
              <td style={{ fontWeight: 600 }}>{Math.round(v.priority)}</td>
              <td>
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: statusColors[v.status] || '#555', color: '#000', fontWeight: 500 }}>
                  {v.status.replace(/_/g, ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {topGroup && (
        <div className={S.counterfactual}>
          {topGroup.status === 'below_mev'
            ? `${topGroup.muscleGroup.replace(/_/g, ' ')} has a deficit of ${topGroup.deficit} sets. If you trained it ${Math.ceil(topGroup.deficit / 3)} more session${Math.ceil(topGroup.deficit / 3) > 1 ? 's' : ''} this week (adding ~3 sets each), it would reach the productive MAV range and priority would drop from ${Math.round(topGroup.priority)} to ~${Math.round((statusPriority.in_mav ?? 1) * 10)}.`
            : topGroup.status === 'in_mev_mav'
            ? `${topGroup.muscleGroup.replace(/_/g, ' ')} is between MEV and MAV — maintaining but not optimally growing. ${topGroup.deficit > 0 ? `Adding ${topGroup.deficit} more sets/week would push it into the productive MAV range.` : 'Volume is on the edge of productive range.'}`
            : `${topGroup.muscleGroup.replace(/_/g, ' ')} is the current top priority (score ${Math.round(topGroup.priority)}). The engine will allocate exercises for this group first during selection.`
          }
        </div>
      )}
    </>
  )
}

/* ── Section 5: Exercise Selection ── */

function ExerciseSelectionPanel({ profile: p }: { profile: TrainingProfile }) {
  const prefs = p.exercisePreferences || []
  const swaps = p.exerciseSwapHistory || []
  const affinities = p.substitutionAffinities || []
  const nutritionCov = p.nutritionLoggingCoverage14d
  const totalCandidates = prefs.length
  const staples = prefs.filter(ep => ep.isStaple).length
  const swappedFrequently = swaps.filter(s => s.swapCount >= 3).length

  const scoringFactors = [
    { factor: 'Performance goal match',       weight: '+6',  cond: 'User has a specific target for this exercise', positive: true },
    { factor: 'Staple exercise',              weight: '+4',  cond: 'Consistently used across training history', positive: true },
    { factor: 'User preference (recency)',    weight: '+0–8', cond: 'recencyScore × 2.5 — proportional to recent usage', positive: true },
    { factor: 'Recently used (<14d)',         weight: '+2',  cond: 'Last performed within 14 days', positive: true },
    { factor: 'Progressing',                  weight: '+3',  cond: 'Positive slope on estimated 1RM trend', positive: true },
    { factor: 'Compound movement',            weight: '+2',  cond: 'Multi-joint exercise', positive: true },
    { factor: 'Stalled progression',          weight: '+1',  cond: 'No progress but not regressing', positive: true },
    { factor: 'Regressing',                   weight: '−1',  cond: 'Negative slope on 1RM trend', positive: false },
    { factor: 'Ordering interference',        weight: '−2',  cond: 'Negative interaction with preceding exercise', positive: false },
    { factor: 'Pattern fatigue (moderate)',    weight: '−2',  cond: 'Movement pattern used recently with moderate fatigue', positive: false },
    { factor: 'Plateaued (swap suggested)',    weight: '−3',  cond: 'Plateau detected, variation recommended', positive: false },
    { factor: 'Never used',                   weight: '−3',  cond: 'Exercise not in user training history', positive: false },
    { factor: 'Equipment unavailable',        weight: '−5',  cond: 'Requires unavailable equipment', positive: false },
    { factor: 'Rotation suggested (4+ wks)',  weight: '−5',  cond: 'Same isolation used 4+ consecutive weeks', positive: false },
    { factor: 'Swap learning (1–2×)',         weight: '−5/−10', cond: 'User previously swapped this exercise out', positive: false },
    { factor: 'Pattern fatigue (high)',       weight: '−6',  cond: 'Movement pattern used recently with high fatigue', positive: false },
    { factor: 'Stale exercise (6+ wks)',      weight: '−10', cond: 'Forced rotation — exercise used 6+ weeks', positive: false },
    { factor: 'Frequently swapped (3+×)',     weight: '−15', cond: 'User consistently rejects this exercise', positive: false },
  ]

  return (
    <>
      <div className={S.summary}>
        Scored {totalCandidates} candidate exercises. {staples} are staples (auto +4).
        {swappedFrequently > 0 ? ` ${swappedFrequently} exercise${swappedFrequently > 1 ? 's' : ''} penalized from frequent swaps (−15).` : ''}
        {nutritionCov != null
          ? ` Nutrition logging coverage (14d): ${Math.round(nutritionCov * 100)}% — feeds fat-loss controller dampening.`
          : ''}
        {affinities.length > 0
          ? ` Learned ${affinities.length} substitution pair${affinities.length > 1 ? 's' : ''} (decay-weighted).`
          : ''}
      </div>

      {nutritionCov != null && (
        <>
          <div className={S.sectionLabel}>Nutrition signal (fat-loss PID)</div>
          <div className={S.counterfactual}>
            Last 14 days with calorie entries: {Math.round(nutritionCov * 100)}%.
            Sparse logging reduces confidence in nutrition-adherence coupling and damps aggressive fat-loss dosing.
          </div>
        </>
      )}

      {affinities.length > 0 && (
        <>
          <div className={S.sectionLabel}>Top substitution affinities (from → to)</div>
          <table className={S.weightsTable}>
            <thead>
              <tr><th>From</th><th>To</th><th>Affinity</th><th>Events</th></tr>
            </thead>
            <tbody>
              {affinities.slice(0, 10).map(a => (
                <tr key={`${a.fromExercise}\t${a.toExercise}`}>
                  <td>{a.fromExercise}</td>
                  <td>{a.toExercise}</td>
                  <td style={{ fontWeight: 600 }}>{a.affinity}</td>
                  <td>{a.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Selection Flow</div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Step 1:</span>
            <span className={S.branchResult}> For each muscle group from priority list, gather all candidate exercises</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Step 2:</span>
            <span className={S.branchResult}> Score each candidate — sum all applicable factors (see table below)</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Step 3:</span>
            <span className={S.branchResult}> Select highest-scoring exercise per group, check ordering interference</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Step 4:</span>
            <span className={S.branchResult}> Global sort — compounds first, then isolations</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Scoring Factors & Weights</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Factor</th><th>Weight</th><th>Condition</th></tr>
        </thead>
        <tbody>
          {scoringFactors.map(r => (
            <tr key={r.factor}>
              <td>{r.factor}</td>
              <td style={{ fontWeight: 600, color: r.positive ? '#66bb6a' : '#ff6b6b' }}>{r.weight}</td>
              <td style={{ color: '#aaa' }}>{r.cond}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={S.sectionLabel}>Your Top Exercise Preferences</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Exercise</th><th>Sessions</th><th>Recency</th><th>Staple</th><th>Last Used</th></tr>
        </thead>
        <tbody>
          {prefs.slice(0, 10).map(ep => (
            <tr key={ep.exerciseName}>
              <td>{ep.exerciseName}</td>
              <td>{ep.totalSessions} ({ep.recentSessions} recent)</td>
              <td style={{ fontWeight: 600 }}>{ep.recencyScore.toFixed(1)}</td>
              <td>{ep.isStaple ? '★' : '—'}</td>
              <td>{ep.lastUsedDaysAgo}d ago</td>
            </tr>
          ))}
        </tbody>
      </table>

      {swappedFrequently > 0 && (
        <>
          <div className={S.sectionLabel}>Frequently Swapped (−15 penalty)</div>
          {swaps.filter(s => s.swapCount >= 3).map(s => (
            <div key={s.exerciseName} className={`${S.decisionBranch} ${S.decisionBranchActive}`} style={{ borderColor: '#ff6b6b', background: '#1a1111' }}>
              <div className={S.branchIndicator} style={{ background: '#ff6b6b' }} />
              <div>
                <span style={{ fontWeight: 600 }}>{s.exerciseName}</span>
                {' '}
                — swapped {s.swapCount}×, effective weight {s.effectiveSwapWeight ?? s.swapCount} (last: {s.lastSwapDate})
              </div>
            </div>
          ))}
        </>
      )}

      <div className={S.counterfactual}>
        {staples > 0
          ? `Your ${staples} staple exercise${staples > 1 ? 's' : ''} get a flat +4 bonus, making them hard to displace. An exercise needs a recency score of ~1.6+ (×2.5 = +4) just to match a staple's base bonus. If a staple stalls for 4+ weeks, the −3 plateau penalty and −5 rotation penalty would start to overcome the +4 staple bonus.`
          : 'No staple exercises detected yet. Once an exercise appears consistently across 60%+ of recent sessions, it earns staple status (+4 selection bonus).'}
      </div>
    </>
  )
}

/* ── Section 6: Progressions ── */

function ProgressionsPanel({ profile: p }: { profile: TrainingProfile }) {
  const progs = p.exerciseProgressions || []
  const progressing = progs.filter(ep => ep.status === 'progressing')
  const stalled = progs.filter(ep => ep.status === 'stalled')
  const regressing = progs.filter(ep => ep.status === 'regressing')

  const statusColor: Record<string, string> = { progressing: '#66bb6a', stalled: '#ffa726', regressing: '#ff6b6b' }

  return (
    <>
      <div className={S.summary}>
        Tracking {progs.length} exercises: {progressing.length} progressing, {stalled.length} stalled, {regressing.length} regressing.
        Progression status feeds directly into exercise selection scoring.
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Progression Detection — Epley 1RM Slope</div>
        <div className={`${S.decisionBranch} ${progressing.length > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${progressing.length > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>Slope &gt; 0:</span>
            <span className={S.branchResult}> Progressing → +3 selection score, weight incremented</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${stalled.length > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${stalled.length > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>Slope ≈ 0:</span>
            <span className={S.branchResult}> Stalled → +1 selection score, rotation pressure begins after 4 weeks</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${regressing.length > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${regressing.length > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>Slope &lt; 0:</span>
            <span className={S.branchResult}> Regressing → −1 selection score, deload signal if widespread</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Epley 1RM Formula</div>
      <div style={{ padding: '10px', background: '#111', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#e0e0e0', marginBottom: 16 }}>
        1RM = weight × (1 + reps / 30)<br />
        <span style={{ color: '#999' }}>Best set (heaviest weight × reps) is used as the Epley input.</span>
      </div>

      <div className={S.sectionLabel}>Exercise Progressions (top {Math.min(progs.length, 10)})</div>
      <table className={S.weightsTable}>
        <thead>
          <tr>
            <th>Exercise</th>
            <th>e1RM</th>
            <th>Last Wt</th>
            <th>Best Set</th>
            <th>Status</th>
            <th>Pattern</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          {progs.slice(0, 10).map(ep => (
            <tr key={ep.exerciseName}>
              <td>{ep.exerciseName}</td>
              <td style={{ fontWeight: 600 }}>{ep.estimated1RM?.toFixed(0) ?? '—'}</td>
              <td>{ep.lastWeight?.toFixed(0) ?? '—'}</td>
              <td style={{ color: '#aaa' }}>{ep.bestSet ? `${ep.bestSet.weight}×${ep.bestSet.reps}` : '—'}</td>
              <td>
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: statusColor[ep.status] || '#555', color: '#000', fontWeight: 500 }}>
                  {ep.status}
                </span>
              </td>
              <td style={{ color: '#aaa' }}>{ep.progressionPattern.replace(/_/g, ' ')}</td>
              <td>{ep.sessionsTracked}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={S.counterfactual}>
        {regressing.length > 0
          ? `${regressing.length} exercise${regressing.length > 1 ? 's are' : ' is'} regressing (${regressing.slice(0, 3).map(e => e.exerciseName).join(', ')}). Each gets a −1 selection penalty. If ${regressing.length >= 3 ? 'this many exercises regress simultaneously' : 'regression continues'}, the model may trigger a deload recommendation to allow supercompensation.`
          : stalled.length > 0
          ? `${stalled.length} exercise${stalled.length > 1 ? 's are' : ' is'} stalled. They receive +1 (still selected, but less favored than progressing exercises). After 4 consecutive weeks at the same weight, the −3 plateau penalty and −5 rotation penalty kick in, potentially swapping the exercise for a variation.`
          : `All ${progressing.length} tracked exercises are progressing. Each receives a +3 selection bonus. If any stalls, the bonus drops to +1 and after 4 weeks, rotation pressure (−3 plateau, −5 rotation) begins accumulating.`
        }
      </div>
    </>
  )
}

/* ── Section 7: Prescription ── */

function PrescriptionPanel({ profile: p }: { profile: TrainingProfile }) {
  const prefs = p.exercisePreferences || []
  const learned = prefs.filter(ep => ep.recentSessions >= 2)
  const fallback = prefs.filter(ep => ep.recentSessions < 2)
  const cardioCaps = (p.cardioCapabilityProfiles || []).length
  const unilateralLearned = (p.exerciseProgressions || []).filter(ep =>
    /single[\s-]*(arm|leg)|one[\s-]*(arm|leg)|unilateral|split squat|step[\s-]*up|cossack/.test(ep.exerciseName || '')
  ).length

  const prescriptionPipeline = [
    { param: 'Reps',   primary: 'Learned median reps (≥2 recent sessions)', fallbackSrc: 'Table by role × goal', threshold: '≥2 sessions' },
    { param: 'Sets',   primary: 'Learned median sets (≥2 recent sessions)', fallbackSrc: 'Tiered by role, goal, priority, deload', threshold: '≥2 sessions' },
    { param: 'Weight', primary: 'Epley e1RM → weightForReps(e1RM, reps, RIR)', fallbackSrc: 'Safety floor: never < 50% of last working weight', threshold: '≥1 tracked set' },
    { param: 'Rest',   primary: 'Learned inter-set rest from timestamps', fallbackSrc: 'Movement-pattern-aware table by role × goal', threshold: '≥2 sessions' },
    { param: 'Tempo',  primary: 'Exercise default_tempo from library', fallbackSrc: 'Goal-based default (e.g., hypertrophy: 3-1-2)', threshold: 'Library entry exists' },
    { param: 'RIR',    primary: 'Role × goal lookup', fallbackSrc: 'Deload override → RIR 4', threshold: 'Always available' },
  ]

  return (
    <>
      <div className={S.summary}>
        {learned.length} exercises use learned prescriptions from your training data.
        {fallback.length > 0 ? ` ${fallback.length} use table fallbacks (insufficient history).` : ' All exercises are fully personalized.'}
        {` Cardio envelopes: ${cardioCaps}. Unilateral learned patterns: ${unilateralLearned}.`}
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Source Decision — Per Parameter</div>
        <div className={`${S.decisionBranch} ${learned.length > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${learned.length > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>If recentSessions ≥ 2:</span>
            <span className={S.branchResult}> Use learned median from your actual training data</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${fallback.length > 0 ? S.decisionBranchActive : ''}`}>
          <div className={`${S.branchIndicator} ${fallback.length > 0 ? S.branchIndicatorActive : ''}`} />
          <div>
            <span className={S.branchCondition}>If recentSessions &lt; 2:</span>
            <span className={S.branchResult}> Fall back to research-based table (role × goal)</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>Prescription Pipeline — Source Per Parameter</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Parameter</th><th>Primary Source</th><th>Fallback</th><th>Threshold</th></tr>
        </thead>
        <tbody>
          {prescriptionPipeline.map(r => (
            <tr key={r.param}>
              <td style={{ fontWeight: 600 }}>{r.param}</td>
              <td>{r.primary}</td>
              <td style={{ color: '#aaa' }}>{r.fallbackSrc}</td>
              <td style={{ color: '#999', fontSize: 11 }}>{r.threshold}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={S.sectionLabel}>Learned Prescriptions (from your data)</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Exercise</th><th>Reps</th><th>Sets</th><th>Weight</th><th>Increment</th><th>Rest</th><th>Source</th></tr>
        </thead>
        <tbody>
          {learned.slice(0, 8).map(ep => (
            <tr key={ep.exerciseName}>
              <td>{ep.exerciseName}</td>
              <td>{ep.learnedReps?.toFixed(0) ?? '—'}</td>
              <td>{ep.learnedSets?.toFixed(0) ?? '—'}</td>
              <td>{ep.learnedWeight != null ? `${ep.learnedWeight} lbs` : '—'}</td>
              <td>{ep.learnedIncrement != null ? `${ep.learnedIncrement} lbs` : '—'}</td>
              <td>{ep.learnedRestSeconds ? `${ep.learnedRestSeconds}s` : '—'}</td>
              <td style={{ color: '#66bb6a' }}>learned</td>
            </tr>
          ))}
          {fallback.slice(0, 3).map(ep => (
            <tr key={ep.exerciseName}>
              <td>{ep.exerciseName}</td>
              <td style={{ color: '#666' }}>—</td>
              <td style={{ color: '#666' }}>—</td>
              <td style={{ color: '#666' }}>—</td>
              <td style={{ color: '#666' }}>—</td>
              <td style={{ color: '#666' }}>—</td>
              <td style={{ color: '#ffa726' }}>table fallback</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={S.sectionLabel}>Weight Derivation Formula</div>
      <div style={{ padding: '10px', background: '#111', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#e0e0e0', marginBottom: 16 }}>
        targetWeight = e1RM × (1 − (targetReps − 1) / 30) × (1 − RIR × 0.033)<br />
        <span style={{ color: '#999' }}>Safety floor: max(targetWeight, lastWorkingWeight × 0.5)</span>
      </div>

      <div className={S.sectionLabel}>New Constraint Layers</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Layer</th><th>What It Prevents</th><th>Behavior</th></tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ fontWeight: 600 }}>Rep humanization</td>
            <td>Awkward coach-unlike outputs (e.g., 11/17 reps)</td>
            <td>Targets snap to practical rep families unless explicit progression requires otherwise</td>
          </tr>
          <tr>
            <td style={{ fontWeight: 600 }}>Cardio envelope caps</td>
            <td>Walk prescriptions drifting into run-like speeds</td>
            <td>Modality cap from profile/history, then incline/duration compensation for fat-loss HR targets</td>
          </tr>
          <tr>
            <td style={{ fontWeight: 600 }}>Unilateral normalization</td>
            <td>Ambiguous total-dumbbell load interpretation</td>
            <td>Canonical per-hand/per-side semantics with high-confidence historical correction path</td>
          </tr>
        </tbody>
      </table>

      <div className={S.counterfactual}>
        {fallback.length > 0
          ? `${fallback.length} exercise${fallback.length > 1 ? 's' : ''} still use${fallback.length === 1 ? 's' : ''} table fallbacks. ${fallback.slice(0, 2).map(f => f.exerciseName).join(' and ')} need${fallback.length === 1 ? 's' : ''} just ${2 - (fallback[0]?.recentSessions ?? 0)} more session${(2 - (fallback[0]?.recentSessions ?? 0)) > 1 ? 's' : ''} to switch to learned prescriptions — the model will then use your actual median reps, sets, and weight instead of textbook values.`
          : 'All exercises are using learned prescriptions from your training data. Table defaults are only used as a safety floor (e.g., weight never drops below 50% of last working weight).'}
      </div>
    </>
  )
}

/* ── Section 8: Time Fit ── */

function TimeFitPanel({ profile: p }: { profile: TrainingProfile }) {
  const budget = p.avgSessionDuration

  return (
    <>
      <div className={S.summary}>
        Session budget is {budget} min (from your average session duration).
        After initial prescription, the greedy loop adds or trims volume to fit this window.
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Time Budget Decision Tree</div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Step 1:</span>
            <span className={S.branchResult}> Compute estimated time for all prescribed exercises (sets × time-per-set + rest + transitions)</span>
          </div>
        </div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>If under budget:</span>
            <span className={S.branchResult}> Greedy loop — pick highest marginal-value action until time filled</span>
          </div>
        </div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>If over budget:</span>
            <span className={S.branchResult}> Remove lowest-value exercises until within budget</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Post-fit:</span>
            <span className={S.branchResult}> Cap any single exercise at per-session max (weeklyTarget ÷ frequency)</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>SFR Curve — Diminishing Returns Formula</div>
      <div style={{ padding: '10px', background: '#111', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#e0e0e0', marginBottom: 16 }}>
        stimulus = e<sup>−k × currentSets</sup><br />
        k = 0.18 + (5 − exerciseSFR) × 0.06<br /><br />
        <span style={{ color: '#999' }}>Higher SFR → slower decay → more sets worthwhile before diminishing returns.<br />
        Lower SFR → faster decay → engine prefers adding a new exercise instead.</span>
      </div>

      <div className={S.sectionLabel}>Marginal Value — Two Competing Actions</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Action</th><th>Formula</th><th>Modifiers</th></tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ fontWeight: 600 }}>Add set to existing exercise</td>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>sfrCurve(currentSets, SFR) × volStatusMod</td>
            <td style={{ color: '#aaa', fontSize: 11 }}>
              below_mev: ×1.3 | in_mev_mav: ×1.0 | in_mav: ×0.8 | approaching_mrv: ×0.4 | above_mrv: ×0.1
            </td>
          </tr>
          <tr>
            <td style={{ fontWeight: 600 }}>Add new exercise</td>
            <td style={{ fontFamily: 'monospace', fontSize: 11 }}>sfrCurve(0, SFR) × volMod × freqBonus × varietyBonus</td>
            <td style={{ color: '#aaa', fontSize: 11 }}>
              freq &lt;2/wk: ×1.3 | 2–3/wk: ×1.0 | &gt;3/wk: ×0.8 — new group: ×1.2 | same: ×0.7
            </td>
          </tr>
        </tbody>
      </table>

      <div className={S.sectionLabel}>Greedy Loop Logic</div>
      <div style={{ padding: '10px', background: '#111', borderRadius: 6, fontSize: 12, color: '#aaa', lineHeight: 1.6, marginBottom: 16 }}>
        <strong style={{ color: '#e0e0e0' }}>Each iteration:</strong><br />
        1. Compute marginal value for adding a set to each existing exercise<br />
        2. Compute marginal value for adding each unused candidate exercise<br />
        3. Pick the action with highest value<br />
        4. Check if adding it stays within budget<br />
        5. If yes: apply it. If no: stop.<br /><br />
        <strong style={{ color: '#e0e0e0' }}>Result:</strong> Volume is distributed optimally across exercises
        based on SFR curves, volume status, and training frequency — not evenly or arbitrarily.
      </div>

      <div className={S.counterfactual}>
        The SFR curve means the 4th set of an exercise with SFR 3.0 has a stimulus value of ~0.58,
        while starting a new exercise (set 1) with the same SFR starts at ~0.84. The engine will
        prefer adding a new exercise once existing exercises reach 3-4 sets each. If your session
        budget were 10 minutes longer, the model would add the next highest-value action from the
        queue — likely an extra set on the exercise with the most remaining SFR headroom.
      </div>
    </>
  )
}

/* ── Section 9: Post-Generation Validation ── */

function ValidationPanel() {
  const checks = [
    {
      name: 'Per-exercise set cap',
      rule: 'Sets > weeklyTarget ÷ frequency',
      action: 'Redistribute excess sets to underdosed groups',
      why: 'Prevents set inflation on a single exercise — e.g., 8 sets of bench when weekly target is 12 across 3 sessions (max 4 per session).',
    },
    {
      name: 'Compound ordering',
      rule: 'Compound appears after isolation for same group',
      action: 'Re-sort: all compounds first, then isolations',
      why: 'Compounds require more neural drive and stabilizer recruitment. Pre-fatiguing with isolations reduces compound performance and injury risk increases.',
    },
    {
      name: 'Volume concentration',
      rule: 'One exercise has > 40% of total session sets',
      action: 'Redistribute to other exercises in session',
      why: 'Excessive concentration limits stimulus breadth and increases repetitive strain risk. Volume should be distributed across exercises for the target muscles.',
    },
    {
      name: 'Time budget deviation',
      rule: 'Estimated time deviates > 20% from session budget',
      action: 'Trim lowest-value or expand with highest-value',
      why: 'Catches edge cases where prescription + time-fit loop left significant over/under-shoot, ensuring the workout is practical for the user\'s schedule.',
    },
  ]

  return (
    <>
      <div className={S.summary}>
        4 deterministic safety checks run after the time-fit loop. These catch edge cases that scoring and prescription logic might miss.
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>Validation Checks — Pass/Fail Rules</div>
        {checks.map(c => (
          <div key={c.name} className={S.decisionBranch} style={{ flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div className={S.branchIndicator} />
              <div>
                <span className={S.branchCondition}>{c.name}:</span>
                <span className={S.branchResult}> If {c.rule.toLowerCase()}</span>
              </div>
            </div>
            <div style={{ marginLeft: 16, fontSize: 11, color: '#14b8a6' }}>→ {c.action}</div>
          </div>
        ))}
      </div>

      <div className={S.sectionLabel}>Check Details — Why Each Exists</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Check</th><th>Threshold</th><th>Correction</th></tr>
        </thead>
        <tbody>
          {checks.map(c => (
            <tr key={c.name}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td>{c.rule}</td>
              <td style={{ color: '#aaa' }}>{c.action}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {checks.map(c => (
        <div key={c.name} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#999', marginBottom: 2 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>{c.why}</div>
        </div>
      ))}

      <div className={S.counterfactual} style={{ marginTop: 16 }}>
        All corrections are logged to each exercise's adjustments array. If the set cap fires on bench press
        (e.g., capping from 6 to 4 sets), the 2 excess sets are redistributed to the most underdosed muscle
        group — visible in the "Why?" breakdown on the workout page. Without this check, the greedy loop
        could concentrate all extra time budget into a single high-SFR exercise.
      </div>
    </>
  )
}

/* ── Section 10: LLM Review ── */

function LlmReviewPanel() {
  const correctionTypes = [
    { type: 'Weight adjustment',  example: 'Reduce deadlift from 315 to 275 — volume too high for current fatigue' },
    { type: 'Set adjustment',     example: 'Reduce lateral raises from 5 sets to 3 — diminishing returns past 3' },
    { type: 'Exercise swap',      example: 'Replace barbell row with cable row — lower spinal fatigue after deadlift' },
    { type: 'Order change',       example: 'Move face pulls before overhead press — better shoulder warm-up' },
  ]

  return (
    <>
      <div className={S.summary}>
        After rules-based validation, the workout is sent to GPT-4o-mini acting as an exercise science
        auditor. It produces immediate corrections (applied silently) and pattern observations (stored for future workouts).
      </div>

      <div className={S.decisionTree}>
        <div className={S.decisionTreeTitle}>LLM Call Decision Tree</div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Check cache:</span>
            <span className={S.branchResult}> If same workout hash was validated within 5 minutes → return cached result (no API call)</span>
          </div>
        </div>
        <div className={S.decisionBranch}>
          <div className={S.branchIndicator} />
          <div>
            <span className={S.branchCondition}>If cache miss:</span>
            <span className={S.branchResult}> Summarize profile (reduce token count), send workout + profile to LLM</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Cost controls:</span>
            <span className={S.branchResult}> Max 1 call per workout, profile summarized to reduce tokens, 5-min cache TTL</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>Infrastructure:</span>
            <span className={S.branchResult}> Uses existing /api/insights route — no additional serverless function</span>
          </div>
        </div>
      </div>

      <div className={S.sectionLabel}>LLM Output — Two Categories</div>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 6, marginTop: 12 }}>Immediate Corrections (applied this workout)</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Correction Type</th><th>Example</th></tr>
        </thead>
        <tbody>
          {correctionTypes.map(c => (
            <tr key={c.type}>
              <td style={{ fontWeight: 600 }}>{c.type}</td>
              <td style={{ color: '#aaa' }}>{c.example}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 6, marginTop: 16 }}>Pattern Observations (stored for future)</div>
      <div style={{ padding: '10px', background: '#111', borderRadius: 6, fontSize: 12, color: '#aaa', lineHeight: 1.6, marginBottom: 16 }}>
        Observations are stored in <span style={{ color: '#e0e0e0', fontFamily: 'monospace' }}>model_feedback</span> table
        with type <span style={{ color: '#e0e0e0', fontFamily: 'monospace' }}>pattern_observation</span>.<br /><br />
        On next workout generation, <span style={{ color: '#e0e0e0', fontFamily: 'monospace' }}>computeTrainingProfile()</span> fetches
        the last 10 observations from the past 30 days. <span style={{ color: '#e0e0e0', fontFamily: 'monospace' }}>parseLlmPatternObservations()</span> extracts
        actionable hints — currently: exercises to avoid — which are injected into the engine's avoid list before exercise selection.
      </div>

      <div className={S.sectionLabel}>Feedback Loop Flow</div>
      <div className={S.decisionTree}>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>1.</span>
            <span className={S.branchResult}> LLM reviews workout → outputs pattern observations</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>2.</span>
            <span className={S.branchResult}> Observations stored in model_feedback table (Supabase)</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>3.</span>
            <span className={S.branchResult}> Next workout: computeTrainingProfile fetches recent observations</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>4.</span>
            <span className={S.branchResult}> parseLlmPatternObservations extracts avoid/prefer hints</span>
          </div>
        </div>
        <div className={`${S.decisionBranch} ${S.decisionBranchActive}`}>
          <div className={`${S.branchIndicator} ${S.branchIndicatorActive}`} />
          <div>
            <span className={S.branchCondition}>5.</span>
            <span className={S.branchResult}> Hints injected into exercise selection → influences next workout</span>
          </div>
        </div>
      </div>

      <div className={S.counterfactual}>
        The LLM acts as a second opinion, not the primary decision-maker. It can only adjust what the deterministic
        engine already produced — it cannot add exercises the engine didn't select or change the fundamental volume
        targets. If the LLM suggests avoiding an exercise, that hint is stored and automatically applied to the next
        3-4 workouts (30-day observation window with max 10 recent observations).
      </div>
    </>
  )
}

/* ── Section 11: Final Output ── */

function FinalOutputPanel({ profile: p }: { profile: TrainingProfile }) {
  const obs = p.llmPatternObservations || []
  const avoidExercises: string[] = []
  const preferExercises: string[] = []
  for (const o of obs) {
    const s = (o.suggestion ?? '').toLowerCase()
    if (s.includes('avoid') || s.includes('remove') || s.includes('swap out') || s.includes('stop')) {
      const m = s.match(/(?:avoid|remove|swap out|stop)\s+(?:using\s+)?(.+?)(?:\s*[-—]|\.|$)/)
      if (m) avoidExercises.push(m[1].trim())
    }
    if (s.includes('add') || s.includes('consider') || s.includes('default to') || s.includes('prefer')) {
      const m = s.match(/(?:add|consider|default to|prefer)\s+(.+?)(?:\s*[-—]|\.|$)/)
      if (m) preferExercises.push(m[1].trim())
    }
  }

  const readinessPct = Math.round(p.fitnessFatigueModel.readiness * 100)
  const volMult = p.sleepVolumeModifier.volumeMultiplier
  const deload = p.deloadRecommendation
  const belowMev = (p.muscleVolumeStatuses || []).filter(v => v.status === 'below_mev').length
  const progressing = (p.exerciseProgressions || []).filter(ep => ep.status === 'progressing').length
  const learned = (p.exercisePreferences || []).filter(ep => ep.recentSessions >= 2).length
  const tier = p.totalWorkoutCount < 10 ? 'bootstrap' : p.totalWorkoutCount < 30 ? 'learning' : 'personalized'
  const utility = p.canonicalModelContext?.objectiveUtility ?? 0
  const utilityVersion = p.canonicalModelContext?.version ?? 'utility_v1'
  const setExecutionAcc = p.prescribedVsActual?.avgSetExecutionAccuracy ?? 0
  const setExecutionN = p.prescribedVsActual?.executionSampleSize ?? 0

  const stages = [
    { stage: '1. Data Collection',       impact: `${tier} mode (${p.totalWorkoutCount} workouts)` },
    { stage: '2. Feature Engineering',    impact: `${(p.rolling30DayTrends.exerciseTrends || []).length} 1RM trends computed` },
    { stage: '3. Recovery State',         impact: `Readiness ${readinessPct}% → vol ×${volMult.toFixed(2)}${deload.needed ? ', DELOAD' : ''}` },
    { stage: '4. Volume Status',          impact: `${belowMev} groups below MEV targeted first` },
    { stage: '5. Exercise Selection',     impact: `${progressing} progressing exercises prioritized (+3 each)` },
    { stage: '6. Progressions',           impact: `1RM trends drive weight targets` },
    { stage: '7. Prescription',           impact: `${learned} exercises use learned data` },
    { stage: '8. Time Fit',              impact: `Fitted to ${p.avgSessionDuration} min budget (SFR greedy)` },
    { stage: '9. Validation',            impact: `4 safety checks applied` },
    { stage: '10. LLM Review',           impact: `${obs.length} stored observations active` },
    { stage: '11. Objective Utility',    impact: `${Math.round(utility * 100)}% (${utilityVersion}), set accuracy ${Math.round(setExecutionAcc * 100)}% from ${setExecutionN} labels` },
  ]

  return (
    <>
      <div className={S.summary}>
        The final workout is the product of all 11 upstream pipeline stages. Each stage transforms,
        filters, or adjusts the output — from raw data to a validated, LLM-reviewed exercise prescription.
      </div>

      <div className={S.sectionLabel}>Pipeline Impact Summary</div>
      <table className={S.weightsTable}>
        <thead>
          <tr><th>Stage</th><th>Impact on This Workout</th></tr>
        </thead>
        <tbody>
          {stages.map(s => (
            <tr key={s.stage}>
              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.stage}</td>
              <td>{s.impact}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(avoidExercises.length > 0 || preferExercises.length > 0) && (
        <>
          <div className={S.sectionLabel}>Active LLM Hints (applied to this workout)</div>
          {avoidExercises.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#ff6b6b', fontWeight: 600 }}>Avoid: </span>
              {avoidExercises.map((e, i) => (
                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#3a1a1a', color: '#ff6b6b', marginRight: 4, fontWeight: 500 }}>{e}</span>
              ))}
            </div>
          )}
          {preferExercises.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#66bb6a', fontWeight: 600 }}>Prefer: </span>
              {preferExercises.map((e, i) => (
                <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#1a3a1a', color: '#66bb6a', marginRight: 4, fontWeight: 500 }}>{e}</span>
              ))}
            </div>
          )}
        </>
      )}

      {obs.length > 0 && (
        <>
          <div className={S.sectionLabel}>Recent LLM Observations ({obs.length})</div>
          {obs.map((o, i) => (
            <div key={i} style={{ marginBottom: 8, padding: '8px 10px', background: '#111', borderRadius: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 600, color: '#e0e0e0', marginBottom: 2 }}>{o.pattern}</div>
              <div style={{ color: '#aaa' }}>{o.suggestion}</div>
              <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>Confidence: {o.confidence}</div>
            </div>
          ))}
        </>
      )}

      <div className={S.counterfactual}>
        Every stage is additive — no single stage makes the final decision alone. If recovery drops
        (stage 3), volume is reduced, which changes which muscle groups are prioritized (stage 4),
        which changes which exercises are selected (stage 5), which changes prescriptions (stage 7),
        which changes time fitting (stage 8). A 10% change in readiness can cascade through 5+ downstream stages.
      </div>
    </>
  )
}

export default function ModelDashboard() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<TrainingProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [policySummary, setPolicySummary] = useState<PolicyEpisodeSummary | null>(null)
  const [policyEpisodes, setPolicyEpisodes] = useState<PolicyEpisodeEval[]>([])
  const [latestReplay, setLatestReplay] = useState<ReplayScenarioSummary | null>(null)
  const [provenanceEvents, setProvenanceEvents] = useState<any[]>([])
  const [runningReplay, setRunningReplay] = useState(false)

  useEffect(() => {
    if (!user) return
    computeTrainingProfile(user.id)
      .then(setProfile)
      .catch(e => logError('ModelDashboard profile load failed', e))
      .finally(() => setLoading(false))
  }, [user])

  const loadPolicyTelemetry = useCallback(async () => {
    if (!user) return
    try {
      const [evalRes, latestReplayRes, provenanceRes] = await Promise.all([
        fetchAuthedJson('/api/ml/policy/episodes/evaluate?limit=12').catch(() => null),
        (async () => {
          const { data } = await db
            .from('replay_scenarios')
            .select('id, scenario_name, status, baseline_policy_version, candidate_policy_version, created_at, config')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          return data || null
        })().catch(() => null),
        (async () => {
          const { data } = await db
            .from('decision_provenance_events')
            .select('event_date, source_type, decision_stage, decision_key, confidence, policy_version')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20)
          return data || []
        })().catch(() => []),
      ])
      if (evalRes?.success) {
        setPolicySummary(evalRes.summary || null)
        setPolicyEpisodes(Array.isArray(evalRes.episodes) ? evalRes.episodes : [])
      }
      setLatestReplay(latestReplayRes)
      setProvenanceEvents(Array.isArray(provenanceRes) ? provenanceRes : [])
    } catch (e) {
      logError('ModelDashboard telemetry load failed', e)
    }
  }, [user])

  useEffect(() => {
    loadPolicyTelemetry()
  }, [loadPolicyTelemetry])

  const runReplay = useCallback(async () => {
    if (runningReplay) return
    setRunningReplay(true)
    try {
      await fetchAuthedJson('/api/ml/policy/replay', {
        method: 'POST',
        body: JSON.stringify({
          baselinePolicyVersion: 'policy_v3_pid_fusion',
          candidatePolicyVersion: 'policy_v3_pid_fusion_candidate',
        }),
      })
      await loadPolicyTelemetry()
    } catch (e) {
      logError('Replay run failed', e)
    } finally {
      setRunningReplay(false)
    }
  }, [loadPolicyTelemetry, runningReplay])

  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams) => {
    if (nodes.length > 0) {
      setSelectedNode(nodes[0].id)
    }
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const nodes = useMemo(() => {
    if (!profile) return []
    return buildNodes(computeNodePreviews(profile))
  }, [profile])

  const edges = useMemo(() => {
    if (!profile) return []
    return buildEdges(profile)
  }, [profile])

  if (loading) return <div className={S.loading}><Spinner /></div>
  if (!profile) return (
    <div className={S.error}>
      <p>Failed to load profile data.</p>
      <button
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer', borderRadius: 6, border: '1px solid #555', background: '#222', color: '#eee' }}
        onClick={() => {
          if (!user) return
          setLoading(true)
          computeTrainingProfile(user.id)
            .then(setProfile)
            .catch(e => logError('ModelDashboard profile retry failed', e))
            .finally(() => setLoading(false))
        }}
      >
        Retry
      </button>
    </div>
  )

  return (
    <div className={S.page}>
      <div className={S.header}>
        <BackButton />
        <h1 className={S.title}>ML Pipeline Dashboard</h1>
      </div>
      <div className={S.body}>
        <div className={selectedNode ? S.canvasWrapWithPanel : S.canvasWrap}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onSelectionChange={onSelectionChange}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            selectNodesOnDrag={false}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background color="#222" gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {!selectedNode && (
        <div className={S.panel}>
          <div className={S.panelHeader}>
            <p className={S.panelTitle}>Policy State and Replay/Regret</p>
            <p className={S.panelSubtitle}>Live policy telemetry, evaluator readiness, and provenance stream</p>
          </div>
          <div className={S.panelBody}>
            <div className={S.summary}>
              Episode evaluator: {policySummary?.sampleSize ?? 0} episodes, {policySummary?.promoteReadyCount ?? 0} promotion-ready.
            </div>
            <div className={S.decisionTree}>
              <div className={S.decisionTreeTitle}>Policy Episode Evaluator</div>
              {policyEpisodes.slice(0, 5).map((ep) => (
                <div key={ep.episode_key} className={`${S.decisionBranch} ${ep.promoteReady ? S.decisionBranchActive : ''}`}>
                  <div className={`${S.branchIndicator} ${ep.promoteReady ? S.branchIndicatorActive : ''}`} />
                  <div>
                    <span className={S.branchCondition}>{ep.episode_key}</span>
                    <span className={S.branchResult}>
                      {' '}objective {Math.round((ep.metrics.avgObjective || 0) * 100)}%, regret {(ep.metrics.avgRegret || 0).toFixed(3)}, adherence {Math.round((ep.metrics.avgAdherence || 0) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className={S.decisionTree}>
              <div className={S.decisionTreeTitle}>Replay/Regret</div>
              <div className={`${S.decisionBranch} ${latestReplay?.status === 'completed' ? S.decisionBranchActive : ''}`}>
                <div className={`${S.branchIndicator} ${latestReplay?.status === 'completed' ? S.branchIndicatorActive : ''}`} />
                <div>
                  <span className={S.branchCondition}>{latestReplay?.scenario_name || 'No replay scenario yet'}</span>
                  <span className={S.branchResult}> status: {latestReplay?.status || 'n/a'}</span>
                </div>
              </div>
              <button className={S.primaryBtn} onClick={runReplay} disabled={runningReplay}>
                {runningReplay ? 'Running replay...' : 'Run Replay/Regret Simulation'}
              </button>
            </div>

            <div className={S.decisionTree}>
              <div className={S.decisionTreeTitle}>Decision Provenance Explorer</div>
              {provenanceEvents.slice(0, 10).map((ev, idx) => (
                <div key={`${ev.event_date}-${ev.decision_key}-${idx}`} className={S.decisionBranch}>
                  <div className={S.branchIndicator} />
                  <div>
                    <span className={S.branchCondition}>{ev.source_type} / {ev.decision_stage} / {ev.decision_key}</span>
                    <span className={S.branchResult}> conf {Math.round((Number(ev.confidence) || 0) * 100)}%, policy {ev.policy_version || 'n/a'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
        {selectedNode && PANEL_META[selectedNode] && (
          <div className={S.panel}>
            <div className={S.panelHeader} style={{ position: 'relative' }}>
              <button className={S.panelClose} onClick={() => setSelectedNode(null)}>✕</button>
              <p className={S.panelTitle}>{selectedNode}. {PANEL_META[selectedNode].title}</p>
              <p className={S.panelSubtitle}>{PANEL_META[selectedNode].subtitle}</p>
            </div>
            <div className={S.panelBody}>
              {renderPanelContent(selectedNode, profile)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
