# 설정 파일 형식 (config.json)

Electron 판과 이후 C# WPF 판이 **같은 파일을 그대로 읽도록** 형식을 고정해 둔다.

```jsonc
{
  "version": 1,
  "appearance": { "idleOpacity": 0.35, "tileSize": 52 },
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
  "holidays": ["2026-01-01"]
}
```

## 항목(item)

| 필드 | 설명 |
| --- | --- |
| `type` | `url` 홈페이지 · `app` 프로그램 · `folder` 폴더 · `tool` 내장 유틸리티 |
| `target` | 주소 / 실행 파일 경로(`notepad.exe`처럼 이름만 써도 됨, `ms-screenclip:` 같은 프로토콜 가능) / 폴더 경로 / 도구 이름 |
| `args` | (선택) 프로그램 실행 인자 배열 |
| `icon` | (선택) `data:image/...` 직접 고른 이미지, 또는 `builtin:<lucide 아이콘 이름>` |

- 경로에는 `%DOWNLOADS%`, `%DESKTOP%`, `%DOCUMENTS%`, `%PICTURES%`, `%HOME%` 과 Windows 환경 변수(`%USERPROFILE%` 등)를 쓸 수 있다.
- 내장 도구 이름: `memo`, `datecalc`, `timer`, `textclean`, `cliphistory`
