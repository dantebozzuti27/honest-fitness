import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeterministicWeekReview,
  isWeekReviewFresh,
  mergeWeekReviews,
  normalizeLoadedWeekPlan,
  parseWeekPlanReviewResponse,
  sanitizeLegacyWeekPlanLlm,
  shouldShowDayVerdictPill,
  verdictLabel,
  weekAtAGlanceLine,
  weekPlanContentFingerprint,
} from '../../src/lib/weekPlanReview.ts'
import type { WeeklyPlan } from '../../src/lib/workoutEngine.ts'

const basePlan: WeeklyPlan = {
  weekStartDate: '2026-06-02',
  featureSnapshotId: 'snap',
  days: [
    {
      planDate: '2026-06-03',
      dayOfWeek: 2,
      dayName: 'Tuesday',
      isRestDay: false,
      focus: 'push',
      muscleGroups: ['mid_chest', 'triceps'],
      plannedWorkout: {
        id: 'a',
        exercises: [{ exerciseName: 'Bench Press', sets: 4, targetReps: 8, targetWeight: 185 } as any],
      } as any,
      estimatedExercises: 1,
      estimatedMinutes: 95,
    },
    {
      planDate: '2026-06-04',
      dayOfWeek: 3,
      dayName: 'Wednesday',
      isRestDay: false,
      focus: 'push',
      muscleGroups: ['mid_chest', 'triceps'],
      plannedWorkout: {
        id: 'b',
        exercises: [
          { exerciseName: 'Bench Press', sets: 4, targetReps: 8, targetWeight: 185 } as any,
        ],
      } as any,
      estimatedExercises: 1,
      estimatedMinutes: 95,
    },
  ],
}

describe('weekPlanReview', () => {
  it('parseWeekPlanReviewResponse maps backend verdicts', () => {
    const r = parseWeekPlanReviewResponse({
      weekSummary: 'Balanced week with one heavy pull day.',
      overallVerdict: 'needs_tweaks',
      days: [{ planDate: '2026-06-05', status: 'watch', note: 'Back-to-back chest stress' }],
    })
    assert.equal(r.overallVerdict, 'minor_issues')
    assert.equal(r.days[0].status, 'watch')
  })

  it('verdictLabel uses human copy', () => {
    assert.equal(verdictLabel('pass'), 'Plan OK')
    assert.equal(verdictLabel('major_issues'), 'Review suggested')
  })

  it('sanitizeLegacyWeekPlanLlm clears old corrections', () => {
    const plan = {
      ...basePlan,
      days: basePlan.days.map((d) => ({
        ...d,
        llmVerdict: 'major_issues' as const,
        llmCorrections: [{ exerciseName: 'X', issue: 'bad', fix: 'remove', newValue: null, reason: 'r' }],
      })),
    }
    const out = sanitizeLegacyWeekPlanLlm(plan)
    assert.equal(out.days[0].llmCorrections, undefined)
    assert.equal(out.days[0].llmVerdict, undefined)
  })

  it('buildDeterministicWeekReview flags duplicate consecutive days', () => {
    const r = buildDeterministicWeekReview(
      { avgSessionDuration: 90, goalProgress: { goalLabel: 'Cut' } } as any,
      basePlan,
      '2026-06-03',
      90,
    )
    const wed = r.days.find((d) => d.planDate === '2026-06-04')
    assert.ok(wed)
    assert.equal(wed!.status, 'concern')
    assert.match(wed!.note, /Same exercise/i)
  })

  it('isWeekReviewFresh respects fingerprint', () => {
    const fp = weekPlanContentFingerprint(basePlan, '2026-06-03')
    const plan = {
      ...basePlan,
      weekPlanReview: {
        summary: 'ok',
        overallVerdict: 'pass' as const,
        reviewedAt: new Date().toISOString(),
        contentFingerprint: fp,
      },
    }
    assert.equal(isWeekReviewFresh(plan, fp), true)
    assert.equal(isWeekReviewFresh(plan, fp + 'x'), false)
  })

  it('mergeWeekReviews keeps stronger day flags', () => {
    const det = buildDeterministicWeekReview({ avgSessionDuration: 90 } as any, basePlan, '2026-06-03', 90)
    const llm = parseWeekPlanReviewResponse({
      weekSummary: 'Solid push focus early week.',
      overallVerdict: 'solid',
      days: [{ planDate: '2026-06-04', status: 'ok', note: '' }],
    })
    const merged = mergeWeekReviews(det, llm)
    const wed = merged.days.find((d) => d.planDate === '2026-06-04')
    assert.equal(wed?.status, 'concern')
  })

  it('normalizeLoadedWeekPlan applies dayNotes from engine snapshot meta', () => {
    const plan = {
      ...basePlan,
      weekPlanReview: {
        summary: 'Solid week.',
        overallVerdict: 'minor_issues' as const,
        reviewedAt: new Date().toISOString(),
        contentFingerprint: 'fp',
        dayNotes: [
          { planDate: '2026-06-04', status: 'watch' as const, note: 'Back-to-back chest stress' },
        ],
      },
      days: basePlan.days.map((d) => ({
        ...d,
        llmVerdict: undefined,
        llmDayNote: undefined,
      })),
    }
    const out = normalizeLoadedWeekPlan(plan)
    const wed = out.days.find((d) => d.planDate === '2026-06-04')
    assert.equal(wed?.llmVerdict, 'minor_issues')
    assert.match(String(wed?.llmDayNote), /chest/i)
  })

  it('normalizeLoadedWeekPlan clears orphan verdicts when holistic pass', () => {
    const plan = {
      ...basePlan,
      weekPlanReview: {
        summary: 'Balanced week.',
        overallVerdict: 'pass' as const,
        reviewedAt: new Date().toISOString(),
        contentFingerprint: 'fp',
      },
      days: basePlan.days.map((d) => ({
        ...d,
        llmVerdict: 'major_issues' as const,
        llmDayNote: undefined,
      })),
    }
    const out = normalizeLoadedWeekPlan(plan)
    assert.equal(out.days[0].llmVerdict, undefined)
  })

  it('shouldShowDayVerdictPill hides pass without note', () => {
    assert.equal(
      shouldShowDayVerdictPill({ ...basePlan.days[0], llmVerdict: 'pass' }),
      false,
    )
    assert.equal(
      shouldShowDayVerdictPill({ ...basePlan.days[0], llmVerdict: 'minor_issues', llmDayNote: 'Heavy overlap' }),
      true,
    )
  })

  it('weekAtAGlanceLine summarizes upcoming days', () => {
    const line = weekAtAGlanceLine(basePlan, '2026-06-03')
    assert.match(line, /training/)
    assert.match(line, /rest/)
  })
})
