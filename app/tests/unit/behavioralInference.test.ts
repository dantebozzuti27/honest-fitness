import test from 'node:test';
import assert from 'node:assert/strict';
import { inferBehavioralSession } from '../../src/lib/behavioralInference';
import { buildSessionTelemetry } from '../../src/lib/sessionTelemetry';

test('inferBehavioralSession derives RPE from density and rest without user input', () => {
  const tel = buildSessionTelemetry(
    [
      {
        name: 'Squat',
        sets: Array.from({ length: 10 }, () => ({
          weight: 185,
          reps: 5,
          rest_seconds_actual: 60,
          prescribed_rest_seconds: 120,
        })),
      },
    ],
    55,
    'cut',
  );
  const b = inferBehavioralSession(tel, {
    durationMinutes: 55,
    prescribedExerciseCount: 6,
    completedExerciseCount: 5,
    fitbitCalories: 400,
    trainingGoal: 'cut',
  });
  assert.ok(b.inferredRpe >= 6 && b.inferredRpe <= 9.5);
  assert.ok(b.behavioralOutcomeScore >= 0.35 && b.behavioralOutcomeScore <= 1);
  assert.equal(b.signals.source, 'behavioral_v1');
});
