// 설정 화면
(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const CAT_ICONS = ['globe', 'search', 'bot', 'factory', 'train-front', 'car-front', 'map-pinned', 'wrench', 'folder', 'sparkles', 'star', 'briefcase', 'book-open', 'landmark', 'scale',
    'building-2', 'newspaper', 'map', 'mail', 'search', 'monitor', 'terminal', 'image', 'download', 'pencil', 'link',
    'layout-grid', 'house', 'activity', 'bell'];
  const COLORS = ['#4C9BEF', '#E9A23B', '#34B89A', '#9C7CF0', '#E5667A', '#5B6B8C', '#3FA7C9', '#C98A4B'];
  const TYPES = { url: '홈페이지', app: '프로그램', folder: '폴더', tool: '내장 도구' };

  let cfg = null;
  let view = { kind: 'general' };
  let dirty = false;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 끌어서 순서 바꾸기 ----------
  // 손잡이(.grip)를 누른 채 위아래로 움직이면 놓을 자리에 파란 선이 생기고, 놓으면 순서가 바뀐다.
  // (Windows에서 브라우저 기본 드래그가 시작되지 않는 경우가 있어 마우스 움직임을 직접 따라간다)
  function sortable(container, arr, onMove) {
    container._sort = { arr, onMove };
    container.querySelectorAll('.grip').forEach((g) => g.addEventListener('pointerdown', (e) => startDrag(e, container)));
    if (container._sortReady) return;
    container._sortReady = true;
    // 끌고 난 직후의 클릭(카테고리 선택 등)은 무시
    container.addEventListener('click', (e) => {
      if (container._justDragged) { e.stopPropagation(); e.preventDefault(); container._justDragged = false; }
    }, true);
  }
  function startDrag(e, container) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const row = grip.closest('[data-idx]');
    const rows = [...container.children].filter((r) => r.dataset.idx !== undefined);
    const from = Number(row.dataset.idx);
    let to = from; let moved = false;
    const startY = e.clientY;
    grip.setPointerCapture(e.pointerId);
    const clear = () => rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    function move(ev) {
      if (!moved && Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      row.classList.add('dragging');
      document.body.classList.add('sorting');
      clear();
      // 마우스 높이에 따라 놓을 자리 계산
      let target = rows[rows.length - 1]; let after = true;
      for (const r of rows) {
        const rc = r.getBoundingClientRect();
        if (ev.clientY < rc.top + rc.height / 2) { target = r; after = false; break; }
      }
      target.classList.add(after ? 'drop-after' : 'drop-before');
      to = Number(target.dataset.idx) + (after ? 1 : 0);
      if (to > from) to -= 1;
      // 목록이 길면 가장자리에서 저절로 스크롤
      const main = document.querySelector('main');
      const mr = main.getBoundingClientRect();
      if (ev.clientY > mr.bottom - 40) main.scrollTop += 12;
      else if (ev.clientY < mr.top + 40) main.scrollTop -= 12;
    }
    function up() {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      document.body.classList.remove('sorting');
      clear();
      if (!moved) return;
      container._justDragged = true;
      setTimeout(() => { container._justDragged = false; }, 0);
      if (to === from) return;
      const { arr: list, onMove: done } = container._sort;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      markDirty();
      done(to);
    }
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  function markDirty() {
    dirty = true;
    api.setSettingsDirty(true);
    $('#save').disabled = false;
    $('#dirty').textContent = '저장하지 않은 변경 사항이 있습니다';
  }

  // ---------- 왼쪽 목록 ----------
  let curCat = null; // 선택한 카테고리 (순서가 바뀌어도 선택 유지)
  function renderSide() {
    curCat = view.kind === 'cat' ? cfg.categories[view.index] : null;
    const list = $('#cat-list');
    list.innerHTML = '';
    cfg.categories.forEach((c, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.className = 'cat-row';
      if (c.type === 'separator') {
        // 구분선: 끌어서 위치를 바꾸고, 휴지통으로 지운다
        li.classList.add('sep-row');
        li.innerHTML = `<div class="nav sep-nav"><span class="sep-line" aria-hidden="true"></span><span class="sep-label">구분선</span><span class="sep-line" aria-hidden="true"></span><button class="icon-only danger sep-del" title="구분선 지우기" aria-label="구분선 지우기">${window.icon('trash-2', 14)}</button><span class="grip" title="끌어서 위치 바꾸기">${window.icon('grip-vertical', 16)}</span></div>`;
        li.querySelector('.sep-del').addEventListener('click', () => {
          cfg.categories.splice(i, 1);
          if (view.kind === 'cat' && view.index > i) view.index -= 1;
          markDirty(); render();
        });
        list.appendChild(li);
        return;
      }
      li.innerHTML = `<button class="nav"><span class="dot" style="--c:${esc(c.color)}">${window.icon(c.icon, 16)}</span><span class="nm"></span><span class="grip" title="끌어서 순서 바꾸기">${window.icon('grip-vertical', 16)}</span></button>`;
      li.querySelector('.nm').textContent = c.name;
      const b = li.firstElementChild;
      b.classList.toggle('on', view.kind === 'cat' && view.index === i);
      b.addEventListener('click', () => { view = { kind: 'cat', index: i }; render(); });
      list.appendChild(li);
    });
    sortable(list, cfg.categories, (to) => {
      const cur = view.kind === 'cat' ? cfg.categories.indexOf(curCat) : -1;
      if (cur >= 0) view.index = cur;
      render();
    });
    $('#nav-general').classList.toggle('on', view.kind === 'general');
  }

  // ---------- 카테고리 화면 ----------
  function renderCat() {
    const cat = cfg.categories[view.index];
    if (!cat || cat.type === 'separator') { view = { kind: 'general' }; return render(); }
    $('#cat-name').value = cat.name;
    $('#cat-pinned').checked = !!cat.pinned;

    const ig = $('#cat-icons');
    ig.innerHTML = '';
    for (const n of CAT_ICONS) {
      const b = document.createElement('button');
      b.innerHTML = window.icon(n, 18);
      b.setAttribute('aria-label', n);
      b.classList.toggle('on', cat.icon === n);
      b.addEventListener('click', () => { cat.icon = n; markDirty(); render(); });
      ig.appendChild(b);
    }
    const sw = $('#cat-colors');
    sw.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', c);
      b.classList.toggle('on', cat.color === c);
      b.addEventListener('click', () => { cat.color = c; markDirty(); render(); });
      sw.appendChild(b);
    }

    const ol = $('#items');
    ol.innerHTML = '';
    cat.items.forEach((item, i) => ol.appendChild(itemRow(cat, item, i)));
    sortable(ol, cat.items, () => renderCat());
  }

  function itemRow(cat, item, i) {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.idx = i;
    li.style.setProperty('--c', cat.color);
    li.innerHTML = `
      <span class="grip" title="끌어서 순서 바꾸기" aria-hidden="true">${window.icon('grip-vertical', 18)}</span>
      <button class="ico" title="아이콘 이미지 바꾸기"></button>
      <input class="name" aria-label="이름">
      <select class="type" aria-label="종류">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <div class="target"></div>
      <div class="row-actions">
        <select class="move" aria-label="위치" title="위치: 다른 카테고리로 옮기기"></select>
        <button class="icon-only danger del" aria-label="삭제" title="삭제">${window.icon('trash-2', 16)}</button>
      </div>`;
    const name = li.querySelector('.name');
    name.value = item.name;
    name.addEventListener('input', () => { item.name = name.value; markDirty(); });
    const type = li.querySelector('.type');
    type.value = item.type;
    type.addEventListener('change', () => {
      item.type = type.value;
      item.target = item.type === 'tool' ? 'memo' : '';
      markDirty(); renderCat();
    });

    // 대상 입력칸
    const tg = li.querySelector('.target');
    if (item.type === 'tool') {
      const sel = document.createElement('select');
      sel.innerHTML = Object.entries(window.TOOL_NAMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
      sel.value = item.target;
      sel.addEventListener('change', () => { item.target = sel.value; markDirty(); renderIco(); });
      tg.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.value = item.target;
      inp.placeholder = { url: 'https://…', app: 'C:\\Program Files\\…\\app.exe 또는 notepad.exe', folder: 'D:\\업무 또는 %DOWNLOADS%' }[item.type];
      inp.setAttribute('aria-label', '주소 또는 경로');
      inp.addEventListener('input', () => { item.target = inp.value; markDirty(); });
      inp.addEventListener('change', renderIco);
      tg.appendChild(inp);
      if (item.type !== 'url') {
        const b = document.createElement('button');
        b.className = 'ghost';
        b.textContent = '찾아보기';
        b.addEventListener('click', async () => {
          const p = await api.pickPath(item.type);
          if (p) { item.target = p; inp.value = p; markDirty(); renderIco(); }
        });
        tg.appendChild(b);
      }
    }

    // 아이콘 미리보기
    const ico = li.querySelector('.ico');
    async function renderIco() {
      ico.className = 'ico';
      const ic = item.icon || '';
      if (ic.startsWith('data:')) { ico.classList.add('paper'); ico.innerHTML = `<img alt="" src="${esc(ic)}">`; return; }
      if (ic.startsWith('builtin:')) { ico.innerHTML = window.icon(ic.slice(8), 20); return; }
      if (item.type === 'tool') { ico.innerHTML = window.icon(window.TOOLS[item.target]?.icon || 'sparkles', 20); return; }
      if (item.type === 'folder') { ico.innerHTML = window.icon('folder-open', 20); return; }
      ico.textContent = (item.name || '?').charAt(0);
      if (!item.target) return;
      const data = item.type === 'url' ? await api.siteIcon(item.target) : await api.fileIcon(item.target);
      if (data) { ico.classList.add('paper'); ico.innerHTML = `<img alt="" src="${esc(data)}">`; }
    }
    renderIco();
    ico.addEventListener('click', async () => {
      if (item.icon && item.icon.startsWith('data:')) {
        if (confirm('직접 고른 아이콘을 지우고 자동 아이콘으로 돌아갈까요?')) { delete item.icon; delete item.iconCustom; delete item.iconScale; markDirty(); renderIco(); }
        return;
      }
      const data = await api.pickImage();
      if (data) { item.icon = data; item.iconCustom = true; markDirty(); renderIco(); }
    });

    // 위치: 다른 카테고리로 옮기기
    const mv = li.querySelector('.move');
    cfg.categories.forEach((c, ci) => {
      if (c.type === 'separator') return;
      const label = `위치: ${c.name}${c.pinned ? ' (툴바에 바로)' : ''}`;
      mv.add(new Option(label, ci, false, ci === view.index));
    });
    mv.addEventListener('change', () => {
      const to = cfg.categories[Number(mv.value)];
      const [moved] = cat.items.splice(i, 1);
      to.items.push(moved);
      markDirty(); renderCat();
      $('#dirty').textContent = `'${moved.name}' 항목을 '${to.name}'(으)로 옮겼습니다 · 저장하면 적용됩니다`;
    });

    // 키보드: Alt+↑/↓ 로도 순서 바꾸기
    li.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      move(cat.items, i, e.key === 'ArrowUp' ? -1 : 1);
    });
    li.querySelector('.del').addEventListener('click', () => {
      if (!confirm(`'${item.name}' 항목을 삭제할까요?`)) return;
      cat.items.splice(i, 1); markDirty(); renderCat();
    });
    return li;
  }

  function move(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    markDirty();
    render();
  }

  $('#cat-pinned').addEventListener('change', (e) => {
    const cat = cfg.categories[view.index];
    if (e.target.checked) cat.pinned = true; else delete cat.pinned;
    markDirty(); renderCat();
  });
  $('#cat-name').addEventListener('input', (e) => { cfg.categories[view.index].name = e.target.value; markDirty(); renderSide(); });
  $('#cat-del').addEventListener('click', () => {
    const c = cfg.categories[view.index];
    if (!confirm(`'${c.name}' 카테고리와 안의 항목 ${c.items.length}개를 삭제할까요?`)) return;
    cfg.categories.splice(view.index, 1);
    view = cfg.categories.length ? { kind: 'cat', index: 0 } : { kind: 'general' };
    markDirty(); render();
  });
  $('#add-cat').addEventListener('click', () => {
    cfg.categories.push({ id: uid(), name: '새 카테고리', icon: 'star', color: COLORS[cfg.categories.length % COLORS.length], items: [] });
    view = { kind: 'cat', index: cfg.categories.length - 1 };
    markDirty(); render();
    $('#cat-name').select();
  });
  $('#add-sep').addEventListener('click', () => {
    cfg.categories.push({ id: uid(), type: 'separator' });
    markDirty(); render();
  });
  $('#add-item').addEventListener('click', () => {
    const cat = cfg.categories[view.index];
    const type = cat.items[cat.items.length - 1]?.type || 'url';
    cat.items.push({ id: uid(), name: '새 항목', type, target: type === 'tool' ? 'memo' : '' });
    markDirty(); renderCat();
    const rows = document.querySelectorAll('#items .item .name');
    rows[rows.length - 1].select();
  });

  // ---------- 일반 설정 ----------
  async function renderGeneral() {
    const op = cfg.appearance?.idleOpacity ?? 0.35;
    posAtLoad = (cfg.appearance && cfg.appearance.position) === 'right' ? 'right' : 'bottom';
    document.querySelectorAll('input[name="dock-pos"]').forEach((r) => { r.checked = r.value === posAtLoad; });
    $('#opacity').value = op;
    $('#opacity-out').textContent = `${Math.round(op * 100)}%`;
    const q = cfg.awake?.quiet || { on: true, start: '11:30', end: '13:00' };
    $('#quiet-on').checked = q.on;
    $('#quiet-start').value = q.start;
    $('#quiet-end').value = q.end;
    $('#holidays').value = (cfg.holidays || []).join('\n');
    const w = { on: true, city: '서울', air: true, ...(cfg.weather || {}) };
    $('#weather-on').checked = w.on;
    $('#weather-air').checked = w.air;
    setWeatherOption(w);
    const n = { on: true, keywords: [], notify: false, ...(cfg.news || {}) };
    $('#news-on').checked = n.on;
    $('#news-notify').checked = n.notify;
    $('#news-kw').value = n.keywords.join('\n');
    $('#key-vworld').value = (cfg.keys && cfg.keys.vworld) || '';
    $('#key-law').value = (cfg.keys && cfg.keys.lawOC) || '';
    $('#key-data').value = (cfg.keys && cfg.keys.dataGoKr) || '';
    showHol(await api.getHolidays());
    const L = { on: true, notify: false, items: ['산업입지 및 개발에 관한 법률', '산업집적활성화 및 공장설립에 관한 법률', '산업단지 인ㆍ허가 절차 간소화를 위한 특례법', '국토의 계획 및 이용에 관한 법률', '공익사업을 위한 토지 등의 취득 및 보상에 관한 법률'], ...(cfg.laws || {}) };
    $('#laws-on').checked = L.on;
    $('#laws-notify').checked = L.notify;
    $('#laws-items').value = L.items.join('\n');
    $('#login').checked = await api.getLogin();
  }
  let posAtLoad = 'bottom';
  document.querySelectorAll('input[name="dock-pos"]').forEach((r) => r.addEventListener('change', () => {
    cfg.appearance = { ...(cfg.appearance || {}), position: r.value };
    markDirty();
  }));
  // 설정 창을 연 뒤 툴바 버튼으로 위치를 바꿨다면, 여기서 위치를 고치지 않은 한 그 위치를 그대로 둔다
  async function keepDockPosition(c) {
    const now = (c.appearance && c.appearance.position) === 'right' ? 'right' : 'bottom';
    if (now !== posAtLoad) return c;
    const live = await api.getConfig();
    c.appearance = { ...(c.appearance || {}), position: (live.appearance && live.appearance.position) || 'bottom' };
    return c;
  }
  $('#opacity').addEventListener('input', (e) => {
    cfg.appearance = cfg.appearance || {};
    cfg.appearance.idleOpacity = Number(e.target.value);
    $('#opacity-out').textContent = `${Math.round(e.target.value * 100)}%`;
    markDirty();
  });
  const quietSync = () => {
    cfg.awake = cfg.awake || { enabled: true };
    cfg.awake.quiet = { on: $('#quiet-on').checked, start: $('#quiet-start').value || '11:30', end: $('#quiet-end').value || '13:00' };
    markDirty();
  };
  ['#quiet-on', '#quiet-start', '#quiet-end'].forEach((s) => $(s).addEventListener('change', quietSync));
  // 날씨 지역: 찾기로 고른 지역(이름·좌표)만 쓴다. 예전 설정의 목록 지역(이름만)도 그대로 동작
  let place = null;
  function setWeatherOption(w) {
    place = { city: w.city, ...(w.lat && w.lon ? { full: w.full || w.city, lat: w.lat, lon: w.lon } : {}) };
    $('#weather-cur').textContent = place.full || place.city;
  }
  const weatherSync = () => {
    cfg.weather = { on: $('#weather-on').checked, air: $('#weather-air').checked, ...place };
    markDirty();
  };
  async function findPlace() {
    const q = $('#weather-q').value.trim();
    const box = $('#weather-results');
    if (!q) return;
    box.hidden = false;
    box.innerHTML = '<li class="empty">찾는 중…</li>';
    const list = await api.weatherSearch(q);
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<li class="empty">찾지 못했습니다. 시·군 이름으로 다시 찾아보세요.</li>'; return; }
    for (const p of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.full;
      b.addEventListener('click', () => {
        setWeatherOption({ city: p.name, full: p.full, lat: p.lat, lon: p.lon });
        box.hidden = true; $('#weather-q').value = '';
        weatherSync();
      });
      li.appendChild(b); box.appendChild(li);
    }
  }
  $('#weather-find').addEventListener('click', findPlace);
  $('#weather-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findPlace(); } });
  $('#weather-on').addEventListener('change', weatherSync);
  $('#weather-air').addEventListener('change', weatherSync);
  const newsSync = () => {
    cfg.news = {
      on: $('#news-on').checked,
      notify: $('#news-notify').checked,
      keywords: $('#news-kw').value.split('\n').map((k) => k.trim()).filter(Boolean).slice(0, 10),
    };
    markDirty();
  };
  ['#news-on', '#news-notify'].forEach((q) => $(q).addEventListener('change', newsSync));
  $('#news-kw').addEventListener('input', newsSync);
  $('#key-vworld').addEventListener('input', (e) => {
    cfg.keys = { ...(cfg.keys || {}), vworld: e.target.value.trim() };
    markDirty();
  });
  $('#key-data').addEventListener('input', (e) => {
    cfg.keys = { ...(cfg.keys || {}), dataGoKr: e.target.value.trim() };
    markDirty();
  });
  function showHol(h) {
    const el = $('#hol-status');
    if (h && h.updatedAt) {
      el.textContent = `자동 공휴일 ${h.dates.length}일 (${h.years.join('·')}년, ${new Date(h.updatedAt).toLocaleDateString('ko-KR')} 갱신)${h.error ? ` · ${h.error}` : ''}`;
    } else el.textContent = h && h.error ? h.error : '자동 공휴일을 아직 받지 않았습니다.';
  }
  $('#hol-refresh').addEventListener('click', async (e) => {
    if (dirty) { $('#hol-status').textContent = '먼저 저장을 눌러 인증키를 저장해 주세요.'; return; }
    e.target.disabled = true; $('#hol-status').textContent = '받는 중…';
    showHol(await api.refreshHolidays(true)); e.target.disabled = false;
  });
  $('#key-law').addEventListener('input', (e) => {
    cfg.keys = { ...(cfg.keys || {}), lawOC: e.target.value.trim() };
    markDirty();
  });
  const lawsSync = () => {
    cfg.laws = {
      on: $('#laws-on').checked,
      notify: $('#laws-notify').checked,
      items: $('#laws-items').value.split('\n').map((k) => k.trim()).filter(Boolean).slice(0, 20),
    };
    markDirty();
  };
  ['#laws-on', '#laws-notify'].forEach((q) => $(q).addEventListener('change', lawsSync));
  $('#laws-items').addEventListener('input', lawsSync);
  document.querySelectorAll('.keyshow').forEach((b) => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.for);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.textContent = inp.type === 'password' ? '보기' : '숨기기';
  }));
  $('#holidays').addEventListener('input', (e) => {
    cfg.holidays = e.target.value.split(/\s+/).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    markDirty();
  });
  $('#login').addEventListener('change', async (e) => { e.target.checked = await api.setLogin(e.target.checked); });
  $('#open-folder').addEventListener('click', () => api.openConfigFolder());
  $('#reset').addEventListener('click', async () => {
    if (!confirm('모든 메뉴와 설정을 처음 상태로 되돌릴까요? 저장을 눌러야 적용됩니다.')) return;
    cfg = await api.getDefaultConfig();
    view = { kind: 'cat', index: 0 };
    markDirty(); render();
  });
  $('#nav-general').addEventListener('click', () => { view = { kind: 'general' }; render(); });

  // ---------- 저장 ----------
  $('#save').addEventListener('click', async () => {
    await api.saveConfig(await keepDockPosition(JSON.parse(JSON.stringify(cfg))));
    dirty = false;
    api.setSettingsDirty(false);
    $('#save').disabled = true;
    $('#dirty').textContent = '저장했습니다';
  });
  // 창을 닫을 때 저장하지 않은 변경이 있으면 메인 프로세스가 물어본다. '저장하고 닫기'를 고르면 여기서 저장한다.
  api.onSaveRequest(async () => {
    await api.saveConfig(await keepDockPosition(JSON.parse(JSON.stringify(cfg))));
    dirty = false;
    api.setSettingsDirty(false);
    api.closeSettings();
  });

  function render() {
    renderSide();
    $('#view-cat').hidden = view.kind !== 'cat';
    $('#view-general').hidden = view.kind !== 'general';
    if (view.kind === 'cat') renderCat(); else renderGeneral();
  }

  (async () => {
    cfg = await api.getConfig();
    $('#save').disabled = true;
    render();
  })();
})();
