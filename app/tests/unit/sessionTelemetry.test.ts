import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionTelemetry } from '../../src/lib/sessionTelemetry';

test('buildSessionTelemetry aggregates rest and tonnage', () => {
  const r = buildSessionTelemetry(
    [
      {
        name: 'Bench Press',
        sets: [
          { weight: 135, reps: 8, rest_seconds_actual: 90, prescribed_rest_seconds: 120 },
          { weight: 135, reps: 6, rest_seconds_actual: 100, prescribed_rest_seconds: 120 },
        ],
      },
    ],
    60,
    'cut',
  );
  assert.equal(r.workingSetCount, 2);
  assert.equal(r.tonnage, 135 * 8 + 135 * 6);
  assert.equal(r.totalRestSeconds, 190);
  assert.equal(r.setsWithRestLogged, 2);
  assert.ok(r.medianRestVsPrescribed != null && r.medianRestVsPrescribed > 0.7);
});
