/**
 * Unit tests for weight prescription snapping.
 *
 * Contract:
 *   - Barbell prescriptions must respect both (a) plate increment (5 lb)
 *     AND (b) the empty-bar minimum (45 lb).
 *   - Dumbbell prescriptions must respect 5-lb rack granularity AND a
 *     5-lb floor.
 *   - Smith machines respect their own min (25 lb) — accounts for shorter
 *     fixed bars common in commercial gyms.
 *   - Kettlebells respect their min (10 lb).
 *   - Machines respect a small minimum to avoid prescribing fractional pin
 *     positions on a stack that doesn't have them.
 *   - Equipment priority when an exercise lists multiple options:
 *     barbell > smith > dumbbell > kettlebell > machine. Picking the most
 *     constrained equipment is the safe default — the user can always
 *     scale down with a less-constrained option.
 *   - Negative / NaN / zero inputs collapse to 0 (no prescription).
 *
 * If any of these break, the user sees physically-impossible weights
 * (40-lb barbells, 69-lb dumbbells) — the entire reason this test exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { snapToPlate } from '../../src/lib/workoutEngine';

test('snapToPlate: barbell floors at 45 lb (empty bar minimum)', () => {
  assert.equal(snapToPlate(30, ['barbell']), 45);
  assert.equal(snapToPlate(40, ['barbell']), 45);
  assert.equal(snapToPlate(42.5, ['barbell']), 45);
  assert.equal(snapToPlate(44, ['barbell']), 45);
});

test('snapToPlate: barbell at-or-above floor snaps to 5-lb increments', () => {
  assert.equal(snapToPlate(45, ['barbell']), 45);
  assert.equal(snapToPlate(47, ['barbell']), 45);
  assert.equal(snapToPlate(48, ['barbell']), 50);
  assert.equal(snapToPlate(135, ['barbell']), 135);
  assert.equal(snapToPlate(137.4, ['barbell']), 135);
  assert.equal(snapToPlate(138, ['barbell']), 140);
  assert.equal(snapToPlate(187.4, ['barbell']), 185);
});

test('snapToPlate: dumbbell snaps to 5-lb increments and never produces 69 lb', () => {
  // The exact bug from the field: a 68-69 lb continuous output must round
  // to a real dumbbell value (70).
  assert.equal(snapToPlate(68, ['dumbbell']), 70);
  assert.equal(snapToPlate(69, ['dumbbell']), 70);
  assert.equal(snapToPlate(67, ['dumbbell']), 65);
  assert.equal(snapToPlate(67.4, ['dumbbell']), 65);
  // Floor at the smallest available pair.
  assert.equal(snapToPlate(2, ['dumbbell']), 5);
  assert.equal(snapToPlate(3, ['dumbbell']), 5);
});

test('snapToPlate: smith machine min 25 lb', () => {
  assert.equal(snapToPlate(15, ['smith_machine']), 25);
  assert.equal(snapToPlate(20, ['smith_machine']), 25);
  assert.equal(snapToPlate(40, ['smith_machine']), 40);
  assert.equal(snapToPlate(127.4, ['smith_machine']), 125);
});

test('snapToPlate: kettlebell min 10 lb, 5-lb steps', () => {
  assert.equal(snapToPlate(7, ['kettlebell']), 10);
  assert.equal(snapToPlate(33, ['kettlebell']), 35);
  assert.equal(snapToPlate(52, ['kettlebell']), 50);
});

test('snapToPlate: machine min 5 lb, 5-lb steps', () => {
  assert.equal(snapToPlate(2, ['machine']), 5);
  assert.equal(snapToPlate(7.4, ['machine']), 5);
  assert.equal(snapToPlate(8, ['machine']), 10);
});

test('snapToPlate: isolation exercises use 2.5-lb increments', () => {
  // exerciseType param overrides default machine increment when no equipment hint
  assert.equal(snapToPlate(11, [], 'isolation'), 10);
  assert.equal(snapToPlate(11.5, [], 'isolation'), 12.5);
  assert.equal(snapToPlate(13, [], 'isolation'), 12.5);
  assert.equal(snapToPlate(14, [], 'isolation'), 15);
});

test('snapToPlate: equipment priority — barbell wins over softer options', () => {
  // An exercise that lists both barbell and dumbbell (e.g. shrug) must
  // be capped to the most constraining option. If we let dumbbell win,
  // the engine could prescribe 30 lb — illegal on a barbell.
  assert.equal(snapToPlate(30, ['barbell', 'dumbbell']), 45);
  assert.equal(snapToPlate(60, ['barbell', 'dumbbell']), 60);
});

test('snapToPlate: equipment priority — smith wins over dumbbell', () => {
  assert.equal(snapToPlate(20, ['smith_machine', 'dumbbell']), 25);
});

test('snapToPlate: zero / negative / NaN inputs return 0', () => {
  assert.equal(snapToPlate(0, ['barbell']), 0);
  assert.equal(snapToPlate(-50, ['barbell']), 0);
  assert.equal(snapToPlate(NaN, ['barbell']), 0);
  assert.equal(snapToPlate(Infinity, ['barbell']), 0);
});

test('snapToPlate: unspecified equipment falls back to machine increment', () => {
  // Empty equipment array, no exerciseType: engine defaults to machine
  // increment (5 lb) with machine minimum (5 lb).
  assert.equal(snapToPlate(7.4, []), 5);
  assert.equal(snapToPlate(50, []), 50);
});
