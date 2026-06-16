import { WEEKDAYS, parsePlans, parseRestDays, isRestDay, pickTodaysPlan, buildItems, cueFor } from './core.js';

const DEFAULT_URL = './plans.toml';

const K = {
  url: 'monotonic.plansUrl',
  cache: 'monotonic.plansCache',
  progress: 'monotonic.progress',
  active: 'monotonic.active',
  theme: 'monotonic.theme',
};

// --- storage helpers -------------------------------------------------------
const lsGet = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
};
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let plans = [];      // [{name, days:[...], exercise:[...]}]
let restDays = [];   // normalized weekday names today's session is skipped on
let resting = false; // true when showing the rest-day screen (no auto session)
let progress = lsGet(K.progress, {});   // { [name]: {sets, reps, weight|null} }
let active = lsGet(K.active, null);      // {planName, date, items:[...]}

const $ = (id) => document.getElementById(id);
const sessionEl = $('session');
const selectEl = $('planSelect');

// --- formatting ------------------------------------------------------------
const fmt = (n) => {
  if (n == null) return '';
  const r = Math.round(n * 1000) / 1000;
  return String(r);
};
const todayDate = () => new Date().toISOString().slice(0, 10);
const todayDow = () => WEEKDAYS[new Date().getDay()];

// Middle-field ("reps") display by unit: counts/minutes as-is, time as m:ss.
const fmtCount = (v, unit) => {
  if (v == null) return '';
  if (unit === 'time') {
    const s = Math.max(0, Math.round(v));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return fmt(v);
};
const repLabel = (unit) => (unit === 'time' ? 'Time' : unit === 'min' ? 'Min' : 'Reps');
// Short mono label for the middle field's stepper group.
const groupKey = (unit) => (unit === 'time' ? 'time' : unit === 'min' ? 'min' : 'reps');
// Show a sets stepper only when meaningful (rep work, or more than one set).
const showSets = (item) => item.unit === 'reps' || item.cur.sets > 1;
// Parse "m:ss" or a plain number (seconds) back to seconds.
const parseTime = (s) => {
  s = String(s).trim();
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  }
  return parseFloat(s);
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- theme -----------------------------------------------------------------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(K.theme, t); } catch {}
  const b = $('themeToggle');
  if (b) {
    b.innerHTML = t === 'dark' ? '☀' : '☾'; // sun / moon
    b.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}
function initTheme() {
  let t;
  try { t = localStorage.getItem(K.theme); } catch {}
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(t);
}

// --- plans loading ---------------------------------------------------------
function getUrl() {
  const u = lsGet(K.url, '');
  return u && u.trim() ? u.trim() : DEFAULT_URL;
}

async function refreshPlans() {
  const url = getUrl();
  const bust = (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  const res = await fetch(url + bust, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${res.statusText}`);
  const text = await res.text();
  parsePlans(text); // validate before caching
  lsSet(K.cache, { toml: text, fetchedAt: Date.now(), url });
  return text;
}

function loadCachedPlans() {
  const c = lsGet(K.cache, null);
  if (!c || !c.toml) return null;
  try { return parsePlans(c.toml); } catch { return null; }
}

// Re-read rest_days from the cached TOML; on any failure assume no rest days.
function loadRestDays() {
  const c = lsGet(K.cache, null);
  if (!c || !c.toml) return [];
  try { return parseRestDays(c.toml); } catch { return []; }
}

// --- session building ------------------------------------------------------
function buildSession(plan) {
  active = { planName: plan.name, date: todayDate(), items: buildItems(plan, progress) };
  resting = false; // a manual (or auto) build leaves the rest screen
  lsSet(K.active, active);
}

function planByName(name) { return plans.find((p) => p.name === name); }

function ensureSession() {
  if (active && active.date === todayDate() && active.items?.length) { resting = false; return; } // resume
  if (isRestDay(restDays, todayDow())) { resting = true; return; } // rest day: no auto session
  resting = false;
  const plan = pickTodaysPlan(plans, todayDow());
  if (plan) buildSession(plan);
}

// --- rendering -------------------------------------------------------------
const DOW_UP = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function updateMeta() {
  const m = $('sessionMeta');
  if (!m) return;
  const items = active?.items || [];
  const done = items.filter((x) => x.done).length;
  const wd = DOW_UP[new Date().getDay()];
  const dd = todayDate().slice(5).replace('-', '.');
  m.innerHTML = items.length ? `${wd} ${dd}<br><b>${done}</b>/${items.length} done` : `${wd} ${dd}`;
}

function renderSelect() {
  const dow = todayDow();
  selectEl.innerHTML = '';
  // On the rest screen, lead with a disabled placeholder so picking any real
  // plan fires a change (and so no plan looks pre-selected).
  if (resting) {
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Choose a plan…';
    ph.disabled = true;
    ph.selected = true;
    selectEl.appendChild(ph);
  }
  for (const p of plans) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.days.includes(dow) ? `${p.name} · today` : p.name;
    if (!resting && active && p.name === active.planName) o.selected = true;
    selectEl.appendChild(o);
  }
  const name = resting ? 'Rest day' : (active?.planName || plans[0]?.name || 'Monotonic');
  $('planName').textContent = name;
  // Resting: force the switcher on (even for a single plan) so a plan can be picked.
  $('titlewrap').classList.toggle('switchable', resting || plans.length > 1);
  updateMeta();
}

function lastLabel(item) {
  const { ref, hasWeight, unit } = item;
  let s = (unit !== 'reps' && ref.sets === 1)
    ? fmtCount(ref.reps, unit)
    : `${fmt(ref.sets)}×${fmtCount(ref.reps, unit)}`;
  if (hasWeight) s += ` · ${fmt(ref.weight)}`;
  return `last <b>${s}</b>`;
}

function stepperGroup(i, field, key, value) {
  return `<div class="grp"><span class="k">${key}</span>`
    + `<button data-act="step" data-i="${i}" data-field="${field}" data-delta="-1">−</button>`
    + `<span class="v" data-act="edit" data-i="${i}" data-field="${field}" id="v-${i}-${field}">${value}</span>`
    + `<button data-act="step" data-i="${i}" data-field="${field}" data-delta="1">+</button></div>`;
}

function cellClass(item) {
  if (item.done || item.skipped) return 'resolved';
  const cue = cueFor(item);
  return cue === 'up' ? 'ahead' : cue === 'down' ? 'behind' : '';
}

function renderSession() {
  if (!plans.length) {
    sessionEl.innerHTML = `<div class="msg">No plans loaded.<br>Open settings (⚙) to set your Plans URL.</div>`;
    updateMeta();
    return;
  }
  if (resting) {
    sessionEl.innerHTML = `<div class="msg">REST DAY — nothing scheduled.<br>Switch plan (▾ above) to train anyway.</div>`;
    updateMeta();
    return;
  }
  if (!active || !active.items?.length) {
    sessionEl.innerHTML = `<div class="msg">No session.</div>`;
    updateMeta();
    return;
  }
  sessionEl.innerHTML = active.items.map((item, i) => {
    const groups = [];
    if (showSets(item)) groups.push(stepperGroup(i, 'sets', 'set', fmt(item.cur.sets)));
    groups.push(stepperGroup(i, 'reps', groupKey(item.unit), fmtCount(item.cur.reps, item.unit)));
    if (item.hasWeight) groups.push(stepperGroup(i, 'weight', 'kg', fmt(item.cur.weight)));
    const idx = String(i + 1).padStart(2, '0');
    const tag = `<span class="i">${idx}</span> · ${groupKey(item.unit)}${item.hasWeight ? ' · kg' : ''}`;
    return `
      <section class="cell ${cellClass(item)}" id="card-${i}">
        <span class="cx tl"></span><span class="cx tr"></span><span class="cx bl"></span><span class="cx br"></span>
        <div class="tag">${tag}</div>
        <div class="row2"><span class="nm">${escapeHtml(item.name)}</span><span class="last">${lastLabel(item)}</span></div>
        <div class="ctl">
          ${groups.join('')}
          <span class="sp"></span>
          <button class="act skip${item.skipped ? ' on' : ''}" data-act="skip" data-i="${i}">skip</button>
          <button class="act done${item.done ? ' on' : ''}" data-act="done" data-i="${i}">${item.done ? '✓ done' : 'done'}</button>
        </div>
      </section>`;
  }).join('');
  updateMeta();
}

function updateCard(i) {
  const item = active.items[i];
  const card = $(`card-${i}`);
  if (!card) return renderSession();
  for (const field of ['sets', 'reps', 'weight']) {
    const el = $(`v-${i}-${field}`);
    if (el) el.textContent = field === 'reps' ? fmtCount(item.cur.reps, item.unit) : fmt(item.cur[field]);
  }
  card.className = `cell ${cellClass(item)}`;
  const d = card.querySelector('.act.done');
  if (d) { d.classList.toggle('on', item.done); d.textContent = item.done ? '✓ done' : 'done'; }
  card.querySelector('.act.skip')?.classList.toggle('on', item.skipped);
  updateMeta();
}

// --- mutations -------------------------------------------------------------
function stepField(i, field, deltaUnits) {
  const item = active.items[i];
  if (field === 'weight' && !item.hasWeight) return;
  const stepSize = field === 'weight' ? item.step : field === 'reps' ? item.repStep : 1;
  let next = (item.cur[field] ?? 0) + deltaUnits * stepSize;
  // weight keeps fractions; counts/minutes/seconds stay whole numbers.
  next = Math.max(0, field === 'weight' ? Math.round(next * 1000) / 1000 : Math.round(next));
  item.cur[field] = next;
  lsSet(K.active, active);
  updateCard(i);
}

function editField(i, field) {
  const item = active.items[i];
  if (field === 'weight' && !item.hasWeight) return;
  const isTime = field === 'reps' && item.unit === 'time';
  const shown = field === 'reps' ? fmtCount(item.cur.reps, item.unit) : fmt(item.cur[field]);
  const fieldLabel = field === 'reps' ? repLabel(item.unit).toLowerCase() : field;
  const raw = prompt(`${item.name} — ${fieldLabel}`, shown);
  if (raw == null) return;
  const n = isTime ? parseTime(raw) : parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return;
  item.cur[field] = field === 'weight' ? Math.round(n * 1000) / 1000 : Math.round(n);
  lsSet(K.active, active);
  updateCard(i);
}

function markDone(i) {
  const item = active.items[i];
  if (item.done) { // toggle off -> undo the progress write
    if (item.prevProgress === null) delete progress[item.name];
    else if (item.prevProgress !== undefined) progress[item.name] = item.prevProgress;
    item.prevProgress = undefined;
    item.done = false;
  } else {
    item.prevProgress = progress[item.name] ? { ...progress[item.name] } : null;
    progress[item.name] = {
      sets: item.cur.sets, reps: item.cur.reps,
      weight: item.hasWeight ? item.cur.weight : null,
    };
    item.done = true;
    item.skipped = false;
  }
  lsSet(K.progress, progress);
  lsSet(K.active, active);
  updateCard(i);
}

function markSkip(i) {
  const item = active.items[i];
  if (item.done) markDone(i); // clear a done state (and its progress write) first
  item.skipped = !item.skipped;
  lsSet(K.active, active);
  updateCard(i);
}

// --- input wiring ----------------------------------------------------------
// Steppers fire only on a clean tap: nothing happens on pointerdown, and a press
// that travels past a small threshold (a scroll, or the iOS home swipe) fires
// nothing at all. So a swipe that starts on a +/- button scrolls the page instead
// of changing a value. One tap = one step; tap again to keep going.
const MOVE_TOL = 10; // px of travel that reclassifies a press as a scroll
let press = { btn: null, x: 0, y: 0, moved: false };
const clearPress = () => { press = { btn: null, x: 0, y: 0, moved: false }; };

sessionEl.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-act="step"]');
  if (!btn) return;
  press = { btn, x: e.clientX, y: e.clientY, moved: false };
});

sessionEl.addEventListener('pointermove', (e) => {
  if (!press.btn || press.moved) return;
  if (Math.abs(e.clientX - press.x) > MOVE_TOL || Math.abs(e.clientY - press.y) > MOVE_TOL) {
    press.moved = true; // a scroll, not a tap — let the page move, fire nothing
  }
});

window.addEventListener('pointerup', () => {
  const { btn, moved } = press;
  clearPress();
  if (btn && !moved) stepField(+btn.dataset.i, btn.dataset.field, +btn.dataset.delta);
});
window.addEventListener('pointercancel', clearPress);

sessionEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act, i = +btn.dataset.i;
  if (act === 'done') markDone(i);
  else if (act === 'skip') markSkip(i);
  else if (act === 'edit') editField(i, btn.dataset.field);
});

selectEl.addEventListener('change', () => {
  const p = planByName(selectEl.value);
  if (p) { buildSession(p); renderSelect(); renderSession(); }
});

$('themeToggle').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

// --- settings dialog -------------------------------------------------------
const dlg = $('settings');
$('openSettings').addEventListener('click', () => {
  $('urlInput').value = lsGet(K.url, '');
  const c = lsGet(K.cache, null);
  $('fetchInfo').textContent = c ? `Last fetched ${new Date(c.fetchedAt).toLocaleString()}` : 'No plans cached yet.';
  $('settingsErr').textContent = '';
  dlg.showModal();
});
$('closeSettings').addEventListener('click', () => dlg.close());

async function doRefresh() {
  $('settingsErr').textContent = '';
  try {
    await refreshPlans();
    plans = loadCachedPlans() || [];
    restDays = loadRestDays();
    rebuildAfterPlansChange();
    const c = lsGet(K.cache, null);
    $('fetchInfo').textContent = `Last fetched ${new Date(c.fetchedAt).toLocaleString()}`;
  } catch (err) {
    $('settingsErr').textContent = `Refresh failed: ${err.message}`;
  }
}
$('refreshPlans').addEventListener('click', doRefresh);
$('saveUrl').addEventListener('click', async () => {
  lsSet(K.url, $('urlInput').value.trim());
  await doRefresh();
});
$('restartSession').addEventListener('click', () => {
  const p = planByName(selectEl.value) || pickTodaysPlan(plans, todayDow());
  if (p) { buildSession(p); renderSession(); }
  dlg.close();
});

$('exportBackup').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({
    progress, active, plansUrl: lsGet(K.url, ''), exportedAt: new Date().toISOString(),
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `monotonic-backup-${todayDate()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('importBackup').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.progress) { progress = data.progress; lsSet(K.progress, progress); }
    if (data.active) { active = data.active; lsSet(K.active, active); }
    if (typeof data.plansUrl === 'string') lsSet(K.url, data.plansUrl);
    rebuildAfterPlansChange(); // re-evaluate rest day / session against imported state
    $('settingsErr').textContent = 'Backup imported.';
  } catch (err) {
    $('settingsErr').textContent = `Import failed: ${err.message}`;
  } finally {
    e.target.value = '';
  }
});

function rebuildAfterPlansChange() {
  if (active && planByName(active.planName) && active.date === todayDate() && active.items?.length) {
    resting = false; // an in-progress session for today wins over the rest screen
    renderSelect(); renderSession(); // keep current session
  } else {
    ensureSession();
    renderSelect();
    renderSession();
  }
}

// --- build ref -------------------------------------------------------------
function stampBuild() {
  const el = $('build');
  if (!el) return;
  const ref = (typeof window !== 'undefined' && window.__BUILD__) || 'dev';
  el.textContent = `build ${ref}`;
  el.href = ref && ref !== 'dev'
    ? `https://github.com/tetigi/monotonic/commit/${ref}`
    : 'https://github.com/tetigi/monotonic';
}

// --- boot ------------------------------------------------------------------
async function boot() {
  initTheme();
  stampBuild();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const cached = loadCachedPlans();
  if (cached) {
    plans = cached;
    restDays = loadRestDays();
    ensureSession();
    renderSelect();
    renderSession();
    refreshPlans().then(() => {
      plans = loadCachedPlans() || plans;
      restDays = loadRestDays();
      rebuildAfterPlansChange(); // a refresh may flip today's rest-day state
    }).catch(() => {}); // offline: keep cached
  } else {
    try {
      await refreshPlans();
      plans = loadCachedPlans() || [];
      restDays = loadRestDays();
      ensureSession();
      renderSelect();
      renderSession();
    } catch (err) {
      sessionEl.innerHTML = `<div class="msg">Couldn't load plans.<br><span class="err">${escapeHtml(err.message)}</span><br><br>Open settings (⚙) to set your Plans URL.</div>`;
    }
  }
}

boot();
