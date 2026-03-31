# Research-Driven Model Improvements

Evidence-based recommendations for improving the HonestFitness workout engine, derived from six landmark papers in resistance training science.

---

## Papers Reviewed

| # | Citation | Core Finding |
|---|----------|-------------|
| 1 | Schoenfeld, Ogborn & Krieger (2017). Dose-response relationship between weekly RT volume and muscle mass. *J Sports Sci* 35(11):1073–1082 | Graded dose-response: each additional weekly set → +0.37% hypertrophy gain. 10+ sets/muscle/week trend toward superior outcomes vs <5 sets. |
| 2 | Schoenfeld, Grgic & Krieger (2016). Training frequency and hypertrophy. *Sports Med* 46(11):1689–1697 | Training each muscle ≥2×/week produces superior hypertrophy to 1×/week on a volume-equated basis. 3×/week may be marginally better but evidence is inconclusive. |
| 3 | Schoenfeld (2010). Mechanisms of muscle hypertrophy. *J Strength Cond Res* 24(10):2857–2872 | Three primary drivers: mechanical tension, metabolic stress, muscle damage. Practical implication: moderate loads (6–12 rep range) with controlled tempo optimize all three. |
| 4 | Haun et al. (2019). Critical evaluation of skeletal muscle hypertrophy measurement. *Front Physiol* 10:247 | Macro-level size gains may not reflect proportional myofibrillar protein increases — sarcoplasmic hypertrophy (fluid/glycogen expansion) can inflate measurements. Training variables that maximize myofibrillar vs sarcoplasmic adaptation may differ. |
| 5 | Ralston et al. (2017). Weekly set volume and strength gain. *Sports Med* 47(12):2585–2601 | Higher weekly set volumes produce greater strength gains (ES 1.01 vs 0.82 for high vs low). Applies to both multi-joint and isolation exercises. |
| 6 | Grgic et al. (2022). Training to failure vs non-failure. *J Strength Cond Res* 36(4):1116–1126 | No significant overall difference. But: in trained individuals, failure training showed a small but significant hypertrophy advantage (ES 0.15). Non-failure may be superior for strength when volume is not equated. |

---

## Current Engine Gaps vs Evidence

### 1. Volume Prescription Is Static — Should Be Individualized and Progressive

**Evidence:** Schoenfeld (2017) and Ralston (2017) both demonstrate a graded dose-response relationship. More sets = more growth, up to a ceiling. But the ceiling (MRV) varies dramatically between individuals and muscle groups.

**Current engine behavior:**
- `volumeGuidelines.ts` defines fixed MEV/MAV/MRV bands per muscle group (e.g., chest: MEV=8, MAV=10–18, MRV=22).
- `individualMrvEstimates` exists in the profile but is only used as a soft cap: `Math.min(weeklyTarget, individualMrv * 0.85)`.
- No progressive overload of *volume itself* — the engine doesn't systematically increase weekly sets over mesocycles.

**Recommended changes:**

```
volumeGuidelines.ts:
  Add a `volumeProgressionRate` field per muscle group (sets/week/mesocycle).
  Default: +1 set/week per mesocycle for large groups, +0.5 for small groups.

workoutEngine.ts → stepSelectMuscleGroups():
  Track cumulative weekly sets over the trailing 4 weeks.
  If weekly sets < MAV_low and recovery indicators are green:
    targetSets = previous_week_sets + volumeProgressionRate
  If weekly sets approaching MRV and any recovery signal is amber/red:
    targetSets = previous_week_sets - 1 (functional overreaching → taper)
  
  This creates a proper periodized volume ramp: MEV → MAV → approach MRV → deload.
```

### 2. Training Frequency Per Muscle Is Not Optimized

**Evidence:** Schoenfeld (2016) — training each muscle ≥2×/week is superior. The current engine doesn't explicitly track or enforce per-muscle weekly frequency.

**Current engine behavior:**
- Split rotation determines which muscles get trained on which days.
- No constraint ensuring each muscle group appears at least twice in the weekly plan.
- The `weekly_split_schedule` feature (just added) controls day-to-muscle mapping but doesn't validate frequency coverage.

**Recommended changes:**

```
workoutEngine.ts → generateWeeklyPlan():
  After generating all 7 days, compute per-muscle frequency:
    frequencyMap: Record<CanonicalMuscleGroup, number>
  
  For any muscle group with frequency < 2:
    If the group is a primary group (chest, back, quads, etc.):
      Flag as UNDERHIT and attempt to add it as secondary volume
      on the nearest compatible training day.
    
  Exception: small groups that receive sufficient indirect volume
  (anterior_deltoid from pressing, biceps from pulling) can be 1×/week
  if their indirect volume already exceeds MEV.

modelConfig.ts:
  Add `minWeeklyFrequencyMajorGroups: 2`
  Add `minWeeklyFrequencyMinorGroups: 1`
```

### 3. RIR Prescription Ignores Training Status

**Evidence:** Grgic (2022) — in *trained* individuals, proximity to failure matters more for hypertrophy (ES=0.15 advantage for failure training). In novices, non-failure training is equally effective and may be superior for strength. Schoenfeld (2010) — metabolic stress (which increases near failure) is one of three primary hypertrophy drivers.

**Current engine behavior:**
- RIR is assigned based on exercise role: primaries get RIR 1–2, isolations get RIR 0.
- No differentiation by training experience or training age.
- No periodization of RIR across a mesocycle.

**Recommended changes:**

```
workoutEngine.ts → stepPrescribeSetsReps():
  Determine effective_training_age from profile.
  
  If experience_level == 'beginner' (< 1 year):
    Primary compounds: RIR 2–3 (skill acquisition priority)
    Isolations: RIR 1–2
    
  If experience_level == 'intermediate' (1–3 years):
    Primary compounds: RIR 1–2
    Isolations: RIR 0–1
    
  If experience_level == 'advanced' (3+ years):
    Primary compounds: RIR 0–1 (mechanical tension maximization)
    Isolations: RIR 0 (metabolic stress maximization)
    Last set of compounds: RIR 0 (failure on final set only)
  
  Mesocycle periodization:
    Week 1 (accumulation): base RIR + 1
    Week 2: base RIR
    Week 3 (intensification): base RIR - 1 (clamped to 0)
    Week 4 (deload): base RIR + 3
```

### 4. Rep Ranges Are Too Uniform — Need Mechanical Tension vs Metabolic Stress Cycling

**Evidence:** Schoenfeld (2010) identifies three distinct hypertrophy mechanisms:
1. **Mechanical tension** — maximized at heavy loads (3–6 reps)
2. **Metabolic stress** — maximized at moderate loads with short rest (8–15 reps)
3. **Muscle damage** — controlled eccentric emphasis (6–12 reps, slower negatives)

Haun (2019) suggests that different rep ranges may preferentially drive myofibrillar (contractile) vs sarcoplasmic (non-contractile) hypertrophy.

**Current engine behavior:**
- Rep targets are computed from a single formula based on exercise type and goals.
- No deliberate cycling between mechanical tension and metabolic stress phases.
- Tempo is assigned but not varied systematically.

**Recommended changes:**

```
workoutEngine.ts → stepPrescribeSetsReps():
  Implement rep range cycling within the weekly plan:
  
  PRIMARY COMPOUNDS (squat, bench, deadlift, row, OHP):
    Day 1 occurrence: Heavy — 4×4–6 @ RIR 1, rest 3–4 min
    Day 2 occurrence: Volume — 3×8–12 @ RIR 1–2, rest 2 min
  
  SECONDARY COMPOUNDS:
    Day 1: 3×6–8 @ RIR 1–2, rest 2–3 min
    Day 2: 3×10–15 @ RIR 0–1, rest 90s
  
  ISOLATIONS:
    Always: 3×12–20 @ RIR 0, rest 60–90s
    (Metabolic stress emphasis — Schoenfeld 2010)
  
  Tempo variation by phase:
    Heavy days: 1-0-X (controlled eccentric, explosive concentric)
    Volume days: 3-1-1 (slow eccentric for muscle damage stimulus)
    Isolation: 2-1-2 (constant tension for metabolic stress)

modelConfig.ts:
  Add `heavyRepRangeLow: 4, heavyRepRangeHigh: 6`
  Add `moderateRepRangeLow: 8, moderateRepRangeHigh: 12`
  Add `metabolicRepRangeLow: 12, metabolicRepRangeHigh: 20`
  Add `heavyRestSeconds: 210, moderateRestSeconds: 120, metabolicRestSeconds: 75`
```

### 5. Volume Accounting Doesn't Count Indirect (Synergist) Sets

**Evidence:** Schoenfeld (2017) measured volume as *direct sets per muscle per week*. But compound movements produce significant indirect stimulus. A bench press is a direct chest set but also an indirect triceps/anterior deltoid set. Ignoring this overestimates volume deficits for synergist muscles and risks overtraining them.

**Current engine behavior:**
- `weeklyDirectSets` in `muscleVolumeStatuses` counts only exercises where the muscle is the primary target.
- Secondary/synergist contribution is not tracked.
- This leads to the engine prescribing, say, 12 direct tricep sets when the user already receives 15 indirect tricep sets from pressing.

**Recommended changes:**

```
trainingAnalysis.ts → computeTrainingProfile():
  For each logged exercise, distribute volume credit:
    Primary muscles: 1.0 set credit per set performed
    Secondary muscles: 0.5 set credit per set performed
    Stabilizer muscles: 0.0 (no meaningful hypertrophy stimulus)
  
  New field: `weeklyEffectiveSets` = directSets + (indirectSets × 0.5)
  
  Volume deficit calculation should use weeklyEffectiveSets, not weeklyDirectSets:
    volumeDeficit = max(0, targetSets - weeklyEffectiveSets)

volumeGuidelines.ts:
  Add `indirectVolumeMultiplier: 0.5` as a configurable parameter.
  Per-group override possible (e.g., biceps from rows = 0.4, triceps from pressing = 0.6).
```

### 6. No Mesocycle-Level Periodization

**Evidence:** Multiple papers (Schoenfeld 2010, 2017; Ralston 2017) implicitly support periodization: volume should ramp up over weeks, then deload. The dose-response relationship is not linear to infinity — there's a ceiling (MRV) beyond which more volume is counterproductive.

**Current engine behavior:**
- Each week's plan is generated independently with no memory of where the user is in a mesocycle.
- Deload is triggered reactively (when regression/fatigue signals cross thresholds) rather than proactively planned.
- No concept of accumulation → intensification → realization → deload phases.

**Recommended changes:**

```
Database:
  Add `mesocycle_week` (1–4) and `mesocycle_start_date` to user_preferences.
  Auto-advance weekly.

workoutEngine.ts:
  Read mesocycle_week and apply phase-specific modifiers:
  
  Week 1 (Accumulation):
    Volume: 90% of target    | RIR: +1 from base
    Purpose: Ease in, establish baseline
    
  Week 2 (Loading):
    Volume: 100% of target   | RIR: base
    Purpose: Full productive training
    
  Week 3 (Overreach):
    Volume: 110% of target   | RIR: -1 from base (more sets closer to failure)
    Purpose: Planned functional overreaching
    
  Week 4 (Deload):
    Volume: 50–60% of target | RIR: +3
    Purpose: Dissipate fatigue, realize gains
    
  After deload: increment MAV targets by volumeProgressionRate for next mesocycle.
```

### 7. Eccentric Emphasis Is Missing

**Evidence:** The meta-analysis at PMID 28486337 (Schoenfeld et al. 2017) found that eccentric actions produced a larger (though not statistically significant) effect size for hypertrophy than concentric (10.0% vs 6.8% mean growth). Schoenfeld (2010) identifies muscle damage from eccentric loading as a primary hypertrophy mechanism.

**Current engine behavior:**
- Tempo is assigned per exercise but there's no systematic eccentric emphasis.
- No tracking of eccentric load or eccentric-specific progressions.

**Recommended changes:**

```
workoutEngine.ts → stepPrescribeSetsReps():
  For volume/hypertrophy days:
    Set default tempo to emphasize eccentric: 3-1-1 or 4-1-1
    (3–4 second eccentric, 1 second pause, 1 second concentric)
  
  For heavy/strength days:
    Set tempo to 2-0-X (controlled eccentric, explosive concentric)
  
  Optionally flag one exercise per session for "eccentric overload":
    Tempo: 5-1-1 with 5% lower weight
    Rationale: maximizes muscle damage stimulus per Schoenfeld (2010)
```

---

## Implementation Priority Matrix

| Priority | Change | Effort | Impact | Evidence Strength |
|----------|--------|--------|--------|-------------------|
| **P0** | Rep range cycling (heavy/volume days) | Medium | High | Schoenfeld 2010, Haun 2019 |
| **P0** | RIR scaling by experience level | Low | High | Grgic 2022, Schoenfeld 2010 |
| **P1** | Indirect volume accounting | Medium | High | Schoenfeld 2017 |
| **P1** | Per-muscle frequency validation (≥2×/week) | Low | High | Schoenfeld 2016 |
| **P1** | Progressive volume overload across mesocycles | Medium | High | Schoenfeld 2017, Ralston 2017 |
| **P2** | 4-week mesocycle periodization | High | Medium | All papers collectively |
| **P2** | Eccentric tempo emphasis | Low | Medium | Schoenfeld 2010, 2017 |
| **P3** | Sarcoplasmic vs myofibrillar tracking | High | Low | Haun 2019 (emerging evidence) |

---

## Summary

The current engine treats every week as an independent optimization problem with static volume targets and uniform rep/RIR prescriptions. The literature strongly supports:

1. **Volume should ramp** across weeks (mesocycle periodization), not stay flat.
2. **Frequency ≥2×/week per muscle** is a hard constraint, not a suggestion.
3. **RIR should scale** with training age — beginners need more buffer, advanced lifters benefit from proximity to failure.
4. **Rep ranges must cycle** — heavy days (mechanical tension) and volume days (metabolic stress) within the same week for the same muscle.
5. **Indirect volume matters** — synergist contribution must be counted or the engine will overtrain small muscles while underprescribing for large ones.
6. **Eccentric tempo** should be deliberately programmed, not randomly assigned.

These changes would transform the engine from a single-session optimizer into a periodized training system grounded in the dose-response and mechanistic evidence from Schoenfeld, Grgic, Ralston, and Haun.
