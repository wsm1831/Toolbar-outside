# 설정 파일 형식 (config.json)

Electron 판과 이후 C# WPF 판이 **같은 파일을 그대로 읽도록** 형식을 고정해 둔다.

```jsonc
{
  "version": 19,
  "appearance": { "idleOpacity": 0.35 },
  "awake": {                       // 녹색 불빛
    "enabled": true,               // 사용자가 켜 둔 상태
    "quiet": { "on": true, "start": "11:30", "end": "13:00" }  // 소등 시간
  },
  "categories": [
    {
      "id": "web", "name": "홈페이지", "icon": "globe", "color": "#4C9BEF",
      "items": [
        { "id": "naver", "name": "네이버", "type": "url", "target": "https://www.naver.com" }
      ]
    }
  ],
  "holidays": ["2026-05-01"]
}
```

## 카테고리 목록
- 툴바는 `categories` 순서 그대로 그린다.
- `{ "id": "...", "type": "separator" }` 는 구분선. 연달아 있거나 맨 앞·끝이면 그리지 않는다.
- `"pinned": true` 인 카테고리는 버튼 없이 항목들을 툴바에 바로 놓는다(툴바 바로가기).
- 그 밖의 최상위 값: `weather`(날씨·미세먼지. `city` 이름, 직접 찾은 지역은 `full`·`lat`·`lon` 좌표도 저장), `news`(키워드 뉴스), `laws`(법령 개정 알림), `keys`(API 인증키 — 이 PC에만 저장, 배포 파일에 넣지 않음), `holidays`(직접 넣은 쉬는 날. 법정 공휴일은 자동 계산되므로 넣지 않아도 됨), `appearance.position`(`bottom` 화면 아래 가로 · `right` 오른쪽 끝 세로), `laws.hidden`(목록에서 지운 법령).

## 항목(item)

| 필드 | 설명 |
| --- | --- |
| `type` | `url` 홈페이지 · `app` 프로그램 · `folder` 폴더 · `tool` 내장 유틸리티 |
| `target` | 주소 / 실행 파일 경로(`notepad.exe`처럼 이름만 써도 됨, `ms-screenclip:` 같은 프로토콜 가능) / 폴더 경로 / 도구 이름 |
| `args` | (선택) 프로그램 실행 인자 배열 |
| `icon` | (선택) `data:image/...` 직접 고른 이미지, 또는 `builtin:<lucide 아이콘 이름>` |

- 경로에는 `%DOWNLOADS%`, `%DESKTOP%`, `%DOCUMENTS%`, `%PICTURES%`, `%HOME%` 과 Windows 환경 변수(`%USERPROFILE%` 등)를 쓸 수 있다.
- 내장 도구 이름: `memo`, `datecalc`, `unitconv`, `krmoney`, `timer`, `textclean`, `cliphistory`, `webcapture`, `news`, `laws`, `parcel`
- `version` 이 기본값보다 낮으면 기존 파일을 백업하고 `categories` 만 새 기본값으로 바꾼다.
