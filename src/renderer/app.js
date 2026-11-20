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
    tip.style.left = `${cx}px`;
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
  function renderDock() {
    document.documentElement.style.setProperty('--idle-opacity', config.appearance?.idleOpacity ?? 0.35);
    cats.innerHTML = '';
    for (const cat of config.categories) {
      const b = document.createElement('button');
      b.className = 'tile tile-cat';
      b.style.setProperty('--c', cat.color || '#5B6B8C');
      b.dataset.tip = cat.name;
      b.dataset.id = cat.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', cat.name);
      b.setAttribute('aria-expanded', 'false');
      b.innerHTML = window.icon(cat.icon || 'layout-grid', 26);
      b.addEventListener('click', () => toggleCategory(cat.id));
      cats.appendChild(b);
    }
    $('#btn-settings').innerHTML = window.icon('settings', 16);
  }

  function markActive() {
    for (const b of cats.children) {
      const on = b.dataset.id === openCatId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-expanded', String(on));
    }
  }

  // 튀어오른 메뉴를 카테고리 버튼 위에 맞춘다 (화면 밖으로 나가지 않게)
  function anchorPop(anchorEl) {
    const a = anchorEl.getBoundingClientRect();
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
    markActive();
    clearTimeout(closeTimer);
    const done = () => { pop.hidden = true; pop.innerHTML = ''; pop.classList.remove('closing'); scheduleSleep(); };
    if (immediate) return done();
    pop.classList.add('closing');
    closeTimer = setTimeout(done, 140);
  }
  window.closePop = closePop;

  function prepPop() {
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
    markActive();
    prepPop();

    const row = document.createElement('div');
    row.className = 'row';
    const items = cat.items || [];
    // 13개까지는 한 줄, 더 많으면 두 줄로 고르게 나눈다
    row.style.setProperty('--cols', items.length > 13 ? Math.ceil(items.length / 2) : Math.max(items.length, 1));
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
      b.addEventListener('click', () => activate(item, cat));
      row.appendChild(b);
    });
    const notch = document.createElement('div');
    notch.className = 'notch';
    pop.append(row, notch);
    anchorPop(cats.querySelector(`[data-id="${CSS.escape(id)}"]`));
  }

  async function activate(item, cat) {
    if (item.type === 'tool') return openPanel(item, cat);
    const res = await api.openItem(item);
    if (!res.ok) showToast(`${item.name}을(를) 열지 못했습니다: ${res.message}`);
    else closePop();
  }

  function openPanel(item, cat) {
    const tool = window.TOOLS[item.target];
    if (!tool) return showToast(`알 수 없는 도구입니다: ${item.target}`);
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
    panel.querySelector('.back').addEventListener('click', () => { const id = openCatId; openCatId = null; toggleCategory(id); });
    panel.querySelector('.close').addEventListener('click', () => closePop());
    const notch = document.createElement('div');
    notch.className = 'notch';
    pop.append(panel, notch);
    api.focusDock();
    tool.render(panel.querySelector('.panel-body'), { api, config, showToast });
    anchorPop(cats.querySelector(`[data-id="${CSS.escape(openCatId)}"]`));
  }

  // 다른 곳을 클릭하거나 Esc를 누르면 닫기
  api.onBlur(() => closePop());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  $('#btn-settings').addEventListener('click', () => { closePop(true); api.openSettings(); });

  // ---------- 녹색 불빛 (화면 보호기 차단) ----------
  const awakeBtn = $('#btn-awake');
  function renderAwake(st) {
    awakeBtn.classList.toggle('on', st.on);
    awakeBtn.classList.toggle('paused', !st.on && st.enabled && st.quiet);
    awakeBtn.setAttribute('aria-pressed', String(st.on));
    awakeBtn.dataset.tip = st.on
      ? '화면 보호기 차단 켜짐 (누르면 끔)'
      : st.enabled && st.quiet
        ? `소등 시간 ${st.quietText} · 누르면 지금 켬`
        : '화면 보호기 차단 꺼짐 (누르면 켬)';
    if (!tip.hidden && awakeBtn.matches(':hover')) showTip(awakeBtn);
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
    weatherBtn.dataset.tip = `${st.city} ${text} · 최고 ${Math.round(st.max)}° / 최저 ${Math.round(st.min)}° · 누르면 자세히`;
  }
  weatherBtn.addEventListener('click', async () => {
    if (!weatherNow) return;
    if (weatherNow.error) { api.refreshWeather(); return; }
    const res = await api.openItem({ type: 'url', target: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${weatherNow.city} 날씨`)}` });
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
  })();
  api.onConfigChanged((cfg) => {
    config = cfg;
    iconCache.clear();
    closePop(true);
    renderDock();
  });
})();
