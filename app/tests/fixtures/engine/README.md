# Engine fixture tests

Behavioural regression suite for the workout engine's invariant pipeline.

## What this covers (today)

End-to-end runs of `runInvariantPipeline` against the full
`DEFAULT_WORKOUT_INVARIANTS` set. Each fixture is a JSON file under
`./cases/` with a synthetic workout + context and a list of behavioural
expectations (must-include exercises, must-exclude exercises, expected
adjustment messages, etc.).

The fixture format intentionally targets the invariant pipeline, not
`generateWorkout` end-to-end. Why:

- `generateWorkout` consumes a full `TrainingProfile` (~50 fields, many
  with their own nested types). Building rich profile fixtures is a
  multi-day project and the fixtures are brittle to engine-internal
  refactors.
- The invariant pipeline is where four of the six bugs we hit this
  month lived (focus exemption, theme drop, off-schedule muscle
  intrusion, drop-reason audit log). Centralising regression coverage
  here gives us the highest leverage per fixture.
- The fixture scaffolding is designed to grow into a `generateWorkout`
  golden-output suite later: the `expectations` shape is the same
  regardless of which engine surface the fixture targets.

## Running

```
npm test --prefix app -- tests/fixtures/engine
```

Or directly:

```
node --import tsx --test app/tests/fixtures/engine/runner.test.ts
```

## Adding a new fixture

1. Create `cases/your-scenario.json`. Schema is documented at the top
   of `runner.test.ts`; copy an existing case and modify.
2. Run the suite. The runner picks up new files automatically — there's
   no allowlist to update.
3. Use the `name` field as your test description. Failures point back
   to the JSON path, so keep names descriptive.

## Extending to `generateWorkout`

When we're ready to add full-engine fixtures:

1. Add a new fixture variant tagged `"target": "generateWorkout"`.
2. Add a profile/preferences/exercise-library section to the JSON.
3. Build a default-stuffing helper in `runner.test.ts` that fills in
   the boring `TrainingProfile` defaults so each fixture only specifies
   what it cares about.
4. Reuse the existing `expectations` schema — the assertions are the
   same regardless of which surface produced the workout.
