import { WEEKDAYS, parsePlans, pickTodaysPlan, buildItems, cueFor } from './core.js';

const DEFAULT_URL = './plans.toml';

const K = {
  url: 'monotonic.plansUrl',
  cache: 'monotonic.plansCache',
  progress: 'monotonic.progress',
  active: 'monotonic.active',
};

// --- storage helpers -------------------------------------------------------
const lsGet = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
};
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let plans = [];      // [{name, days:[...], exercise:[...]}]
let progress = lsGet(K.progress, {});   // { [name]: {sets, reps, weight|null} }
let active = lsGet(K.active, null);      // {planName, date, items:[...]}

const $ = (id) => document.getElementById(id);
const sessionEl = $('session');
const selectEl = $('planSelect');

// --- formatting ------------------------------------------------------------
const fmt = (n) => {
  if (n == null) return '';
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
};
const todayDate = () => new Date().toISOString().slice(0, 10);
const todayDow = () => WEEKDAYS[new Date().getDay()];

// Middle-field ("reps") display by unit: counts as-is, minutes as-is, time as m:ss.
const fmtCount = (v, unit) => {
  if (v == null) return '';
  if (unit === 'time') {
    const s = Math.max(0, Math.round(v));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return fmt(v);
};
const repLabel = (unit) => (unit === 'time' ? 'Time' : unit === 'min' ? 'Min' : 'Reps');
// Parse "m:ss" or a plain number (seconds) back to seconds.
const parseTime = (s) => {
  s = String(s).trim();
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  }
  return parseFloat(s);
};

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

// --- session building ------------------------------------------------------
function buildSession(plan) {
  active = { planName: plan.name, date: todayDate(), items: buildItems(plan, progress) };
  lsSet(K.active, active);
}

function planByName(name) { return plans.find((p) => p.name === name); }

function ensureSession() {
  if (active && active.date === todayDate() && active.items?.length) return; // resume
  const plan = pickTodaysPlan(plans, todayDow());
  if (plan) buildSession(plan);
}

const cueGlyph = { up: '\u25B2', same: '\u003D', down: '\u25BC' };

// --- rendering -------------------------------------------------------------
function renderSelect() {
  const dow = todayDow();
  selectEl.innerHTML = '';
  for (const p of plans) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.days.includes(dow) ? `${p.name} \u00B7 today` : p.name;
    if (active && p.name === active.planName) o.selected = true;
    selectEl.appendChild(o);
  }
}

function lastLabel(item) {
  const { ref, hasWeight, unit } = item;
  const base = `last ${fmt(ref.sets)}\u00D7${fmtCount(ref.reps, unit)}`;
  return hasWeight ? `${base} \u00B7 ${fmt(ref.weight)}` : base;
}

function stepperRow(i, field, label, value) {
  return `
    <div class="stepper">
      <span class="lbl">${label}</span>
      <button class="step" data-act="step" data-i="${i}" data-field="${field}" data-delta="-1">\u2212</button>
      <span class="val" data-act="edit" data-i="${i}" data-field="${field}" id="v-${i}-${field}">${value}</span>
      <button class="step" data-act="step" data-i="${i}" data-field="${field}" data-delta="1">+</button>
    </div>`;
}

function renderSession() {
  if (!plans.length) {
    sessionEl.innerHTML = `<div class="msg">No plans loaded.<br>Open settings (\u2699) to set your Plans URL.</div>`;
    return;
  }
  if (!active || !active.items?.length) {
    sessionEl.innerHTML = `<div class="msg">No session.</div>`;
    return;
  }
  const html = active.items.map((item, i) => {
    const cue = cueFor(item);
    const resolved = item.done || item.skipped ? ' resolved' : '';
    const rows = [
      stepperRow(i, 'sets', 'Sets', fmt(item.cur.sets)),
      stepperRow(i, 'reps', repLabel(item.unit), fmtCount(item.cur.reps, item.unit)),
      item.hasWeight ? stepperRow(i, 'weight', 'Weight', fmt(item.cur.weight)) : '',
    ].join('');
    return `
      <section class="card cue-${cue}${resolved}" id="card-${i}">
        <div class="card-top">
          <span class="ex-name">${escapeHtml(item.name)}</span>
          <span class="ex-last">${lastLabel(item)}<span class="glyph">${cueGlyph[cue]}</span></span>
        </div>
        ${rows}
        <div class="actions">
          <button class="btn done${item.done ? ' on' : ''}" data-act="done" data-i="${i}">Done</button>
          <button class="btn skip${item.skipped ? ' on' : ''}" data-act="skip" data-i="${i}">Skip</button>
        </div>
      </section>`;
  }).join('');
  sessionEl.innerHTML = html;
}

function updateCard(i) {
  const item = active.items[i];
  const card = $(`card-${i}`);
  if (!card) return renderSession();
  for (const field of ['sets', 'reps', 'weight']) {
    const el = $(`v-${i}-${field}`);
    if (el) el.textContent = field === 'reps' ? fmtCount(item.cur.reps, item.unit) : fmt(item.cur[field]);
  }
  const cue = cueFor(item);
  card.className = `card cue-${cue}${item.done || item.skipped ? ' resolved' : ''}`;
  const glyph = card.querySelector('.glyph');
  if (glyph) glyph.textContent = cueGlyph[cue];
  card.querySelector('.btn.done')?.classList.toggle('on', item.done);
  card.querySelector('.btn.skip')?.classList.toggle('on', item.skipped);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const raw = prompt(`${item.name} \u2014 ${fieldLabel}`, shown);
  if (raw == null) return;
  const n = isTime ? parseTime(raw) : parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return;
  item.cur[field] = field === 'weight' ? Math.round(n * 1000) / 1000 : Math.round(n);
  lsSet(K.active, active);
  updateCard(i);
}

function markDone(i) {
  const item = active.items[i];
  if (item.done) { // toggle off → undo the progress write
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
let hold = { t: null, iv: null };
const stopHold = () => { clearTimeout(hold.t); clearInterval(hold.iv); hold.t = hold.iv = null; };
window.addEventListener('pointerup', stopHold);
window.addEventListener('pointercancel', stopHold);

sessionEl.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-act="step"]');
  if (!btn) return;
  e.preventDefault();
  const i = +btn.dataset.i, field = btn.dataset.field, delta = +btn.dataset.delta;
  const fire = () => stepField(i, field, delta);
  fire();
  hold.t = setTimeout(() => { hold.iv = setInterval(fire, 110); }, 380);
});

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
  if (p) { buildSession(p); renderSession(); }
});

// --- settings dialog -------------------------------------------------------
const dlg = $('settings');
$('openSettings').addEventListener('click', () => {
  $('urlInput').value = lsGet(K.url, '');
  const c = lsGet(K.cache, null);
  $('fetchInfo').textContent = c ? `Last fetched: ${new Date(c.fetchedAt).toLocaleString()}` : 'No plans cached yet.';
  $('settingsErr').textContent = '';
  dlg.showModal();
});
$('closeSettings').addEventListener('click', () => dlg.close());

async function doRefresh() {
  $('settingsErr').textContent = '';
  try {
    await refreshPlans();
    plans = loadCachedPlans() || [];
    rebuildAfterPlansChange();
    const c = lsGet(K.cache, null);
    $('fetchInfo').textContent = `Last fetched: ${new Date(c.fetchedAt).toLocaleString()}`;
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
    renderSelect(); renderSession();
    $('settingsErr').textContent = 'Backup imported.';
  } catch (err) {
    $('settingsErr').textContent = `Import failed: ${err.message}`;
  } finally {
    e.target.value = '';
  }
});

function rebuildAfterPlansChange() {
  renderSelect();
  if (active && planByName(active.planName) && active.date === todayDate()) {
    renderSession(); // keep current session
  } else {
    ensureSession();
    renderSelect();
    renderSession();
  }
}

// --- boot ------------------------------------------------------------------
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const cached = loadCachedPlans();
  if (cached) {
    plans = cached;
    ensureSession();
    renderSelect();
    renderSession();
    refreshPlans().then(() => {
      plans = loadCachedPlans() || plans;
      renderSelect();
    }).catch(() => {}); // offline: keep cached
  } else {
    try {
      await refreshPlans();
      plans = loadCachedPlans() || [];
      ensureSession();
      renderSelect();
      renderSession();
    } catch (err) {
      sessionEl.innerHTML = `<div class="msg">Couldn't load plans.<br>${escapeHtml(err.message)}<br><br>Open settings (\u2699) to set your Plans URL.</div>`;
    }
  }
}

boot();
