import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  robustSessionBestE1rm,
  analyzeE1rmInflation,
  detectSwapOscillation,
  epley1RMWithRir,
} from '../src/engines/ml/strengthForensics.js';

describe('strengthForensics', () => {
  it('robustSessionBestE1rm rejects lone high-rep spike vs second-best', () => {
    const sets = [
      { weight: 35, reps: 20 },
      { weight: 35, reps: 18 },
      { weight: 65, reps: 20 },
    ];
    const best = robustSessionBestE1rm(sets);
    assert.ok(best);
    assert.equal(best.weight, 35);
    assert.ok(best.e1rm < epley1RMWithRir(65, 20, 1));
  });

  it('analyzeE1rmInflation flags high-rep dominated exercises', () => {
    const workouts = [
      {
        date: '2026-01-01',
        workout_exercises: [
          {
            exercise_name: 'Cable Curl',
            workout_sets: [{ weight: 65, reps: 20 }, { weight: 35, reps: 20 }],
          },
        ],
      },
      {
        date: '2026-01-08',
        workout_exercises: [
          {
            exercise_name: 'Cable Curl',
            workout_sets: [{ weight: 65, reps: 18 }, { weight: 35, reps: 20 }],
          },
        ],
      },
      {
        date: '2026-01-15',
        workout_exercises: [
          {
            exercise_name: 'Cable Curl',
            workout_sets: [{ weight: 40, reps: 12 }],
          },
        ],
      },
    ];
    const r = analyzeE1rmInflation(workouts);
    assert.ok(r.inflatedExercises.length >= 1);
    assert.ok(r.inflatedExercises[0].inflationPct >= 5);
  });

  it('detectSwapOscillation finds bidirectional edges', () => {
    const swaps = [
      { exercise_name: 'A', replacement_exercise_name: 'B' },
      { exercise_name: 'B', replacement_exercise_name: 'A' },
      { exercise_name: 'A', replacement_exercise_name: 'B' },
      { exercise_name: 'B', replacement_exercise_name: 'A' },
    ];
    const r = detectSwapOscillation(swaps);
    assert.equal(r.oscillationPairs.length, 1);
    assert.equal(r.oscillationPairs[0].total, 4);
  });
});
