# ML Dashboard Visual Overhaul — Step Tracker

## Design Decisions (locked in)
- Alteryx-inspired zoomable/pannable canvas (React Flow / @xyflow/react)
- Left-to-right branching DAG (11 nodes, 2 fan-out/merge points)
- Mini card nodes: numbered badge + label + algorithm action preview
- Labeled smoothstep edges with animated marching-ants
- Right-side detail panel (slides in on node click; full-width canvas when nothing selected)
- Dark theme: #0a0a0a canvas, teal (#14b8a6) accents
- Algorithm-first content: decision trees, threshold rules, weights tables, counterfactuals
- Zoom controls, no minimap
- Desktop-focused

---

## Steps

### S1: Install @xyflow/react
- [x] `npm install @xyflow/react` in `app/` — installed v12.10.1
- [x] Verify package.json updated

### S2: Create CSS module skeleton
- [x] Create `app/src/pages/ModelDashboard.module.css`
- [x] Styles for: page layout, canvas container, node cards, selected state, edges, detail panel, decision tree, weights table, threshold highlights

### S3: Scaffold ModelDashboard.tsx with empty React Flow canvas
- [x] Replace current accordion JSX with React Flow `<ReactFlow>` + `<Background>` + `<Controls>`
- [x] Define 11 node positions (left-to-right, staggered for branches)
- [x] Define 12 edges (including branch/merge connections)
- [x] Smoothstep edges, animated, teal color, arrow markers
- [x] Keep `computeTrainingProfile` data loading logic
- [x] No detail panel yet, no custom nodes yet — just default nodes on the canvas
- [x] Type-check clean (0 new errors)

### S4: Build PipelineNode custom component
- [x] Create custom node type registered with React Flow (`pipeline` type)
- [x] Numbered teal circle badge (1-11)
- [x] Stage label
- [x] Algorithm action preview text (computed from profile data via `computeNodePreviews`)
- [x] Selected state: teal border + glow (CSS class toggle)
- [x] Wire into canvas replacing default nodes (`buildNodes` + `useMemo`)
- [x] Type-check clean (0 new errors)

### S5: Add edge labels
- [x] Add labels to all 12 edges describing data flow between nodes
- [x] Labels derived from profile data (e.g., "readiness 82%, vol ×0.85")
- [x] Edges now built dynamically via `buildEdges(profile)` + `useMemo`
- [x] Type-check clean

### S6: Implement detail panel shell
- [x] Add right-side panel container (hidden when no node selected, 35% width when visible)
- [x] Canvas resizes to 65% when panel open (CSS transition)
- [x] Panel header: numbered title + algorithm summary subtitle (teal)
- [x] Click node -> panel opens with that node's key
- [x] Click canvas background -> panel closes (`onPaneClick`)
- [x] Close button (✕) in panel header
- [x] Scrollable panel body (placeholder for now)
- [x] Type-check clean

### S7: Detail panel — Section 1 (Data Collection)
- [x] Short summary: "Model is in {tier} mode with {N} logged workouts"
- [x] Decision tree: 3 branches (bootstrap < 10 / learning 10-29 / personalized 30+), active path highlighted with teal dot
- [x] Weights table: 4 rows (workout logs, health metrics, wearables, consistency) with status + impact
- [x] Counterfactual: dynamic based on tier — shows workouts needed + what changes
- [x] Created `renderPanelContent` dispatcher + `DataCollectionPanel` component
- [x] Type-check clean

### S8: Detail panel — Section 2 (Feature Engineering)
- [x] Short summary: trend counts, progressing/declining exercises
- [x] Decision tree: 4 branches — 1RM progression (+3), regression (−1), HRV >15% drop, sleep >10% drop — active paths highlighted
- [x] Health metrics table: current vs 30d avg with deviation % and trend
- [x] Exercise 1RM trends table: top 6 exercises with e1RM, avg, trend
- [x] Counterfactual: explains selection bonus for progressing vs stalled exercises
- [x] Type-check clean

### S9: Detail panel — Section 3 (Recovery State)
- [x] Short summary: readiness %, fitness − fatigue, volume/rest multipliers, deload status
- [x] Decision tree: 4 branches (deload <60%, reduced 60-74%, normal 75-89%, push 90%+), active path highlighted
- [x] Weights table: 6 rows — Banister readiness, sleep vol mod, sleep rest mod, HRV mod, sleep debt, deload status — with values and effects
- [x] Deload signals list (conditional, shown when deload recommended)
- [x] Counterfactual: tier-specific — shows distance to next threshold in both directions
- [x] Type-check clean

### S10: Detail panel — Section 4 (Volume Status)
- [x] Short summary: below MEV / in MAV / near MRV counts + top priority group with score
- [x] Decision tree: 3-part priority formula (status ×10, deficit ×2, staleness +5) with all rules shown
- [x] Table: all muscle groups sorted by priority — sets/wk, MEV, MAV, MRV, deficit, freq, priority score, color-coded status badge
- [x] Counterfactual: context-specific per top priority group — shows sets needed to reach MAV, predicted priority drop
- [x] Type-check clean

### S11: Detail panel — Section 5 (Exercise Selection)
- [x] Short summary: total candidates, staple count, swap penalties
- [x] Decision tree: 4-step selection flow (gather candidates → score → select top → global sort)
- [x] Weights table: all 18 scoring factors with weights (green/red) and conditions
- [x] Top preferences table: top 10 exercises with sessions, recency score, staple status, last used
- [x] Frequently swapped list: exercises with 3+× swaps shown with −15 penalty (conditional)
- [x] Counterfactual: explains staple +4 bonus vs recency/rotation/plateau mechanics
- [x] Type-check clean

### S12: Detail panel — Section 6 (Progressions)
- [x] Short summary: progressing/stalled/regressing counts, feeds into selection
- [x] Decision tree: 3 branches (slope >0, ≈0, <0) with selection score impact (+3/+1/−1), active paths highlighted
- [x] Epley formula display (monospace code block)
- [x] Table: top 10 exercises with e1RM, last weight, best set, status badge, pattern, sessions
- [x] Counterfactual: context-specific — regressing shows deload trigger, stalled shows rotation timeline, all progressing shows what happens when one stalls
- [x] Type-check clean

### S13: Detail panel — Section 7 (Prescription)
- [x] Short summary: learned count vs fallback count
- [x] Decision tree: 2 branches (recentSessions ≥2 → learned, <2 → table fallback), active paths highlighted
- [x] Pipeline table: 6 params (reps, sets, weight, rest, tempo, RIR) with primary source, fallback, threshold
- [x] Learned prescriptions table: top 8 learned + 3 fallback, showing reps/sets/weight/increment/rest/source
- [x] Weight derivation formula (monospace block)
- [x] Counterfactual: shows sessions needed for fallback exercises to switch to learned
- [x] Type-check clean

### S14: Detail panel — Section 8 (Time Fit)
- [x] Short summary: session budget from avg duration, greedy loop description
- [x] Decision tree: 4 steps (compute time → under budget greedy add → over budget trim → post-fit cap)
- [x] SFR curve formula (monospace block with decay constant explanation)
- [x] Marginal value table: two competing actions (add set vs add exercise) with formulas and all modifiers
- [x] Greedy loop logic: 5-step iteration explained
- [x] Counterfactual: SFR curve crossover point (set 4 at 0.58 vs new exercise at 0.84), budget extension impact
- [x] Type-check clean

### S15: Detail panel — Section 9 (Validation)
- [x] Short summary: 4 deterministic safety checks description
- [x] Decision tree: all 4 checks as rule → correction pairs with teal action indicators
- [x] Table: check | threshold | correction action
- [x] Per-check rationale: explains WHY each check exists (set inflation, compound ordering, concentration, time deviation)
- [x] Counterfactual: set cap redistribution example, greedy loop edge case explanation
- [x] Type-check clean

### S16: Detail panel — Section 10 (LLM Review)
- [x] Short summary: GPT-4o-mini exercise science audit role
- [x] Decision tree: 4 branches — cache check (5-min TTL), cache miss flow, cost controls (1 call/workout), infrastructure (existing route)
- [x] Correction types table: 4 types (weight, set, swap, order) with examples
- [x] Pattern observations: storage mechanism in model_feedback, fetch/parse flow explained
- [x] Feedback loop flow: 5-step decision tree showing observation → storage → fetch → parse → inject cycle
- [x] Counterfactual: LLM as second opinion, scope constraints, 30-day observation window
- [x] Type-check clean

### S17: Detail panel — Section 11 (Final Output)
- [x] Short summary: workout is product of all 10 upstream stages
- [x] Pipeline impact table: all 10 stages with their specific impact on this workout
- [x] Active LLM hints: avoid (red badges) and prefer (green badges) parsed from observations
- [x] Recent LLM observations: full list with pattern, suggestion, and confidence
- [x] Counterfactual: cascade effect — how a 10% readiness change propagates through 5+ stages
- [x] Type-check clean

### S18: Type-check and lint
- [x] Run `npx tsc --noEmit` — 0 new errors (all errors are pre-existing in trainingAnalysis.ts)
- [x] No errors introduced in ModelDashboard.tsx or ModelDashboard.module.css
- [x] ReadLints — 0 linter errors

### S19: Browser verification
- [ ] Start dev server, navigate to /model
- [ ] Verify canvas renders with all nodes and edges
- [ ] Verify node click opens detail panel
- [ ] Verify panel content for each section
- [ ] Verify zoom/pan controls work

---

## Status
**Current step**: S18 complete — waiting for approval
**Last completed**: S18
