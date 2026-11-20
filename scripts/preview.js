// 개발용: Electron 없이 브라우저에서 툴바 화면을 띄워 스크린샷을 찍는다.
// 사용: node scripts/preview.js <출력폴더>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const out = process.argv[2] || 'preview-out';
fs.mkdirSync(out, { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'default-config.json'), 'utf8'));

const mock = (cfg) => {
  let awake = { on: true, enabled: true, quiet: false, quietText: '11:30~13:00' };
  window.api = {
    getConfig: async () => cfg, getDefaultConfig: async () => cfg, saveConfig: async () => true,
    openConfigFolder: async () => {}, onConfigChanged: () => {},
    setIgnoreMouse: () => {}, focusDock: () => {}, onBlur: () => {}, hideDock: () => {},
    openItem: async () => ({ ok: true }), fileIcon: async () => null, siteIcon: async () => null,
    pickImage: async () => null, pickPath: async () => null,
    readClipboard: async () => '복사해 둔 글이\n여러 줄로   나뉘어\n있습니다.',
    writeClipboard: async () => true,
    clipHistory: async () => ['2026년 산업단지 현황 보고', 'https://www.law.go.kr', '담당자 연락처 정리'],
    clearClipHistory: async () => true, loadMemo: async () => '오후 3시 회의 자료 확인', saveMemo: async () => true,
    getAwake: async () => awake, toggleAwake: async () => { awake = { ...awake, on: !awake.on, enabled: !awake.on }; return awake; },
    onAwake: () => {},
    getWeather: async () => ({ city: '서울', temp: 12.4, code: 2, isDay: true, max: 15, min: 4 }),
    weatherCities: async () => ['서울', '부산', '김천'], refreshWeather: async () => {}, onWeather: () => {},
    setSettingsDirty: () => {}, onSaveRequest: () => {}, closeSettings: () => {}, notify: () => {}, openSettings: () => {}, quit: () => {}, getLogin: async () => false, setLogin: async (v) => v,
  };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  await page.addInitScript(mock, cfg);
  await page.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  // 바탕화면 느낌의 배경 (미리보기 전용)
  await page.addStyleTag({ content: 'html{background:linear-gradient(160deg,#6d8fb5,#c9d6e3 55%,#e9e4d8)}' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/1-idle.png` });
  await page.hover('#cats [data-id="admin"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/2b-cathover.png` });
  await page.hover('#weather');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/2-hover.png` });
  for (const [i, id] of [['3', 'admin'], ['4', 'utils']]) {
    await page.click(`#cats [data-id="${id}"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${i}-${id}.png` });
    await page.hover('#pop .tile >> nth=1');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${i}-${id}-tip.png` });
  }
  await page.click('#pop .tile >> nth=3'); // 금액 한글 표기
  await page.waitForTimeout(400);
  await page.fill('#km-in', '113560');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/4b-krmoney.png` });
  console.log('money:', await page.$$eval('.money-row .mv', (e) => e.map((x) => x.textContent)));
  await page.click('.panel .back');
  await page.waitForTimeout(500);
  await page.click('#pop .tile >> nth=2'); // 단위 환산
  await page.waitForTimeout(400);
  await page.fill('.unit-row:nth-child(2) input', '1000');
  await page.dispatchEvent('.unit-row:nth-child(2) input', 'input');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/4c-unit.png` });
  console.log('units:', await page.$$eval('.unit-row input', (e) => e.map((x) => x.value)));
  await page.click('.panel .back');
  await page.waitForTimeout(500);
  await page.click('#pop .tile >> nth=1'); // 날짜 계산
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/5-datecalc.png` });
  await page.click('.seg button[data-m="deadline"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/6-deadline.png` });
  // 애니메이션 중간 프레임
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#cats [data-id="trip"]');
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/7-anim-mid.png` });
  const errs = [];
  const sp = await browser.newPage({ viewport: { width: 860, height: 640 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  sp.on('pageerror', (e) => errs.push(e.message));
  await sp.addInitScript(mock, cfg);
  await sp.goto('file://' + path.join(__dirname, '..', 'src', 'settings', 'settings.html'));
  await sp.waitForTimeout(400);
  await sp.screenshot({ path: `${out}/8-settings.png` });
  await sp.click('#nav-general');
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: `${out}/9-settings-general.png` });
  await browser.close();
  console.log('done', errs);
})();
