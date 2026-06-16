// Pure, DOM-free logic for Monotonic. Imported by app.js; unit-tested in Node.
import { parse } from './vendor/toml.js';

export const DEFAULT_WEIGHT_STEP = 2.5;
export const DEFAULT_TIME_STEP = 15; // seconds, for unit="time"
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const UNITS = ['reps', 'min', 'time'];

export const normDay = (d) => String(d).trim().toLowerCase().slice(0, 3);

// Unit for the middle ("reps") field: "reps" (count), "min" (whole minutes),
// or "time" (stored as seconds, shown mm:ss). Unknown values fall back to reps.
export const normUnit = (u) => {
  const n = String(u ?? 'reps').trim().toLowerCase();
  return UNITS.includes(n) ? n : 'reps';
};

export function parsePlans(text) {
  const data = parse(text);
  const list = Array.isArray(data.plan) ? data.plan : (data.plan ? [data.plan] : []);
  if (!list.length) throw new Error('No [[plan]] entries found.');
  for (const p of list) {
    if (!p.name) throw new Error('A plan is missing "name".');
    const ex = Array.isArray(p.exercise) ? p.exercise : (p.exercise ? [p.exercise] : []);
    if (!ex.length) throw new Error(`Plan "${p.name}" has no exercises.`);
    p.exercise = ex;
    p.days = (p.days || []).map(normDay);
  }
  return list;
}

// Top-level `rest_days` (sibling to [[plan]]): a weekday or array of weekdays,
// any case/length. Returns normalized 3-letter names; absent/invalid -> [].
export function parseRestDays(text) {
  const data = parse(text);
  const raw = data.rest_days;
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(normDay);
}

export const isRestDay = (restDays, dow) => restDays.includes(dow);

export function pickTodaysPlan(plans, dow) {
  if (!plans.length) return null;
  return plans.find((p) => p.days.includes(dow)) || plans[0];
}

export function referenceFor(progress, ex) {
  const prev = progress[ex.name];
  if (prev) return { sets: prev.sets, reps: prev.reps, weight: prev.weight ?? null };
  return { sets: ex.sets ?? 0, reps: ex.reps ?? 0, weight: ex.weight ?? null };
}

export function buildItems(plan, progress) {
  return plan.exercise.map((ex) => {
    const ref = referenceFor(progress, ex);
    const unit = normUnit(ex.unit);
    return {
      name: ex.name,
      step: Number(ex.weight_step) > 0 ? Number(ex.weight_step) : DEFAULT_WEIGHT_STEP,
      unit,
      repStep: Number(ex.rep_step) > 0 ? Number(ex.rep_step) : (unit === 'time' ? DEFAULT_TIME_STEP : 1),
      hasWeight: ref.weight != null,
      ref,
      cur: { sets: ref.sets, reps: ref.reps, weight: ref.weight },
      done: false,
      skipped: false,
      prevProgress: undefined,
    };
  });
}

export function cueFor(item) {
  const { cur, ref, hasWeight } = item;
  const down = cur.sets < ref.sets || cur.reps < ref.reps || (hasWeight && cur.weight < ref.weight);
  if (down) return 'down';
  const up = cur.sets > ref.sets || cur.reps > ref.reps || (hasWeight && cur.weight > ref.weight);
  return up ? 'up' : 'same';
}
