// 대한민국 공휴일 기본 계산 (공공데이터포털 인증키가 없어도 달력·날짜 계산에 휴일이 나오게).
// 인증키가 있으면 한국천문연구원 특일 정보가 이 값보다 우선한다.
// 음력 명절은 표로 넣어 두었다(2025~2030). 대체공휴일은 「관공서의 공휴일에 관한 규정」 제3조를 따른다.
const LUNAR = {
  2025: { seol: '2025-01-29', buddha: '2025-05-05', chuseok: '2025-10-06' },
  2026: { seol: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
  2027: { seol: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
  2028: { seol: '2028-01-27', buddha: '2028-05-02', chuseok: '2028-10-03' },
  2029: { seol: '2029-02-13', buddha: '2029-05-20', chuseok: '2029-09-22' },
  2030: { seol: '2030-02-03', buddha: '2030-05-09', chuseok: '2030-09-12' },
};
// 선거일·임시공휴일 (정해진 것만)
const EXTRA = {
  '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거일',
  '2026-06-03': '전국동시지방선거일', '2028-04-12': '국회의원선거일',
};

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function krHolidays(year) {
  const names = {}; // 'YYYY-MM-DD' → 이름
  const put = (k, n) => { names[k] = names[k] ? `${names[k]}·${n}` : n; };
  const fixed = [['01-01', '1월1일'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'],
    ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '기독탄신일']];
  for (const [md, n] of fixed) put(`${year}-${md}`, n);
  const L = LUNAR[year];
  const groups = []; // 대체공휴일 판단 묶음
  if (L) {
    for (const [k, n] of [['seol', '설날'], ['chuseok', '추석']]) {
      const c = parse(L[k]);
      const days = [add(c, -1), c, add(c, 1)].map(key);
      days.forEach((d) => put(d, n));
      groups.push({ days, sundayOnly: true });
    }
    put(L.buddha, '부처님오신날');
  }
  for (const [k, n] of Object.entries(EXTRA)) if (k.startsWith(`${year}-`)) put(k, n);
  // 토·일 또는 다른 공휴일과 겹치면 대체공휴일이 생기는 날 (1월1일·현충일은 제외)
  for (const md of ['03-01', '05-05', '08-15', '10-03', '10-09', '12-25']) groups.push({ days: [`${year}-${md}`], sundayOnly: false });
  if (L) groups.push({ days: [L.buddha], sundayOnly: false });

  const count = {}; // 같은 날 겹친 공휴일 수
  for (const g of groups) for (const d of g.days) count[d] = (count[d] || 0) + 1;
  const isOff = (d) => d.getDay() === 0 || d.getDay() === 6 || names[key(d)];
  const subs = [];
  const usedOverlap = new Set(); // 겹친 날 하나에는 대체공휴일도 하루만 (예: 2025년 어린이날·부처님오신날 → 5/6 하루)
  for (const g of groups.sort((a, b) => a.days[0].localeCompare(b.days[0]))) {
    const weekend = g.days.some((d) => { const wd = parse(d).getDay(); return wd === 0 || (!g.sundayOnly && wd === 6); });
    const overlaps = g.days.filter((d) => count[d] > 1 && !usedOverlap.has(d));
    if (!weekend && !overlaps.length) continue;
    overlaps.forEach((d) => usedOverlap.add(d));
    let d = add(parse(g.days[g.days.length - 1]), 1);
    while (isOff(d) || subs.includes(key(d))) d = add(d, 1);
    subs.push(key(d));
    names[key(d)] = '대체공휴일';
  }
  return names;
}

// 여러 해를 한꺼번에: { dates: [...], names: {...} }
function krHolidayRange(fromYear, toYear) {
  const names = {};
  for (let y = fromYear; y <= toYear; y++) Object.assign(names, krHolidays(y));
  return { dates: Object.keys(names).sort(), names };
}

if (typeof module !== 'undefined') module.exports = { krHolidays, krHolidayRange };
