import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlans, pickTodaysPlan, referenceFor, buildItems, cueFor, normDay, normUnit,
  parseRestDays, isRestDay, tickRemaining, reconcileRemaining, reconcileSkipStreaks,
} from '../core.js';

const mkItem = (name, { done = false, skipped = false } = {}) => ({ name, done, skipped });

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

test('reconcileSkipStreaks increments skipped, resets done, leaves untouched', () => {
  const prev = { Bench: 1, Squat: 4, Rows: 2 };
  const items = [
    mkItem('Bench', { skipped: true }),   // skipped -> +1
    mkItem('Squat', { done: true }),       // done -> 0
    mkItem('Rows'),                         // neither -> unchanged
    mkItem('Curls', { skipped: true }),     // new exercise, skipped -> 1
  ];
  const next = reconcileSkipStreaks(prev, items);
  assert.deepEqual(next, { Bench: 2, Squat: 0, Rows: 2, Curls: 1 });
});

test('reconcileSkipStreaks counts a new exercise from zero', () => {
  assert.deepEqual(reconcileSkipStreaks({}, [mkItem('Dips', { skipped: true })]), { Dips: 1 });
});

test('reconcileSkipStreaks: done beats skipped if both somehow set', () => {
  // markDone clears skipped, but be defensive: done should win and reset.
  const next = reconcileSkipStreaks({ Bench: 3 }, [mkItem('Bench', { done: true, skipped: true })]);
  assert.equal(next.Bench, 0);
});

test('reconcileSkipStreaks is pure and tolerates null inputs', () => {
  const prev = { Bench: 1 };
  const next = reconcileSkipStreaks(prev, [mkItem('Bench', { skipped: true })]);
  assert.deepEqual(prev, { Bench: 1 }); // input untouched
  assert.equal(next.Bench, 2);
  assert.deepEqual(reconcileSkipStreaks(null, null), {});
  assert.deepEqual(reconcileSkipStreaks(undefined, undefined), {});
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

test('buildItems seeds setsLeft from the reference set count', () => {
  const plans = parsePlans(SAMPLE);
  const items = buildItems(plans[0], {});
  assert.equal(items[0].setsLeft, items[0].cur.sets); // Bench, 3
  // honours recorded progress like cur/ref do
  const withHistory = buildItems(plans[0], { Bench: { sets: 5, reps: 8, weight: 65 } });
  assert.equal(withHistory[0].setsLeft, 5);
});

test('tickRemaining decrements, floors at 0, and flags done at 0', () => {
  assert.deepEqual(tickRemaining(3), { setsLeft: 2, done: false });
  assert.deepEqual(tickRemaining(1), { setsLeft: 0, done: true });   // last set -> done
  assert.deepEqual(tickRemaining(0), { setsLeft: 0, done: true });   // already empty
  assert.deepEqual(tickRemaining(undefined), { setsLeft: 0, done: true });
});

test('reconcileRemaining keeps ticked sets fixed when the target changes', () => {
  // 3 sets, 1 ticked (2 left) -> bump target to 5: 4 still to do
  assert.equal(reconcileRemaining(3, 2, 5), 4);
  // 3 sets, 1 ticked (2 left) -> cut target to 1: already past it, nothing left
  assert.equal(reconcileRemaining(3, 2, 1), 0);
  // none ticked yet -> remaining tracks the new target
  assert.equal(reconcileRemaining(3, 3, 4), 4);
  // never exceeds the new target
  assert.equal(reconcileRemaining(3, 0, 2), 0);
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
