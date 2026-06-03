import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patternKey,
  aggregatePatternObservations,
  verifyPatternAgainstProfile,
  preparePatternRowsForInsert,
} from '../../src/lib/patternLearning';
import type { TrainingProfile } from '../../src/lib/trainingAnalysis';

const stubProfile = {
  muscleVolumeStatuses: [
    { muscleGroup: 'triceps', status: 'above_mrv', weeklyDirectSets: 18, mev: 6, mav: 12, mrv: 14 },
  ],
  muscleGroupFrequency: { triceps: 3 },
  exerciseSwapHistory: [{ exerciseName: 'Row', replacementExerciseName: 'Cable Row' }],
  exercisePreferences: [],
  avgSessionDuration: 84,
  cumulativeSleepDebt: 0,
  totalWorkoutCount: 50,
} as unknown as TrainingProfile;

test('patternKey is stable for duplicate LLM wording', () => {
  const a = patternKey('User trains triceps with high volume.', 'Reduce triceps volume');
  const b = patternKey('User trains triceps with high volume!', 'Reduce triceps volume');
  assert.equal(a, b);
});

test('aggregatePatternObservations collapses duplicate rows', () => {
  const rows = Array.from({ length: 20 }, () => ({
    feedback_data: {
      pattern: 'User frequently trains triceps with high volume.',
      suggestion: 'Reduce triceps sets next mesocycle.',
      confidence: 'high',
    },
    created_at: '2026-06-01',
  }));
  const agg = aggregatePatternObservations(rows, stubProfile, { minOccurrences: 2 });
  assert.equal(agg.length, 1);
  assert.equal(agg[0].occurrenceCount, 20);
});

test('verifyPatternAgainstProfile auto-verifies MRV claim', () => {
  const v = verifyPatternAgainstProfile(
    {
      pattern: 'Triceps volume above MRV',
      suggestion: 'Reduce triceps volume',
      confidence: 'high',
    },
    stubProfile,
  );
  assert.ok(v.autoVerified);
  assert.ok(v.evidence.length > 0);
});

test('preparePatternRowsForInsert skips existing keys', () => {
  const keys = new Set([patternKey('Same pattern', 'Same fix')]);
  const rows = preparePatternRowsForInsert(
    'user-1',
    '2026-06-03',
    [
      { pattern: 'Same pattern', suggestion: 'Same fix', confidence: 'high' },
      { pattern: 'New pattern', suggestion: 'New fix', confidence: 'medium' },
    ],
    keys,
    stubProfile,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].feedback_data.pattern, 'New pattern');
});
