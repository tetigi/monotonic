import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlans, pickTodaysPlan, referenceFor, buildItems, cueFor, normDay, normUnit,
  parseRestDays, isRestDay,
} from '../core.js';

const SAMPLE = `
[[plan]]
name = "Push"
days = ["Mon", "thursday"]
  [[plan.exercise]]
  name = "Bench"
  sets = 3
  reps = 8
  weight = 60
  weight_step = 2.5
  [[plan.exercise]]
  name = "Press-ups"
  sets = 3
  reps = 15

[[plan]]
name = "Legs"
days = ["wed"]
  [[plan.exercise]]
  name = "Squat"
  sets = 5
  reps = 5
  weight = 80
`;

test('parsePlans normalizes days and keeps order', () => {
  const plans = parsePlans(SAMPLE);
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0].days, ['mon', 'thu']); // full names + case normalized
  assert.equal(plans[0].exercise.length, 2);
  assert.equal(plans[0].exercise[0].name, 'Bench');
});

test('parsePlans coerces a single exercise table to an array', () => {
  const plans = parsePlans(`
[[plan]]
name = "Solo"
  [plan.exercise]
  name = "Deadlift"
  sets = 1
  reps = 5
  weight = 100
`);
  assert.ok(Array.isArray(plans[0].exercise));
  assert.equal(plans[0].exercise[0].name, 'Deadlift');
});

test('parsePlans rejects malformed input', () => {
  assert.throws(() => parsePlans('nonsense = '), /.*/);
  assert.throws(() => parsePlans('[[plan]]\nname="x"'), /no exercises/);
  assert.throws(() => parsePlans('[[plan]]\n[[plan.exercise]]\nname="x"\nsets=1\nreps=1'), /missing "name"/);
  assert.throws(() => parsePlans('foo = 1'), /No \[\[plan\]\]/);
});

test('pickTodaysPlan matches the weekday, else falls back to first', () => {
  const plans = parsePlans(SAMPLE);
  assert.equal(pickTodaysPlan(plans, 'thu').name, 'Push');
  assert.equal(pickTodaysPlan(plans, 'wed').name, 'Legs');
  assert.equal(pickTodaysPlan(plans, 'sun').name, 'Push'); // no match -> plans[0]
  assert.equal(pickTodaysPlan([], 'mon'), null);
});

test('referenceFor prefers recorded progress over the TOML seed', () => {
  const ex = { name: 'Bench', sets: 3, reps: 8, weight: 60 };
  assert.deepEqual(referenceFor({}, ex), { sets: 3, reps: 8, weight: 60 });
  const withHistory = referenceFor({ Bench: { sets: 4, reps: 8, weight: 65 } }, ex);
  assert.deepEqual(withHistory, { sets: 4, reps: 8, weight: 65 });
});

test('referenceFor treats a weightless exercise as weight null', () => {
  assert.deepEqual(referenceFor({}, { name: 'Press-ups', sets: 3, reps: 15 }),
    { sets: 3, reps: 15, weight: null });
});

test('buildItems seeds current=reference and resolves weight step', () => {
  const plans = parsePlans(SAMPLE);
  const items = buildItems(plans[0], {});
  assert.equal(items.length, 2);
  assert.equal(items[0].step, 2.5);
  assert.equal(items[0].hasWeight, true);
  assert.deepEqual(items[0].cur, items[0].ref);
  assert.equal(items[1].hasWeight, false); // press-ups, no weight
  assert.equal(items[1].step, 2.5); // default when unset
  assert.equal(items[0].done, false);
});

test('cueFor flags decreases, holds, and increases', () => {
  const mk = (cur, ref, hasWeight = true) => ({ cur, ref, hasWeight });
  // same
  assert.equal(cueFor(mk({ sets: 3, reps: 8, weight: 60 }, { sets: 3, reps: 8, weight: 60 })), 'same');
  // up on any field
  assert.equal(cueFor(mk({ sets: 3, reps: 9, weight: 60 }, { sets: 3, reps: 8, weight: 60 })), 'up');
  assert.equal(cueFor(mk({ sets: 3, reps: 8, weight: 62.5 }, { sets: 3, reps: 8, weight: 60 })), 'up');
  // down wins even if another field went up
  assert.equal(cueFor(mk({ sets: 4, reps: 7, weight: 60 }, { sets: 3, reps: 8, weight: 60 })), 'down');
  // weight ignored when exercise has no weight
  assert.equal(cueFor(mk({ sets: 3, reps: 8, weight: 0 }, { sets: 3, reps: 8, weight: null }, false)), 'same');
});

test('normDay handles full names and whitespace', () => {
  assert.equal(normDay(' Tuesday '), 'tue');
  assert.equal(normDay('FRI'), 'fri');
});

test('parseRestDays reads an array and normalizes case/length', () => {
  assert.deepEqual(parseRestDays('rest_days = ["Sun", "SATURDAY"]'), ['sun', 'sat']);
});

test('parseRestDays accepts a single string', () => {
  assert.deepEqual(parseRestDays('rest_days = "sunday"'), ['sun']);
});

test('parseRestDays returns [] when absent', () => {
  assert.deepEqual(parseRestDays('[[plan]]\nname="x"'), []);
  assert.deepEqual(parseRestDays(SAMPLE), []);
});

test('parseRestDays coexists with [[plan]] entries', () => {
  assert.deepEqual(parseRestDays(`rest_days = ["sun"]\n${SAMPLE}`), ['sun']);
});

test('isRestDay tests membership against normalized days', () => {
  assert.equal(isRestDay(['sun', 'sat'], 'sun'), true);
  assert.equal(isRestDay(['sun'], 'mon'), false);
  assert.equal(isRestDay([], 'mon'), false);
});

test('normUnit accepts reps/min/time and falls back to reps', () => {
  assert.equal(normUnit(undefined), 'reps');
  assert.equal(normUnit('MIN'), 'min');
  assert.equal(normUnit(' Time '), 'time');
  assert.equal(normUnit('bogus'), 'reps');
});

test('buildItems carries unit and resolves rep step', () => {
  const [plan] = parsePlans(`
[[plan]]
name = "D"
  [[plan.exercise]]
  name = "Run"
  sets = 1
  reps = 10
  unit = "min"
  [[plan.exercise]]
  name = "Wall Sits"
  sets = 3
  reps = 60
  unit = "time"
  [[plan.exercise]]
  name = "Pull-ups"
  sets = 3
  reps = 7
  [[plan.exercise]]
  name = "Plank"
  sets = 1
  reps = 30
  unit = "time"
  rep_step = 10
`);
  const [run, wall, pull, plank] = buildItems(plan, {});
  assert.equal(run.unit, 'min');
  assert.equal(run.repStep, 1);            // min defaults to 1
  assert.equal(wall.unit, 'time');
  assert.equal(wall.repStep, 15);          // time defaults to 15s
  assert.equal(pull.unit, 'reps');
  assert.equal(pull.repStep, 1);
  assert.equal(plank.repStep, 10);         // explicit rep_step wins
});
