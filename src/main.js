// 업무 툴바 - Electron 메인 프로세스
// 화면 아래(작업 표시줄 바로 위)에 투명한 창을 띄우고, 독(dock) 영역 위에서만 마우스를 받는다.
const {
  app, BrowserWindow, WebContentsView, ipcMain, screen, shell, clipboard, Tray, Menu,
  nativeImage, Notification, dialog, net, powerSaveBlocker, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WINDOW_HEIGHT = 720; // 독 + 튀어오르는 메뉴/패널이 들어갈 높이
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

let dockWin = null;
let settingsWin = null;
let settingsDirty = false; // 설정 창에 저장하지 않은 변경이 있는지
let tray = null;
let config = null;
const clipHistory = [];

// ---------- 설정 파일 ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
const CONFIG_FILE = () => userFile('config.json');

function readDefaultConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'default-config.json'), 'utf8'));
}

function loadConfig() {
  const file = CONFIG_FILE();
  if (fs.existsSync(file)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      return migrateConfig(cfg);
    } catch (err) {
      // 깨진 설정 파일은 지우지 않고 옆에 보관한 뒤 기본값으로 시작한다.
      const backup = userFile(`config.broken-${Date.now()}.json`);
      fs.renameSync(file, backup);
      dialog.showErrorBox('설정 파일 오류', `설정 파일을 읽지 못해 기본 설정으로 시작합니다.\n기존 파일: ${backup}`);
    }
  }
  const def = readDefaultConfig();
  writeConfig(def);
  return def;
}

// 기본 메뉴 구성이 바뀐 새 버전이면, 기존 파일을 보관하고 메뉴만 새 기본값으로 바꾼다.
// (투명도·녹색 불빛·공휴일 설정은 그대로 둔다)
function migrateConfig(cfg) {
  const def = readDefaultConfig();
  const from = cfg.version || 1;
  if (from >= def.version) return cfg;
  fs.copyFileSync(CONFIG_FILE(), userFile(`config.v${from}-backup.json`));
  let next = { ...cfg, version: def.version };
  if (from < 2) {
    // v2: 메뉴 구성 전체 변경
    next.categories = def.categories;
  } else {
    // v3 이후: 사용자가 고친 메뉴(이름·주소·순서)는 그대로 두고, 아이콘은 새 기본값으로 맞춘다.
    // 단, 설정 창에서 직접 고른 아이콘(iconCustom)은 건드리지 않는다.
    const defItems = new Map();
    def.categories.forEach((c) => (c.items || []).forEach((it) => defItems.set(it.id, it)));
    next.categories = cfg.categories.map((c) => (!c.items ? c : {
      ...c,
      items: c.items.map((it) => {
        const d = defItems.get(it.id);
        if (!d || it.iconCustom) return it;
        const { icon, iconScale, ...rest } = it;
        return { ...rest, ...(d.icon ? { icon: d.icon } : {}), ...(d.iconScale ? { iconScale: d.iconScale } : {}) };
      }),
    }));
  }
  if (from < 12 && from >= 2) {
    // v12: 빠른 메모·클립보드·계산기·캡처 도구는 '툴바 바로가기'로 옮기고, 그림판·파일 탐색기·작업 관리자는 뺀다
    const moved = new Set(['memo', 'cliphistory', 'calc', 'snip', 'paint', 'explorer', 'taskmgr']);
    next.categories = next.categories.map((c) => (c.pinned ? c : { ...c, items: c.items.filter((it) => !moved.has(it.id)) }));
    if (!next.categories.some((c) => c.pinned)) next.categories.push(def.categories.find((c) => c.pinned));
  }
  if (from < 13 && from >= 2) {
    // v13: 유틸리티 카테고리를 오른쪽 도구 묶음으로, 바로가기 아이콘 색을 유틸리티 색으로 통일
    const utils = next.categories.find((c) => c.id === 'utils');
    if (utils) utils.side = 'right';
    const col = utils ? utils.color : '#9C7CF0';
    next.categories = next.categories.map((c) => (c.pinned ? { ...c, color: col } : c));
  }
  if (from < 14 && from >= 2) {
    // v14: 'AI' 카테고리 추가(검색엔진 바로 다음)
    if (!next.categories.some((c) => c.id === 'ai')) {
      const ai = def.categories.find((c) => c.id === 'ai');
      const at = next.categories.findIndex((c) => c.id === 'search');
      next.categories.splice(at >= 0 ? at + 1 : 0, 0, ai);
    }
  }
  if (from < 15 && from >= 2) {
    // v15: 툴바 바로가기에 '키워드 뉴스', AI에 GitHub·Netlify·Cloudflare 추가
    const defCat = (id) => def.categories.find((c) => c.id === id);
    const pinned = next.categories.find((c) => c.pinned);
    const hasItem = (id) => next.categories.some((c) => (c.items || []).some((it) => it.id === id));
    if (pinned && !hasItem('news')) pinned.items.push(defCat('quick').items.find((it) => it.id === 'news'));
    const ai = next.categories.find((c) => c.id === 'ai');
    if (ai) for (const id of ['github', 'netlify', 'cloudflare']) if (!hasItem(id)) ai.items.push(defCat('ai').items.find((it) => it.id === id));
  }
  if (from < 16 && from >= 2) {
    // v16: 유틸리티에 '필지 조회' 추가
    const has = next.categories.some((c) => (c.items || []).some((it) => it.id === 'parcel'));
    const utils = next.categories.find((c) => c.id === 'utils');
    const item = def.categories.find((c) => c.id === 'utils').items.find((it) => it.id === 'parcel');
    if (!has && utils && item) utils.items.unshift(item);
  }
  if (from < 17 && from >= 2) {
    // v17: 툴바 바로가기에 '법령 개정 알림' 추가
    const pinned = next.categories.find((c) => c.pinned);
    const has = next.categories.some((c) => (c.items || []).some((it) => it.id === 'laws'));
    const item = def.categories.find((c) => c.pinned).items.find((it) => it.id === 'laws');
    if (pinned && !has && item) pinned.items.push(item);
  }
  if (from < 18 && from >= 2) {
    // v18: 행정·법령에 '공공데이터포털' 추가 (국가통계포털 다음)
    const admin = next.categories.find((c) => c.id === 'admin');
    const has = next.categories.some((c) => (c.items || []).some((it) => it.id === 'datagokr'));
    const item = def.categories.find((c) => c.id === 'admin').items.find((it) => it.id === 'datagokr');
    for (const c of next.categories) for (const it of (c.items || [])) if (it.id === 'webcapture' && it.name === '웹페이지 전체 저장') it.name = '웹페이지 저장';
    if (admin && !has && item) {
      const at = admin.items.findIndex((it) => it.id === 'kosis');
      admin.items.splice(at >= 0 ? at + 1 : admin.items.length, 0, item);
    }
  }
  if (from < 19 && from >= 2) {
    // v19: 구분선을 목록 안의 한 줄로. 예전 '오른쪽 도구 묶음(side:right)'·바로 표시 카테고리 앞에 구분선을 넣는다
    if (!next.categories.some((c) => c.type === 'separator')) {
      const left = next.categories.filter((c) => !c.pinned && c.side !== 'right');
      const right = [...next.categories.filter((c) => !c.pinned && c.side === 'right'), ...next.categories.filter((c) => c.pinned)];
      next.categories = right.length ? [...left, { id: 'sep-1', type: 'separator' }, ...right] : left;
    }
    next.categories = next.categories.map(({ side, ...c }) => c);
  }
  if (from < 20) {
    // v20: AI 기본 목록 줄이기(Copilot·뤼튼·DeepL 빼기), 키워드 뉴스의 예시 키워드 빼기(직접 넣은 키워드만 남김)
    const ai = (next.categories || []).find((c) => c.id === 'ai');
    if (ai && ai.items) ai.items = ai.items.filter((it) => !['copilot', 'wrtn', 'deepl'].includes(it.id));
    if (next.news && Array.isArray(next.news.keywords)) {
      next.news = { ...next.news, keywords: next.news.keywords.filter((k) => !['산업단지', '산단 개발', '토지보상'].includes(k)) };
    }
  }
  if (from < 21 && from >= 2 && !next.categories.some((c) => c.id === 'biz' || c.id === 'work')) {
    // v21: '유틸리티'를 '업무 도구'(뉴스·법령·필지)와 '작업 도구'로 나누고, 툴바 바로가기는 메모·클립보드·캡처·웹페이지 저장만
    const defCat = (id) => def.categories.find((c) => c.id === id);
    const utils = next.categories.find((c) => c.id === 'utils');
    const pinned = next.categories.find((c) => c.pinned);
    const mine = new Map();
    for (const c of [utils, pinned]) for (const it of ((c && c.items) || [])) mine.set(it.id, it);
    const pick = (d) => d.items.map((it) => mine.get(it.id) || it); // 이미 있던 항목은 고친 이름·아이콘 그대로
    const defIds = new Set(['biz', 'work', 'quick'].flatMap((id) => defCat(id).items.map((it) => it.id)));
    const extraUtils = ((utils && utils.items) || []).filter((it) => !defIds.has(it.id)); // 직접 넣은 항목은 작업 도구로
    const extraPinned = ((pinned && pinned.items) || []).filter((it) => !defIds.has(it.id));
    const biz = { ...defCat('biz'), items: pick(defCat('biz')) };
    const work = { ...defCat('work'), color: (utils && utils.color) || defCat('work').color, items: [...pick(defCat('work')), ...extraUtils] };
    const quick = { ...(pinned || defCat('quick')), items: [...pick(defCat('quick')), ...extraPinned] };
    const at = utils ? next.categories.indexOf(utils) : (pinned ? next.categories.indexOf(pinned) : next.categories.length);
    next.categories = next.categories.filter((c) => c !== utils && c !== pinned);
    next.categories.splice(Math.min(at, next.categories.length), 0, biz, work);
    next.categories.push(quick);
  }
  if (from < 22) {
    // v22: Windows 알림은 기본으로 끔
    if (next.news) next.news = { ...next.news, notify: false };
    if (next.laws) next.laws = { ...next.laws, notify: false };
  }
  writeConfig(next);
  return next;
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8');
}

// %DOWNLOADS% 같은 특수 경로와 %USERPROFILE% 같은 환경 변수를 실제 경로로 바꾼다.
function resolveTarget(target) {
  const special = {
    DOWNLOADS: app.getPath('downloads'),
    DESKTOP: app.getPath('desktop'),
    DOCUMENTS: app.getPath('documents'),
    PICTURES: app.getPath('pictures'),
    HOME: app.getPath('home'),
  };
  return String(target || '').replace(/%([A-Z_]+)%/gi, (m, key) => {
    const up = key.toUpperCase();
    if (special[up]) return special[up];
    if (process.env[key] !== undefined) return process.env[key];
    return m;
  });
}

// 'notepad.exe'처럼 이름만 있는 실행 파일을 System32 등에서 찾아 전체 경로로 만든다 (아이콘 추출용).
function findExecutable(target) {
  if (path.isAbsolute(target)) return target;
  const dirs = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    process.env.SystemRoot || 'C:\\Windows',
    ...(process.env.PATH || '').split(path.delimiter),
  ];
  for (const d of dirs) {
    const p = path.join(d, target);
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

// 'ms-screenclip:' 같은 프로토콜 주소인지 (드라이브 문자 'C:\\' 는 제외)
const isProtocol = (t) => /^[a-z][a-z0-9+.-]+:/i.test(t);

// ---------- 창 ----------
function placeDock() {
  if (!dockWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  dockWin.setBounds({
    x: workArea.x,
    y: workArea.y + workArea.height - WINDOW_HEIGHT,
    width: workArea.width,
    height: WINDOW_HEIGHT,
  });
}

function createDock() {
  dockWin = new BrowserWindow({
    width: 1200,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dockWin.setAlwaysOnTop(true, 'pop-up-menu');
  dockWin.setIgnoreMouseEvents(true, { forward: true });
  placeDock();
  dockWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  dockWin.once('ready-to-show', () => dockWin.showInactive());
  dockWin.on('blur', () => dockWin.webContents.send('dock:blur'));
  // 다른 창이 '항상 위'를 가져가도 다시 맨 위로
  setInterval(() => {
    if (dockWin && !dockWin.isDestroyed() && dockWin.isVisible()) dockWin.moveTop();
  }, 5000);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 900,
    minHeight: 520,
    title: `업무 툴바 설정 (v${app.getVersion()})`,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#F3F5F9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.on('page-title-updated', (e) => e.preventDefault()); // 창 제목에 버전 표시 유지
  settingsDirty = false;
  settingsWin.on('close', (e) => {
    if (!settingsDirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(settingsWin, {
      type: 'question',
      title: '업무 툴바 설정',
      message: '저장하지 않은 변경 사항이 있습니다.',
      detail: '저장하지 않고 닫으면 바꾼 내용이 사라집니다.',
      buttons: ['저장하고 닫기', '저장하지 않고 닫기', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) settingsWin.webContents.send('settings:save-request');
    else if (choice === 1) { settingsDirty = false; settingsWin.close(); }
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'settings.html'));
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip(`업무 툴바 v${app.getVersion()}`);
  const menu = Menu.buildFromTemplate([
    { label: '툴바 보이기/숨기기', click: toggleDock },
    { label: '설정', click: openSettings },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleDock);
}

function toggleDock() {
  if (!dockWin) return;
  if (dockWin.isVisible()) dockWin.hide();
  else dockWin.showInactive();
}

// ---------- 클립보드 기록 (메모리에만 보관, 파일로 저장하지 않음) ----------
function watchClipboard() {
  let last = clipboard.readText();
  setInterval(() => {
    const text = clipboard.readText();
    if (!text || text === last) return;
    last = text;
    const i = clipHistory.indexOf(text);
    if (i >= 0) clipHistory.splice(i, 1);
    clipHistory.unshift(text);
    if (clipHistory.length > 30) clipHistory.pop();
  }, 1000);
}

// ---------- 사이트 아이콘 (홈페이지에서 가장 큰 아이콘을 찾아 캐시) ----------
const ICON_CACHE_FILE = () => userFile('icon-cache.json');
let iconCache = null;
function getIconCache() {
  if (iconCache) return iconCache;
  try { iconCache = JSON.parse(fs.readFileSync(ICON_CACHE_FILE(), 'utf8')); } catch { iconCache = {}; }
  return iconCache;
}

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await net.fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
}

async function findSiteIcon(pageUrl) {
  const candidates = [];
  try {
    const res = await fetchWithTimeout(pageUrl);
    const html = (await res.text()).slice(0, 200000);
    const base = res.url || pageUrl;
    const linkRe = /<link\b[^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html))) {
      const tag = m[0];
      const rel = (tag.match(/rel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!href || !/icon/i.test(rel)) continue;
      const sizes = (tag.match(/sizes\s*=\s*["'](\d+)x\d+["']/i) || [])[1];
      let score = sizes ? Number(sizes) : 16;
      if (/apple-touch-icon/i.test(rel)) score = Math.max(score, 180);
      if (/\.svg(\?|$)/i.test(href)) score = 150;
      try { candidates.push({ url: new URL(href, base).href, score }); } catch { /* 잘못된 주소 무시 */ }
    }
    candidates.push({ url: new URL('/apple-touch-icon.png', base).href, score: 100 });
    candidates.push({ url: new URL('/favicon.ico', base).href, score: 10 });
  } catch {
    try { candidates.push({ url: new URL('/favicon.ico', pageUrl).href, score: 10 }); } catch { return null; }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    try {
      const r = await fetchWithTimeout(c.url);
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\//.test(type) && !/\.(ico|png|svg)(\?|$)/i.test(c.url)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100 || buf.length > 500000) continue;
      const mime = /^image\//.test(type) ? type : (c.url.match(/\.svg/i) ? 'image/svg+xml' : 'image/x-icon');
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch { /* 다음 후보 */ }
  }
  return null;
}


// ---------- 화면 보호기 차단 (녹색 불빛) ----------
// Windows 공식 API(SetThreadExecutionState)를 쓰는 Electron powerSaveBlocker 사용.
// 키 입력·마우스 이동을 흉내 내지 않는다.
let blockerId = null;
let awakeOverrideDay = null; // 소등 시간 중 직접 켠 날짜 (그 소등 시간 동안만 유지)

function awakeCfg() {
  if (!config.awake) config.awake = { enabled: true, quiet: { on: true, start: '11:30', end: '13:00' } };
  return config.awake;
}
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function inQuietHours() {
  const q = awakeCfg().quiet;
  if (!q || !q.on) return false;
  const now = new Date();
  const n = now.getHours() * 60 + now.getMinutes();
  const s = toMin(q.start); const e = toMin(q.end);
  return s <= e ? n >= s && n < e : n >= s || n < e;
}

function awakeState() {
  const a = awakeCfg();
  const quiet = inQuietHours();
  if (!quiet) awakeOverrideDay = null;
  const on = a.enabled && (!quiet || awakeOverrideDay === todayKey());
  return { on, enabled: a.enabled, quiet, quietText: a.quiet && a.quiet.on ? `${a.quiet.start}~${a.quiet.end}` : '' };
}

function applyAwake() {
  const st = awakeState();
  if (st.on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!st.on && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('awake:state', st);
  return st;
}

function toggleAwake() {
  const a = awakeCfg();
  const st = awakeState();
  if (st.on) { a.enabled = false; awakeOverrideDay = null; }
  else { a.enabled = true; if (st.quiet) awakeOverrideDay = todayKey(); }
  writeConfig(config);
  return applyAwake();
}

// ---------- 날씨 (Open-Meteo, 가입·키 없이 쓰는 무료 날씨 서비스) ----------
const CITIES = require('./shared/cities.json');
let weatherState = null;
function weatherCfg() { return { on: true, city: '서울', air: true, ...(config.weather || {}) }; }
// 환경부 기준 미세먼지 등급 (PM10 / PM2.5 중 나쁜 쪽)
function airGrade(pm10, pm25) {
  const g10 = pm10 <= 30 ? 0 : pm10 <= 80 ? 1 : pm10 <= 150 ? 2 : 3;
  const g25 = pm25 <= 15 ? 0 : pm25 <= 35 ? 1 : pm25 <= 75 ? 2 : 3;
  return Math.max(g10, g25);
}
async function refreshWeather() {
  const w = weatherCfg();
  if (!w.on) { weatherState = null; sendWeather(); return; }
  // 설정에서 직접 찾은 지역은 좌표(lat·lon)를 같이 저장해 둔다
  const city = (Number.isFinite(w.lat) && Number.isFinite(w.lon))
    ? { name: w.city, full: w.full || w.city, lat: w.lat, lon: w.lon }
    : (CITIES.find((c) => c.name === w.city) || CITIES[0]);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1';
  try {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    weatherState = {
      city: city.name,
      full: city.full || city.name,
      temp: j.current.temperature_2m,
      code: j.current.weather_code,
      isDay: j.current.is_day === 1,
      max: j.daily.temperature_2m_max[0],
      min: j.daily.temperature_2m_min[0],
      at: Date.now(),
    };
    if (w.air) {
      try {
        const ar = await fetchWithTimeout('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + city.lat +
          '&longitude=' + city.lon + '&current=pm10,pm2_5&timezone=Asia%2FSeoul', 10000);
        const aj = await ar.json();
        const pm10 = aj.current.pm10; const pm25 = aj.current.pm2_5;
        if (typeof pm10 === 'number' && typeof pm25 === 'number') {
          weatherState.air = { pm10: Math.round(pm10), pm25: Math.round(pm25), grade: airGrade(pm10, pm25) };
        }
      } catch { /* 미세먼지만 실패하면 날씨는 그대로 보여 준다 */ }
    }
  } catch (err) {
    // 실패하면 마지막 값을 그대로 두고, 값이 없으면 오류만 알린다
    if (!weatherState || weatherState.city !== city.name) weatherState = { city: city.name, error: true };
  }
  sendWeather();
}
// 목록에 없는 지역 찾기: 내장 목록 + 브이월드 행정구역(인증키가 있을 때) + Open-Meteo 지명 검색
async function weatherSearch(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const out = [];
  for (const c of CITIES) if (c.name.includes(q) || q.includes(c.name)) out.push({ full: c.name, lat: c.lat, lon: c.lon });
  if (config.keys && config.keys.vworld) {
    for (const cat of ['L4', 'L2', 'L3']) { // 읍면동, 시군구, 일반구
      try {
        const r = await vworldGet(`/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&type=district&category=${cat}&query=${encodeURIComponent(q)}`);
        for (const it of (r && r.result && r.result.items) || []) {
          const lat = Number(it.point && it.point.y); const lon = Number(it.point && it.point.x);
          if (it.title && Number.isFinite(lat) && Number.isFinite(lon)) out.push({ full: it.title, lat, lon });
        }
      } catch { /* 키가 틀려도 다른 검색은 계속 */ }
    }
  }
  try {
    const res = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=ko&countryCode=KR&format=json`, 10000);
    const j = await res.json();
    for (const r of j.results || []) {
      const parts = [];
      for (const p of [r.admin1, r.admin2, r.admin3, r.name]) if (p && !parts.includes(p)) parts.push(p);
      out.push({ full: parts.join(' '), lat: r.latitude, lon: r.longitude });
    }
  } catch { /* 인터넷이 안 되면 내장 목록만 */ }
  const seen = new Set();
  return out.filter((p) => !seen.has(p.full) && seen.add(p.full)).slice(0, 15).map((p) => {
    // 툴바에 보일 짧은 이름: 마지막 단어 (김천시 → 김천, 율곡동은 그대로)
    let name = p.full.split(' ').pop();
    if (/^..+[시군]$/.test(name) && name.length > 2) name = name.slice(0, -1);
    return { ...p, name };
  });
}
function sendWeather() {
  if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('weather:update', weatherState);
}

// ---------- 웹페이지 저장 (내용 복사 / PDF / 이미지) ----------
// 두 가지 방법이 있다.
// 1) 주소 넣기: 주소를 숨은 창에 열어 저장한다.
// 2) 스크랩 창: 툴바 안의 작은 브라우저에서 직접 로그인·이동한 뒤, 지금 보이는 페이지를 저장한다(메일·블로그 등).
// 두 방법 모두 같은 저장소(persist:webclip)를 써서, 스크랩 창에서 한 번 로그인하면 주소 넣기에서도 로그인된 화면이 열린다.
const CLIP_PARTITION = 'persist:webclip';
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms))]);
const fileStamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const safeName = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'webpage';
const escHtml = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 'Electron/33' 같은 표시를 빼서 일반 크롬처럼 보이게 한다 (일부 사이트가 로그인을 막는 것 방지)
const plainUA = (ua) => ua.replace(/\s(WorkToolbar|toolbar-outside)\/\S+/gi, '').replace(/\sElectron\/\S+/, '');

// 본문 찾기: Mozilla Readability(Firefox 읽기 모드)로 광고·메뉴·댓글을 뺀 기사 본문을 찾는다.
// 네이버 블로그처럼 본문이 iframe 안에 있는 경우를 위해 모든 프레임에서 찾아 가장 긴 것을 쓴다.
const READABILITY_JS = () => fs.readFileSync(path.join(__dirname, 'vendor', 'readability', 'Readability.js'), 'utf8');
async function extractArticle(wc) {
  const script = `${READABILITY_JS()}
;(() => {
  const a = new Readability(document.cloneNode(true)).parse();
  if (!a || !a.content) return null;
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;white-space:normal';
  box.innerHTML = a.content;
  document.body.appendChild(box);
  // 제목: 끝에 붙은 ' - 언론사' 정리, 본문 첫머리에 같은 제목이 또 있으면 지운다
  let title = (a.title || document.title || '').trim();
  if (a.siteName) for (const sep of [' - ', ' | ', ' · ', ' : ']) if (title.endsWith(sep + a.siteName)) title = title.slice(0, -(sep + a.siteName).length);
  const firstHead = box.querySelector('h1, h2');
  if (firstHead && title && (title.includes(firstHead.innerText.trim()) || firstHead.innerText.trim().includes(title))) firstHead.remove();
  const text = box.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
  const content = box.innerHTML;
  box.remove();
  return { title, byline: a.byline || '', site: a.siteName || '', text, content, url: location.href };
})()`;
  let best = null;
  for (const f of wc.mainFrame.framesInSubtree) {
    const a = await withTimeout(f.executeJavaScript(script), 10000, 'timeout').catch(() => null);
    if (a && a.text && (!best || a.text.length > best.text.length)) best = a;
  }
  return best;
}

// 페이지에서 드래그해 선택한 글자 (모든 프레임 중 가장 긴 것)
async function selectedText(wc) {
  let best = '';
  for (const f of wc.mainFrame.framesInSubtree) {
    const t = await f.executeJavaScript('String(window.getSelection ? window.getSelection() : "")').catch(() => '');
    if (t && t.trim().length > best.length) best = t.trim();
  }
  return best;
}

function articleHtml(art, url) {
  const meta = [art.site, art.byline, `${new Date().toLocaleDateString('ko-KR')} 저장`].filter(Boolean).map(escHtml).join(' · ');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${escHtml(art.url || url)}"><title>${escHtml(art.title)}</title>
<style>
  body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; max-width: 760px; margin: 36px auto; padding: 0 32px; color: #111; background: #fff; font-size: 16px; line-height: 1.75; word-break: keep-all; }
  h1 { font-size: 26px; line-height: 1.35; margin: 0 0 10px; }
  .meta { color: #666; font-size: 13px; padding-bottom: 12px; margin-bottom: 24px; border-bottom: 1px solid #ddd; }
  img, video, iframe { max-width: 100%; height: auto; }
  figure { margin: 18px 0; } figcaption { color: #666; font-size: 13px; }
  a { color: inherit; } table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; }
  .src { margin-top: 32px; padding-top: 10px; border-top: 1px solid #ddd; color: #888; font-size: 12px; word-break: break-all; }
  @page { margin: 16mm 14mm; }
</style></head><body><h1>${escHtml(art.title)}</h1><div class="meta">${meta}</div>${art.content}<p class="src">출처: ${escHtml(url)}</p></body></html>`;
}

// 숨은 창 만들기. 이미지 저장은 화면이 실제로 그려져야 하므로, 화면 밖에 투명·비활성 창으로 띄운다
function hiddenWin(width = 1280) {
  const win = new BrowserWindow({
    show: false, width, height: 900, x: -30000, y: 0,
    frame: false, skipTaskbar: true, focusable: false, opacity: 0, paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: CLIP_PARTITION },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setUserAgent(plainUA(win.webContents.getUserAgent()));
  return win;
}

// 페이지 전체를 PNG 한 장으로 (CDP 사용). 너무 긴 페이지는 30000px에서 자른다
async function shootFull(wc, measureJs) {
  const dbg = wc.debugger;
  dbg.attach('1.3');
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const view = m.cssLayoutViewport || m.layoutViewport;
    const width = Math.ceil(Math.min(size.width, view.clientWidth || size.width, 1600));
    let fullH = size.height;
    if (measureJs) fullH = await wc.executeJavaScript(measureJs);
    const height = Math.ceil(Math.min(fullH, 30000));
    const shot = await withTimeout(dbg.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
    }), 40000, '이미지를 만드는 데 너무 오래 걸립니다. PDF로 저장해 보세요.');
    return { data: Buffer.from(shot.data, 'base64'), width, height };
  } finally {
    dbg.detach();
  }
}

// PNG를 A4 PDF로 (세로로 긴 그림은 여러 쪽으로 나뉜다)
async function pngToPdf(png, width) {
  const win = hiddenWin(Math.max(width, 400));
  try {
    const tmp = userFile('capture-tmp.png');
    fs.writeFileSync(tmp, png);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:8mm}html,body{margin:0}img{width:100%;display:block}</style></head><body><img src="capture-tmp.png"></body></html>`;
    fs.writeFileSync(userFile('capture-tmp.html'), html, 'utf8');
    await win.loadFile(userFile('capture-tmp.html'));
    await win.webContents.executeJavaScript('new Promise((d) => { const i = document.images[0]; if (i.complete) d(); else { i.onload = d; i.onerror = d; } })');
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function saveFile(data, ext, title, parent) {
  const opts = {
    title: ext === 'pdf' ? 'PDF로 저장' : '이미지로 저장',
    defaultPath: path.join(app.getPath('downloads'), `${safeName(title)}_${fileStamp()}.${ext}`),
    filters: [ext === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PNG 이미지', extensions: ['png'] }],
  };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, data);
  shell.showItemInFolder(r.filePath);
  return { ok: true, file: r.filePath };
}

// 본문만 깔끔한 문서로 다시 만들어 PDF/PNG로 저장한다
async function saveArticle(art, url, format, parent) {
  const win = hiddenWin(860); // 본문 폭에 맞춰 좌우 여백을 줄인다
  try {
    fs.writeFileSync(userFile('capture-tmp.html'), articleHtml(art, url), 'utf8');
    await win.loadFile(userFile('capture-tmp.html'));
    // 그림이 다 불러와질 때까지 잠깐 기다린다 (최대 8초)
    await win.webContents.executeJavaScript(`new Promise((done) => {
      const imgs = [...document.images].filter((i) => !i.complete);
      if (!imgs.length) return done();
      let left = imgs.length; const t = setTimeout(done, 8000);
      imgs.forEach((i) => { const f = () => { if (--left === 0) { clearTimeout(t); done(); } }; i.onload = f; i.onerror = f; });
    })`);
    let data;
    if (format === 'pdf') data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    else {
      win.showInactive();
      await new Promise((r) => setTimeout(r, 400));
      data = (await shootFull(win.webContents, 'Math.ceil(document.body.getBoundingClientRect().bottom + 36)')).data;
    }
    return { ...(await saveFile(data, format, art.title, parent)), bodyOnly: true };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function articleClipText(art) {
  const head = [art.title, [art.site, art.byline].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  return `${head}\n\n${art.text}\n\n출처: ${art.url}`;
}

// 1) 주소 넣기
async function capturePage(url, format, opts = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.');
  const win = hiddenWin();
  try {
    await withTimeout(win.loadURL(url), 30000, '페이지를 30초 안에 불러오지 못했습니다.');
    // 아래쪽까지 한 번 훑어 내려 지연 로딩되는 그림을 불러온다
    await win.webContents.executeJavaScript(`new Promise((done) => {
      let y = 0; const step = () => { y += 700; window.scrollTo(0, y);
        if (y < document.documentElement.scrollHeight && y < 60000) setTimeout(step, 120); else { window.scrollTo(0, 0); setTimeout(done, 800); } };
      step(); })`);
    const art = await extractArticle(win.webContents);
    if (format === 'text') {
      if (!art || !art.text) throw new Error('이 페이지에서 본문을 찾지 못했습니다. "원본 화면 그대로"를 켜고 PDF나 PNG로 저장해 보세요.');
      return { ok: true, text: articleClipText({ ...art, url }), length: art.text.length };
    }
    if (!opts.full && art && art.content && art.text.length > 200) {
      win.destroy();
      return await saveArticle(art, url, format);
    }
    const title = win.webContents.getTitle();
    let data;
    if (format === 'pdf') data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: false });
    else {
      win.showInactive();
      await new Promise((r) => setTimeout(r, 400));
      data = (await shootFull(win.webContents)).data;
    }
    return { ...(await saveFile(data, format, title)), bodyOnly: false };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// 2) 스크랩 창
// 메일·웹앱은 화면 전체가 고정되어 있고 안쪽 상자만 스크롤된다. 그런 상자(와 같은 출처 iframe)를
// 내용 길이만큼 잠깐 늘려 한 장으로 찍은 뒤 원래대로 돌린다.
const EXPAND_JS = `(() => {
  const R = window.__clipRestore = [];
  const seen = new Set();
  const save = (el) => { if (seen.has(el)) return false; seen.add(el); R.push([el, el.getAttribute('style'), el.scrollTop]); return true; };
  const set = (el, k, v) => el.style.setProperty(k, v, 'important');
  const freeAncestors = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (!save(p)) continue;
      const cs = getComputedStyle(p);
      set(p, 'overflow', 'visible'); set(p, 'max-height', 'none'); set(p, 'height', 'auto');
      if (cs.position === 'fixed') set(p, 'position', 'absolute');
      if (cs.position === 'fixed' || cs.position === 'absolute') set(p, 'bottom', 'auto');
    }
  };
  const vw = innerWidth * innerHeight;
  const boxes = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.scrollHeight <= el.clientHeight + 20 || el.clientHeight < 120 || el.clientWidth < 200) return false;
    return /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
  });
  for (const el of boxes) {
    const r = el.getBoundingClientRect();
    if (r.width * Math.min(r.height, innerHeight) < vw * 0.08) continue; // 작은 목록 상자는 두고
    if (!save(el)) continue;
    const h = el.scrollHeight;
    el.scrollTop = 0;
    if (getComputedStyle(el).position === 'fixed') set(el, 'position', 'absolute');
    set(el, 'height', h + 'px'); set(el, 'max-height', 'none'); set(el, 'overflow', 'visible');
    freeAncestors(el);
  }
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument; if (!d || !d.documentElement) continue;
      const r = f.getBoundingClientRect(); if (r.width < 300 || r.height < 150) continue;
      const h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
      if (h <= r.height + 20) continue;
      save(f); set(f, 'height', h + 'px'); set(f, 'max-height', 'none');
      freeAncestors(f);
    } catch (e) { /* 다른 출처 iframe은 건드릴 수 없다 */ }
  }
  for (const el of [document.documentElement, document.body]) { save(el); set(el, 'height', 'auto'); set(el, 'overflow', 'visible'); }
  window.__clipScroll = [scrollX, scrollY];
  window.scrollTo(0, 0);
  return R.length;
})()`;
const RESTORE_JS = `(() => {
  const R = window.__clipRestore || [];
  for (let i = R.length - 1; i >= 0; i--) {
    const [el, st, top] = R[i];
    if (st === null) el.removeAttribute('style'); else el.setAttribute('style', st);
    el.scrollTop = top;
  }
  window.__clipRestore = null;
  if (window.__clipScroll) window.scrollTo(...window.__clipScroll);
})()`;

// ---------- 따로 뜨는 도구 창 (필지 조회 등) ----------
const toolWins = new Map();
function openToolWindow(id, name, color) {
  const old = toolWins.get(id);
  if (old && !old.isDestroyed()) { if (old.isMinimized()) old.restore(); old.show(); old.focus(); return; }
  const size = { parcel: [620, 760] }[id] || [480, 640];
  const win = new BrowserWindow({
    width: size[0], height: size[1], minWidth: 420, minHeight: 360,
    title: name || id, icon: ICON_PATH, autoHideMenuBar: true, backgroundColor: '#1E2534',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'tool.html'), { query: { tool: id, name: name || '', color: color || '' } });
  toolWins.set(id, win);
  win.on('closed', () => toolWins.delete(id));
}

let clipWin = null;
let clipView = null;
const CLIP_BAR = 52; // 위쪽 도구 막대 높이
function sendClipState() {
  if (!clipWin || clipWin.isDestroyed() || !clipView) return;
  const wc = clipView.webContents;
  clipWin.webContents.send('clip:state', {
    url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
    canBack: wc.navigationHistory.canGoBack(), canFwd: wc.navigationHistory.canGoForward(),
  });
}
function layoutClip() {
  if (!clipWin || !clipView) return;
  const [w, h] = clipWin.getContentSize();
  clipView.setBounds({ x: 0, y: CLIP_BAR, width: w, height: Math.max(h - CLIP_BAR, 0) });
}
function openClipWindow(url) {
  const go = /^https?:\/\//i.test(url || '') ? url : null;
  if (clipWin && !clipWin.isDestroyed()) {
    if (go) clipView.webContents.loadURL(go);
    clipWin.show(); clipWin.focus();
    return;
  }
  clipWin = new BrowserWindow({
    width: 1200, height: 900, minWidth: 640, minHeight: 400,
    title: '스크랩 창', icon: ICON_PATH, autoHideMenuBar: true, backgroundColor: '#F3F5F9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  clipWin.on('page-title-updated', (e) => e.preventDefault());
  clipView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: CLIP_PARTITION } });
  const wc = clipView.webContents;
  wc.setUserAgent(plainUA(wc.getUserAgent()));
  clipWin.contentView.addChildView(clipView);
  layoutClip();
  clipWin.on('resize', layoutClip);
  clipWin.on('closed', () => { clipWin = null; clipView = null; });
  // 새 창으로 열리는 링크는 같은 창에서 연다
  wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) wc.loadURL(u); return { action: 'deny' }; });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, sendClipState);
  clipWin.loadFile(path.join(__dirname, 'clip', 'clip.html'));
  wc.loadURL(go || 'https://www.naver.com');
}

async function clipCapture(format, bodyOnly) {
  if (!clipView) throw new Error('스크랩 창이 닫혀 있습니다.');
  const wc = clipView.webContents;
  const url = wc.getURL();
  if (format === 'text') {
    const sel = await selectedText(wc);
    if (sel) return { ok: true, text: sel, length: sel.length, selection: true };
    const art = await extractArticle(wc);
    if (!art || !art.text) throw new Error('본문을 찾지 못했습니다. 복사할 부분을 드래그해서 선택한 뒤 다시 누르세요.');
    return { ok: true, text: articleClipText(art), length: art.text.length };
  }
  if (bodyOnly) {
    const art = await extractArticle(wc);
    if (!art || !art.content || art.text.length < 100) throw new Error('본문을 찾지 못했습니다. "본문만"을 끄고 화면 그대로 저장해 보세요.');
    return await saveArticle(art, url, format, clipWin);
  }
  // 화면 그대로: 안쪽 스크롤 상자를 펼쳐 한 장으로
  const frames = wc.mainFrame.framesInSubtree;
  let shot;
  try {
    for (const f of frames) await f.executeJavaScript(EXPAND_JS).catch(() => 0);
    await new Promise((r) => setTimeout(r, 500));
    shot = await shootFull(wc, 'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
  } finally {
    for (const f of frames) await f.executeJavaScript(RESTORE_JS).catch(() => 0);
  }
  const data = format === 'pdf' ? await pngToPdf(shot.data, shot.width) : shot.data;
  return { ...(await saveFile(data, format, wc.getTitle(), clipWin)), bodyOnly: false, cut: shot.height >= 30000 };
}

// ---------- 키워드 뉴스 알림 (구글 뉴스 RSS) ----------
const NEWS_FILE = () => userFile('news.json');
let newsState = null; // { items: [{ link, title, source, date, kw, read }], first: bool }
function newsCfg() { return { on: true, keywords: [], notify: false, ...(config.news || {}) }; }
function loadNews() {
  if (newsState) return newsState;
  try { newsState = JSON.parse(fs.readFileSync(NEWS_FILE(), 'utf8')); } catch { newsState = { items: [], first: true }; }
  return newsState;
}
function saveNews() { fs.writeFile(NEWS_FILE(), JSON.stringify(newsState), () => {}); }
const xmlText = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
function parseRss(xml, kw) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const get = (tag) => { const r = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return r ? xmlText(r[1]) : ''; };
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = get('link');
    if (link && title) out.push({ link, title, source, date: Date.parse(get('pubDate')) || Date.now(), kw });
  }
  return out;
}
function newsPublic() {
  const st = loadNews();
  const kws = new Set(newsCfg().keywords);
  const items = st.items.filter((i) => kws.has(i.kw)); // 지운 키워드의 기사는 보이지 않게
  return { items, unread: items.filter((i) => !i.read).length, on: newsCfg().on, keywords: newsCfg().keywords };
}
function sendNews() { if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('news:update', newsPublic()); }
async function refreshNews() {
  const cfg = newsCfg(); const st = loadNews();
  if (!cfg.on || !cfg.keywords.length) { sendNews(); return; }
  // seen: 한 번이라도 본 기사 주소 (목록에서 빠지거나 지운 기사가 다시 '새 기사'로 뜨지 않게)
  // kwSeen: 한 번이라도 가져온 키워드 (새로 넣은 키워드의 지난 기사는 읽음으로 처리)
  st.seen = st.seen || st.items.map((i) => i.link);
  st.kwSeen = st.kwSeen || [...new Set(st.items.map((i) => i.kw))];
  const seen = new Set(st.seen);
  const oldest = Date.now() - 14 * 86400000; // 2주 넘은 기사는 받지 않는다
  const fresh = [];
  for (const kw of cfg.keywords) {
    const firstTime = !st.kwSeen.includes(kw);
    try {
      const res = await fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`, 15000);
      if (!res.ok) continue;
      for (const it of parseRss(await res.text(), kw)) {
        if (seen.has(it.link)) continue;
        seen.add(it.link);
        if (it.date <= oldest) continue;
        fresh.push({ ...it, read: firstTime }); // 처음 가져온 키워드는 쌓여 있던 기사를 모두 읽음으로
      }
      if (firstTime) st.kwSeen.push(kw);
    } catch { /* 한 키워드가 실패해도 다음 키워드 계속 */ }
  }
  st.items = [...fresh, ...st.items].filter((i) => i.date > oldest).sort((a, b) => b.date - a.date).slice(0, 80);
  st.seen = [...seen].slice(-3000);
  st.first = false;
  const kept = new Set(st.items.map((i) => i.link));
  const newOnes = fresh.filter((i) => !i.read && kept.has(i.link)); // 실제 목록에 남은 새 기사만 센다
  saveNews();
  sendNews();
  if (cfg.notify && newOnes.length && Notification.isSupported()) {
    const n = new Notification({
      title: `새 기사 ${newOnes.length}건`,
      body: newOnes.slice(0, 3).map((i) => `[${i.kw}] ${i.title}`).join('\n'),
      icon: ICON_PATH,
    });
    n.on('click', () => { if (newOnes.length === 1) shell.openExternal(newOnes[0].link); });
    n.show();
  }
}

// ---------- 필지 조회 (브이월드 오픈API) ----------
// 인증키는 설정 창에서 입력해 이 PC의 설정 파일(config.json)에만 저장한다.
const VW_DOMAIN = 'http://localhost';
function vworldKey() {
  const k = (config.keys && config.keys.vworld) || '';
  if (!k) throw new Error('설정 → 일반 설정 → API 인증키에 브이월드 인증키를 넣어 주세요.');
  return k;
}
async function vworldGet(pathAndQuery) {
  const url = `https://api.vworld.kr${pathAndQuery}&key=${encodeURIComponent(vworldKey())}&domain=${encodeURIComponent(VW_DOMAIN)}&format=json&errorformat=json`;
  const res = await fetchWithTimeout(url, 15000);
  const j = await res.json().catch(() => null);
  if (!j || !j.response) throw new Error(`브이월드 응답을 읽지 못했습니다 (HTTP ${res.status})`);
  const r = j.response;
  if (r.status === 'NOT_FOUND') return null;
  if (r.status !== 'OK') throw new Error(`브이월드 오류: ${(r.error && (r.error.text || r.error.code)) || r.status}`);
  return r;
}
async function vworldSearch(query) {
  const q = encodeURIComponent(query.trim());
  const base = `/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&query=${q}`;
  const out = [];
  for (const [type, category] of [['address', 'parcel'], ['address', 'road'], ['place', null]]) {
    const r = await vworldGet(`${base}&type=${type}${category ? `&category=${category}` : ''}`);
    const items = (r && r.result && r.result.items) || [];
    for (const it of items) {
      const a = it.address || {};
      out.push({
        kind: type === 'place' ? '장소' : category === 'parcel' ? '지번' : '도로명',
        title: type === 'place' ? (it.title || '') : (category === 'parcel' ? a.parcel : a.road) || '',
        sub: type === 'place' ? (a.parcel || a.road || '') : (category === 'parcel' ? (a.road || '') : (a.parcel || '')),
        pnu: category === 'parcel' ? it.id : null,
        x: Number(it.point && it.point.x), y: Number(it.point && it.point.y),
      });
    }
    if (out.length >= 10) break;
  }
  return out.slice(0, 15);
}
async function vworldFeature(layer, x, y, extra = '') {
  const r = await vworldGet(`/req/data?service=data&request=GetFeature&version=2.0&data=${layer}&crs=EPSG:4326&geometry=false&size=10&page=1&geomFilter=${encodeURIComponent(`POINT(${x} ${y})`)}${extra}`);
  const fc = r && r.result && r.result.featureCollection;
  return (fc && fc.features ? fc.features : []).map((f) => f.properties || {});
}
async function vworldParcel(x, y) {
  const info = { x, y, zones: [] };
  // 연속지적도: PNU, 지번(지목 포함), 공시지가
  const p = (await vworldFeature('LP_PA_CBND_BUBUN', x, y))[0];
  if (p) {
    info.pnu = p.pnu; info.addr = p.addr; info.jibun = p.jibun;
    const jm = String(p.jibun || '').match(/([가-힣]+)$/); info.jimok = jm ? jm[1] : '';
    if (p.jiga) info.jiga = Number(p.jiga);
    if (p.gosi_year) info.gosi = `${p.gosi_year}년${p.gosi_month ? ` ${Number(p.gosi_month)}월` : ''}`;
  }
  // 용도지역 (도시·관리·농림·자연환경보전)
  for (const layer of ['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114']) {
    try {
      for (const z of await vworldFeature(layer, x, y)) if (z.uname && !info.zones.includes(z.uname)) info.zones.push(z.uname);
    } catch { /* 레이어 하나 실패는 넘어감 */ }
  }
  return info;
}

// ---------- 관심 법령 개정 알림 (국가법령정보 공동활용 API) ----------
// 법률 이름을 넣으면 그 법의 시행령·시행규칙까지 함께 본다. OC 값은 설정 창에서 입력.
const LAWS_FILE = () => userFile('laws.json');
let lawsState = null; // { known: { 법령명: { mst, prom, enf, kind } }, events: [...], checkedAt, error }
const DEFAULT_LAWS = ['산업입지 및 개발에 관한 법률', '산업집적활성화 및 공장설립에 관한 법률', '공익사업을 위한 토지 등의 취득 및 보상에 관한 법률', '국토의 계획 및 이용에 관한 법률'];
function lawsCfg() { return { on: true, notify: false, items: DEFAULT_LAWS, ...(config.laws || {}) }; }
function loadLaws() {
  if (lawsState) return lawsState;
  try { lawsState = JSON.parse(fs.readFileSync(LAWS_FILE(), 'utf8')); } catch { lawsState = { known: {}, events: [] }; }
  return lawsState;
}
function saveLaws() { fs.writeFile(LAWS_FILE(), JSON.stringify(lawsState), () => {}); }
const squash = (t) => String(t || '').replace(/\s+/g, '');
function lawsPublic() {
  const st = loadLaws(); const cfg = lawsCfg();
  const watched = Object.entries(st.known).map(([name, v]) => ({ name, ...v }))
    .filter((l) => cfg.items.some((w) => squash(l.name).startsWith(squash(w))))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { on: cfg.on, events: st.events, unread: st.events.filter((e) => !e.read).length, watched, checkedAt: st.checkedAt || 0, error: st.error || '' };
}
function sendLaws() { if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('laws:update', lawsPublic()); }
async function refreshLaws() {
  const cfg = lawsCfg(); const st = loadLaws();
  const oc = (config.keys && config.keys.lawOC) || '';
  if (!cfg.on) { sendLaws(); return; }
  if (!oc) { st.error = '설정 → 일반 설정 → API 인증키에 국가법령정보 OC 값을 넣어 주세요.'; sendLaws(); return; }
  const fresh = []; let anyOk = false; st.error = '';
  for (const name of cfg.items) {
    try {
      const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&display=100&query=${encodeURIComponent(name)}`;
      const res = await fetchWithTimeout(url, 15000);
      const text = await res.text();
      let j; try { j = JSON.parse(text); } catch { throw new Error(text.slice(0, 120).replace(/<[^>]+>/g, ' ').trim() || `HTTP ${res.status}`); }
      let list = (j.LawSearch && j.LawSearch.law) || [];
      if (!Array.isArray(list)) list = [list];
      anyOk = true;
      for (const l of list) {
        const lname = l['법령명한글'];
        if (!lname || !squash(lname).startsWith(squash(name))) continue; // 시행령·시행규칙 포함, 다른 법은 제외
        const cur = { mst: String(l['법령일련번호'] || ''), prom: String(l['공포일자'] || ''), enf: String(l['시행일자'] || ''), kind: l['제개정구분명'] || '', dept: l['소관부처명'] || '' };
        const old = st.known[lname];
        if (old && old.mst && cur.mst && old.mst !== cur.mst) {
          fresh.push({ name: lname, ...cur, at: Date.now(), read: false });
        }
        st.known[lname] = cur;
      }
    } catch (err) { st.error = `법령 정보를 가져오지 못했습니다: ${err.message}`; }
  }
  if (anyOk) st.checkedAt = Date.now();
  st.events = [...fresh, ...(st.events || [])].slice(0, 50);
  saveLaws(); sendLaws();
  if (cfg.notify && fresh.length && Notification.isSupported()) {
    new Notification({
      title: `법령 개정 ${fresh.length}건`,
      body: fresh.slice(0, 3).map((e) => `${e.name} (${e.kind || '개정'}, 시행 ${e.enf.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')})`).join('\n'),
      icon: ICON_PATH,
    }).show();
  }
}

// ---------- 공휴일 자동 갱신 (공공데이터포털 한국천문연구원 특일 정보) ----------
const HOL_FILE = () => userFile('holidays.json');
let holState = null; // { dates: ['2026-01-01', ...], names: { '2026-01-01': '1월1일' }, years: [2026, 2027], updatedAt, error }
function loadHol() {
  if (holState) return holState;
  try { holState = JSON.parse(fs.readFileSync(HOL_FILE(), 'utf8')); } catch { holState = { dates: [], names: {}, years: [], updatedAt: 0 }; }
  return holState;
}
async function fetchHolidayYear(key, year) {
  const q = `getRestDeInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&numOfRows=100&_type=json`;
  let res;
  try { res = await fetchWithTimeout(`https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/${q}`, 15000); }
  catch { res = await fetchWithTimeout(`http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/${q}`, 15000); }
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch {
    const msg = (text.match(/<returnAuthMsg>([^<]+)/) || text.match(/<resultMsg>([^<]+)/) || [])[1];
    throw new Error(msg ? `공공데이터포털: ${msg}` : `응답을 읽지 못했습니다 (HTTP ${res.status})`);
  }
  const head = j.response && j.response.header;
  if (head && head.resultCode !== '00') throw new Error(`공공데이터포털: ${head.resultMsg || head.resultCode}`);
  let items = j.response && j.response.body && j.response.body.items && j.response.body.items.item;
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];
  return items.filter((i) => i.isHoliday === 'Y').map((i) => {
    const d = String(i.locdate);
    return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: i.dateName || '' };
  });
}
async function refreshHolidays(force) {
  const st = loadHol();
  const key = (config.keys && config.keys.dataGoKr) || '';
  if (!key) { st.error = '설정 → 일반 설정 → API 인증키에 공공데이터포털 인증키를 넣어 주세요.'; return st; }
  const y = new Date().getFullYear();
  if (!force && st.updatedAt > Date.now() - 7 * 86400000 && st.years.includes(y)) return st;
  const dates = new Set(st.dates.filter((d) => Number(d.slice(0, 4)) < y)); // 지난 해 기록은 남겨 둔다
  const names = { ...st.names }; const years = [];
  st.error = '';
  for (const year of [y, y + 1]) {
    try {
      const list = await fetchHolidayYear(key, year);
      if (list.length) years.push(year);
      for (const h of list) { dates.add(h.date); names[h.date] = h.name; }
    } catch (err) { st.error = err.message; }
  }
  if (years.length) {
    st.dates = [...dates].sort(); st.names = names; st.years = years; st.updatedAt = Date.now();
    fs.writeFile(HOL_FILE(), JSON.stringify(st), () => {});
  }
  return st;
}

// ---------- 여러 필지 한꺼번에 조회 ----------
async function vworldBulkRow(query) {
  const found = await vworldSearch(query);
  const hit = found.find((f) => f.kind === '지번') || found[0];
  if (!hit) return { query, error: '찾지 못함' };
  const d = await vworldParcel(hit.x, hit.y);
  return { query, addr: d.addr || hit.title, jibun: d.jibun || '', jimok: d.jimok || '', zones: d.zones.join(', '), jiga: d.jiga || '', gosi: d.gosi || '', pnu: d.pnu || '', x: d.x, y: d.y };
}

// ---------- 공공데이터포털(국토교통부): 토지 실거래가 · 건축물대장 ----------
function dataKey() {
  const k = (config.keys && config.keys.dataGoKr) || '';
  if (!k) throw new Error('설정 → 일반 설정 → API 인증키에 공공데이터포털 인증키를 넣어 주세요.');
  return k;
}
// 공공데이터포털 응답(XML 또는 JSON)에서 item 목록을 꺼낸다. 태그 이름은 영문(신규)·한글(구버전) 모두 받는다.
function parseDataGoKr(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    const head = j.response && j.response.header;
    if (head && head.resultCode && !['00', '000'].includes(String(head.resultCode))) throw new Error(`공공데이터포털: ${head.resultMsg || head.resultCode}`);
    let items = j.response && j.response.body && j.response.body.items && j.response.body.items.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }
  const auth = t.match(/<returnAuthMsg>([^<]+)/);
  if (auth) throw new Error(`공공데이터포털: ${auth[1]}`);
  const code = t.match(/<resultCode>([^<]+)/);
  if (code && !['00', '000'].includes(code[1].trim())) {
    const msg = t.match(/<resultMsg>([^<]+)/);
    throw new Error(`공공데이터포털: ${msg ? msg[1] : code[1]}`);
  }
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(t))) {
    const o = {}; const fr = /<([^>\/\s]+)>([^<]*)<\/\1>/g; let f;
    while ((f = fr.exec(m[1]))) o[f[1]] = xmlText(f[2]);
    out.push(o);
  }
  return out;
}
async function dataGet(urls) {
  let lastErr;
  for (const u of urls) {
    try {
      const res = await fetchWithTimeout(u, 15000);
      const text = await res.text();
      if (res.status === 404 || /API not found|Unexpected errors/i.test(text)) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return parseDataGoKr(text);
    } catch (err) { lastErr = err; if (/공공데이터포털:/.test(err.message)) throw err; }
  }
  throw lastErr || new Error('응답이 없습니다');
}
const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && String(o[k]).trim() !== '') return String(o[k]).trim(); return ''; };

// 토지 매매 실거래가: PNU 앞 5자리(시군구)로 최근 N개월 조회
async function landTrades(pnu, months = 6) {
  const key = encodeURIComponent(dataKey());
  const lawd = String(pnu).slice(0, 5);
  const now = new Date(); const rows = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const q = `serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`;
    const items = await dataGet([
      `https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade?${q}`,
      `http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcLandTrade?${q}`,
    ]);
    for (const it of items) {
      const amount = Number(pick(it, 'dealAmount', '거래금액').replace(/[^0-9]/g, '')); // 만원
      const area = Number(pick(it, 'dealArea', '거래면적').replace(/[^0-9.]/g, '')); // ㎡
      const y = pick(it, 'dealYear', '년'); const mo = pick(it, 'dealMonth', '월'); const dd = pick(it, 'dealDay', '일');
      if (pick(it, 'cdealType', '해제여부') === 'O') continue; // 해제된 거래는 뺀다
      rows.push({
        date: `${y}.${String(mo).padStart(2, '0')}.${String(dd).padStart(2, '0')}`,
        dong: pick(it, 'umdNm', '법정동'), jibun: pick(it, 'jibun', '지번'),
        jimok: pick(it, 'jimok', '지목'), zone: pick(it, 'landUse', '용도지역'),
        area, amount, unit: area ? Math.round((amount * 10000) / area) : 0,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

// 건축물대장 표제부: PNU로 시군구·법정동·대지구분·번·지를 만든다
async function buildingInfo(pnu) {
  const key = encodeURIComponent(dataKey());
  const p = String(pnu);
  const q = `serviceKey=${key}&sigunguCd=${p.slice(0, 5)}&bjdongCd=${p.slice(5, 10)}&platGbCd=${p[10] === '2' ? '1' : '0'}&bun=${p.slice(11, 15)}&ji=${p.slice(15, 19)}&numOfRows=50&pageNo=1&_type=json`;
  const items = await dataGet([
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?${q}`,
    `https://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?${q}`,
  ]);
  return items.map((it) => ({
    name: [pick(it, 'bldNm'), pick(it, 'dongNm')].filter(Boolean).join(' ') || '(건물명 없음)',
    purpose: pick(it, 'mainPurpsCdNm', 'etcPurps'),
    structure: pick(it, 'strctCdNm'),
    totArea: Number(pick(it, 'totArea')) || 0,
    archArea: Number(pick(it, 'archArea')) || 0,
    platArea: Number(pick(it, 'platArea')) || 0,
    floors: `지상 ${pick(it, 'grndFlrCnt') || 0}층 / 지하 ${pick(it, 'ugrndFlrCnt') || 0}층`,
    approved: pick(it, 'useAprDay'),
    kind: pick(it, 'regstrKindCdNm'),
  }));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:default', () => readDefaultConfig());
  ipcMain.handle('config:save', (e, cfg) => {
    const before = JSON.stringify(weatherCfg()); // 바꾸기 전 날씨 설정
    const newsBefore = JSON.stringify(newsCfg());
    const holKeyBefore = config.keys && config.keys.dataGoKr;
    const lawsBefore = JSON.stringify([lawsCfg(), config.keys && config.keys.lawOC]);
    config = cfg;
    writeConfig(cfg);
    applyAwake();
    if (JSON.stringify(weatherCfg()) !== before) refreshWeather();
    if (JSON.stringify(newsCfg()) !== newsBefore) refreshNews();
    if ((cfg.keys && cfg.keys.dataGoKr) && (cfg.keys.dataGoKr !== holKeyBefore)) refreshHolidays(true);
    if (JSON.stringify([lawsCfg(), config.keys && config.keys.lawOC]) !== lawsBefore) refreshLaws();
    if (dockWin) dockWin.webContents.send('config:changed', cfg);
    return true;
  });
  ipcMain.handle('config:openFolder', () => shell.openPath(app.getPath('userData')));

  ipcMain.on('dock:ignoreMouse', (e, ignore) => {
    if (!dockWin) return;
    if (ignore) dockWin.setIgnoreMouseEvents(true, { forward: true });
    else dockWin.setIgnoreMouseEvents(false);
  });
  ipcMain.on('dock:focus', () => dockWin && dockWin.focus());

  ipcMain.handle('item:open', async (e, item) => {
    try {
      const target = resolveTarget(item.target).trim();
      if (!target) throw new Error('대상이 비어 있습니다.');
      if (item.type === 'url') {
        if (!/^https?:\/\//i.test(target)) throw new Error('http:// 또는 https:// 로 시작하는 주소만 열 수 있습니다.');
        await shell.openExternal(target);
      } else if (item.type === 'folder') {
        const err = await shell.openPath(target);
        if (err) throw new Error(err);
      } else if (item.type === 'app') {
        if (isProtocol(target)) {
          await shell.openExternal(target);
        } else if (/\.exe$/i.test(target)) {
          const exe = findExecutable(target) || target;
          await new Promise((resolve, reject) => {
            const child = spawn(exe, item.args || [], { detached: true, stdio: 'ignore', cwd: path.isAbsolute(exe) ? path.dirname(exe) : undefined });
            child.once('error', reject);
            child.once('spawn', () => { child.unref(); resolve(); });
          });
        } else {
          const err = await shell.openPath(target); // 바로가기(.lnk), 문서 파일 등
          if (err) throw new Error(err);
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  });

  ipcMain.handle('icon:file', async (e, target) => {
    try {
      const resolved = resolveTarget(target);
      if (isProtocol(resolved)) return null;
      const full = findExecutable(resolved) || resolved;
      if (!fs.existsSync(full)) return null;
      const img = await app.getFileIcon(full, { size: 'large' });
      return img.isEmpty() ? null : img.toDataURL();
    } catch { return null; }
  });

  ipcMain.handle('icon:site', async (e, url, refresh) => {
    const cache = getIconCache();
    if (!refresh && url in cache) return cache[url];
    const data = await findSiteIcon(url);
    cache[url] = data;
    fs.writeFile(ICON_CACHE_FILE(), JSON.stringify(cache), () => {});
    return data;
  });

  ipcMain.handle('icon:pickImage', async () => {
    const r = await dialog.showOpenDialog(settingsWin, {
      title: '아이콘 이미지 선택',
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'svg', 'ico', 'webp'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', webp: 'image/webp' }[ext] || 'image/png';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  });

  ipcMain.handle('dialog:pickPath', async (e, kind) => {
    const r = await dialog.showOpenDialog(settingsWin, kind === 'folder'
      ? { title: '폴더 선택', properties: ['openDirectory'] }
      : { title: '프로그램 선택', properties: ['openFile'], filters: [{ name: '프로그램', extensions: ['exe', 'lnk', 'bat', 'cmd'] }, { name: '모든 파일', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (e, text) => { clipboard.writeText(String(text)); return true; });
  ipcMain.handle('clipboard:history', () => clipHistory.slice());
  ipcMain.handle('clipboard:clearHistory', () => { clipHistory.length = 0; return true; });

  ipcMain.handle('memo:load', () => {
    try { return fs.readFileSync(userFile('memo.txt'), 'utf8'); } catch { return ''; }
  });
  ipcMain.handle('memo:save', (e, text) => { fs.writeFileSync(userFile('memo.txt'), String(text), 'utf8'); return true; });

  ipcMain.on('notify', (e, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON_PATH }).show();
  });

  ipcMain.handle('capture:page', async (e, url, format, opts) => {
    try { return await capturePage(String(url).trim(), format, opts || {}); } catch (err) { return { ok: false, message: err.message || String(err) }; }
  });
  ipcMain.handle('tool:window', (e, id, name, color) => { openToolWindow(String(id), String(name || ''), String(color || '')); return true; });
  ipcMain.handle('clip:open', (e, url) => { openClipWindow(String(url || '').trim()); return true; });
  ipcMain.handle('clip:capture', async (e, format, bodyOnly) => {
    try { return await clipCapture(format, !!bodyOnly); } catch (err) { return { ok: false, message: err.message || String(err) }; }
  });
  ipcMain.handle('clip:nav', (e, action, url) => {
    if (!clipView) return false;
    const wc = clipView.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'fwd' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'go') {
      let u = String(url || '').trim();
      if (!u) return false;
      if (!/^https?:\/\//i.test(u)) u = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(u) ? `https://${u}` : `https://search.naver.com/search.naver?query=${encodeURIComponent(u)}`;
      wc.loadURL(u);
    }
    return true;
  });
  ipcMain.handle('clip:state', () => { sendClipState(); return true;
  });
  ipcMain.handle('vworld:search', async (e, q) => {
    try { return { ok: true, items: await vworldSearch(String(q)) }; } catch (err) { return { ok: false, message: err.message }; }
  });
  ipcMain.handle('vworld:parcel', async (e, x, y) => {
    try { return { ok: true, info: await vworldParcel(Number(x), Number(y)) }; } catch (err) { return { ok: false, message: err.message }; }
  });
  ipcMain.handle('vworld:bulkRow', async (e, q) => {
    try { return await vworldBulkRow(String(q)); } catch (err) { return { query: q, error: err.message }; }
  });
  ipcMain.handle('land:trades', async (e, pnu, months) => {
    try { return { ok: true, rows: await landTrades(String(pnu), Number(months) || 6) }; } catch (err) { return { ok: false, message: err.message }; }
  });
  ipcMain.handle('land:building', async (e, pnu) => {
    try { return { ok: true, items: await buildingInfo(String(pnu)) }; } catch (err) { return { ok: false, message: err.message }; }
  });
  ipcMain.handle('holidays:get', () => loadHol());
  ipcMain.handle('holidays:refresh', (e, force) => refreshHolidays(!!force));
  ipcMain.handle('laws:get', () => lawsPublic());
  ipcMain.handle('laws:refresh', () => refreshLaws());
  ipcMain.handle('laws:read', () => { const st = loadLaws(); st.events.forEach((e) => { e.read = true; }); saveLaws(); sendLaws(); return true; });
  ipcMain.handle('news:get', () => newsPublic());
  ipcMain.handle('news:refresh', () => refreshNews());
  // 뉴스 창에서 바로 키워드 추가·삭제
  ipcMain.handle('news:setKeywords', async (e, list) => {
    const keywords = [...new Set((list || []).map((k) => String(k).trim()).filter(Boolean))].slice(0, 10);
    config.news = { ...newsCfg(), keywords };
    writeConfig(config);
    const st = loadNews();
    st.items = st.items.filter((i) => keywords.includes(i.kw));
    saveNews();
    sendNews();
    refreshNews();
    return newsPublic();
  });
  ipcMain.handle('news:clear', () => { const st = loadNews(); st.items = []; saveNews(); sendNews(); return newsPublic(); });
  ipcMain.handle('laws:clear', () => { const st = loadLaws(); st.events = []; saveLaws(); sendLaws(); return lawsPublic(); });
  ipcMain.handle('news:read', (e, link) => {
    const st = loadNews();
    for (const i of st.items) if (link === '*' || i.link === link) i.read = true;
    saveNews(); sendNews(); return true;
  });
  ipcMain.handle('weather:get', () => weatherState);
  ipcMain.handle('weather:cities', () => CITIES.map((c) => c.name));
  ipcMain.handle('weather:search', (e, q) => weatherSearch(q));
  ipcMain.handle('weather:refresh', () => refreshWeather());

  ipcMain.handle('awake:get', () => awakeState());
  ipcMain.handle('awake:toggle', () => toggleAwake());

  ipcMain.on('settings:open', openSettings);
  ipcMain.on('settings:dirty', (e, d) => { settingsDirty = !!d; });
  ipcMain.on('settings:close', () => { settingsDirty = false; if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); });

  const loginPath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  ipcMain.handle('login:get', () => app.getLoginItemSettings({ path: loginPath() }).openAtLogin);
  ipcMain.handle('login:set', (e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, path: loginPath() });
    return app.getLoginItemSettings({ path: loginPath() }).openAtLogin;
  });
}

// ---------- 시작 ----------
// 이미 실행 중이면 새로 켠 쪽은 종료된다. 이때 버전이 다르면(새 버전을 받아 실행한 경우)
// 기존 툴바가 스스로 꺼지고 새 버전을 대신 실행해 준다.
const instanceInfo = { version: app.getVersion(), exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath };
if (!app.requestSingleInstanceLock(instanceInfo)) {
  app.quit();
} else {
  app.on('second-instance', (e, argv, cwd, other) => {
    if (other && other.version && other.version !== app.getVersion() && other.exe && fs.existsSync(other.exe)) {
      app.releaseSingleInstanceLock();
      spawn(other.exe, [], { detached: true, stdio: 'ignore' }).unref();
      app.quit();
      return;
    }
    if (dockWin) dockWin.showInactive();
  });
  app.setAppUserModelId('kr.toolbar.outside');
  app.whenReady().then(() => {
    config = loadConfig();
    registerIpc();
    createDock();
    createTray();
    watchClipboard();
    applyAwake();
    setInterval(applyAwake, 20000);
    refreshWeather();
    setInterval(refreshWeather, 30 * 60 * 1000);
    setTimeout(refreshNews, 8000);
    // 법령 개정은 하루에 한 번만 확인 (마지막 확인 후 24시간이 지났을 때만)
    const lawsDaily = () => { if (Date.now() - (loadLaws().checkedAt || 0) >= 23.5 * 3600000) refreshLaws(); else sendLaws(); };
    setTimeout(lawsDaily, 20000);
    setTimeout(() => refreshHolidays(false), 12000);
    setInterval(() => refreshHolidays(false), 24 * 60 * 60 * 1000);
    setInterval(lawsDaily, 60 * 60 * 1000);
    setInterval(refreshNews, 30 * 60 * 1000);
    powerMonitor.on('resume', () => { setTimeout(refreshWeather, 5000); setTimeout(refreshNews, 15000); });
    screen.on('display-metrics-changed', placeDock);
    screen.on('display-added', placeDock);
    screen.on('display-removed', placeDock);
  });
  app.on('window-all-closed', () => { /* 설정 창을 닫아도 툴바는 계속 실행 */ });
}
