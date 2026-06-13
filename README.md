<p align="center">
  <img src="assets/banner.svg" alt="Monotonic — keep the numbers going up" width="100%">
</p>

<h1 align="center">Monotonic</h1>

<p align="center">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installable-fb503b?style=flat-square">
  <img alt="Offline-first" src="https://img.shields.io/badge/offline-first-fb503b?style=flat-square">
  <img alt="Backend" src="https://img.shields.io/badge/backend-none-1a1814?style=flat-square">
  <img alt="Build step" src="https://img.shields.io/badge/build_step-none-1a1814?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-11%20passing-1a936f?style=flat-square">
</p>

A dead-simple, phone-first gym session tracker. Open it and today's workout is
right there — no login, no loading, no menus. Each exercise shows **what you did
last time**, and the only goal is to keep the numbers the same or higher:
**monotonically non-decreasing.** No history, no charts, no streaks — just up.

It's an offline-first PWA (a single set of static files), so it installs to your
home screen, works with no signal at the gym, and needs no backend or app store.

> 🤖 **Shamelessly vibe-coded** with Claude Code — described, screenshotted, and
> iterated into shape rather than hand-written. The look is **lovingly borrowed
> from [hex.tech](https://hex.tech)** (their notebook/blueprint styling).

---

## What it does

- **Opens to today's session.** Plans are tagged with the day(s) they apply to;
  the app auto-selects the one for today.
- **Touch-first.** Big `−`/`+` steppers for sets, reps, and weight — no keyboard
  during a workout (tap a number for manual entry as a fallback).
- **Monotonic cue.** Each card shows `last 3×8 · 70`. Beat it and the card frames
  coral (**ahead**); drop below and it frames amber (**behind**).
- **Done / Skip.** "Done" records your numbers as the new reference for next time.
  "Skip" leaves them untouched.
- **Resumes mid-workout, resets daily.** Close and reopen the same day and your
  ticks are still there; a new day starts a fresh checklist, pre-filled with last
  time's numbers.
- **Light / dark theme**, toggled from the header and remembered.
- **Works offline.** App shell, logic, and fonts are cached.

## How progress works

- Your **plan** (the TOML) defines *which* exercises, in what order, and the
  starting numbers the first time you ever do each one.
- After that, your **last completed numbers** become the reference shown on
  screen — that's the thing you keep ≥. Progress is stored locally on the device,
  keyed by exercise name.
- "Done" advances the reference; "Skip" doesn't.

---

## Writing your workout (TOML)

Plans live in a TOML file the app fetches from a URL you control (or the bundled
[`plans.toml`](plans.toml)). One file holds all your plans.

```toml
[[plan]]
name = "Daily"
days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]   # when it applies

  [[plan.exercise]]
  name = "Run"
  sets = 1
  reps = 10
  unit = "min"            # show as minutes

  [[plan.exercise]]
  name = "Wall Sits"
  sets = 3
  reps = 60
  unit = "time"           # show mm:ss (reps = seconds); +/- 15s

  [[plan.exercise]]
  name = "Deadlift"
  sets = 3
  reps = 8
  weight = 70             # omit for bodyweight (hides the weight stepper)
  weight_step = 2.5       # +/- increment for weight (default 2.5)
```

**Per-exercise fields**

| Field         | Required | Meaning |
|---------------|----------|---------|
| `name`        | yes      | Exercise label (also its identity for tracking progress). |
| `sets`        | yes      | Number of sets. A sets stepper is hidden for single-set, non-rep moves (e.g. a run). |
| `reps`        | yes      | Reps — or, with `unit`, minutes / seconds (see below). |
| `weight`      | no       | Weight; omit for bodyweight. |
| `weight_step` | no       | Weight `+/-` increment. Default `2.5`. |
| `unit`        | no       | `reps` (default), `min` (whole minutes), or `time` (mm:ss, with `reps` given in **seconds**). |
| `rep_step`    | no       | `+/-` increment for the middle field. Default `1`, or `15` for `unit = "time"`. |

**Plan fields:** `name`, `days` (any of `mon`…`sun` or full names, case-insensitive),
and an ordered list of `[[plan.exercise]]`.

> Renaming an exercise starts its progress history fresh (identity is the name).

---

## Deploy & install

### 1. Host it (GitHub Pages)
Fork/clone, then in the repo: **Settings → Pages → Deploy from a branch → `main` / root**.
Your app is at `https://<you>.github.io/monotonic/`. (Public repo, or Pages on a paid plan.)

### 2. Point it at your plans
Either edit the bundled `plans.toml` and push, **or** put your TOML in a GitHub
gist and paste its *raw* URL into the app's ⚙ settings — then editing the gist
needs no redeploy.

### 3. Add to your phone
Open the URL in **Safari** (iOS) → Share → **Add to Home Screen**. Launches
full-screen, offline-capable, straight to today's session.

### Updating
The service worker is network-first, so pushes show up on the next online open.
After a change that touches the app code, you may need to fully close and reopen
the installed app once so the new service worker takes over.

---

## Settings (⚙)

- **Plans URL** — where to fetch TOML (blank = bundled `plans.toml`).
- **Refresh** — re-fetch plans now.
- **Restart session** — wipe today's ticks and rebuild from last numbers.
- **Export / Import** — download or restore a JSON backup of your progress
  (the only irreplaceable, device-local data).

---

## Development

No build step — it's vanilla ES modules and static files.

```bash
# Serve locally
python3 -m http.server 8000      # then open http://localhost:8000

# Run the unit tests (pure logic in core.js)
node --test                      # 11 tests

# Regenerate app icons
uv run --with pillow scripts/make_icons.py
```

### Project layout

| Path | What |
|------|------|
| `index.html` | Markup + all CSS (themes, responsive, Hex-notebook styling). |
| `app.js` | UI: rendering, steppers, done/skip, theme, settings, fetch/cache. |
| `core.js` | Pure, DOM-free logic (TOML parse, day selection, monotonic cue) — unit-tested. |
| `test/core.test.mjs` | Node test suite for `core.js`. |
| `vendor/toml.js` | Vendored [`smol-toml`](https://github.com/squirrelchat/smol-toml) parser. |
| `sw.js` | Service worker: network-first shell + runtime font cache. |
| `manifest.webmanifest`, `icons/` | PWA manifest and icons. |
| `plans.toml` | Default/example workout. |
| `scripts/make_icons.py` | Icon generator (Pillow). |
| `design/` | Throwaway design-exploration mockups (not part of the app). |

### How it's built

- **Storage:** `localStorage` for settings, last-fetched plans, progress, and the
  active session. No backend.
- **Plans:** fetched (cache-busted) when online, cached locally so the gym works
  offline.
- **Offline:** `sw.js` precaches the app shell (network-first when online) and
  runtime-caches the web fonts.
- **Type:** Chivo (display), JetBrains Mono (data/labels), Fraunces italic
  (accents), via Google Fonts.

## Out of scope (by design)

History/graphs, goals/targets, social, accounts, cloud sync. The whole point is a
clean checklist that nudges the numbers up.

## Colophon

Built almost entirely by **vibe coding** with Claude Code — described, iterated,
and screenshotted into shape rather than carefully hand-written. The visual
language (squarish display sans + monospace data, blueprint hairlines with
crosshair ticks, coral accent) is **borrowed, with admiration, from
[hex.tech](https://hex.tech)** — go check them out; they're great.

Type: [Chivo](https://fonts.google.com/specimen/Chivo),
[JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono),
[Fraunces](https://fonts.google.com/specimen/Fraunces).
TOML parsing by [smol-toml](https://github.com/squirrelchat/smol-toml).
