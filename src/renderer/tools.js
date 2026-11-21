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
    async render(el, { config, api }) {
      // 공휴일 = 공공데이터포털에서 자동으로 받은 날 + 설정에 직접 적은 날
      const auto = await api.getHolidays();
      const holidays = new Set([...(config.holidays || []), ...((auto && auto.dates) || [])]);
      const holNote = auto && auto.updatedAt
        ? `공휴일: 공공데이터포털 자동 갱신(${new Date(auto.updatedAt).toLocaleDateString('ko-KR')}) + 설정에 직접 넣은 날`
        : '공휴일: 설정에 직접 넣은 날만 반영 중 (공공데이터포털 인증키를 넣으면 자동 갱신)';
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
        <p class="muted hol-note" style="margin:8px 0 0"></p>`));
      el.querySelector('.hol-note').textContent = holNote;

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

  // ---------- 웹페이지 전체 저장 ----------
  const webcapture = {
    icon: 'file-down',
    async render(el, { api }) {
      el.append(h(`
        <div class="field"><label for="wc-url">저장할 페이지 주소</label><input id="wc-url" type="text" placeholder="https://..." autocomplete="off" spellcheck="false"></div>
        <p class="muted" style="margin:0 0 6px">브라우저 주소창에서 Ctrl+L, Ctrl+C로 주소를 복사한 뒤 이 창을 열면 자동으로 들어갑니다. 광고·메뉴·댓글을 빼고 기사 본문만 저장합니다.</p>
        <label class="check"><input type="checkbox" class="full"> 광고·댓글까지 원본 화면 그대로 저장</label>
        <div class="actions">
          <button class="btn ghost txt">내용만 복사</button>
          <button class="btn ghost img">PNG로 저장</button>
          <button class="btn pdf">PDF로 저장</button>
        </div>
        <p class="muted status" style="margin:8px 0 0" aria-live="polite"></p>
        <p class="muted" style="margin:6px 0 0">로그인해야 보이는 페이지는 로그인 화면이 저장될 수 있습니다. 그럴 때는 Edge의 '웹 캡처'(Ctrl+Shift+S)를 쓰세요.</p>`));
      const inp = el.querySelector('#wc-url');
      const status = el.querySelector('.status');
      const clip = (await api.readClipboard() || '').trim();
      if (/^https?:\/\/\S+$/i.test(clip)) inp.value = clip;
      inp.focus();
      let busy = false;
      async function go(format) {
        if (busy) return;
        const url = inp.value.trim();
        if (!/^https?:\/\//i.test(url)) { status.textContent = 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.'; return; }
        busy = true;
        el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        status.textContent = '페이지를 불러와 아래쪽까지 읽는 중입니다… (10~30초)';
        const r = await api.capturePage(url, format, { full: el.querySelector('.full').checked });
        busy = false;
        el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        if (r.ok && format === 'text') {
          // 제목 / (출처) / 본문 / 주소 순서로 복사
          const head = [r.title, [r.site, r.byline].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
          await api.writeClipboard(`${head}\n\n${r.text}\n\n출처: ${r.url}`);
          status.textContent = `내용을 복사했습니다 (${r.text.length.toLocaleString()}자). 한글·워드에 붙여 넣으세요.`;
        } else if (r.ok) status.textContent = `${r.bodyOnly ? '본문만' : '원본 화면 그대로'} 저장했습니다: ${r.file}`;
        else if (r.canceled) status.textContent = '저장을 취소했습니다.';
        else status.textContent = `저장하지 못했습니다: ${r.message}`;
      }
      el.querySelector('.pdf').addEventListener('click', () => go('pdf'));
      el.querySelector('.img').addEventListener('click', () => go('png'));
      el.querySelector('.txt').addEventListener('click', () => go('text'));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('pdf'); });
    },
  };

  // ---------- 키워드 뉴스 ----------
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return `${Math.max(m, 1)}분 전`;
    if (m < 1440) return `${Math.round(m / 60)}시간 전`;
    return `${Math.round(m / 1440)}일 전`;
  };
  const news = {
    icon: 'newspaper',
    async render(el, { api }) {
      el.append(h(`
        <div class="chips news-kw"></div>
        <div class="kw-edit">
          <input type="text" class="kw-in" placeholder="키워드 추가 (예: 스마트그린산단)" maxlength="30">
          <button class="btn ghost kw-add">추가</button>
        </div>
        <ul class="newslist"></ul>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="muted news-status"></span>
          <span style="display:flex;gap:6px">
            <button class="btn ghost refresh">새로고침</button>
            <button class="btn ghost readall">모두 읽음</button>
          </span>
        </div>`));
      const list = el.querySelector('.newslist');
      let filter = null;
      function draw(st) {
        const kwBox = el.querySelector('.news-kw');
        kwBox.innerHTML = '';
        if (filter && !st.keywords.includes(filter)) filter = null;
        for (const k of [null, ...st.keywords]) {
          const b = document.createElement('button');
          b.textContent = k || '전체';
          b.classList.toggle('on', filter === k);
          b.addEventListener('click', () => { filter = k; draw(st); });
          if (k) {
            // 키워드 지우기 (×)
            const x = document.createElement('span');
            x.className = 'kw-x'; x.textContent = '×'; x.title = `'${k}' 키워드 지우기`;
            x.addEventListener('click', async (e) => {
              e.stopPropagation();
              draw(await api.setNewsKeywords(st.keywords.filter((w) => w !== k)));
            });
            b.appendChild(x);
          }
          kwBox.appendChild(b);
        }
        current = st;
        const items = st.items.filter((i) => !filter || i.kw === filter).slice(0, 40);
        list.innerHTML = '';
        if (!st.on) { list.innerHTML = '<li class="empty">설정에서 키워드 뉴스 알림을 켜 주세요</li>'; return; }
        if (!items.length) { list.innerHTML = '<li class="empty">아직 가져온 기사가 없습니다. 잠시 뒤 다시 보거나 새로고침을 누르세요</li>'; return; }
        for (const it of items) {
          const li = document.createElement('li');
          li.innerHTML = '<button><span class="nt"></span><span class="nm"></span></button>';
          li.querySelector('button').classList.toggle('unread', !it.read);
          li.querySelector('.nt').textContent = it.title;
          li.querySelector('.nm').textContent = `${it.kw} · ${it.source || '언론사'} · ${ago(it.date)}`;
          li.querySelector('button').addEventListener('click', async () => {
            await api.openItem({ type: 'url', target: it.link });
            api.readNews(it.link);
          });
          list.appendChild(li);
        }
        el.querySelector('.news-status').textContent = st.unread ? `안 읽은 기사 ${st.unread}건` : '모두 읽었습니다';
      }
      let current = null;
      draw(await api.getNews());
      window.__newsPanelDraw = draw;
      const kwIn = el.querySelector('.kw-in');
      async function addKw() {
        const k = kwIn.value.trim();
        if (!k) return;
        if (current.keywords.length >= 10) { el.querySelector('.news-status').textContent = '키워드는 10개까지 넣을 수 있습니다.'; return; }
        kwIn.value = '';
        el.querySelector('.news-status').textContent = `'${k}' 기사를 가져오는 중…`;
        draw(await api.setNewsKeywords([...current.keywords, k]));
      }
      el.querySelector('.kw-add').addEventListener('click', addKw);
      kwIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addKw(); });
      el.querySelector('.readall').addEventListener('click', () => api.readNews('*'));
      el.querySelector('.refresh').addEventListener('click', async (e) => {
        e.target.disabled = true; el.querySelector('.news-status').textContent = '가져오는 중…';
        await api.refreshNews(); e.target.disabled = false;
      });
    },
  };

  // ---------- 필지 조회 (브이월드 + 국토교통부 실거래가·건축물대장) ----------
  const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
  const fnum = (n, d = 0) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: d });
  const ymd8p = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d || '-');
  let parcelMode = 'one';
  const parcel = {
    icon: 'land-plot',
    render(el, { api }) {
      el.append(h(`
        <div class="seg" role="tablist"><button data-m="one">한 필지</button><button data-m="many">여러 필지</button></div>
        <div class="pc-one">
          <div class="field"><label for="pc-q">주소·지번·장소명</label>
            <div style="display:flex;gap:6px"><input id="pc-q" type="text" placeholder="예: 김천시 율곡동 1052 / 구미국가산업단지" autocomplete="off"><button class="btn go">찾기</button></div>
          </div>
          <ul class="cliplist pc-list"></ul>
          <div class="pc-detail"></div>
        </div>
        <div class="pc-many">
          <div class="field"><label for="pc-bulk">지번 목록 (한 줄에 하나, 엑셀에서 복사해 붙여 넣기)</label>
            <textarea id="pc-bulk" rows="5" placeholder="김천시 율곡동 1052&#10;김천시 율곡동 1053-2&#10;..."></textarea></div>
          <div class="actions" style="justify-content:space-between;align-items:center">
            <span class="muted pc-prog"></span>
            <span style="display:flex;gap:6px"><button class="btn ghost pc-tsv" disabled>엑셀용 복사</button><button class="btn pc-run">조회</button></span>
          </div>
          <div class="pc-tablewrap"><table class="pc-grid"></table></div>
        </div>
        <p class="muted pc-status" style="margin:6px 0 0" aria-live="polite"></p>`));
      const status = el.querySelector('.pc-status');
      const panel = el.closest('.panel');
      function setMode(m) {
        parcelMode = m;
        el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
        el.querySelector('.pc-one').hidden = m !== 'one';
        el.querySelector('.pc-many').hidden = m !== 'many';
        panel.classList.toggle('wide', m === 'many');
        status.textContent = '';
        (m === 'one' ? el.querySelector('#pc-q') : el.querySelector('#pc-bulk')).focus();
      }
      el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));

      // ----- 한 필지 -----
      const q = el.querySelector('#pc-q'); const list = el.querySelector('.pc-list');
      const detail = el.querySelector('.pc-detail');
      async function search() {
        if (!q.value.trim()) return;
        status.textContent = '찾는 중…'; list.innerHTML = ''; detail.innerHTML = '';
        const r = await api.vworldSearch(q.value);
        if (!r.ok) { status.textContent = r.message; return; }
        if (!r.items.length) { status.textContent = '찾은 결과가 없습니다. 시·군 이름을 붙이거나 다르게 적어 보세요.'; return; }
        status.textContent = `${r.items.length}건 · 누르면 토지 정보를 봅니다`;
        for (const it of r.items) {
          const li = document.createElement('li'); const b = document.createElement('button');
          b.textContent = `[${it.kind}] ${it.title}${it.sub ? `\n${it.sub}` : ''}`;
          b.addEventListener('click', () => show(it));
          li.appendChild(b); list.appendChild(li);
        }
      }
      const table = (rows) => {
        const t = document.createElement('div'); t.className = 'result pc-table';
        for (const [k, v] of rows) { const row = document.createElement('div'); row.className = 'pc-row'; row.innerHTML = '<span></span><span></span>'; row.children[0].textContent = k; row.children[1].textContent = v; t.appendChild(row); }
        return t;
      };
      async function show(it) {
        status.textContent = '토지 정보를 가져오는 중…';
        const r = await api.vworldParcel(it.x, it.y);
        if (!r.ok) { status.textContent = r.message; return; }
        const d = r.info; list.innerHTML = '';
        const rows = [
          ['소재지', d.addr || it.title], ['지번', d.jibun || '-'], ['지목', d.jimok || '-'],
          ['용도지역', d.zones.length ? d.zones.join(', ') : '-'],
          ['공시지가', d.jiga ? `${won(d.jiga)}/㎡${d.gosi ? ` (${d.gosi})` : ''}` : '-'],
          ['PNU', d.pnu || '-'], ['좌표', `${d.y.toFixed(6)}, ${d.x.toFixed(6)}`],
        ];
        detail.innerHTML = '';
        panel.classList.remove('wide');
        detail.appendChild(table(rows));
        detail.append(h(`<div class="actions" style="flex-wrap:wrap"><button class="btn ghost back2">다른 결과</button><button class="btn ghost bld">건축물대장</button><button class="btn ghost trade">실거래가</button><button class="btn ghost map">카카오맵</button><button class="btn copy">정보 복사</button></div><div class="pc-extra"></div>`));
        const extra = detail.querySelector('.pc-extra');
        status.textContent = '용도지역은 도시·관리·농림·자연환경보전지역 기준입니다. 지구·구역 등 자세한 내용은 토지이음에서 확인하세요.';
        let copyText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
        detail.querySelector('.copy').addEventListener('click', async () => { await api.writeClipboard(copyText); window.showToast('토지 정보를 복사했습니다', true); });
        detail.querySelector('.map').addEventListener('click', () => api.openItem({ type: 'url', target: `https://map.kakao.com/link/map/${encodeURIComponent(d.addr || it.title)},${d.y},${d.x}` }));
        detail.querySelector('.back2').addEventListener('click', search);
        detail.querySelector('.bld').addEventListener('click', async (e) => {
          if (!d.pnu) { status.textContent = 'PNU가 없어 건축물대장을 찾을 수 없습니다.'; return; }
          e.target.disabled = true; status.textContent = '건축물대장을 가져오는 중…';
          const b = await api.landBuilding(d.pnu); e.target.disabled = false;
          if (!b.ok) { status.textContent = `건축물대장: ${b.message}`; return; }
          extra.innerHTML = '<h3 class="law-h">건축물대장 (표제부)</h3>';
          if (!b.items.length) { extra.append(h('<p class="muted">이 필지에 등록된 건축물이 없습니다.</p>')); status.textContent = ''; return; }
          for (const x of b.items) {
            const br = [['건물', x.name], ['주용도', x.purpose || '-'], ['구조', x.structure || '-'], ['층수', x.floors],
              ['연면적', `${fnum(x.totArea, 2)}㎡`], ['건축면적', `${fnum(x.archArea, 2)}㎡`], ['대지면적', `${fnum(x.platArea, 2)}㎡`], ['사용승인', ymd8p(x.approved)]];
            extra.appendChild(table(br));
            copyText += `\n\n[건축물대장] ${br.map(([k, v]) => `${k}: ${v}`).join(' / ')}`;
          }
          status.textContent = `건축물 ${b.items.length}동`;
          extra.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        detail.querySelector('.trade').addEventListener('click', async (e) => {
          if (!d.pnu) { status.textContent = 'PNU가 없어 실거래가를 찾을 수 없습니다.'; return; }
          e.target.disabled = true; status.textContent = '최근 6개월 토지 실거래가를 가져오는 중… (10초 정도)';
          const t = await api.landTrades(d.pnu, 6); e.target.disabled = false;
          if (!t.ok) { status.textContent = `실거래가: ${t.message}`; return; }
          const dong = ((d.addr || '').match(/\s(\S+[동리가읍면])\s/) || [])[1] || '';
          const same = t.rows.filter((r) => !dong || r.dong === dong);
          const rowsShown = (same.length ? same : t.rows).slice(0, 30);
          extra.innerHTML = `<h3 class="law-h">토지 실거래가 · 최근 6개월 · ${same.length ? `${dong} ${same.length}건` : `시군구 전체 ${t.rows.length}건`}</h3>`;
          if (!rowsShown.length) { extra.append(h('<p class="muted">최근 6개월 거래가 없습니다.</p>')); status.textContent = ''; return; }
          const units = rowsShown.map((r) => r.unit).filter(Boolean).sort((a, b) => a - b);
          const mid = units.length ? units[Math.floor(units.length / 2)] : 0;
          const tw = document.createElement('div'); tw.className = 'pc-tablewrap';
          const tb = document.createElement('table'); tb.className = 'pc-grid';
          tb.innerHTML = '<thead><tr><th>계약일</th><th>법정동</th><th>지목</th><th>용도지역</th><th>면적(㎡)</th><th>금액(만원)</th><th>㎡당</th></tr></thead><tbody></tbody>';
          for (const r of rowsShown) {
            const tr = document.createElement('tr');
            for (const v of [r.date, r.dong, r.jimok, r.zone, fnum(r.area, 1), fnum(r.amount), r.unit ? won(r.unit) : '-']) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
            tb.tBodies[0].appendChild(tr);
          }
          tw.appendChild(tb); extra.appendChild(tw);
          panel.classList.add('wide'); // 표가 다 보이게 창을 넓힌다
          status.textContent = mid ? `㎡당 가운데값 ${won(mid)} · 지번은 일부 가려져 제공됩니다` : '';
          extra.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }
      el.querySelector('.go').addEventListener('click', search);
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

      // ----- 여러 필지 -----
      const grid = el.querySelector('.pc-many .pc-grid');
      const prog = el.querySelector('.pc-prog');
      const tsvBtn = el.querySelector('.pc-tsv');
      const HEAD = ['입력', '소재지', '지목', '용도지역', '공시지가(원/㎡)', '기준', 'PNU', '비고'];
      let results = [];
      let running = false;
      function drawGrid() {
        grid.innerHTML = `<thead><tr>${HEAD.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody></tbody>`;
        for (const r of results) {
          const tr = document.createElement('tr');
          if (r.error) tr.className = 'err';
          for (const v of [r.query, r.addr || '', r.jimok || '', r.zones || '', r.jiga ? fnum(r.jiga) : '', r.gosi || '', r.pnu || '', r.error || '']) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
          grid.tBodies[0].appendChild(tr);
        }
      }
      el.querySelector('.pc-run').addEventListener('click', async (e) => {
        if (running) return;
        const lines = el.querySelector('#pc-bulk').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 200);
        if (!lines.length) { prog.textContent = '지번을 한 줄에 하나씩 넣어 주세요.'; return; }
        running = true; e.target.disabled = true; tsvBtn.disabled = true;
        results = lines.map((query) => ({ query, error: '대기' }));
        drawGrid();
        let done = 0; let next = 0;
        async function worker() {
          while (next < lines.length) {
            const i = next++;
            results[i] = await api.vworldBulkRow(lines[i]);
            done++; prog.textContent = `${done} / ${lines.length} 조회`;
            drawGrid();
          }
        }
        await Promise.all([worker(), worker(), worker()]); // 동시에 3건씩
        const fail = results.filter((r) => r.error).length;
        prog.textContent = `${lines.length}건 완료${fail ? ` · 실패 ${fail}건` : ''}`;
        running = false; e.target.disabled = false; tsvBtn.disabled = false;
      });
      tsvBtn.addEventListener('click', async () => {
        const esc = (v) => String(v ?? '').replace(/[\t\n]/g, ' ');
        const tsv = [HEAD, ...results.map((r) => [r.query, r.addr, r.jimok, r.zones, r.jiga, r.gosi, r.pnu, r.error])].map((row) => row.map(esc).join('\t')).join('\n');
        await api.writeClipboard(tsv);
        window.showToast('엑셀에 붙여 넣을 수 있게 복사했습니다', true);
      });
      setMode(parcelMode);
    },
  };

  // ---------- 법령 개정 알림 ----------
  const ymd8 = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d || '-');
  const isFuture = (d) => d && d.length === 8 && d > new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const laws = {
    icon: 'gavel',
    async render(el, { api }) {
      el.append(h(`
        <div class="law-events"></div>
        <h3 class="law-h">지켜보는 법령</h3>
        <ul class="newslist law-list"></ul>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="muted law-status"></span>
          <span style="display:flex;gap:6px">
            <button class="btn ghost refresh">새로고침</button>
            <button class="btn ghost readall">모두 읽음</button>
          </span>
        </div>`));
      const open = (mst) => api.openItem({ type: 'url', target: `https://www.law.go.kr/lsInfoP.do?lsiSeq=${encodeURIComponent(mst)}` });
      function draw(st) {
        const ev = el.querySelector('.law-events'); ev.innerHTML = '';
        const unread = st.events.filter((e) => !e.read);
        if (unread.length) {
          const ul = document.createElement('ul'); ul.className = 'newslist';
          for (const e of unread) {
            const li = document.createElement('li');
            li.innerHTML = '<button class="unread"><span class="nt"></span><span class="nm"></span></button>';
            li.querySelector('.nt').textContent = `${e.name} ${e.kind || '개정'}`;
            li.querySelector('.nm').textContent = `공포 ${ymd8(e.prom)} · 시행 ${ymd8(e.enf)}${isFuture(e.enf) ? ' (시행 예정)' : ''}`;
            li.querySelector('button').addEventListener('click', () => open(e.mst));
            ul.appendChild(li);
          }
          ev.appendChild(ul);
        }
        const list = el.querySelector('.law-list'); list.innerHTML = '';
        if (!st.on) list.innerHTML = '<li class="empty">설정에서 법령 개정 알림을 켜 주세요</li>';
        else if (!st.watched.length) list.innerHTML = `<li class="empty">${st.error || '처음 확인하는 중입니다. 잠시 뒤 새로고침을 누르세요'}</li>`;
        for (const l of st.watched) {
          const li = document.createElement('li');
          li.innerHTML = '<button><span class="nt"></span><span class="nm"></span></button>';
          li.querySelector('.nt').textContent = l.name;
          li.querySelector('.nm').textContent = `${l.kind || ''} 공포 ${ymd8(l.prom)} · 시행 ${ymd8(l.enf)}${isFuture(l.enf) ? ' (시행 예정)' : ''}`;
          li.querySelector('button').addEventListener('click', () => open(l.mst));
          list.appendChild(li);
        }
        const when = st.checkedAt ? new Date(st.checkedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        el.querySelector('.law-status').textContent = st.error && st.watched.length ? st.error : (unread.length ? `새 개정 ${unread.length}건` : when ? `마지막 확인 ${when}` : '');
      }
      draw(await api.getLaws());
      window.__lawsPanelDraw = draw;
      el.querySelector('.readall').addEventListener('click', () => api.readLaws());
      el.querySelector('.refresh').addEventListener('click', async (e) => {
        e.target.disabled = true; el.querySelector('.law-status').textContent = '확인하는 중…';
        await api.refreshLaws(); e.target.disabled = false;
      });
    },
  };

  window.TOOLS = { memo, datecalc, unitconv, krmoney, timer, textclean, cliphistory, webcapture, news, parcel, laws };
  window.TOOL_NAMES = { memo: '빠른 메모', datecalc: '날짜 계산', unitconv: '단위 환산', krmoney: '금액 한글 표기', timer: '타이머·알람', textclean: '텍스트 정리', cliphistory: '클립보드 기록', webcapture: '웹페이지 저장', news: '키워드 뉴스', parcel: '필지 조회', laws: '법령 개정 알림' };
})();
