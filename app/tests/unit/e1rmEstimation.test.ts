import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capE1rmVsRecentMedian,
  epley1RMWithRir,
  robustRecentPeakE1rm,
  sessionBestE1rmFromSets,
} from '../../src/lib/e1rmEstimation';

test('epley1RMWithRir: caps high reps so 20-rep sets do not inflate e1RM', () => {
  const highRep = epley1RMWithRir(50, 20, 2);
  const capped = epley1RMWithRir(50, 12, 2);
  assert.ok(highRep <= capped * 1.05);
});

test('sessionBestE1rmFromSets: resists one outlier set vs second-best', () => {
  const best = sessionBestE1rmFromSets([
    { weight: 100, reps: 8, actual_rir: 2 },
    { weight: 100, reps: 8, actual_rir: 2 },
    { weight: 100, reps: 8, actual_rir: 2 },
    { weight: 200, reps: 3, actual_rir: 0 },
  ]);
  assert.ok(best);
  const naiveMax = Math.max(
    epley1RMWithRir(100, 8, 2),
    epley1RMWithRir(200, 3, 0),
  );
  assert.ok(best!.e1rm < naiveMax);
});

test('robustRecentPeakE1rm: caps spike vs prior sessions', () => {
  const peak = robustRecentPeakE1rm([200, 205, 210, 280], 4);
  assert.ok(peak < 280);
  assert.ok(peak >= 210);
});

test('capE1rmVsRecentMedian: limits jump ratio', () => {
  const capped = capE1rmVsRecentMedian(300, [200, 205, 210], 1.12);
  assert.ok(capped < 300);
  assert.ok(capped <= 210 * 1.12 + 0.01);
});
