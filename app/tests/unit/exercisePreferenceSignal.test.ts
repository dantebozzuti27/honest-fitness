/**
 * Unit coverage for `computeExercisePreferenceSignals` — the Beta–Binomial
 * fusion of the swap (reject) and acceptance (keep) channels into an
 * exposure-normalized preference rate.
 *
 * The properties under test are statistical guarantees, not magic numbers:
 *   - shrinkage toward neutral on thin evidence,
 *   - rate (not absolute count) determines net affinity,
 *   - monotonicity of confidence in evidence mass,
 *   - bounds and symmetry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeExercisePreferenceSignals,
  type TrainingProfile,
} from '../../src/lib/trainingAnalysis';

type Swaps = TrainingProfile['exerciseSwapHistory'];
type Accepts = TrainingProfile['exerciseAcceptances'];

function swap(name: string, weight: number, count = Math.ceil(weight)): Swaps[number] {
  return { exerciseName: name, swapCount: count, lastSwapDate: '2026-01-01', effectiveSwapWeight: weight };
}
function accept(name: string, weight: number, count = Math.ceil(weight)): Accepts[number] {
  return { exerciseName: name, count, lastDate: '2026-01-01', effectiveWeight: weight };
}

function only(signals: ReturnType<typeof computeExercisePreferenceSignals>, name: string) {
  const s = signals.find((x) => x.exerciseName === name);
  assert.ok(s, `expected a signal for ${name}`);
  return s!;
}

// For single-exercise inputs we don't care how the name was normalized.
function sole(signals: ReturnType<typeof computeExercisePreferenceSignals>) {
  assert.equal(signals.length, 1, `expected exactly one signal, got ${signals.length}`);
  return signals[0];
}

test('preferenceSignal: a single swap with no acceptance stays near-neutral (shrinkage)', () => {
  const sig = sole(computeExercisePreferenceSignals([swap('bench press', 1, 1)], []));
  // One rejection event out of a thin sample must not read as strong rejection.
  assert.ok(sig.netAffinity < 0, 'a lone swap leans negative');
  assert.ok(sig.netAffinity > -0.35, `but is shrunk toward neutral, got ${sig.netAffinity}`);
  assert.ok(sig.confidence < 0.3, `confidence must be low on 1 event, got ${sig.confidence}`);
});

test('preferenceSignal: high keep / low swap reads as net positive', () => {
  const sig = sole(
    computeExercisePreferenceSignals([swap('squat', 3, 3)], [accept('squat', 30, 30)]),
  );
  // Kept 30, swapped 3 → strongly preferred despite a non-trivial swap count.
  assert.ok(sig.netAffinity > 0.5, `expected strong positive affinity, got ${sig.netAffinity}`);
  assert.ok(sig.shrunkAcceptRate > 0.8);
  assert.ok(sig.confidence > 0.85, 'lots of evidence → high confidence');
});

test('preferenceSignal: same swap count, opposite verdict by base rate', () => {
  // Both exercises swapped 3×, but one is otherwise kept 30× and the other never.
  const signals = computeExercisePreferenceSignals(
    [swap('a', 3, 3), swap('b', 3, 3)],
    [accept('a', 30, 30)],
  );
  const a = only(signals, 'a');
  const b = only(signals, 'b');
  // This is the entire point of the change: absolute counts are equal, the
  // exposure-normalized verdict is opposite.
  assert.ok(a.netAffinity > 0, 'a (kept far more) is net positive');
  assert.ok(b.netAffinity < 0, 'b (only ever swapped) is net negative');
  assert.ok(a.netAffinity > b.netAffinity + 0.6, 'verdicts are clearly separated');
});

test('preferenceSignal: confidence increases monotonically with evidence', () => {
  const thin = only(computeExercisePreferenceSignals([], [accept('x', 2, 2)]), 'x');
  const thick = only(computeExercisePreferenceSignals([], [accept('x', 40, 40)]), 'x');
  assert.ok(thick.confidence > thin.confidence, 'more evidence ⇒ more confidence');
  // Both pure-acceptance, so both positive, but thick is closer to certainty.
  assert.ok(thick.shrunkAcceptRate > thin.shrunkAcceptRate);
});

test('preferenceSignal: bounds and symmetry hold', () => {
  const pos = only(computeExercisePreferenceSignals([], [accept('p', 100, 100)]), 'p');
  const neg = only(computeExercisePreferenceSignals([swap('n', 100, 100)], []), 'n');
  for (const s of [pos, neg]) {
    assert.ok(s.shrunkAcceptRate > 0 && s.shrunkAcceptRate < 1, 'rate strictly in (0,1)');
    assert.ok(s.netAffinity >= -1 && s.netAffinity <= 1, 'affinity in [-1,1]');
    assert.ok(s.confidence >= 0 && s.confidence < 1, 'confidence in [0,1)');
  }
  // Symmetric prior ⇒ pure-accept and pure-reject of equal mass are mirror images.
  assert.ok(Math.abs(pos.netAffinity + neg.netAffinity) < 1e-6, 'symmetry around neutral');
});

test('preferenceSignal: balanced keep/swap collapses to neutral', () => {
  const sig = sole(
    computeExercisePreferenceSignals([swap('row', 10, 10)], [accept('row', 10, 10)]),
  );
  assert.ok(Math.abs(sig.netAffinity) < 1e-6, `equal evidence ⇒ neutral, got ${sig.netAffinity}`);
  assert.ok(sig.confidence > 0.8, 'but plenty of evidence either way');
});

test('preferenceSignal: empty inputs yield no signals', () => {
  assert.deepEqual(computeExercisePreferenceSignals([], []), []);
});
