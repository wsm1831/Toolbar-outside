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
    getWeather: async () => ({ city: '서울', temp: 12.4, code: 2, isDay: true, max: 15, min: 4, air: { pm10: 42, pm25: 21, grade: 1 } }),
    getNews: async () => ({ on: true, unread: 3, keywords: ['산업단지', '산단 개발', '토지보상'], items: [
      { link: 'a', title: '노후 산업단지 재생사업 공모 착수… 올해 5곳 선정', source: '테스트일보', kw: '산업단지', date: Date.now() - 20 * 60000, read: false },
      { link: 'b', title: '스마트그린산단 확대, 입주기업 에너지 비용 절감 효과', source: '한국경제', kw: '산업단지', date: Date.now() - 90 * 60000, read: false },
      { link: 'c', title: '공익사업 토지보상 기준 개선안 입법예고', source: '연합뉴스', kw: '토지보상', date: Date.now() - 5 * 3600000, read: false },
      { link: 'd', title: '지역 산단 개발 계획 주민설명회 개최', source: '지역신문', kw: '산단 개발', date: Date.now() - 26 * 3600000, read: true }] }),
    vworldSearch: async () => ({ ok: true, items: [{ kind: '지번', title: '경상북도 김천시 율곡동 1052', sub: '경상북도 김천시 혁신8로 77', x: 128.1747, y: 36.1076 }] }),
    vworldParcel: async () => ({ ok: true, info: { x: 128.1747, y: 36.1076, zones: ['일반상업지역'], pnu: '4715010700110520000', addr: '경상북도 김천시 율곡동 1052', jibun: '1052 대', jimok: '대', jiga: 1234000, gosi: '2026년 1월' } }),
    getLaws: async () => ({ on: true, unread: 1, checkedAt: Date.now(), error: '',
      events: [{ name: '산업입지 및 개발에 관한 법률', kind: '일부개정', prom: '20261120', enf: '20270521', mst: '1', read: false }],
      watched: [
        { name: '공익사업을 위한 토지 등의 취득 및 보상에 관한 법률', kind: '일부개정', prom: '20260310', enf: '20260911', mst: '2' },
        { name: '산업입지 및 개발에 관한 법률', kind: '일부개정', prom: '20261120', enf: '20270521', mst: '1' },
        { name: '산업입지 및 개발에 관한 법률 시행령', kind: '일부개정', prom: '20250301', enf: '20250701', mst: '3' }] }),
    getHolidays: async () => ({ dates: ['2026-11-23'], names: {}, years: [2026, 2027], updatedAt: Date.now() }), refreshHolidays: async () => ({ dates: [], years: [], updatedAt: 0 }),
    refreshLaws: async () => {}, readLaws: async () => true, onLaws: () => {},
    refreshNews: async () => {}, readNews: async () => true, onNews: () => {},
    weatherCities: async () => ['서울', '부산', '김천'], refreshWeather: async () => {}, onWeather: () => {},
    capturePage: async () => ({ ok: true, file: 'C:\\Users\\me\\Downloads\\기사_20261121.pdf' }),
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
  await page.hover('.tile-cat[data-id="admin"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/2b-cathover.png` });
  await page.hover('#weather');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/2-hover.png` });
  for (const [i, id] of [['3', 'ai'], ['4', 'utils']]) {
    await page.click(`.tile-cat[data-id="${id}"]`);
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
  await page.click('.tile-cat[data-id="trip"]');
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/7-anim-mid.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#quick [data-qid="webcapture"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/7b-webcapture.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#quick [data-qid="news"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/7c-news.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('.tile-cat[data-id="utils"]');
  await page.waitForTimeout(600);
  await page.click('#pop .tile >> nth=0');
  await page.waitForTimeout(300);
  await page.fill('#pc-q', '율곡동 1052');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.click('.pc-list button');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/7d-parcel.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#quick [data-qid="laws"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/7e-laws.png` });
  const errs = [];
  const sp = await browser.newPage({ viewport: { width: 1000, height: 680 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  sp.on('pageerror', (e) => errs.push(e.message));
  await sp.addInitScript(mock, cfg);
  await sp.goto('file://' + path.join(__dirname, '..', 'src', 'settings', 'settings.html'));
  await sp.waitForTimeout(400);
  await sp.screenshot({ path: `${out}/8a-settings-start.png` });
  await sp.click('#cat-list li:nth-child(5) .nav');
  await sp.waitForTimeout(400);
  await sp.screenshot({ path: `${out}/8-settings.png` });
  await sp.click('#nav-general');
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: `${out}/9-settings-general.png` });
  await browser.close();
  console.log('done', errs);
})();
