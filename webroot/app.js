// GhostGMS WebUI — KSU bridge (ksu.exec), plain JS, no build step.
'use strict';

const MODDIR = '/data/adb/modules/ghostgms';

const PREFS = [
  ['ENABLE_GHOSTED', '👻 GMS Ghosting'],
  ['ENABLE_LOG_DISABLE', '📋 Отключать GMS-логирование'],
  ['ENABLE_SYS_PROPS', '🔧 Системные пропсы (LKLM/Dalvik)'],
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
  ['tombstoned.max_tombstone_count', '0'],
  ['ro.lmk.debug', 'false'], ['ro.lmk.log_stats', 'false'],
  ['dalvik.vm.check-dex-sum', 'false'], ['dalvik.vm.checkjni', 'false'],
  ['dalvik.vm.dex2oat-minidebuginfo', 'false'], ['dalvik.vm.minidebuginfo', 'false'],
  ['dalvik.vm.verify-bytecode', 'false'],
  ['disableBlurs', 'true'], ['enable_blurs_on_windows', '0'],
  ['ro.launcher.blur.appLaunch', '0'], ['ro.sf.blurs_are_expensive', '0'],
  ['ro.surface_flinger.supports_background_blur', '0'],
];

// ---------- KSU exec bridge ----------
function hasKsu() {
  return typeof globalThis.ksu === 'object' && globalThis.ksu !== null && 'exec' in globalThis.ksu;
}
let cbSeq = 0;
function ksuExec(cmd) {
  return new Promise((resolve, reject) => {
    const name = `ggms_cb_${Date.now()}_${cbSeq++}`;
    window[name] = (errno, stdout, stderr) => {
      delete window[name];
      resolve({ errno, stdout: stdout || '', stderr: stderr || '' });
    };
    try {
      globalThis.ksu.exec(cmd, '{}', name);
    } catch (e) {
      delete window[name];
      reject(e);
    }
  });
}
const shq = (s) => "'" + String(s).replace(/(['\\])/g, '\\$1') + "'";
async function run(cmd) {
  // ksu.exec runs as root already; quote the whole command once.
  const r = await ksuExec('sh -c ' + shq(cmd));
  return r;
}

// ---------- UI helpers ----------
const $ = (id) => document.getElementById(id);
function toast(msg) { try { globalThis.ksu.toast(msg); } catch { showOut(msg); } }
function showOut(text) {
  const box = $('out');
  const pre = document.createElement('pre');
  pre.textContent = text;
  box.prepend(pre);
  while (box.childElementCount > 4) box.lastChild.remove();
}
function busy(btn, on) {
  btn.disabled = on;
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.textContent = on ? '…' : btn.dataset.label;
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
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+)$/);
    if (m) kv[m[1]] = m[2] === '1' ? '1' : '0';
  }
  return kv;
}
async function writeKV(path, kv, pairs) {
  const body = pairs.map(([k]) => `${k}=${kv[k] === '1' ? 1 : 0}`).join('\n') + '\n';
  await run(`echo ${shq(body)} > ${shq(path)} && chmod 644 ${shq(path)}`);
}
async function moduleVersion() {
  const t = await readFile(`${MODDIR}/module.prop`);
  return (t && (t.match(/^version=(.+)$/m) || [])[1]) || '';
}

async function refreshStatus() {
  const rows = [];
  for (const [k, v] of LOG_SETTINGS.slice(0, 7).concat([['usage_stats_enabled', '0']])) {
    const r = await run(`settings get global ${k}`);
    rows.push([k, (r.stdout || '').trim() || '?']);
  }
  const tb = $('settingsTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = k;
    const td2 = document.createElement('td'); td2.textContent = v;
    tr.append(td1, td2); tb.append(tr);
  }

  // Disabled GMS components count (services currently turned off by module)
  const dump = await run(
    `dumpsys package com.google.android.gms | ` +
    `awk '/^      disabledComponents:/{f=1;next} /^      [a-z]/{f=0} f' | grep -c com.google`
  );
  const n = (dump.stdout || '').trim();
  $('compCount').textContent = n ? `Сейчас отключено компонентов GMS: ${n}` : '';

  const log = await readFile(
    `${MODDIR}/logs/ghostgms_service.log || echo (нет лога)`
  ).catch(() => null);
  const logText = await readFile(`${MODDIR}/logs/ghostgms_service.log`);
  const tail = logText ? logText.split('\n').slice(-15).join('\n') : '(лог пуст)';
  $('logTail').textContent = tail;
}

function buildSwitch(container, list, kv) {
  container.innerHTML = '';
  for (const [key, label] of list) {
    const lab = document.createElement('label');
    lab.className = 'sw';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.key = key;
    cb.checked = kv[key] === '1';
    lab.append(cb, document.createTextNode(label + (key.startsWith('ENABLE_') ? '' : ` (${key.replace('DISABLE_', '')})`)));
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

// ---------- Actions ----------
async function doRun(button, cmd, okMsg) {
  busy(button, true);
  try {
    const r = await run(cmd);
    const tail = (r.stdout || r.stderr || '').split('\n').filter(Boolean).slice(-12).join('\n');
    showOut(tail || (r.errno === 0 ? 'ok' : `errno=${r.errno}`));
    toast(okMsg || (r.errno === 0 ? 'Готово' : `Ошибка ${r.errno}`));
  } catch (e) {
    showOut(String(e));
    toast('Ошибка: ' + e);
  } finally {
    busy(button, false);
  }
}

const VEL = (args) => `${shq(MODDIR + '/veloxine.sh')} ${args}`;
const LOG_SETTINGS_CMD = LOG_SETTINGS.map(
  ([k, v]) => `settings put global ${k} ${v};`
).join(' ');
const PROP_SETTINGS_CMD = PROP_SETTINGS.map(
  ([k, v]) => `resetprop ${k.startsWith('ro.') || k.startsWith('dalvik.vm') ? '-n ' : ''}${k} ${v} 2>/dev/null;`
).join(' ');

// ---------- Init ----------
async function init() {
  if (!hasKsu()) {
    $('noksuhint').hidden = false;
  }
  $('ver').textContent = await moduleVersion();

  const prefs = await parseKV(`${MODDIR}/config/user_prefs`);
  const cats = await parseKV(`${MODDIR}/config/gms_categories`);
  buildSwitch($('prefsBox'), PREFS, prefs);
  buildSwitch($('catsBox'), CATS, cats);

  $('refreshBtn').onclick = () => doRun($('refreshBtn'), 'true', 'Обновлено').then(refreshStatus);
  $('refreshBtn').onclick = async () => { busy($('refreshBtn'), true); try { await refreshStatus(); } finally { busy($('refreshBtn'), false); } };

  $('savePrefsBtn').onclick = async () => {
    const kv = { ...prefs, ...readSwitch($('prefsBox')) };
    await writeKV(`${MODDIR}/config/user_prefs`, kv, PREFS);
    await run(`cp ${shq(MODDIR + '/config/user_prefs')} /data/local/tmp/ghostgms_config/user_prefs`);
    toast('Опции сохранены (вступят после reboot; сервисы/логи можно применить кнопками ниже)');
  };
  $('saveCatsBtn').onclick = async () => {
    const kv = { ...cats, ...readSwitch($('catsBox')) };
    await writeKV(`${MODDIR}/config/gms_categories`, kv, CATS);
    await run(`cp ${shq(MODDIR + '/config/gms_categories')} /data/local/tmp/ghostgms_config/gms_categories`);
    toast('Категории сохранены');
  };

  $('disableBtn').onclick = (e) => doRun(e.target, VEL('disable'), 'GMS отключается');
  $('enableBtn').onclick = (e) => doRun(e.target, VEL('enable'), 'GMS включается');
  $('revertSettingsBtn').onclick = (e) => doRun(e.target, LOG_SETTINGS_CMD, 'Настройки логов возвращены');
  $('applyPropsBtn').onclick = (e) => doRun(e.target, PROP_SETTINGS_CMD, 'Пропсы применены');

  $('rmStubsBtn').onclick = (e) => doRun(
    e.target,
    `rm -rf ${shq(MODDIR + '/system/bin')} ${shq(MODDIR + '/system/etc/init')} && echo "Заглушки удалены; перезагрузи телефон"`,
    'Заглушки удалены'
  );

  await refreshStatus();
}
document.addEventListener('DOMContentLoaded', init);
