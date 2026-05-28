import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BIOMECHANICS_ONTOLOGY_SCHEMA,
  buildBiomechanicsOntologySnapshot,
  buildCardioMechanicalLoadSignal,
  buildMechanicalCouplingEdges,
  buildMovementPatternOverlapEdges,
  cardioMechanicalLoadByGroup,
  computeCouplingSignalsFromOntology,
  computeHipAbductorLoadSignal,
} from '../../src/lib/biomechanicsOntology.ts'

test('buildMechanicalCouplingEdges: produces synergist fatigue edges', () => {
  const edges = buildMechanicalCouplingEdges()
  assert.ok(edges.length >= 20)
  const chestToTriceps = edges.find(
    e => e.source_group === 'mid_chest' && e.target_group === 'triceps',
  )
  assert.ok(chestToTriceps)
  assert.equal(chestToTriceps?.coupling_kind, 'synergist_fatigue')
})

test('buildMovementPatternOverlapEdges: co-occurrence edges for shared patterns', () => {
  const overlapEdges = buildMovementPatternOverlapEdges()
  assert.ok(overlapEdges.length >= 50)
  assert.ok(overlapEdges.every(e => e.coupling_kind === 'movement_pattern_overlap'))
  const chestTriceps = overlapEdges.find(
    e => e.source_group === 'mid_chest' && e.target_group === 'triceps',
  )
  assert.ok(chestTriceps)
  assert.ok(chestTriceps!.weight > 0)
  assert.match(chestTriceps!.rationale, /horizontal_push/)
})

test('buildMechanicalCouplingEdges: includes movement pattern overlap edges', () => {
  const edges = buildMechanicalCouplingEdges()
  const overlapCount = edges.filter(e => e.coupling_kind === 'movement_pattern_overlap').length
  assert.ok(overlapCount >= 50)
})

test('buildBiomechanicsOntologySnapshot: schema version bumped', () => {
  assert.equal(BIOMECHANICS_ONTOLOGY_SCHEMA, '2026-05-28.4')
})

test('buildBiomechanicsOntologySnapshot: has hip roles', () => {
  const snap = buildBiomechanicsOntologySnapshot()
  assert.ok(snap.hip_roles.length >= 4)
  assert.match(snap.schema_version, /^\d{4}-\d{2}-\d{2}\.\d+$/)
})

test('computeHipAbductorLoadSignal: returns cardio mechanical signal', () => {
  const signal = computeHipAbductorLoadSignal({
    cardioHistory: [],
    muscleVolumeStatuses: [],
    muscleGroupFrequency: {},
  } as any)
  assert.ok(signal.cardioMechanical)
  assert.equal(typeof signal.externalHipLoadScore, 'number')
})

test('computeCouplingSignalsFromOntology: abductor boost when external load high', () => {
  const hipSignal = {
    weeklyAmbulatoryHours: 4,
    externalHipLoadScore: 1.2,
    internalHipLoadScore: 0.2,
    abductorPriorityBoost: 0.15,
    adductorPriorityBoost: 0,
    adductorPriorityPenalty: 0.1,
    adaptiveSuppression: 1,
    suppressDirectIsolation: false,
    shouldFrontLoadAbductors: true,
    cardioMechanical: {
      source: 'walking' as const,
      frontal_plane_stability_load: 1,
      sagittal_plane_load: 0.5,
      external_rotation_bias: 0.2,
      internal_rotation_bias: 0.1,
    },
  }
  const signals = computeCouplingSignalsFromOntology({ muscleVolumeStatuses: [] } as any, hipSignal)
  assert.ok(signals.abductors?.priorityDelta > 0)
})

test('buildCardioMechanicalLoadSignal: incline walk sets frontal load > 0', () => {
  const signal = buildCardioMechanicalLoadSignal({
    cardioHistory: [{
      exerciseName: 'Incline Treadmill Walk',
      avgDurationSeconds: 3600,
      recentSessions: 4,
      avgIncline: 10,
    }],
  } as any)
  assert.ok(signal.frontal_plane_stability_load > 0)
})

test('buildCardioMechanicalLoadSignal: run sets plantarflexion_load > 0', () => {
  const signal = buildCardioMechanicalLoadSignal({
    cardioHistory: [{
      exerciseName: 'Outdoor Run',
      avgDurationSeconds: 1800,
      recentSessions: 4,
    }],
  } as any)
  assert.ok((signal.plantarflexion_load ?? 0) > 0)
  assert.ok((signal.hip_flexor_demand ?? 0) > 0)
})

test('computeCouplingSignalsFromOntology: stability_transfer edges apply lower penalty', () => {
  const edges = buildMechanicalCouplingEdges()
  const stabilityEdge = edges.find(
    e => e.coupling_kind === 'stability_transfer' && e.source_group === 'core' && e.target_group === 'erector_spinae',
  )
  assert.ok(stabilityEdge)

  const hipSignal = {
    weeklyAmbulatoryHours: 0,
    externalHipLoadScore: 0,
    internalHipLoadScore: 0,
    abductorPriorityBoost: 0,
    adductorPriorityBoost: 0,
    adductorPriorityPenalty: 0,
    adaptiveSuppression: 1,
    suppressDirectIsolation: false,
    shouldFrontLoadAbductors: false,
    cardioMechanical: {
      source: 'mixed' as const,
      frontal_plane_stability_load: 0,
      sagittal_plane_load: 0,
      external_rotation_bias: 0,
      internal_rotation_bias: 0,
    },
  }
  const profile = {
    muscleVolumeStatuses: [{ muscleGroup: 'core', daysSinceLastTrained: 1, weeklyDirectSets: 6 }],
  } as any
  const signals = computeCouplingSignalsFromOntology(profile, hipSignal, edges)
  const expectedPenalty = -(stabilityEdge!.weight * 0.06)
  assert.ok(Math.abs((signals.erector_spinae?.priorityDelta ?? 0) - expectedPenalty) < 0.001)
})

test('computeCouplingSignalsFromOntology: movement_pattern_overlap on shared pattern fatigue', () => {
  const overlapEdges = buildMovementPatternOverlapEdges()
  const chestTriceps = overlapEdges.find(
    e => e.source_group === 'mid_chest' && e.target_group === 'triceps',
  )
  assert.ok(chestTriceps)

  const hipSignal = {
    weeklyAmbulatoryHours: 0,
    externalHipLoadScore: 0,
    internalHipLoadScore: 0,
    abductorPriorityBoost: 0,
    adductorPriorityBoost: 0,
    adductorPriorityPenalty: 0,
    adaptiveSuppression: 1,
    suppressDirectIsolation: false,
    shouldFrontLoadAbductors: false,
    cardioMechanical: {
      source: 'mixed' as const,
      frontal_plane_stability_load: 0,
      sagittal_plane_load: 0,
      external_rotation_bias: 0,
      internal_rotation_bias: 0,
    },
  }
  const profile = {
    muscleVolumeStatuses: [],
    movementPatternFatigue: [{
      pattern: 'horizontal_push',
      lastTrainedDate: '2026-05-26',
      hoursSinceLastTrained: 12,
      weeklySessionCount: 2,
      fatigueLevel: 'high' as const,
    }],
  } as any
  const signals = computeCouplingSignalsFromOntology(profile, hipSignal, [chestTriceps!])
  const expectedDelta = -(chestTriceps!.weight * 0.12)
  assert.ok(Math.abs((signals.mid_chest?.priorityDelta ?? 0) - expectedDelta) < 0.001)
  assert.ok(Math.abs((signals.triceps?.priorityDelta ?? 0) - expectedDelta) < 0.001)
})

test('cardioMechanicalLoadByGroup: run maps calves load', () => {
  const signal = buildCardioMechanicalLoadSignal({
    cardioHistory: [{
      exerciseName: 'Treadmill Run',
      avgDurationSeconds: 2400,
      recentSessions: 4,
    }],
  } as any)
  const byGroup = cardioMechanicalLoadByGroup(signal)
  assert.ok((byGroup.calves ?? 0) > 0)
})
