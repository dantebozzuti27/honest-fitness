/**
 * Day-theme derivation — extracted from workoutEngine.ts (audit #8).
 *
 * "Theme" is the engine's notion of what a training day is *about*:
 * a primary muscle group plus a set of allowed accessories. The theme
 * is a stable contract consumed by:
 *   - stepSelectMuscleGroups (selection filter)
 *   - themeCoherenceInvariant + hardScheduleConstraintInvariant
 *     (post-generation validators)
 *   - the rationale generator (user-facing copy)
 *
 * This module is kept dependency-free (only types and a single
 * normaliser import) so it stays cheap to test and easy to reuse.
 * Anything in here MUST be a pure function. No I/O, no globals, no
 * mutable state.
 *
 * Why extract: the theme code is small (~150 lines), well-tested
 * (10+ unit tests), and consumed by both the engine and the invariant
 * pipeline. Pulling it out reduces workoutEngine.ts surface area
 * without touching the riskier selection/prescription core.
 */

import { normalizeMuscleGroupList } from './volumeGuidelines';

export interface DayTheme {
  /** Primary muscle group for the day, e.g. "mid_chest", "back_lats", "quadriceps". */
  primary: string;
  /** Muscle groups allowed alongside the primary (synergists + abs + core + cardio). */
  allowedAccessories: string[];
  /**
   * Origin of this theme. Determines how strict the engine should be:
   *   - "schedule" — user-defined `weekly_split_schedule` (hard filter + invariant drop)
   *   - "rotation" — `preferred_split` slot rotation (same strictness as schedule)
   *   - "default"  — day-of-week pattern fallback (soft; invariant warnings only)
   */
  source: 'schedule' | 'rotation' | 'default';
}

/**
 * Muscle groups that must NEVER be the primary focus of a training day.
 *
 * Rationale: these are conditioning / accessory muscles whose stimulus is
 * cheap, fast, and best distributed across the whole week rather than
 * concentrated into a "dedicated day". Specifically:
 *
 *   - core/abs: max useful direct volume is ~6–8 working sets per session
 *     (Schoenfeld dose-response work + recovery considerations); past that
 *     point you're wasting session time that should go to a primary movement.
 *     A dedicated "abs day" therefore over-allocates time to a muscle that
 *     responds best to daily low-dose stimulus.
 *   - calves: same logic — high-frequency low-dose beats a once-a-week
 *     blowout.
 *   - cardio: a "cardio day" is conditioning, not a strength theme; the
 *     planner already handles it via the cardio policy block.
 *
 * If the schedule lists *only* one of these groups for a day, the engine
 * treats that as "no strength theme set" and falls through to the rotation
 * / detected-pattern fallback, which gives a real primary focus.
 */
export const NON_PRIMARY_THEME_GROUPS: ReadonlySet<string> = new Set([
  'core',
  'abs',
  'abdominals',
  'calves',
  'cardio',
]);

/**
 * Family synonyms for label-driven theme primary selection.
 *
 * Users label split days with informal terms ("Chest", "Shoulders",
 * "Back", "Legs"). Those terms aren't canonical muscle groups but DO
 * unambiguously identify which canonical groups the user meant. This
 * map lets `deriveDayTheme` honor the user's stated intent ("Chest /
 * Triceps day") rather than just picking the first muscle in the
 * groups array (which can be e.g. `upper_traps` due to ordering
 * accidents in the Profile editor).
 *
 * Order within each value array matters: it's the preference order
 * when multiple canonical groups in the eligible set match the same
 * family (e.g. "chest" prefers mid_chest over upper_chest because
 * mid_chest is the default home for horizontal push work).
 */
export const THEME_LABEL_FAMILY_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['chest', ['mid_chest', 'upper_chest', 'lower_chest']],
  ['shoulders', ['anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid']],
  ['delts', ['lateral_deltoid', 'anterior_deltoid', 'posterior_deltoid']],
  ['rear delts', ['posterior_deltoid']],
  ['back', ['back_lats', 'back_upper']],
  ['lats', ['back_lats']],
  ['traps', ['upper_traps', 'mid_traps', 'lower_traps']],
  ['legs', ['quadriceps', 'hamstrings', 'glutes']],
  ['quads', ['quadriceps']],
  ['hams', ['hamstrings']],
  ['arms', ['biceps', 'triceps']],
  ['push', ['mid_chest', 'anterior_deltoid', 'triceps']],
  ['pull', ['back_lats', 'biceps', 'posterior_deltoid']],
  ['upper', ['mid_chest', 'back_lats']],
  ['lower', ['quadriceps', 'glutes']],
]);

/**
 * Tokenise a focus label into normalised lowercase fragments.
 * Splits on / , & + and the word "and"; trims whitespace; drops
 * empties. "Chest / Triceps & Shoulders" → ["chest","triceps","shoulders"].
 *
 * Exported for direct testing; used internally by deriveDayTheme.
 */
export function parseFocusLabelTokens(focus: string): string[] {
  if (!focus) return [];
  return String(focus)
    .toLowerCase()
    .split(/[/,&+]|\sand\s/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Resolve a single focus-label token to a preferred canonical group
 * from the eligible set. Strategy, in priority order:
 *   1. Token (with spaces → underscores) is itself a canonical group.
 *   2. Token matches a multi-word family synonym key ("rear delts" →
 *      `posterior_deltoid`).
 *   3. Any individual whitespace-separated word inside the token is a
 *      canonical group or a single-word family synonym key. This catches
 *      labels like "posterior_deltoid emphasis" or "biceps focus" where
 *      the user added a qualifier after the muscle name.
 * Returns null when nothing matches — caller falls back to its own
 * default ordering.
 *
 * Exported for direct testing; used internally by deriveDayTheme.
 */
export function resolveLabelTokenToCanonical(
  token: string,
  eligible: readonly string[],
): string | null {
  const eligibleSet = new Set(eligible);
  const tryCanonical = (s: string): string | null => (eligibleSet.has(s) ? s : null);
  const tryFamily = (s: string): string | null => {
    const family = THEME_LABEL_FAMILY_SYNONYMS.get(s);
    if (!family) return null;
    for (const candidate of family) {
      if (eligibleSet.has(candidate)) return candidate;
    }
    return null;
  };

  const cleaned = token.replace(/\s+/g, '_');
  return (
    tryCanonical(cleaned)
    ?? tryFamily(token)
    ?? tryFamily(cleaned)
    ?? (() => {
      const words = token.split(/\s+/).filter(Boolean);
      if (words.length <= 1) return null;
      for (const word of words) {
        const hit = tryCanonical(word) ?? tryFamily(word);
        if (hit) return hit;
      }
      return null;
    })()
  );
}

/**
 * Build a `DayTheme` from a focus label and the muscle groups assigned to
 * the day. The theme codifies what the day is "about" so downstream selectors
 * and validators have a stable contract.
 *
 * Primary muscle: prefer a canonical group resolved from the focus label
 * (see `resolveLabelTokenToCanonical`). When the label resolves nothing,
 * fall back to the first non-conditioning group in `muscleGroups`.
 *
 * Allowed accessories: every other group in `muscleGroups` (verbatim — we
 * do NOT expand with synergists here because the canonical split mappings
 * already represent the intended scope, and synergist expansion was the
 * source of "back day pulled in hamstrings" bugs).
 */
export function deriveDayTheme(
  focus: string,
  muscleGroups: string[],
  source: DayTheme['source'],
): DayTheme | null {
  const groups = (muscleGroups ?? []).filter(g => typeof g === 'string' && g.length > 0);
  if (groups.length === 0) return null;

  // Demote core/abs/calves/cardio out of the primary slot.
  const primaryEligible = groups.filter(g => !NON_PRIMARY_THEME_GROUPS.has(String(g).toLowerCase()));
  if (primaryEligible.length === 0) {
    // Schedule is core/calves/cardio only with no strength primary.
    // Refuse to set this as a themed day; caller falls through to the
    // rotation or detected-pattern fallback to pick a real primary.
    return null;
  }

  // Honor the user's stated label intent over groups[0] when consistent.
  let primary = primaryEligible[0];
  for (const token of parseFocusLabelTokens(focus)) {
    const resolved = resolveLabelTokenToCanonical(token, primaryEligible);
    if (resolved) {
      primary = resolved;
      break;
    }
  }
  const allowed = groups.filter(g => g !== primary);
  return {
    primary,
    allowedAccessories: allowed,
    source,
  };
}

// Re-exported to keep the resolver helpers near the consumers that need
// the same normalisation contract. This is the single source of truth
// for "is this a real muscle group?" — keep it out of workoutEngine.ts
// so future modules can import without dragging the engine in.
export { normalizeMuscleGroupList };
