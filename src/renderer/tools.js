// 유틸리티 패널들. 각 도구는 render(본문 요소, { api, config, showToast }) 를 가진다.
(() => {
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmt = (d) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${DAYS[d.getDay()]})`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const DAY = 86400000;
  const diffDays = (a, b) => Math.round((b - a) / DAY);

  // ---------- 빠른 메모 ----------
  const memo = {
    icon: 'notebook-pen',
    async render(el, { api }) {
      el.append(h(`
        <textarea rows="10" placeholder="생각나는 것을 적어 두세요. 자동으로 저장됩니다."></textarea>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="muted status"></span>
          <button class="btn ghost copy">전체 복사</button>
        </div>`));
      const ta = el.querySelector('textarea');
      const status = el.querySelector('.status');
      ta.value = await api.loadMemo();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      let t = null;
      ta.addEventListener('input', () => {
        status.textContent = '저장 중…';
        clearTimeout(t);
        t = setTimeout(async () => { await api.saveMemo(ta.value); status.textContent = '저장됨'; }, 400);
      });
      el.querySelector('.copy').addEventListener('click', async () => {
        await api.writeClipboard(ta.value);
        status.textContent = '복사했습니다';
      });
    },
  };

  // ---------- 날짜 계산 ----------
  let dateMode = 'dday';
  const datecalc = {
    icon: 'calendar-days',
    render(el, { config }) {
      const holidays = new Set(config.holidays || []);
      const isOff = (d) => d.getDay() === 0 || d.getDay() === 6 || holidays.has(ymd(d));
      const nextWorkday = (d) => { let x = d; while (isOff(x)) x = addDays(x, 1); return x; };
      const workdaysBetween = (a, b) => { // a 다음 날부터 b까지
        let n = 0; const sign = b >= a ? 1 : -1;
        for (let x = addDays(a, sign); sign > 0 ? x <= b : x >= b; x = addDays(x, sign)) if (!isOff(x)) n += sign;
        return n;
      };
      const t = ymd(today());

      el.append(h(`
        <div class="seg" role="tablist">
          <button data-m="dday">D-day</button>
          <button data-m="deadline">기한 계산</button>
          <button data-m="between">두 날짜 사이</button>
        </div>
        <div class="mode" data-m="dday">
          <div class="field"><label for="dd-date">날짜</label><input id="dd-date" type="date" value="${t}"></div>
        </div>
        <div class="mode" data-m="deadline">
          <div class="row2">
            <div class="field"><label for="dl-start">기준일</label><input id="dl-start" type="date" value="${t}"></div>
            <div class="field"><label for="dl-n">기간</label><input id="dl-n" type="number" value="14" min="-3650" max="3650"></div>
          </div>
          <div class="field"><label for="dl-unit">단위</label>
            <select id="dl-unit"><option value="days">일 (달력 기준)</option><option value="work">영업일 (주말·공휴일 제외)</option><option value="months">개월</option></select>
          </div>
          <label class="check"><input id="dl-first" type="checkbox"> 기준일(첫날)을 포함해서 셈</label>
          <label class="check"><input id="dl-shift" type="checkbox" checked> 마지막 날이 휴일이면 다음 평일로 (민법 제161조)</label>
        </div>
        <div class="mode" data-m="between">
          <div class="row2">
            <div class="field"><label for="bt-a">시작일</label><input id="bt-a" type="date" value="${t}"></div>
            <div class="field"><label for="bt-b">종료일</label><input id="bt-b" type="date" value="${ymd(addDays(today(), 30))}"></div>
          </div>
        </div>
        <div class="result" aria-live="polite"><div class="big"></div><div class="sub"></div></div>
        <p class="muted" style="margin:8px 0 0">공휴일은 설정 화면에서 고칠 수 있습니다.</p>`));

      const big = el.querySelector('.big');
      const sub = el.querySelector('.sub');
      const v = (id) => el.querySelector(id);

      function calc() {
        try {
          if (dateMode === 'dday') {
            const d = parse(v('#dd-date').value);
            const n = diffDays(today(), d);
            big.textContent = n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`;
            sub.textContent = `${fmt(d)} · 영업일 기준 ${Math.abs(workdaysBetween(today(), d))}일 ${n >= 0 ? '남음' : '지남'}`;
          } else if (dateMode === 'deadline') {
            const s = parse(v('#dl-start').value);
            const n = Number(v('#dl-n').value) || 0;
            const unit = v('#dl-unit').value;
            const first = v('#dl-first').checked;
            let end;
            if (unit === 'days') {
              end = addDays(s, first ? n - Math.sign(n) : n);
            } else if (unit === 'months') {
              const m = new Date(s.getFullYear(), s.getMonth() + n, 1);
              const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
              // 민법 제160조: 첫날 불산입이면 최종 월의 같은 날짜가 말일(그 날짜가 없으면 그 달 말일)
              end = new Date(m.getFullYear(), m.getMonth(), Math.min(s.getDate(), last));
              if (first) end = addDays(end, -1);
            } else {
              end = s; let left = Math.abs(n); const step = n >= 0 ? 1 : -1;
              if (first && !isOff(s) && left > 0) left -= 1;
              while (left > 0) { end = addDays(end, step); if (!isOff(end)) left -= 1; }
            }
            let note = '';
            if (v('#dl-shift').checked && unit !== 'work' && isOff(end)) {
              const moved = nextWorkday(end);
              note = ` · 원래 ${fmt(end)}이 휴일이라 미룸`;
              end = moved;
            }
            big.textContent = fmt(end);
            const dd = diffDays(today(), end);
            sub.textContent = `오늘부터 ${dd === 0 ? '오늘' : dd > 0 ? `${dd}일 뒤` : `${-dd}일 전`}${note}`;
          } else {
            const a = parse(v('#bt-a').value); const b = parse(v('#bt-b').value);
            const n = diffDays(a, b);
            big.textContent = `${n}일`;
            sub.textContent = `시작일 포함 ${n + Math.sign(n || 1)}일 · 영업일 ${workdaysBetween(a, b)}일 (시작일 제외)`;
          }
        } catch {
          big.textContent = '—';
          sub.textContent = '날짜를 확인하세요.';
        }
      }

      function setMode(m) {
        dateMode = m;
        el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
        el.querySelectorAll('.mode').forEach((d) => { d.hidden = d.dataset.m !== m; });
        calc();
      }
      el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
      el.addEventListener('input', calc);
      el.addEventListener('change', calc);
      setMode(dateMode);
    },
  };

  // ---------- 타이머 · 알람 (패널을 닫아도 계속 동작) ----------
  const T = { end: 0, label: '', handle: null, listeners: new Set() };
  const remain = () => Math.max(0, T.end - Date.now());
  const mmss = (ms) => {
    const s = Math.ceil(ms / 1000);
    const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  };
  function beep() {
    try {
      const ctx = new AudioContext();
      [0, 0.35, 0.7].forEach((at) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
        o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch { /* 소리 실패는 무시 */ }
  }
  function timerTick() {
    const r = remain();
    window.setTimerBadge(T.end ? mmss(r) : '');
    T.listeners.forEach((fn) => fn());
    if (T.end && r <= 0) {
      const label = T.label;
      stopTimer();
      beep();
      window.api.notify('업무 툴바', label || '설정한 시간이 되었습니다.');
    }
  }
  function startTimer(ms, label) {
    T.end = Date.now() + ms;
    T.label = label;
    clearInterval(T.handle);
    T.handle = setInterval(timerTick, 250);
    timerTick();
  }
  function stopTimer() {
    T.end = 0; clearInterval(T.handle); T.handle = null;
    window.setTimerBadge('');
    T.listeners.forEach((fn) => fn());
  }

  const timer = {
    icon: 'timer',
    render(el) {
      el.append(h(`
        <div class="countdown" aria-live="off">00:00</div>
        <div class="chips">
          <button data-min="5">5분</button><button data-min="10">10분</button><button data-min="15">15분</button>
          <button data-min="30">30분</button><button data-min="60">1시간</button>
        </div>
        <div class="row2">
          <div class="field"><label for="tm-min">직접 입력 (분)</label><input id="tm-min" type="number" min="1" max="1440" value="25"></div>
          <div class="field"><label for="tm-at">알람 시각</label><input id="tm-at" type="time"></div>
        </div>
        <div class="field"><label for="tm-label">알림 문구</label><input id="tm-label" type="text" placeholder="예: 회의 시작"></div>
        <div class="actions">
          <button class="btn ghost stop">멈춤</button>
          <button class="btn start">시작</button>
        </div>`));
      const cd = el.querySelector('.countdown');
      const label = () => el.querySelector('#tm-label').value.trim();
      const draw = () => { cd.textContent = T.end ? mmss(remain()) : '00:00'; };
      draw();
      T.listeners.clear();
      T.listeners.add(draw);
      el.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => {
        const m = Number(b.dataset.min);
        startTimer(m * 60000, label() || `${b.textContent} 타이머가 끝났습니다.`);
      }));
      el.querySelector('.start').addEventListener('click', () => {
        const at = el.querySelector('#tm-at').value;
        if (at) {
          const [hh, mm] = at.split(':').map(Number);
          const now = new Date();
          let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
          if (target <= now) target = addDays(target, 1);
          target.setHours(hh, mm, 0, 0);
          startTimer(target - now, label() || `${at} 알람입니다.`);
        } else {
          const m = Number(el.querySelector('#tm-min').value);
          if (!(m > 0)) return window.showToast('분을 1 이상으로 입력하세요.');
          startTimer(m * 60000, label() || `${m}분 타이머가 끝났습니다.`);
        }
      });
      el.querySelector('.stop').addEventListener('click', stopTimer);
    },
  };

  // ---------- 텍스트 정리 ----------
  const textclean = {
    icon: 'remove-formatting',
    async render(el, { api }) {
      el.append(h(`
        <textarea rows="6" placeholder="정리할 글을 붙여 넣으세요"></textarea>
        <label class="check"><input type="checkbox" data-o="joinLines" checked> 줄바꿈을 띄어쓰기로 (문단 사이 빈 줄은 유지)</label>
        <label class="check"><input type="checkbox" data-o="spaces" checked> 여러 칸 띄어쓰기를 한 칸으로</label>
        <label class="check"><input type="checkbox" data-o="hyphen"> 줄 끝 하이픈(-)으로 끊긴 단어 잇기</label>
        <label class="check"><input type="checkbox" data-o="blank"> 빈 줄 모두 지우기</label>
        <div class="actions">
          <button class="btn ghost paste">클립보드에서 가져오기</button>
          <button class="btn run">정리하고 복사</button>
        </div>
        <p class="muted count" style="margin:6px 0 0"></p>`));
      const ta = el.querySelector('textarea');
      const count = el.querySelector('.count');
      const opt = (k) => el.querySelector(`[data-o="${k}"]`).checked;
      const showCount = () => { count.textContent = `글자 수 ${ta.value.length.toLocaleString()} (공백 제외 ${ta.value.replace(/\s/g, '').length.toLocaleString()})`; };
      ta.addEventListener('input', showCount);
      ta.value = await api.readClipboard();
      showCount();
      ta.focus();
      el.querySelector('.paste').addEventListener('click', async () => { ta.value = await api.readClipboard(); showCount(); });
      el.querySelector('.run').addEventListener('click', async () => {
        let s = ta.value.replace(/\r\n?/g, '\n');
        if (opt('hyphen')) s = s.replace(/([A-Za-z가-힣])-\n(?=[A-Za-z가-힣])/g, '$1');
        if (opt('blank')) s = s.replace(/\n\s*\n+/g, '\n');
        if (opt('joinLines')) s = s.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ')).join('\n\n');
        if (opt('spaces')) s = s.replace(/[ \t ]{2,}/g, ' ');
        s = s.split('\n').map((l) => l.trim()).join('\n').trim();
        ta.value = s;
        showCount();
        await api.writeClipboard(s);
        window.showToast('정리한 글을 복사했습니다', true);
      });
    },
  };

  // ---------- 클립보드 기록 ----------
  const cliphistory = {
    icon: 'clipboard-list',
    async render(el, { api }) {
      el.append(h(`
        <ul class="cliplist"></ul>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="muted">최근 30개 · 프로그램을 끄면 지워집니다</span>
          <button class="btn ghost clear">기록 지우기</button>
        </div>`));
      const list = el.querySelector('.cliplist');
      async function draw() {
        const items = await api.clipHistory();
        list.innerHTML = '';
        if (!items.length) {
          list.innerHTML = '<li class="empty">복사한 글이 여기에 쌓입니다</li>';
          return;
        }
        for (const text of items) {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.textContent = text.length > 300 ? `${text.slice(0, 300)}…` : text;
          b.title = '누르면 다시 복사';
          b.addEventListener('click', async () => {
            await api.writeClipboard(text);
            window.showToast('복사했습니다', true);
          });
          li.appendChild(b);
          list.appendChild(li);
        }
      }
      el.querySelector('.clear').addEventListener('click', async () => { await api.clearClipHistory(); draw(); });
      draw();
    },
  };

  // ---------- 단위 환산 (면적 · 길이) ----------
  const UNITS = {
    area: [
      { k: 'm2', label: '㎡', f: 1 },
      { k: 'py', label: '평', f: 400 / 121 },
      { k: 'k_m2', label: '천㎡', f: 1000 },
      { k: 'ha', label: 'ha (헥타르)', f: 10000 },
      { k: 'km2', label: '㎢', f: 1e6 },
    ],
    length: [
      { k: 'm', label: 'm', f: 1 },
      { k: 'km', label: 'km', f: 1000 },
      { k: 'cm', label: 'cm', f: 0.01 },
      { k: 'ja', label: '자 (尺)', f: 10 / 33 },
      { k: 'ri', label: '리 (里)', f: 400 },
    ],
  };
  let unitMode = 'area';
  const num = (v) => Number(String(v).replace(/,/g, '').trim());
  const fmtNum = (n) => {
    if (!isFinite(n)) return '';
    const digits = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 4 : 6;
    return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
  };
  const unitconv = {
    icon: 'ruler',
    render(el, { api }) {
      el.append(h(`
        <div class="seg" role="tablist">
          <button data-m="area">면적</button>
          <button data-m="length">길이</button>
        </div>
        <div class="units"></div>
        <p class="muted" style="margin:8px 0 0">아무 칸에나 숫자를 넣으면 나머지가 바뀝니다. 1평 = 400/121㎡ (약 3.3058㎡)</p>`));
      const box = el.querySelector('.units');
      let base = 1000; // 기준 단위(㎡ 또는 m) 값
      function draw(skip) {
        box.querySelectorAll('input').forEach((inp) => {
          if (inp === skip) return;
          inp.value = base === null ? '' : fmtNum(base / Number(inp.dataset.f));
        });
      }
      function build() {
        el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === unitMode));
        box.innerHTML = '';
        base = unitMode === 'area' ? 10000 : 1000;
        for (const u of UNITS[unitMode]) {
          const row = h(`
            <div class="unit-row">
              <input type="text" inputmode="decimal" aria-label="${u.label}" data-f="${u.f}">
              <span class="unit">${u.label}</span>
              <button class="icon-btn" aria-label="${u.label} 값 복사" data-tip="복사">${window.icon('copy', 16)}</button>
            </div>`);
          const inp = row.querySelector('input');
          inp.addEventListener('input', () => {
            const v = num(inp.value);
            base = inp.value.trim() === '' || !isFinite(v) ? null : v * Number(inp.dataset.f);
            draw(inp);
          });
          row.querySelector('button').addEventListener('click', async () => {
            await api.writeClipboard(String(inp.value).replace(/,/g, ''));
            window.showToast(`${inp.value} ${u.label} 복사했습니다`, true);
          });
          box.appendChild(row);
        }
        draw();
        box.querySelector('input').focus();
      }
      el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { unitMode = b.dataset.m; build(); }));
      build();
    },
  };

  // ---------- 금액 한글 표기 ----------
  const KR_DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const KR_SMALL = ['', '십', '백', '천'];
  const KR_BIG = ['', '만', '억', '조', '경'];
  // 공문서 방식: 일십, 일백, 일천처럼 '일'을 붙인다 (예: 금113,560원(금일십일만삼천오백육십원))
  function toKorean(n, withIl = true) {
    if (n === 0n) return '영';
    let out = '';
    let big = 0;
    while (n > 0n) {
      const group = Number(n % 10000n);
      if (group) {
        let g = '';
        const ds = String(group).padStart(4, '0').split('').map(Number);
        ds.forEach((d, i) => {
          if (!d) return;
          const unit = KR_SMALL[3 - i];
          g += (d === 1 && unit && !withIl ? '' : KR_DIGIT[d]) + unit;
        });
        out = g + KR_BIG[big] + out;
      }
      n /= 10000n;
      big += 1;
    }
    return out;
  }
  function toMixed(n) { // 12억 3,450만 6,789
    const parts = [];
    let big = 0;
    while (n > 0n) {
      const group = Number(n % 10000n);
      if (group) parts.unshift(group.toLocaleString('ko-KR') + KR_BIG[big]);
      n /= 10000n;
      big += 1;
    }
    return parts.join(' ') || '0';
  }
  const krmoney = {
    icon: 'banknote',
    render(el, { api }) {
      el.append(h(`
        <div class="field"><label for="km-in">금액 (원)</label><input id="km-in" type="text" inputmode="numeric" placeholder="예: 113560" autocomplete="off"></div>
        <div class="money-out"></div>
        <p class="muted" style="margin:8px 0 0">공문서 표기는 「행정업무의 운영 및 혁신에 관한 규정 시행규칙」 제2조제2항 방식입니다.</p>`));
      const inp = el.querySelector('#km-in');
      const out = el.querySelector('.money-out');
      function line(label, text) {
        const row = h(`<div class="money-row"><div><div class="muted"></div><div class="mv"></div></div><button class="icon-btn" aria-label="복사" data-tip="복사">${window.icon('copy', 16)}</button></div>`);
        row.querySelector('.muted').textContent = label;
        row.querySelector('.mv').textContent = text;
        row.querySelector('button').addEventListener('click', async () => {
          await api.writeClipboard(text);
          window.showToast('복사했습니다', true);
        });
        out.appendChild(row);
      }
      function calc() {
        const raw = inp.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
        out.innerHTML = '';
        if (!raw) return;
        if (raw.length > 20) { out.innerHTML = '<p class="muted">20자리(경 단위)까지만 바꿀 수 있습니다.</p>'; return; }
        const n = BigInt(raw);
        const comma = n.toLocaleString('ko-KR');
        // 입력칸에 쉼표 넣기 (커서는 끝으로)
        if (inp.value !== comma) inp.value = comma;
        line('공문서 표기', `금${comma}원(금${toKorean(n)}원)`);
        line('한글만', `${toKorean(n)}원`);
        line('한글만 (일 생략)', `${toKorean(n, false)}원`);
        line('숫자 + 단위', `${toMixed(n)}원`);
      }
      inp.addEventListener('input', calc);
      inp.focus();
    },
  };

  window.TOOLS = { memo, datecalc, unitconv, krmoney, timer, textclean, cliphistory };
  window.TOOL_NAMES = { memo: '빠른 메모', datecalc: '날짜 계산', unitconv: '단위 환산', krmoney: '금액 한글 표기', timer: '타이머·알람', textclean: '텍스트 정리', cliphistory: '클립보드 기록' };
})();
