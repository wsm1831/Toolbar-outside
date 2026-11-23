// 스크랩 창 위쪽 도구 막대. 아래쪽 페이지는 메인 프로세스의 WebContentsView 가 그린다.
const api = window.api;
const addr = document.getElementById('addr');
const btns = [...document.querySelectorAll('.btn')];
const bodyOnly = document.getElementById('body');
let busy = false;

document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => api.clipNav(b.dataset.a)));
addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { api.clipNav('go', addr.value); addr.blur(); } });
addr.addEventListener('focus', () => addr.select());

api.onClipState((st) => {
  if (document.activeElement !== addr) addr.value = st.url || '';
  document.querySelector('[data-a="back"]').disabled = !st.canBack;
  document.querySelector('[data-a="fwd"]').disabled = !st.canFwd;
  document.querySelector('[data-a="reload"]').textContent = st.loading ? '×' : '↻';
  document.title = st.title ? `스크랩 창 - ${st.title}` : '스크랩 창';
});
api.clipState();

// 막대 높이가 낮아 결과는 알림으로 보여 준다
function say(title, body) { api.notify(title, body || ''); }

async function go(format) {
  if (busy) return;
  busy = true;
  btns.forEach((b) => { b.disabled = true; });
  const label = document.getElementById(format === 'text' ? 'txt' : format);
  const old = label.textContent;
  label.textContent = '저장 중…';
  const r = await api.clipCapture(format, bodyOnly.checked);
  label.textContent = old;
  btns.forEach((b) => { b.disabled = false; });
  busy = false;
  if (r.ok && format === 'text') {
    await api.writeClipboard(r.text);
    say(r.selection ? '선택한 부분을 복사했습니다' : '본문을 복사했습니다', `${r.length.toLocaleString()}자. 한글·워드에 붙여 넣으세요.`);
  } else if (r.ok) say('저장했습니다', `${r.file}${r.cut ? '\n페이지가 너무 길어 아래쪽 일부는 잘렸습니다.' : ''}`);
  else if (!r.canceled) say('저장하지 못했습니다', r.message);
}
document.getElementById('txt').addEventListener('click', () => go('text'));
document.getElementById('png').addEventListener('click', () => go('png'));
document.getElementById('pdf').addEventListener('click', () => go('pdf'));
