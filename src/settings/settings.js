// 설정 화면
(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const CAT_ICONS = ['globe', 'wrench', 'folder', 'sparkles', 'star', 'briefcase', 'book-open', 'landmark', 'scale',
    'building-2', 'newspaper', 'map', 'mail', 'search', 'monitor', 'terminal', 'image', 'download', 'pencil', 'link',
    'layout-grid', 'house', 'activity', 'bell'];
  const COLORS = ['#4C9BEF', '#E9A23B', '#34B89A', '#9C7CF0', '#E5667A', '#5B6B8C', '#3FA7C9', '#C98A4B'];
  const TYPES = { url: '홈페이지', app: '프로그램', folder: '폴더', tool: '유틸리티' };

  let cfg = null;
  let view = { kind: 'cat', index: 0 };
  let dirty = false;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function markDirty() {
    dirty = true;
    $('#save').disabled = false;
    $('#dirty').textContent = '저장하지 않은 변경 사항이 있습니다';
  }

  // ---------- 왼쪽 목록 ----------
  function renderSide() {
    const list = $('#cat-list');
    list.innerHTML = '';
    cfg.categories.forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<button class="nav"><span class="dot" style="--c:${esc(c.color)}">${window.icon(c.icon, 16)}</span><span></span></button>`;
      li.querySelector('span:last-child').textContent = c.name;
      const b = li.firstElementChild;
      b.classList.toggle('on', view.kind === 'cat' && view.index === i);
      b.addEventListener('click', () => { view = { kind: 'cat', index: i }; render(); });
      list.appendChild(li);
    });
    $('#nav-general').classList.toggle('on', view.kind === 'general');
  }

  // ---------- 카테고리 화면 ----------
  function renderCat() {
    const cat = cfg.categories[view.index];
    if (!cat) { view = { kind: 'general' }; return render(); }
    $('#cat-name').value = cat.name;

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
  }

  function itemRow(cat, item, i) {
    const li = document.createElement('li');
    li.className = 'item';
    li.style.setProperty('--c', cat.color);
    li.innerHTML = `
      <button class="ico" title="아이콘 이미지 바꾸기"></button>
      <input class="name" aria-label="이름">
      <select class="type" aria-label="종류">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <div class="target"></div>
      <div class="row-actions">
        <button class="icon-only up" aria-label="위로" title="위로">${window.icon('arrow-up', 16)}</button>
        <button class="icon-only down" aria-label="아래로" title="아래로">${window.icon('arrow-down', 16)}</button>
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
        if (confirm('직접 고른 아이콘을 지우고 자동 아이콘으로 돌아갈까요?')) { delete item.icon; markDirty(); renderIco(); }
        return;
      }
      const data = await api.pickImage();
      if (data) { item.icon = data; markDirty(); renderIco(); }
    });

    li.querySelector('.up').addEventListener('click', () => move(cat.items, i, -1));
    li.querySelector('.down').addEventListener('click', () => move(cat.items, i, 1));
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

  $('#cat-name').addEventListener('input', (e) => { cfg.categories[view.index].name = e.target.value; markDirty(); renderSide(); });
  $('#cat-up').addEventListener('click', () => { const i = view.index; if (i > 0) { move(cfg.categories, i, -1); view.index = i - 1; render(); } });
  $('#cat-down').addEventListener('click', () => { const i = view.index; if (i < cfg.categories.length - 1) { move(cfg.categories, i, 1); view.index = i + 1; render(); } });
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
    $('#opacity').value = op;
    $('#opacity-out').textContent = `${Math.round(op * 100)}%`;
    const q = cfg.awake?.quiet || { on: true, start: '11:30', end: '13:00' };
    $('#quiet-on').checked = q.on;
    $('#quiet-start').value = q.start;
    $('#quiet-end').value = q.end;
    $('#holidays').value = (cfg.holidays || []).join('\n');
    $('#login').checked = await api.getLogin();
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
    await api.saveConfig(JSON.parse(JSON.stringify(cfg)));
    dirty = false;
    $('#save').disabled = true;
    $('#dirty').textContent = '저장했습니다';
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty && !confirm('저장하지 않은 변경 사항이 있습니다. 닫을까요?')) e.returnValue = false;
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
