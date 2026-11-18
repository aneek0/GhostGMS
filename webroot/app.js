// GhostGMS WebUI — KSU bridge, plain JS, no build step.
'use strict';

const MODDIR = '/data/adb/modules/ghostgms';

const PREFS = [
  ['ENABLE_GHOSTED', '👻 GMS Ghosting'],
  ['ENABLE_LOG_DISABLE', '📋 Отключать GMS-логирование'],
  ['ENABLE_SYS_PROPS', '🔧 Системные пропсы (LMK/Dalvik)'],
  ['ENABLE_BLUR_DISABLE', '🎨 Отключать блюры'],
  ['ENABLE_SERVICES_DISABLE', '⚙️ Отключать GMS-сервисы'],
  ['ENABLE_RECEIVER_DISABLE', '📻 Отключать ресиверы (заготовка)'],
  ['ENABLE_PROVIDER_DISABLE', '🏬 Отключать провайдеры (заготовка)'],
  ['ENABLE_ACTIVITY_DISABLE', '🔠 Отключать активности (заготовка)'],
];

const CATS = [
  ['ADS', 'Реклама'], ['TRACKING', 'Трекинг'], ['ANALYTICS', 'Аналитика'],
  ['REPORTING', 'Отчёты'], ['BACKGROUND', 'Фоновые'], ['UPDATE', 'Обновления'],
  ['LOCATION', 'Локация'], ['GEOFENCE', 'Геозоны'], ['NEARBY', 'Nearby'],
  ['CAST', 'Cast'], ['DISCOVERY', 'Discovery'], ['SYNC', 'Синхронизация'],
  ['CLOUD', 'Облако'], ['AUTH', 'Авторизация'], ['WALLET', 'Кошелёк'],
  ['PAYMENT', 'Платежи'], ['WEAR', 'Wear'], ['FITNESS', 'Фитнес'],
];

const LOG_SETTINGS = [
  ['gmscorestat_enabled', '1'], ['play_store_panel_logging_enabled', '1'],
  ['clearcut_events', '1'], ['clearcut_gcm', '1'],
  ['ga_collection_enabled', '1'], ['clearcut_enabled', '1'],
  ['analytics_enabled', '1'], ['uploading_enabled', '1'],
  ['bug_report_in_power_menu', '1'], ['usage_stats_enabled', '1'],
  ['usagestats_collection_enabled', '1'],
];

const PROP_SETTINGS = [
  ['tombstoned.max_tombstone_count', '0', false],
  ['ro.lmk.debug', 'false', true], ['ro.lmk.log_stats', 'false', true],
  ['dalvik.vm.check-dex-sum', 'false', true], ['dalvik.vm.checkjni', 'false', true],
  ['dalvik.vm.dex2oat-minidebuginfo', 'false', true], ['dalvik.vm.minidebuginfo', 'false', true],
  ['dalvik.vm.verify-bytecode', 'false', true],
  ['disableBlurs', 'true', false], ['enable_blurs_on_windows', '0', false],
  ['ro.launcher.blur.appLaunch', '0', true], ['ro.sf.blurs_are_expensive', '0', true],
  ['ro.surface_flinger.supports_background_blur', '0', true],
];

const STATUS_KEYS = [
  'gmscorestat_enabled', 'play_store_panel_logging_enabled', 'clearcut_events',
  'clearcut_gcm', 'ga_collection_enabled', 'clearcut_enabled',
  'analytics_enabled', 'uploading_enabled', 'usage_stats_enabled',
];

// ---------- error banner: any JS error becomes visible ----------
function showErr(msg) {
  const el = document.getElementById('errbanner');
  if (el) { el.textContent = '⚠ ' + msg; el.hidden = false; }
}
window.onerror = (m) => showErr(String(m));
window.onunhandledrejection = (e) => showErr('Promise: ' + (e && e.reason ? e.reason : e));

// ---------- KSU exec bridge (callback OR promise, with timeout) ----------
function hasKsu() {
  return typeof globalThis.ksu === 'object' && globalThis.ksu !== null && 'exec' in globalThis.ksu;
}
let cbSeq = 0;
function ksuExec(cmd) {
  if (!hasKsu()) return Promise.reject(new Error('ksu bridge отсутствует (открой через менеджер)'));
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error('timeout: ksu.exec не ответил за 15с: ' + cmd.slice(0, 60))); }
    }, 15000);

    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };

    const name = `ggms_cb_${Date.now()}_${cbSeq++}`;
    window[name] = (errno, stdout, stderr) => {
      delete window[name];
      finish({ errno, stdout: stdout || '', stderr: stderr || '' });
    };

    try {
      const ret = globalThis.ksu.exec(cmd, JSON.stringify({}), name);
      // Newer KSU builds may return a Promise instead of invoking the callback.
      if (ret && typeof ret.then === 'function') {
        ret.then((v) => {
          delete window[name];
          if (typeof v === 'string') finish({ errno: 0, stdout: v, stderr: '' });
          else finish({ errno: v && v.errno || 0, stdout: (v && v.stdout) || '', stderr: (v && v.stderr) || '' });
        }, (e) => { delete window[name]; finish({ errno: -1, stdout: '', stderr: String(e) }); });
      }
    } catch (e) {
      delete window[name];
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    }
  });
}
const shq = (s) => "'" + String(s).replace(/(['\\])/g, '\\$1') + "'";
// ksu.exec runs as root; single shell round: pass script body via -c
async function run(cmd) {
  return ksuExec('sh -c ' + shq(cmd));
}

// ---------- UI helpers ----------
const $ = (id) => document.getElementById(id);
function toast(msg) { try { globalThis.ksu.toast(String(msg)); } catch { showErr(String(msg)); } }
function showOut(text) {
  const box = $('out');
  const pre = document.createElement('pre');
  pre.textContent = String(text).slice(-3000);
  box.prepend(pre);
  while (box.childElementCount > 4) box.lastChild.remove();
}
function busy(btn, on) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = '…'; }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

// ---------- Data layer ----------
async function readFile(path) {
  const r = await run(`cat ${shq(path)} 2>/dev/null`);
  return r.errno === 0 ? r.stdout : null;
}
async function parseKV(path) {
  const txt = await readFile(path);
  const kv = {};
  if (txt) for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+)\s*$/);
    if (m) kv[m[1]] = m[2] === '1' ? '1' : '0';
  }
  return kv;
}
async function writeKV(path, kv, pairs) {
  const body = pairs.map(([k]) => `${k}=${kv[k] === '1' ? 1 : 0}`).join('\n') + '\n';
  await run(`printf ${shq('%s')} ${shq(body)} > ${shq(path)} && chmod 644 ${shq(path)}`);
}

// ---------- build switches BEFORE any await ----------
function buildSwitch(container, list, kv) {
  container.innerHTML = '';
  for (const [key, label] of list) {
    const lab = document.createElement('label');
    lab.className = 'sw';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.key = key;
    cb.checked = kv[key] === '1';
    lab.append(cb, document.createTextNode(label));
    container.append(lab);
  }
}
function readSwitch(container) {
  const kv = {};
  container.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    kv[cb.dataset.key] = cb.checked ? '1' : '0';
  });
  return kv;
}

async function refreshStatus() {
  const tb = $('settingsTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const k of STATUS_KEYS) {
    let v = '?';
    try { v = ((await run(`settings get global ${k}`)).stdout || '').trim() || 'null'; } catch (e) { v = 'err'; }
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = k;
    const td2 = document.createElement('td'); td2.textContent = v;
    tr.append(td1, td2); tb.append(tr);
  }
  try {
    const dump = await run(
      `dumpsys package com.google.android.gms | awk '/^      disabledComponents:/{f=1;next} /^      [a-z]/{f=0} f' | grep -c com.google`
    );
    const n = (dump.stdout || '').trim();
    $('compCount').textContent = n ? `Сейчас отключено компонентов GMS: ${n}` : '';
  } catch (e) { $('compCount').textContent = ''; }
  const logText = await readFile(`${MODDIR}/logs/ghostgms_service.log`);
  $('logTail').textContent = logText ? logText.split('\n').slice(-15).join('\n') : '(лог пуст или недоступен)';
}

// ---------- actions ----------
async function doRun(button, cmd, okMsg) {
  busy(button, true);
  try {
    const r = await run(cmd);
    const tail = (r.stdout || r.stderr || '').split('\n').filter(Boolean).slice(-12).join('\n');
    showOut(tail || (r.errno === 0 ? 'ok' : `errno=${r.errno}`));
    toast(okMsg || (r.errno === 0 ? 'Готово' : `Ошибка ${r.errno}`));
    await refreshStatus().catch(() => {});
  } catch (e) {
    showOut(String(e));
    toast('Ошибка: ' + e);
  } finally {
    busy(button, false);
  }
}

// commands are quoted exactly once here (path quoted, not double-wrapped)
const VEL = (args) => `${shq(MODDIR + '/veloxine.sh')} ${args}`;
const LOG_SETTINGS_CMD = LOG_SETTINGS.map(([k, v]) => `settings put global ${k} ${v};`).join(' ');
const PROP_SETTINGS_CMD = PROP_SETTINGS.map(
  ([k, v, isRo]) => `resetprop ${isRo ? '-n ' : ''}${k} ${v} 2>/dev/null;`
).join(' ');

// ---------- init: handlers first, then async fills ----------
function init() {
  if (!hasKsu()) showErr('ksu bridge отсутствует — открой WebUI из менеджера (ReSukisu → Модули → GhostGMS)');

  buildSwitch($('prefsBox'), PREFS, {});
  buildSwitch($('catsBox'), CATS, {});

  $('refreshBtn').onclick = async () => {
    busy($('refreshBtn'), true);
    try { await refreshStatus(); } catch (e) { showErr(String(e)); } finally { busy($('refreshBtn'), false); }
  };

  $('savePrefsBtn').onclick = async () => {
    busy($('savePrefsBtn'), true);
    try {
      const cur = await parseKV(`${MODDIR}/config/user_prefs`);
      const kv = { ...cur, ...readSwitch($('prefsBox')) };
      await writeKV(`${MODDIR}/config/user_prefs`, kv, PREFS);
      await run(`cp ${shq(MODDIR + '/config/user_prefs')} /data/local/tmp/ghostgms_config/user_prefs`);
      toast('Опции сохранены');
    } catch (e) { showErr(String(e)); toast('Ошибка сохранения'); } finally { busy($('savePrefsBtn'), false); }
  };

  $('saveCatsBtn').onclick = async () => {
    busy($('saveCatsBtn'), true);
    try {
      const cur = await parseKV(`${MODDIR}/config/gms_categories`);
      const kv = { ...cur, ...readSwitch($('catsBox')) };
      await writeKV(`${MODDIR}/config/gms_categories`, kv, CATS);
      await run(`cp ${shq(MODDIR + '/config/gms_categories')} /data/local/tmp/ghostgms_config/gms_categories`);
      toast('Категории сохранены');
    } catch (e) { showErr(String(e)); toast('Ошибка сохранения'); } finally { busy($('saveCatsBtn'), false); }
  };

  $('disableBtn').onclick = (e) => doRun(e.target, VEL('disable'), 'GMS отключается');
  $('enableBtn').onclick = (e) => doRun(e.target, VEL('enable'), 'GMS включается');
  $('revertSettingsBtn').onclick = (e) => doRun(e.target, LOG_SETTINGS_CMD, 'Настройки логов возвращены');
  $('applyPropsBtn').onclick = (e) => doRun(e.target, PROP_SETTINGS_CMD, 'Пропсы применены');
  $('rmStubsBtn').onclick = (e) => doRun(
    e.target,
    `rm -rf ${shq(MODDIR + '/system/bin')} ${shq(MODDIR + '/system/etc/init')} && echo 'Заглушки удалены; перезагрузи телефон'`,
    'Заглушки удалены'
  );

  // async fill: version, current checkbox states, status
  (async () => {
    try {
      const t = await readFile(`${MODDIR}/module.prop`);
      $('ver').textContent = (t && (t.match(/^version=(.+)$/m) || [])[1]) || '';
      const prefs = await parseKV(`${MODDIR}/config/user_prefs`);
      const cats = await parseKV(`${MODDIR}/config/gms_categories`);
      buildSwitch($('prefsBox'), PREFS, prefs);
      buildSwitch($('catsBox'), CATS, cats);
      await refreshStatus();
      showOut('Инициализация завершена ✓');
    } catch (e) { showErr(String(e)); }
  })();
}
document.addEventListener('DOMContentLoaded', init);
