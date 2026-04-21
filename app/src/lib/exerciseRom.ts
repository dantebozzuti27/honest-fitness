/**
 * Estimated range-of-motion (ROM) in meters for common exercises.
 * Used to compute mechanical work: Work(J) = weight_kg × 9.81 × rom_m × reps
 *
 * Values are approximate concentric ROM for a full repetition at standard execution.
 * When an exercise is not found, we fall back by movement pattern / exercise type.
 */

const ROM_LOOKUP: Record<string, number> = {
  // Squats & leg press
  'barbell squat': 0.70,
  'back squat': 0.70,
  'front squat': 0.65,
  'goblet squat': 0.60,
  'hack squat': 0.55,
  'leg press': 0.45,
  'smith machine squat': 0.65,
  'bulgarian split squat': 0.55,
  'split squat': 0.50,
  'pistol squat': 0.60,
  'box squat': 0.50,
  'safety bar squat': 0.68,
  'pause squat': 0.70,
  'belt squat': 0.55,

  // Deadlifts & hinges
  'deadlift': 0.55,
  'conventional deadlift': 0.55,
  'sumo deadlift': 0.45,
  'romanian deadlift': 0.40,
  'rdl': 0.40,
  'stiff leg deadlift': 0.45,
  'trap bar deadlift': 0.50,
  'dumbbell rdl': 0.38,
  'single leg rdl': 0.38,
  'good morning': 0.35,
  'hip thrust': 0.25,
  'barbell hip thrust': 0.25,
  'glute bridge': 0.20,
  'glute ham raise': 0.35,
  'hyperextension': 0.30,
  'back extension': 0.30,
  'reverse hyperextension': 0.30,

  // Bench press variants
  'bench press': 0.40,
  'barbell bench press': 0.40,
  'flat bench press': 0.40,
  'incline bench press': 0.38,
  'incline barbell bench press': 0.38,
  'decline bench press': 0.35,
  'close grip bench press': 0.38,
  'dumbbell bench press': 0.42,
  'dumbbell incline bench press': 0.40,
  'dumbbell decline bench press': 0.37,
  'floor press': 0.30,
  'smith machine bench press': 0.38,
  'machine chest press': 0.35,

  // Chest isolation
  'cable fly': 0.55,
  'dumbbell fly': 0.50,
  'incline dumbbell fly': 0.48,
  'pec deck': 0.45,
  'machine fly': 0.45,
  'cable crossover': 0.55,
  'push up': 0.35,
  'pushup': 0.35,
  'dip': 0.40,
  'chest dip': 0.40,

  // Rows
  'barbell row': 0.35,
  'bent over row': 0.35,
  'pendlay row': 0.35,
  'dumbbell row': 0.35,
  'single arm dumbbell row': 0.35,
  'cable row': 0.40,
  'seated cable row': 0.40,
  'chest supported row': 0.32,
  't-bar row': 0.35,
  'machine row': 0.35,
  'meadows row': 0.32,
  'seal row': 0.32,

  // Pulldowns & pull-ups
  'lat pulldown': 0.55,
  'wide grip lat pulldown': 0.55,
  'close grip lat pulldown': 0.50,
  'pull up': 0.45,
  'pullup': 0.45,
  'chin up': 0.45,
  'chinup': 0.45,
  'neutral grip pull up': 0.45,
  'assisted pull up': 0.40,
  'straight arm pulldown': 0.50,

  // Overhead press
  'overhead press': 0.45,
  'military press': 0.45,
  'barbell overhead press': 0.45,
  'dumbbell overhead press': 0.45,
  'dumbbell shoulder press': 0.42,
  'seated dumbbell press': 0.40,
  'arnold press': 0.40,
  'push press': 0.45,
  'machine shoulder press': 0.38,
  'smith machine overhead press': 0.42,
  'landmine press': 0.35,

  // Lateral & rear delts
  'lateral raise': 0.50,
  'dumbbell lateral raise': 0.50,
  'cable lateral raise': 0.50,
  'machine lateral raise': 0.45,
  'front raise': 0.50,
  'dumbbell front raise': 0.50,
  'rear delt fly': 0.45,
  'reverse fly': 0.45,
  'reverse pec deck': 0.40,
  'face pull': 0.40,
  'cable face pull': 0.40,
  'upright row': 0.35,
  'dumbbell upright row': 0.35,

  // Biceps
  'barbell curl': 0.35,
  'dumbbell curl': 0.35,
  'dumbbell bicep curl': 0.35,
  'hammer curl': 0.35,
  'dumbbell hammer curl': 0.35,
  'preacher curl': 0.30,
  'ez bar curl': 0.32,
  'incline dumbbell curl': 0.38,
  'concentration curl': 0.30,
  'cable curl': 0.35,
  'bayesian curl': 0.35,
  'spider curl': 0.28,
  'machine curl': 0.30,

  // Triceps
  'tricep pushdown': 0.35,
  'cable tricep pushdown': 0.35,
  'rope pushdown': 0.38,
  'tricep extension': 0.40,
  'overhead tricep extension': 0.40,
  'skull crusher': 0.35,
  'ez bar skull crusher': 0.35,
  'close grip push up': 0.30,
  'tricep dip': 0.40,
  'cable overhead extension': 0.42,
  'dumbbell tricep kickback': 0.30,
  'machine tricep extension': 0.35,

  // Legs isolation
  'leg extension': 0.40,
  'leg curl': 0.35,
  'lying leg curl': 0.35,
  'seated leg curl': 0.35,
  'nordic curl': 0.40,
  'lunge': 0.50,
  'walking lunge': 0.50,
  'dumbbell lunge': 0.50,
  'reverse lunge': 0.50,
  'step up': 0.40,
  'dumbbell step up': 0.40,
  'sissy squat': 0.40,
  'pendulum squat': 0.50,

  // Calves
  'calf raise': 0.12,
  'standing calf raise': 0.12,
  'seated calf raise': 0.10,
  'machine calf raise': 0.12,
  'smith machine calf raise': 0.12,
  'donkey calf raise': 0.12,
  'leg press calf raise': 0.10,

  // Abs / Core
  'crunch': 0.20,
  'cable crunch': 0.25,
  'hanging leg raise': 0.40,
  'leg raise': 0.35,
  'ab wheel': 0.50,
  'ab rollout': 0.50,
  'plank': 0.0,
  'side plank': 0.0,
  'russian twist': 0.20,
  'woodchop': 0.55,
  'cable woodchop': 0.55,
  'decline sit up': 0.30,
  'sit up': 0.25,

  // Traps / shrugs
  'shrug': 0.12,
  'barbell shrug': 0.12,
  'dumbbell shrug': 0.12,
  'trap bar shrug': 0.12,
  'rack pull': 0.25,

  // Forearms
  'wrist curl': 0.12,
  'reverse wrist curl': 0.12,
  'farmer walk': 0.0,
  'farmer carry': 0.0,

  // Olympic / power
  'clean': 0.70,
  'power clean': 0.60,
  'hang clean': 0.50,
  'snatch': 0.90,
  'clean and jerk': 0.85,
  'thruster': 0.75,
};

const PATTERN_ROM: Record<string, number> = {
  squat: 0.60,
  hinge: 0.40,
  press: 0.38,
  pull: 0.40,
  row: 0.35,
  fly: 0.48,
  curl: 0.33,
  extension: 0.38,
  raise: 0.45,
  lunge: 0.50,
};

const TYPE_ROM: Record<string, number> = {
  compound: 0.50,
  isolation: 0.35,
  isometric: 0.0,
  cardio: 0.0,
  recovery: 0.0,
};

export function getExerciseRom(
  name: string,
  movementPattern?: string | null,
  exerciseType?: string | null,
): number {
  const key = name.toLowerCase().trim();

  const direct = ROM_LOOKUP[key];
  if (direct !== undefined) return direct;

  // Fuzzy match: check if any ROM_LOOKUP key is contained in the exercise name
  for (const [romKey, rom] of Object.entries(ROM_LOOKUP)) {
    if (key.includes(romKey) || romKey.includes(key)) return rom;
  }

  // Fall back by movement pattern
  if (movementPattern) {
    const pat = movementPattern.toLowerCase();
    for (const [p, rom] of Object.entries(PATTERN_ROM)) {
      if (pat.includes(p)) return rom;
    }
  }

  // Fall back by exercise type
  if (exerciseType) {
    const t = exerciseType.toLowerCase();
    return TYPE_ROM[t] ?? 0.40;
  }

  return 0.40;
}

const LBS_TO_KG = 0.45359237;
const G = 9.81;

export function computeMechanicalWork(
  weightLbs: number,
  reps: number,
  romMeters: number,
): number {
  if (romMeters <= 0 || reps <= 0 || weightLbs <= 0) return 0;
  return weightLbs * LBS_TO_KG * G * romMeters * reps;
}

export function formatJoules(joules: number): string {
  if (joules >= 1000) return `${(joules / 1000).toFixed(1)} kJ`;
  return `${Math.round(joules)} J`;
}
