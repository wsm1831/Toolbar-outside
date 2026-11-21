// 업무 툴바 - Electron 메인 프로세스
// 화면 아래(작업 표시줄 바로 위)에 투명한 창을 띄우고, 독(dock) 영역 위에서만 마우스를 받는다.
const {
  app, BrowserWindow, ipcMain, screen, shell, clipboard, Tray, Menu,
  nativeImage, Notification, dialog, net, powerSaveBlocker, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WINDOW_HEIGHT = 600; // 독 + 튀어오르는 메뉴/패널이 들어갈 높이
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
    def.categories.forEach((c) => c.items.forEach((it) => defItems.set(it.id, it)));
    next.categories = cfg.categories.map((c) => ({
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
    const hasItem = (id) => next.categories.some((c) => c.items.some((it) => it.id === id));
    if (pinned && !hasItem('news')) pinned.items.push(defCat('quick').items.find((it) => it.id === 'news'));
    const ai = next.categories.find((c) => c.id === 'ai');
    if (ai) for (const id of ['github', 'netlify', 'cloudflare']) if (!hasItem(id)) ai.items.push(defCat('ai').items.find((it) => it.id === id));
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
  const city = CITIES.find((c) => c.name === w.city) || CITIES[0];
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1';
  try {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    weatherState = {
      city: city.name,
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
function sendWeather() {
  if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('weather:update', weatherState);
}

// ---------- 웹페이지 전체 저장 (PDF / 이미지) ----------
// 주소를 숨은 창에 열고, 아래쪽까지 한 번 훑어 내려 지연 로딩되는 그림을 불러온 뒤 저장한다.
async function capturePage(url, format) {
  if (!/^https?:\/\//i.test(url)) throw new Error('http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.');
  // 이미지 저장은 화면이 실제로 그려져야 하므로, 화면 밖에 투명·비활성 창으로 띄운다
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900, x: -30000, y: 0,
    frame: false, skipTaskbar: true, focusable: false, opacity: 0, paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms))]);
  try {
    win.webContents.setAudioMuted(true);
    await Promise.race([
      win.loadURL(url),
      new Promise((_, no) => setTimeout(() => no(new Error('페이지를 30초 안에 불러오지 못했습니다.')), 30000)),
    ]);
    await win.webContents.executeJavaScript(`new Promise((done) => {
      let y = 0; const step = () => { y += 700; window.scrollTo(0, y);
        if (y < document.documentElement.scrollHeight && y < 60000) setTimeout(step, 120); else { window.scrollTo(0, 0); setTimeout(done, 800); } };
      step(); })`);
    if (format === 'text') {
      // 본문만 뽑기: Mozilla Readability(Firefox 읽기 모드)로 기사 본문을 찾고, 문단 줄바꿈을 살려 글자로 만든다
      const lib = fs.readFileSync(path.join(__dirname, 'vendor', 'readability', 'Readability.js'), 'utf8');
      const r = await win.webContents.executeJavaScript(`${lib}
;(() => {
  const a = new Readability(document.cloneNode(true)).parse();
  if (!a || !a.content) return null;
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;white-space:normal';
  box.innerHTML = a.content;
  document.body.appendChild(box);
  const text = box.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
  box.remove();
  return { title: a.title || document.title, byline: a.byline || '', site: a.siteName || '', text };
})()`);
      if (!r || !r.text) throw new Error('이 페이지에서 본문을 찾지 못했습니다. PDF나 이미지로 저장해 보세요.');
      return { ok: true, ...r, url };
    }
    const title = (win.webContents.getTitle() || 'webpage').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'webpage';
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    let data; let ext;
    if (format === 'pdf') {
      data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: false });
      ext = 'pdf';
    } else {
      win.setPosition(-30000, 0);
      win.showInactive();
      await new Promise((r) => setTimeout(r, 400));
      const dbg = win.webContents.debugger;
      dbg.attach('1.3');
      const m = await dbg.sendCommand('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const width = Math.ceil(Math.min(size.width, 1600));
      const height = Math.ceil(Math.min(size.height, 30000)); // 너무 긴 페이지는 30000px에서 자름
      const shot = await withTimeout(dbg.sendCommand('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 },
      }), 40000, '이미지를 만드는 데 너무 오래 걸립니다. PDF로 저장해 보세요.');
      dbg.detach();
      data = Buffer.from(shot.data, 'base64');
      ext = 'png';
    }
    const r = await dialog.showSaveDialog({
      title: format === 'pdf' ? 'PDF로 저장' : '이미지로 저장',
      defaultPath: path.join(app.getPath('downloads'), `${title}_${stamp}.${ext}`),
      filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PNG 이미지', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, data);
    shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// ---------- 키워드 뉴스 알림 (구글 뉴스 RSS) ----------
const NEWS_FILE = () => userFile('news.json');
let newsState = null; // { items: [{ link, title, source, date, kw, read }], first: bool }
function newsCfg() { return { on: true, keywords: ['산업단지', '산단 개발', '토지보상'], notify: true, ...(config.news || {}) }; }
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
  return { items: st.items, unread: st.items.filter((i) => !i.read).length, on: newsCfg().on, keywords: newsCfg().keywords };
}
function sendNews() { if (dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('news:update', newsPublic()); }
async function refreshNews() {
  const cfg = newsCfg(); const st = loadNews();
  if (!cfg.on || !cfg.keywords.length) { sendNews(); return; }
  const known = new Set(st.items.map((i) => i.link));
  const fresh = [];
  for (const kw of cfg.keywords) {
    try {
      const res = await fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`, 15000);
      if (!res.ok) continue;
      for (const it of parseRss(await res.text(), kw)) {
        if (known.has(it.link)) continue;
        known.add(it.link);
        fresh.push({ ...it, read: !!st.first }); // 처음 한 번은 쌓여 있던 기사를 모두 읽음으로
      }
    } catch { /* 한 키워드가 실패해도 다음 키워드 계속 */ }
  }
  const weekAgo = Date.now() - 14 * 86400000;
  st.items = [...fresh, ...st.items].filter((i) => i.date > weekAgo).sort((a, b) => b.date - a.date).slice(0, 80);
  const newOnes = fresh.filter((i) => !i.read);
  if (st.first && fresh.length) st.first = false;
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

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:default', () => readDefaultConfig());
  ipcMain.handle('config:save', (e, cfg) => {
    const before = JSON.stringify(weatherCfg()); // 바꾸기 전 날씨 설정
    const newsBefore = JSON.stringify(newsCfg());
    config = cfg;
    writeConfig(cfg);
    applyAwake();
    if (JSON.stringify(weatherCfg()) !== before) refreshWeather();
    if (JSON.stringify(newsCfg()) !== newsBefore) refreshNews();
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

  ipcMain.handle('capture:page', async (e, url, format) => {
    try { return await capturePage(String(url).trim(), format); } catch (err) { return { ok: false, message: err.message || String(err) }; }
  });
  ipcMain.handle('news:get', () => newsPublic());
  ipcMain.handle('news:refresh', () => refreshNews());
  ipcMain.handle('news:read', (e, link) => {
    const st = loadNews();
    for (const i of st.items) if (link === '*' || i.link === link) i.read = true;
    saveNews(); sendNews(); return true;
  });
  ipcMain.handle('weather:get', () => weatherState);
  ipcMain.handle('weather:cities', () => CITIES.map((c) => c.name));
  ipcMain.handle('weather:refresh', () => refreshWeather());

  ipcMain.handle('awake:get', () => awakeState());
  ipcMain.handle('awake:toggle', () => toggleAwake());

  ipcMain.on('settings:open', openSettings);
  ipcMain.on('settings:dirty', (e, d) => { settingsDirty = !!d; });
  ipcMain.on('settings:close', () => { settingsDirty = false; if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('dock:hide', () => dockWin && dockWin.hide());

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
    setInterval(refreshNews, 30 * 60 * 1000);
    powerMonitor.on('resume', () => { setTimeout(refreshWeather, 5000); setTimeout(refreshNews, 15000); });
    screen.on('display-metrics-changed', placeDock);
    screen.on('display-added', placeDock);
    screen.on('display-removed', placeDock);
  });
  app.on('window-all-closed', () => { /* 설정 창을 닫아도 툴바는 계속 실행 */ });
}
