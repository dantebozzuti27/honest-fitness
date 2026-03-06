# ML Model Improvements — High Impact, Objective Data Only

No subjective inputs. Every feature derives from measurable data.

## Now Integrated Into Engine (via ModelConfig)

1. **Sleep debt → volume auto-regulation** — cumulative 7-day sleep debt reduces training capacity (configurable weight)
2. **Steps/NEAT → volume modifier** — learned correlation; high-step days with negative coefficient reduce next-day volume
3. **Session fatigue curve → time budget cap** — if performance drops sharply late in session, tighten effective session length
4. **HRV/RHR → volume scaling** — HRV below baseline or RHR above baseline triggers proportional volume reduction
5. **Exercise rotation → staleness penalty** — exercises used too many consecutive weeks get scored down
6. **Cardio-strength interference** — high-impact cardio hours reduce lower-body volume targets
7. **Sleep-performance coefficients → weight adjustment** — learned per-user upper/lower body sleep sensitivity applied to prescribed weights
8. **Push/pull ratio → auto-corrective insertion** — imbalanced ratio triggers automatic pulling work
9. **Progressive overload thresholds** — configurable reps-above-target for weight increase, regression multiplier
10. **Time-of-day performance** — surfaces historical performance delta for current training window

All thresholds are centralized in `modelConfig.ts` — no hardcoded magic numbers in the engine.

## Remaining (Not Yet Built)

11. **Session RPE → volume auto-regulation** — RPE > 8 twice → reduce volume; RPE < 5 → increase
12. **Prescribed vs actual comparison** — track compliance per exercise, auto-correct future prescriptions
13. **Training density trend** — rising density + stable RPE = adaptation; plateaued density + rising RPE = limit
14. **Set-level RIR input** — per-set 0-4 scale instead of inferring from reps
15. **Double progression automation** — same weight → increase reps → hit top of range → bump weight → reset reps
16. **Per-muscle recovery rate learning** — replace population 48/72h defaults with individual learned rates
17. **Fitness-fatigue model (Banister)** — fitness accumulates slowly, fatigue fast; performance = fitness - fatigue
18. **Caloric balance from weight slope** — deficit = cap MRV at 80%; surplus = allow 100-110%
19. **Stimulus-to-fatigue ratio ranking** — bias toward high-SFR exercises when fatigued or deloading
20. **Weak point auto-detection** — compare lift ratios to population standards, auto-prioritize lagging muscles
