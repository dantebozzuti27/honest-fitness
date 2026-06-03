import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseWeekPlanReviewResponse, verdictLabel } from '../../src/lib/weekPlanReview.ts'

describe('weekPlanReview', () => {
  it('parseWeekPlanReviewResponse maps backend verdicts', () => {
    const r = parseWeekPlanReviewResponse({
      weekSummary: 'Balanced week with one heavy pull day.',
      overallVerdict: 'needs_tweaks',
      days: [{ planDate: '2026-06-05', status: 'watch', note: 'Back-to-back chest stress' }],
    })
    assert.equal(r.overallVerdict, 'minor_issues')
    assert.equal(r.days[0].status, 'watch')
    assert.equal(r.days[0].note, 'Back-to-back chest stress')
  })

  it('verdictLabel uses human copy', () => {
    assert.equal(verdictLabel('pass'), 'Plan OK')
    assert.equal(verdictLabel('major_issues'), 'Review suggested')
  })
})
