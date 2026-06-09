import test from 'node:test'
import assert from 'node:assert/strict'
import { combineCorrelatedPenalties } from '../../src/lib/recoveryModel.ts'

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

test('combineCorrelatedPenalties: no signals is a no-op (×1.0)', () => {
  assert.equal(combineCorrelatedPenalties([]), 1.0)
})

test('combineCorrelatedPenalties: a single signal is unchanged vs the old behaviour', () => {
  // KEY INVARIANT: with one active penalty the result must equal that penalty
  // exactly, so single-signal days are bit-for-bit identical to the old engine.
  for (const m of [0.95, 0.85, 0.70, 0.5]) {
    assert.ok(approx(combineCorrelatedPenalties([m]), m), `single ${m}`)
  }
})

test('combineCorrelatedPenalties: boosts (≥1) are ignored — penalties only', () => {
  assert.equal(combineCorrelatedPenalties([1.05, 1.2]), 1.0)
  // A boost mixed with a penalty leaves only the penalty.
  assert.ok(approx(combineCorrelatedPenalties([1.1, 0.9]), 0.9))
})

test('combineCorrelatedPenalties: dominant signal counts fully, others decay', () => {
  // penalties [0.30, 0.15, 0.10] with decay 0.5:
  //   0.30 + 0.5*0.15 + 0.25*0.10 = 0.40 → multiplier 0.60
  const m = combineCorrelatedPenalties([0.70, 0.85, 0.90], { correlationDecay: 0.5 })
  assert.ok(approx(m, 0.60), `expected 0.60, got ${m}`)
})

test('combineCorrelatedPenalties: never harsher than the naive product', () => {
  // De-correlation must only ever be *gentler* than independent multiplication.
  const sets = [
    [0.9, 0.9],
    [0.85, 0.9, 0.9],
    [0.7, 0.85, 0.9, 0.85, 0.85],
    [0.6, 0.95],
  ]
  for (const ms of sets) {
    const naive = ms.reduce((a, b) => a * b, 1)
    const combined = combineCorrelatedPenalties(ms)
    assert.ok(combined >= naive - 1e-9, `combined ${combined} < naive ${naive} for ${ms}`)
  }
})

test('combineCorrelatedPenalties: dominant signal is never under-counted', () => {
  // The combined penalty must be at least as large as the single worst signal —
  // adding correlated evidence can only deepen (or hold) the cut, never soften
  // below the dominant one.
  const ms = [0.7, 0.9, 0.95]
  const combined = combineCorrelatedPenalties(ms)
  assert.ok(combined <= 0.7 + 1e-9, `combined ${combined} softer than worst signal`)
})

test('combineCorrelatedPenalties: decay=1 reproduces additive penalties', () => {
  // [0.2, 0.1] penalties, additive → 0.3 → 0.7
  const m = combineCorrelatedPenalties([0.8, 0.9], { correlationDecay: 1 })
  assert.ok(approx(m, 0.7), `expected 0.7, got ${m}`)
})

test('combineCorrelatedPenalties: decay=0 keeps only the dominant signal', () => {
  const m = combineCorrelatedPenalties([0.8, 0.9, 0.95], { correlationDecay: 0 })
  assert.ok(approx(m, 0.8), `expected 0.8, got ${m}`)
})

test('combineCorrelatedPenalties: correlation stacking is capped by maxPenalty', () => {
  // Dominant penalty 0.30 < cap 0.45, but the additive sum (0.30*3 = 0.90 with
  // decay=1) is clipped to maxPenalty → multiplier 0.55.
  const m = combineCorrelatedPenalties([0.7, 0.7, 0.7], { correlationDecay: 1 })
  assert.ok(approx(m, 0.55), `expected 1 - 0.45 = 0.55, got ${m}`)
})

test('combineCorrelatedPenalties: a severe single signal is never clipped by the cap', () => {
  // The cap bounds correlation stacking, not the dominant signal itself.
  // A 0.5 penalty (> 0.45 cap) must still pass through as ×0.5.
  assert.ok(approx(combineCorrelatedPenalties([0.5]), 0.5))
})

test('psych readiness folds in without double-taxing a low-mood day', () => {
  // A stressful day depresses HRV (×0.85) AND psych readiness (×0.85). These
  // co-move, so they must not compound to 0.7225 — the de-correlated cut keeps
  // the dominant signal and decays the correlated one: 1-(0.15+0.5*0.15)=0.775.
  const naive = 0.85 * 0.85
  const folded = combineCorrelatedPenalties([0.85, 0.85])
  assert.ok(approx(folded, 0.775), `expected 0.775, got ${folded}`)
  assert.ok(folded > naive, `folded ${folded} should be gentler than compounded ${naive}`)
})

test('combineCorrelatedPenalties: realistic mild-signal day is not punitive', () => {
  // The original bug: a single poor night that also dipped HRV, bumped RHR,
  // and tripped the ML sleep + HRV modifiers compounded to a >50% cut.
  const naive = [0.85, 0.9, 0.9, 0.85, 0.85].reduce((a, b) => a * b, 1) // ≈ 0.498
  const combined = combineCorrelatedPenalties([0.85, 0.9, 0.9, 0.85, 0.85])
  assert.ok(naive < 0.52, `sanity: naive should be ~0.50, got ${naive}`)
  assert.ok(combined > 0.71, `de-correlated day should stay >0.71, got ${combined}`)
})
