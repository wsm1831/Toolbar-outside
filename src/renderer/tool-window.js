// 따로 뜨는 도구 창 (필지 조회 등). tool.html?tool=parcel&name=...&color=...
(() => {
  const q = new URLSearchParams(location.search);
  const id = q.get('tool');
  const tool = window.TOOLS[id];
  document.title = q.get('name') || window.TOOL_NAMES[id] || '업무 툴바';
  const panel = document.querySelector('.panel');
  if (q.get('color')) panel.style.setProperty('--accent', q.get('color'));
  const toast = document.getElementById('toast');
  let t = null;
  function showToast(msg, ok = false) {
    toast.textContent = msg;
    toast.classList.toggle('ok', ok);
    toast.hidden = false;
    clearTimeout(t);
    t = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  window.showToast = showToast;
  if (tool) tool.render(panel.querySelector('.panel-body'), { api: window.api, config: null, showToast });
})();
