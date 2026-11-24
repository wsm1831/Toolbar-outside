// 스크랩 창 위쪽 도구 막대. 아래쪽 페이지는 메인 프로세스의 WebContentsView 가 그린다.
// (preload가 이미 전역 'api'를 만들어 두므로, 같은 이름을 다시 선언하지 않게 함수 안에 넣는다)
(() => {
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

// 결과는 막대 안의 글자로 보여 준다 (Windows 알림이 꺼져 있어도 보이게)
const msg = document.getElementById('msg');
let msgTimer = null;
function say(title, body, bad = false) {
  msg.textContent = title;
  msg.title = body ? `${title}\n${body}` : title;
  msg.classList.toggle('bad', bad);
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { msg.textContent = ''; msg.title = ''; }, 8000);
}

async function go(format) {
  if (busy) return;
  busy = true;
  btns.forEach((b) => { b.disabled = true; });
  const label = document.getElementById(format === 'text' ? 'txt' : format);
  const old = label.textContent;
  label.textContent = format === 'text' ? '복사 중…' : '저장 중…';
  say('');
  const r = await api.clipCapture(format, bodyOnly.checked);
  label.textContent = old;
  btns.forEach((b) => { b.disabled = false; });
  busy = false;
  if (r.ok && format === 'text') {
    if (r.html) await api.writeClipboardHtml(r.text, r.html); else await api.writeClipboard(r.text);
    say(r.selection ? '선택한 부분을 복사했습니다' : '본문을 복사했습니다', `${r.length.toLocaleString()}자. 한글·워드에 붙여 넣으면 제목·표·그림 서식도 함께 들어갑니다.`);
  } else if (r.ok) say('저장했습니다', `${r.file}${r.cut ? '\n페이지가 너무 길어 아래쪽 일부는 잘렸습니다.' : ''}`);
  else if (!r.canceled) say(`저장하지 못했습니다: ${r.message}`, '', true);
}
document.getElementById('txt').addEventListener('click', () => go('text'));
document.getElementById('png').addEventListener('click', () => go('png'));
document.getElementById('pdf').addEventListener('click', () => go('pdf'));
})();
