import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthlyFocusSplitGuard } from '../../src/lib/monthlyFocus';

const schedule = {
  '1': {
    focus: 'Push',
    groups: ['mid_chest', 'triceps'],
  },
  '2': {
    focus: 'Pull',
    groups: ['back_lats', 'biceps'],
  },
};

test('computeMonthlyFocusSplitGuard: true when tomorrow split includes the focus muscle', () => {
  // Monday (1) plan date → Tuesday (2) is pull w/ biceps.
  assert.equal(
    computeMonthlyFocusSplitGuard(schedule as never, [], '2026-05-11', 'biceps'),
    true,
  );
});

test('computeMonthlyFocusSplitGuard: false on rest day tomorrow', () => {
  assert.equal(
    computeMonthlyFocusSplitGuard(schedule as never, [2], '2026-05-11', 'biceps'),
    false,
  );
});

test('computeMonthlyFocusSplitGuard: false when tomorrow does not train that muscle', () => {
  assert.equal(
    computeMonthlyFocusSplitGuard(schedule as never, [], '2026-05-12', 'biceps'),
    false,
  );
});
