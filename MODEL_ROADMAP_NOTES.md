# Model Roadmap Notes

Saved follow-up work (deferred while prioritizing error audit):

1. Evidence weighting by confidence
- Add Bayesian-style confidence per signal (sample size, recency, variance) so low-evidence signals cannot over-steer planning.

2. Direct/indirect set accounting overhaul
- Move from single dominant-muscle attribution to weighted multi-muscle stimulus accounting per exercise (primary/secondary/stabilizer coefficients).

3. Per-muscle dose-response learning
- Learn personal response curves per muscle group (volume -> performance/recovery), beyond generic MEV/MAV/MRV defaults.

4. Explicit injury-risk constraints in optimization
- Add hard constraints for risky combinations (high hinge + low readiness + high spinal fatigue) with explainable rejection reasons.

5. Unified multi-objective planner
- Replace staged heuristics with one objective over progression, fatigue, adherence likelihood, variety, and time-fit.

6. Counterfactual evaluator + promotion gates
- Auto-compare baseline vs candidate policy on recent history; promote only when regret decreases with confidence.

7. Ontology-backed explanation graph
- Emit structured causal edges (signal -> constraint -> action) and render in dashboard (not text-only bullets).

8. Data quality contract enforcement
- Add strict quarantine for stale/corrupt wearable/session data before model state updates.
