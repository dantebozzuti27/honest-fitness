import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mesocycleVolumeTarget,
  getGuidelineForGroup,
  VOLUME_GUIDELINES,
} from '../../src/lib/volumeGuidelines.ts'

const midChest = getGuidelineForGroup('mid_chest')!

test('mesocycleVolumeTarget: opens an accumulation block at MAV-low', () => {
  // Week 1 should equal MAV-low — the lowest dose still in the productive band.
  assert.equal(mesocycleVolumeTarget(midChest, 1), midChest.mavLow)
})

test('mesocycleVolumeTarget: peaks at MAV-high on the final accumulation week', () => {
  // Default 3 accumulation weeks → week 3 is the peak.
  assert.equal(mesocycleVolumeTarget(midChest, 3), midChest.mavHigh)
})

test('mesocycleVolumeTarget: deload week drops to MEV', () => {
  // Week 4 (= accumulationWeeks + 1) is the deload.
  assert.equal(mesocycleVolumeTarget(midChest, 4), midChest.mev)
})

test('mesocycleVolumeTarget: accumulation is monotonically non-decreasing', () => {
  // Progressive overload by volume: every accumulation week must be >= the prior.
  for (const g of VOLUME_GUIDELINES) {
    if (g.mavHigh <= 0) continue
    const w1 = mesocycleVolumeTarget(g, 1)
    const w2 = mesocycleVolumeTarget(g, 2)
    const w3 = mesocycleVolumeTarget(g, 3)
    assert.ok(w2 >= w1, `${g.muscleGroup}: week2 (${w2}) < week1 (${w1})`)
    assert.ok(w3 >= w2, `${g.muscleGroup}: week3 (${w3}) < week2 (${w2})`)
  }
})

test('mesocycleVolumeTarget: peak accumulation strictly exceeds the opener (real progression)', () => {
  // For every muscle with a non-trivial MAV band, the block must actually
  // add volume — otherwise periodization is cosmetic.
  for (const g of VOLUME_GUIDELINES) {
    if (g.mavHigh <= g.mavLow) continue
    const opener = mesocycleVolumeTarget(g, 1)
    const peak = mesocycleVolumeTarget(g, 3)
    assert.ok(peak > opener, `${g.muscleGroup}: peak (${peak}) did not exceed opener (${opener})`)
  }
})

test('mesocycleVolumeTarget: every target is bounded by [0, MRV]', () => {
  for (const g of VOLUME_GUIDELINES) {
    for (let w = 1; w <= 5; w++) {
      const v = mesocycleVolumeTarget(g, w)
      assert.ok(v >= 0, `${g.muscleGroup} week ${w}: ${v} < 0`)
      assert.ok(v <= g.mrv, `${g.muscleGroup} week ${w}: ${v} > MRV ${g.mrv}`)
    }
  }
})

test('mesocycleVolumeTarget: deload is the lowest point of the wave', () => {
  for (const g of VOLUME_GUIDELINES) {
    if (g.mavHigh <= 0) continue
    const accumulation = [1, 2, 3].map(w => mesocycleVolumeTarget(g, w))
    const deload = mesocycleVolumeTarget(g, 4)
    assert.ok(
      deload <= Math.min(...accumulation),
      `${g.muscleGroup}: deload (${deload}) is not <= min accumulation (${Math.min(...accumulation)})`,
    )
  }
})

test('mesocycleVolumeTarget: muscles needing no direct work stay at zero', () => {
  // anterior_deltoid is saturated by compound pressing (mavHigh modest, but
  // any guideline with mavHigh <= 0 must floor at 0).
  const zeroGroups = VOLUME_GUIDELINES.filter(g => g.mavHigh <= 0)
  for (const g of zeroGroups) {
    for (let w = 1; w <= 4; w++) {
      assert.equal(mesocycleVolumeTarget(g, w), 0, `${g.muscleGroup} week ${w}`)
    }
  }
})

test('mesocycleVolumeTarget: clamps out-of-range / non-finite weeks deterministically', () => {
  // Week 0 and negative weeks collapse to the opener; NaN defaults to week 1.
  assert.equal(mesocycleVolumeTarget(midChest, 0), mesocycleVolumeTarget(midChest, 1))
  assert.equal(mesocycleVolumeTarget(midChest, -5), mesocycleVolumeTarget(midChest, 1))
  assert.equal(mesocycleVolumeTarget(midChest, NaN), mesocycleVolumeTarget(midChest, 1))
  // Far-future weeks remain deload (never climb again).
  assert.equal(mesocycleVolumeTarget(midChest, 9), midChest.mev)
})

test('mesocycleVolumeTarget: respects a custom accumulation length', () => {
  // A 5-week wave (4 accumulation + deload) must still open at MAV-low,
  // peak at MAV-high on week 4, and deload on week 5.
  assert.equal(mesocycleVolumeTarget(midChest, 1, 4), midChest.mavLow)
  assert.equal(mesocycleVolumeTarget(midChest, 4, 4), midChest.mavHigh)
  assert.equal(mesocycleVolumeTarget(midChest, 5, 4), midChest.mev)
})
