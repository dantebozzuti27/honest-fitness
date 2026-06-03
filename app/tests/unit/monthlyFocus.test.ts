import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlyFocusSplitGuard,
  focusWeekOfMonth,
  monthlyFocusVolumeBonus,
  parseMonthlyFocusState,
} from '../../src/lib/monthlyFocus';

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

test('focusWeekOfMonth: 1st-7th = week 1', () => {
  assert.equal(focusWeekOfMonth('2026-05-01'), 1);
  assert.equal(focusWeekOfMonth('2026-05-07'), 1);
});

test('focusWeekOfMonth: 8th-14th = week 2', () => {
  assert.equal(focusWeekOfMonth('2026-05-08'), 2);
  assert.equal(focusWeekOfMonth('2026-05-14'), 2);
});

test('focusWeekOfMonth: 22nd-28th = week 4', () => {
  assert.equal(focusWeekOfMonth('2026-05-22'), 4);
  assert.equal(focusWeekOfMonth('2026-05-28'), 4);
});

test('focusWeekOfMonth: 29th-31st clamps to week 5', () => {
  assert.equal(focusWeekOfMonth('2026-05-29'), 5);
  assert.equal(focusWeekOfMonth('2026-05-31'), 5);
});

const focusState = {
  month: '2026-05',
  fitness_muscles: ['biceps'],
  life_label: '',
  life_completions: {},
};

test('monthlyFocusVolumeBonus: week 1 → +1 set', () => {
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-03'), 1);
});

test('monthlyFocusVolumeBonus: week 2 → +2 sets', () => {
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-10'), 2);
});

test('monthlyFocusVolumeBonus: week 3 → +2 sets', () => {
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-17'), 2);
});

test('monthlyFocusVolumeBonus: week 4 → +1 set (consolidation)', () => {
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-24'), 1);
});

test('monthlyFocusVolumeBonus: split guard day halves the bonus', () => {
  // Week 2 normally = +2; on a guard day, +1.
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-10', true), 1);
  // Week 4 normally = +1; on a guard day, +0 (no extra dose the day
  // before the dedicated split day).
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-05-24', true), 0);
});

test('monthlyFocusVolumeBonus: returns 0 when no fitness focus set', () => {
  const noFocus = { ...focusState, fitness_muscles: [] };
  assert.equal(monthlyFocusVolumeBonus(noFocus, '2026-05-10'), 0);
});

test('parseMonthlyFocusState: migrates legacy fitness_muscle to array', () => {
  const parsed = parseMonthlyFocusState({
    month: '2026-05',
    fitness_muscle: 'biceps',
    life_label: '',
    life_completions: {},
  });
  assert.deepEqual(parsed?.fitness_muscles, ['biceps']);
});

test('parseMonthlyFocusState: accepts fitness_muscles array', () => {
  const parsed = parseMonthlyFocusState({
    month: '2026-05',
    fitness_muscles: ['biceps', 'calves'],
    life_label: '',
    life_completions: {},
  });
  assert.deepEqual(parsed?.fitness_muscles, ['biceps', 'calves']);
});

test('monthlyFocusVolumeBonus: returns 0 when month does not match', () => {
  assert.equal(monthlyFocusVolumeBonus(focusState, '2026-06-10'), 0);
});
