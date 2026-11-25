// 업무 툴바 - 화면 동작
(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const cats = $('#cats');
  const pop = $('#pop');
  const dock = $('#dock');
  const tip = $('#tip');
  const toast = $('#toast');

  let config = null;
  let openCatId = null;   // 열려 있는 카테고리
  let openTool = null;    // 열려 있는 유틸리티 패널
  let openQuickId = null; // 독에 바로 놓인 항목 중 패널을 연 것
  const iconCache = new Map();

  // ---------- 마우스: 독 위에 있을 때만 클릭을 받고, 나머지는 뒤의 창으로 통과 ----------
  let overHit = false;
  let sleepTimer = null;
  function setOver(over) {
    if (over === overHit) return;
    overHit = over;
    api.setIgnoreMouse(!over);
    if (over) {
      clearTimeout(sleepTimer);
      document.body.classList.add('awake');
    } else {
      hideTip();
      scheduleSleep();
    }
  }
  function scheduleSleep() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      if (!overHit && !openCatId && !openTool) document.body.classList.remove('awake');
    }, 700);
  }
  document.addEventListener('mousemove', (e) => setOver(!!e.target.closest('.hit')));
  document.addEventListener('mouseleave', () => setOver(false));

  // ---------- 이름 풍선 ----------
  function showTip(el) {
    const text = el.dataset.tip;
    if (!text) return;
    if (el.classList.contains('active')) return hideTip(); // 열린 메뉴를 가리지 않게
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    if (document.body.classList.contains('vertical')) {
      // 세로 배치: 아이콘이 놓인 검은 배경의 왼쪽에
      const box = (el.closest('.row, .panel, #dock') || el).getBoundingClientRect();
      tip.style.left = `${box.left - 8 - tip.offsetWidth / 2}px`;
      tip.style.top = `${r.top + r.height / 2 + tip.offsetHeight / 2}px`;
      return;
    }
    const cx = r.left + r.width / 2;
    // 아이콘이 놓인 검은 배경(메뉴 줄·패널·독)의 윗변 기준
    const box = el.closest('.row, .panel, #dock') || el;
    let top = box.getBoundingClientRect().top;
    // 독 아이콘인데 위에 메뉴가 열려 있고 가로로 겹치면, 메뉴 위로 올린다
    if (box.id === 'dock' && !pop.hidden) {
      const pr = (pop.querySelector('.row, .panel') || pop).getBoundingClientRect();
      const half = tip.offsetWidth / 2;
      if (cx + half > pr.left && cx - half < pr.right) top = Math.min(top, pr.top);
    }
    const half = tip.offsetWidth / 2; // 화면 가장자리 밖으로 나가지 않게
    tip.style.left = `${Math.max(half + 8, Math.min(window.innerWidth - half - 8, cx))}px`;
    tip.style.top = `${top - 4}px`;
  }
  function hideTip() { tip.hidden = true; }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el); else hideTip();
  });

  let toastTimer = null;
  function showToast(msg, ok = false) {
    toast.textContent = msg;
    toast.className = ok ? 'ok' : '';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }
  window.showToast = showToast;

  // ---------- 아이콘 ----------
  function letterTile(btn, name, color) {
    btn.classList.add('tile-letter');
    btn.style.setProperty('--c', color);
    btn.textContent = (name || '?').trim().charAt(0);
  }

  function setImage(btn, src, scale) {
    btn.textContent = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    // 이름이 들어간 아이콘처럼 크게 보여야 하는 것은 iconScale(0~1)로 크기를 키운다
    if (scale) { img.style.width = `${scale * 100}%`; img.style.height = `${scale * 100}%`; }
    btn.appendChild(img);
  }

  async function renderItemIcon(btn, item, color) {
    const ic = item.icon || '';
    if (ic.startsWith('builtin:')) {
      btn.classList.add('tile-tint');
      btn.style.setProperty('--c', color);
      btn.innerHTML = window.icon(ic.slice(8), 26);
      return;
    }
    if (ic.startsWith('data:')) {
      btn.classList.add('tile-paper');
      setImage(btn, ic, item.iconScale);
      return;
    }
    if (item.type === 'tool') {
      btn.classList.add('tile-tint');
      btn.style.setProperty('--c', color);
      btn.innerHTML = window.icon(window.TOOLS[item.target]?.icon || 'sparkles', 26);
      return;
    }
    if (item.type === 'folder') {
      btn.classList.add('tile-tint');
      btn.style.setProperty('--c', color);
      btn.innerHTML = window.icon('folder-open', 26);
      return;
    }
    // 홈페이지 · 프로그램: 처음엔 글자 아이콘, 진짜 아이콘을 받으면 교체
    const key = `${item.type}|${item.target}`;
    if (iconCache.has(key) && iconCache.get(key)) {
      btn.classList.add('tile-paper');
      setImage(btn, iconCache.get(key));
      return;
    }
    letterTile(btn, item.name, color);
    if (iconCache.has(key)) return; // 이전에 실패
    const data = item.type === 'url' ? await api.siteIcon(item.target) : await api.fileIcon(item.target);
    iconCache.set(key, data);
    if (data && btn.isConnected) {
      btn.classList.remove('tile-letter');
      btn.classList.add('tile-paper');
      setImage(btn, data);
    }
  }

  // ---------- 독 그리기 ----------
  // 왼쪽: 일반 카테고리 / 구분선 / 오른쪽 도구 묶음: side:'right' 카테고리 + 바로 놓인(pinned) 항목
  function catTile(cat) {
    const b = document.createElement('button');
    b.className = 'tile tile-cat';
    b.style.setProperty('--c', cat.color || '#5B6B8C');
    b.dataset.id = cat.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', cat.name);
    b.setAttribute('aria-expanded', 'false');
    // 마우스를 올리면 아이콘이 사라지고 그 자리에 이름이 올라온다 (이름 풍선 대신)
    b.innerHTML = `<span class="cat-ic">${window.icon(cat.icon || 'layout-grid', 26)}</span><span class="cat-name"></span>`;
    const nm = b.querySelector('.cat-name');
    nm.textContent = cat.name;
    const len = [...cat.name].length;
    nm.style.fontSize = `${len <= 3 ? 13 : len === 4 ? 12 : len === 5 ? 10.5 : 9.5}px`;
    b.addEventListener('click', () => toggleCategory(cat.id));
    return b;
  }

  function quickTile(item, cat) {
    const b = document.createElement('button');
    b.className = 'tile tile-quick';
    b.dataset.tip = item.name;
    b.dataset.qid = item.id;
    if (item.type === 'tool') b.dataset.tool = item.target;
    b.setAttribute('aria-label', item.name);
    renderItemIcon(b, item, cat.color || '#9C7CF0');
    b.addEventListener('click', () => {
      if (openQuickId === item.id) return closePop();
      activate(item, cat, b);
    });
    return b;
  }

  // 설정의 카테고리 목록 순서 그대로 그린다: 카테고리 버튼 / 바로 표시(pinned) 항목 / 구분선
  function renderDock() {
    document.documentElement.style.setProperty('--idle-opacity', config.appearance?.idleOpacity ?? 0.35);
    cats.innerHTML = '';
    let pendingSep = false;
    const add = (el) => {
      if (pendingSep && cats.children.length) {
        const sep = document.createElement('div');
        sep.className = 'sep'; sep.setAttribute('aria-hidden', 'true');
        cats.appendChild(sep);
      }
      pendingSep = false;
      cats.appendChild(el);
    };
    for (const cat of config.categories) {
      if (cat.type === 'separator') { pendingSep = true; continue; } // 연달아 있거나 맨 끝 구분선은 그리지 않음
      if (cat.pinned) for (const item of cat.items || []) add(quickTile(item, cat));
      else add(catTile(cat));
    }
    $('#btn-settings').innerHTML = window.icon('settings', 16);
    // 위치: 화면 아래(가로, 기본) / 오른쪽 끝(세로)
    const vertical = config.appearance?.position === 'right';
    document.body.classList.toggle('vertical', vertical);
    const posBtn = $('#btn-pos');
    posBtn.setAttribute('aria-label', vertical ? '툴바를 화면 아래에 가로로' : '툴바를 오른쪽 끝에 세로로');
    drawNewsBadge();
  }

  // 키워드 뉴스: 안 읽은 기사 수를 해당 아이콘에 빨간 숫자로
  let newsNow = { unread: 0 };
  let lawsNow = { unread: 0 };
  // 새 내용이 있으면 아이콘 오른쪽 위에 빨간 점: 그 도구 아이콘(바로가기·튀어오른 메뉴)과, 그 도구가 든 카테고리 아이콘
  function drawNewsBadge() {
    document.querySelectorAll('.tile .badge').forEach((b) => b.remove());
    const dot = (tile) => {
      if (!tile || tile.querySelector('.badge')) return;
      const b = document.createElement('span');
      b.className = 'badge';
      b.setAttribute('aria-hidden', 'true');
      tile.appendChild(b);
    };
    for (const [tool, n] of [['news', newsNow.unread], ['laws', lawsNow.unread]]) {
      if (!n) continue;
      document.querySelectorAll(`.tile[data-tool="${tool}"]`).forEach(dot);
      for (const c of config.categories || []) {
        if (!c.pinned && (c.items || []).some((it) => it.type === 'tool' && it.target === tool)) dot(dock.querySelector(`.tile-cat[data-id="${CSS.escape(c.id)}"]`));
      }
    }
  }
  api.onLaws((st) => {
    lawsNow = st;
    drawNewsBadge();
    if (window.__lawsPanelDraw && openTool === 'laws') window.__lawsPanelDraw(st);
  });
  api.onNews((st) => {
    newsNow = st;
    drawNewsBadge();
    if (window.__newsPanelDraw && openTool === 'news') window.__newsPanelDraw(st);
  });

  const catButton = (id) => dock.querySelector(`.tile-cat[data-id="${CSS.escape(id || '')}"]`);
  function markActive() {
    for (const b of dock.querySelectorAll('.tile-cat')) {
      const on = b.dataset.id === openCatId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-expanded', String(on));
    }
  }

  // 튀어오른 메뉴를 카테고리 버튼 위에 맞춘다 (화면 밖으로 나가지 않게)
  // 메뉴·패널 크기가 바뀌면(내용을 늦게 불러오는 패널 등) 위치를 다시 맞춘다
  let lastAnchor = null;
  new ResizeObserver(() => { if (!pop.hidden && lastAnchor && lastAnchor.isConnected) anchorPop(lastAnchor); }).observe(pop);
  function anchorPop(anchorEl) {
    lastAnchor = anchorEl;
    const a = anchorEl.getBoundingClientRect();
    if (document.body.classList.contains('vertical')) {
      // 세로 배치: 독 왼쪽에, 누른 버튼 높이에 맞춰 펼친다
      const d = dock.getBoundingClientRect();
      const cy = a.top + a.height / 2;
      const ph = pop.offsetHeight;
      const top = Math.max(12, Math.min(window.innerHeight - ph - 12, cy - ph / 2));
      pop.style.left = 'auto';
      pop.style.right = `${window.innerWidth - d.left + 16}px`;
      pop.style.top = `${top}px`;
      pop.style.setProperty('--oy', `${Math.max(20, Math.min(ph - 20, cy - top))}px`);
      return;
    }
    pop.style.right = ''; pop.style.top = '';
    const center = a.left + a.width / 2;
    const w = pop.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, center - w / 2));
    pop.style.left = `${left}px`;
    const ox = Math.max(20, Math.min(w - 20, center - left));
    pop.style.setProperty('--ox', `${ox}px`);
  }

  let closeTimer = null;
  function closePop(immediate) {
    if (pop.hidden) return;
    openCatId = null;
    openTool = null;
    openQuickId = null;
    markActive();
    clearTimeout(closeTimer);
    const done = () => { pop.hidden = true; pop.innerHTML = ''; pop.classList.remove('closing'); scheduleSleep(); };
    if (immediate) return done();
    pop.classList.add('closing');
    closeTimer = setTimeout(done, 140);
  }
  window.closePop = closePop;

  function prepPop() {
    hideTip(); // 메뉴가 열리면 떠 있던 이름 풍선은 지운다 (메뉴를 가리지 않게)
    clearTimeout(closeTimer);
    pop.classList.remove('closing');
    pop.innerHTML = '';
    pop.hidden = false;
    document.body.classList.add('awake');
  }

  function toggleCategory(id) {
    if (openCatId === id && !openTool) return closePop();
    const cat = config.categories.find((c) => c.id === id);
    if (!cat) return;
    openCatId = id;
    openTool = null;
    openQuickId = null;
    markActive();
    prepPop();

    const row = document.createElement('div');
    row.className = 'row';
    const items = cat.items || [];
    // 화면 폭에 들어가면 한 줄로, 안 들어가면 여러 줄로 고르게 나눈다
    const fitW = Math.max(1, Math.floor((window.innerWidth - 40) / (52 + 8)));
    const rowsW = Math.ceil(items.length / Math.min(Math.max(items.length, 1), fitW));
    row.style.setProperty('--cols', Math.max(Math.ceil(items.length / rowsW), 1));
    if (document.body.classList.contains('vertical') && items.length) {
      // 세로 배치: 아이콘도 세로로 쌓고, 화면 높이에 다 안 들어가면 여러 줄로 고르게 나눈다
      const fit = Math.max(1, Math.floor((window.innerHeight - 40) / (52 + 8)));
      const cols = Math.ceil(items.length / Math.min(items.length, fit));
      row.style.setProperty('--cols', cols);
      row.style.setProperty('--rows', Math.ceil(items.length / cols));
    }
    if (!items.length) {
      row.style.setProperty('--cols', 1);
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.style.width = '200px';
      empty.textContent = '설정에서 메뉴를 추가하세요';
      row.style.gridTemplateColumns = 'auto';
      row.appendChild(empty);
    }
    items.forEach((item, i) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.style.setProperty('--i', i);
      b.dataset.tip = item.name;
      b.setAttribute('aria-label', item.name);
      renderItemIcon(b, item, cat.color || '#5B6B8C');
      if (item.type === 'tool') b.dataset.tool = item.target;
      b.addEventListener('click', () => activate(item, cat));
      row.appendChild(b);
    });
    const notch = document.createElement('div');
    notch.className = 'notch';
    pop.append(row, notch);
    anchorPop(catButton(id));
    drawNewsBadge();
  }

  async function activate(item, cat, anchor) {
    if (item.type === 'tool') return openPanel(item, cat, anchor);
    const res = await api.openItem(item);
    if (!res.ok) showToast(`${item.name}을(를) 열지 못했습니다: ${res.message}`);
    else closePop();
  }

  function openPanel(item, cat, anchor) {
    const tool = window.TOOLS[item.target];
    if (!tool) return showToast(`알 수 없는 도구입니다: ${item.target}`);
    if (tool.window) { closePop(); api.openToolWindow(item.target, item.name, cat.color); return; } // 따로 뜨는 창
    if (anchor) { openCatId = null; openQuickId = item.id; markActive(); } // 독에서 바로 연 패널
    openTool = item.target;
    prepPop();
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.style.setProperty('--accent', cat.color || '#9C7CF0');
    panel.innerHTML = `
      <div class="panel-head">
        <button class="icon-btn back" aria-label="뒤로" data-tip="뒤로">${window.icon('chevron-left', 18)}</button>
        <h2></h2>
        <button class="icon-btn close" aria-label="닫기" data-tip="닫기">${window.icon('x', 18)}</button>
      </div>
      <div class="panel-body"></div>`;
    panel.querySelector('h2').textContent = item.name;
    if (anchor) panel.querySelector('.back').hidden = true;
    panel.querySelector('.back').addEventListener('click', () => { const id = openCatId; openCatId = null; toggleCategory(id); });
    panel.querySelector('.close').addEventListener('click', () => closePop());
    const notch = document.createElement('div');
    notch.className = 'notch';
    pop.append(panel, notch);
    api.focusDock();
    tool.render(panel.querySelector('.panel-body'), { api, config, showToast });
    anchorPop(anchor || catButton(openCatId));
  }

  // 다른 곳을 클릭하거나 Esc를 누르면 닫기
  api.onBlur(() => closePop());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  $('#btn-settings').addEventListener('click', () => { closePop(true); api.openSettings(); });
  $('#btn-pos').addEventListener('click', () => {
    closePop(true);
    api.setDockPosition(document.body.classList.contains('vertical') ? 'bottom' : 'right');
  });

  // ---------- 녹색 불빛 (화면 보호기 차단) ----------
  const awakeBtn = $('#btn-awake');
  function renderAwake(st) {
    awakeBtn.classList.toggle('on', st.on);
    awakeBtn.classList.toggle('paused', !st.on && st.enabled && st.quiet);
    awakeBtn.setAttribute('aria-pressed', String(st.on));
    // 마우스를 올려도 설명은 띄우지 않는다 (화면 읽기 프로그램용 이름만 바꿈)
    awakeBtn.setAttribute('aria-label', st.on
      ? '화면 보호기 차단 켜짐'
      : st.enabled && st.quiet ? `화면 보호기 차단 소등 시간 ${st.quietText}` : '화면 보호기 차단 꺼짐');
  }
  awakeBtn.addEventListener('click', async () => renderAwake(await api.toggleAwake()));
  api.onAwake(renderAwake);

  // ---------- 날씨 ----------
  const weatherBtn = $('#weather');
  let weatherNow = null;
  // WMO 날씨 코드 → [설명, 아이콘(낮), 아이콘(밤)]
  function describe(code) {
    if (code === 0) return ['맑음', 'sun', 'moon'];
    if (code <= 2) return ['구름 조금', 'cloud-sun', 'cloud-moon'];
    if (code === 3) return ['흐림', 'cloud', 'cloud'];
    if (code === 45 || code === 48) return ['안개', 'cloud-fog', 'cloud-fog'];
    if (code >= 51 && code <= 57) return ['이슬비', 'cloud-drizzle', 'cloud-drizzle'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['비', 'cloud-rain', 'cloud-rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['눈', 'cloud-snow', 'cloud-snow'];
    if (code >= 95) return ['뇌우', 'cloud-lightning', 'cloud-lightning'];
    return ['날씨', 'cloud', 'cloud'];
  }
  function renderWeather(st) {
    weatherNow = st;
    if (!st) { weatherBtn.hidden = true; return; }
    weatherBtn.hidden = false;
    weatherBtn.querySelector('.w-city').textContent = st.city;
    const iconEl = weatherBtn.querySelector('.w-icon');
    if (st.error) {
      iconEl.innerHTML = window.icon('cloud', 18);
      iconEl.classList.add('cool');
      weatherBtn.querySelector('.w-temp').textContent = '--°';
      weatherBtn.dataset.tip = `${st.city} 날씨를 가져오지 못했습니다 · 누르면 다시 시도`;
      return;
    }
    const [text, dayIcon, nightIcon] = describe(st.code);
    const name = st.isDay ? dayIcon : nightIcon;
    iconEl.innerHTML = window.icon(name, 18);
    iconEl.classList.toggle('cool', !['sun', 'cloud-sun'].includes(name));
    weatherBtn.querySelector('.w-temp').textContent = `${Math.round(st.temp)}°`;
    const airEl = weatherBtn.querySelector('.w-air');
    let airText = '';
    if (st.air) {
      const names = ['좋음', '보통', '나쁨', '매우나쁨'];
      airEl.hidden = false;
      airEl.className = `w-air g${st.air.grade}`;
      airEl.textContent = names[st.air.grade];
      airText = ` · 미세먼지 ${names[st.air.grade]} (PM10 ${st.air.pm10} / PM2.5 ${st.air.pm25}㎍/㎥)`;
    } else airEl.hidden = true;
    weatherBtn.dataset.tip = `${st.city} ${text} · 최고 ${Math.round(st.max)}° / 최저 ${Math.round(st.min)}°${airText} · 누르면 자세히`;
  }
  weatherBtn.addEventListener('click', async () => {
    if (!weatherNow) return;
    if (weatherNow.error) { api.refreshWeather(); return; }
    const res = await api.openItem({ type: 'url', target: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${weatherNow.full || weatherNow.city} 날씨`)}` });
    if (!res.ok) showToast(`날씨 페이지를 열지 못했습니다: ${res.message}`);
  });
  api.onWeather(renderWeather);

  // ---------- 시계 ----------
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function tick() {
    const d = new Date();
    $('#clock-time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('#clock-date').textContent = `${d.getMonth() + 1}.${d.getDate()} (${DAYS[d.getDay()]})`;
  }
  tick();
  setInterval(tick, 1000 * 10);
  // 시계를 누르면 달력 (휴일 표시)
  const CAL_ITEM = { id: '__calendar', name: '달력', type: 'tool', target: 'calendar' };
  $('#clock').addEventListener('click', () => {
    if (openQuickId === CAL_ITEM.id) return closePop();
    openPanel(CAL_ITEM, { color: '#4C9BEF' }, $('#clock'));
  });

  window.setTimerBadge = (text) => {
    const el = $('#timer-badge');
    el.hidden = !text;
    el.textContent = text || '';
  };

  // ---------- 시작 ----------
  (async () => {
    config = await api.getConfig();
    renderDock();
    renderAwake(await api.getAwake());
    renderWeather(await api.getWeather());
    newsNow = await api.getNews();
    lawsNow = await api.getLaws();
    drawNewsBadge();
  })();
  api.onConfigChanged((cfg) => {
    config = cfg;
    iconCache.clear();
    closePop(true);
    renderDock();
  });
})();
