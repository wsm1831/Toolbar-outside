// lucide-static(ISC 라이선스)에서 필요한 아이콘만 뽑아 src/shared/icons.js 로 만든다.
// 사용: node scripts/build-icons.js
const fs = require('fs');
const path = require('path');
const names = ['globe','wrench','folder','folder-open','sparkles','settings','sticky-note','calendar-days','timer',
  'remove-formatting','clipboard-list','spell-check','languages','calculator','scissors','file-text','house','star',
  'briefcase','book-open','link','x','chevron-left','copy','trash-2','plus','arrow-up','arrow-down','terminal',
  'monitor','image','download','pencil','bell','clock','search','mail','building-2','scale','landmark','map',
  'newspaper','app-window','power','eye-off','notebook-pen','paintbrush','activity','layout-grid','check','grip-vertical','factory','train-front','ruler','banknote','car-front','map-pinned','sun','moon','cloud-sun','cloud-moon','cloud','cloud-fog','cloud-drizzle','cloud-rain','cloud-snow','cloud-lightning'];
const dir = path.dirname(require.resolve('lucide-static/package.json')) + '/icons';
const out = {};
for (const n of names) {
  const svg = fs.readFileSync(path.join(dir, n + '.svg'), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '');
  out[n] = inner;
}
fs.mkdirSync('src/shared', { recursive: true });
fs.writeFileSync('src/shared/icons.js',
  '// 자동 생성 파일 (scripts/build-icons.js). 아이콘 출처: Lucide (ISC License)\n' +
  'window.ICONS = ' + JSON.stringify(out, null, 1) + ';\n' +
  'window.icon = (name, size = 24) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONS[name] || window.ICONS["link"]}</svg>`;\n');
console.log('icons:', Object.keys(out).length);
