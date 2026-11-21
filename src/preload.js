// 화면(렌더러)에서 쓸 수 있는 기능만 골라서 window.api 로 노출한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getDefaultConfig: () => ipcRenderer.invoke('config:default'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  openConfigFolder: () => ipcRenderer.invoke('config:openFolder'),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (e, cfg) => cb(cfg)),

  setIgnoreMouse: (ignore) => ipcRenderer.send('dock:ignoreMouse', ignore),
  focusDock: () => ipcRenderer.send('dock:focus'),
  onBlur: (cb) => ipcRenderer.on('dock:blur', () => cb()),
  hideDock: () => ipcRenderer.send('dock:hide'),

  openItem: (item) => ipcRenderer.invoke('item:open', item),
  fileIcon: (target) => ipcRenderer.invoke('icon:file', target),
  siteIcon: (url, refresh) => ipcRenderer.invoke('icon:site', url, refresh),
  pickImage: () => ipcRenderer.invoke('icon:pickImage'),
  pickPath: (kind) => ipcRenderer.invoke('dialog:pickPath', kind),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  clipHistory: () => ipcRenderer.invoke('clipboard:history'),
  clearClipHistory: () => ipcRenderer.invoke('clipboard:clearHistory'),

  loadMemo: () => ipcRenderer.invoke('memo:load'),
  saveMemo: (text) => ipcRenderer.invoke('memo:save', text),

  capturePage: (url, format) => ipcRenderer.invoke('capture:page', url, format),
  getWeather: () => ipcRenderer.invoke('weather:get'),
  weatherCities: () => ipcRenderer.invoke('weather:cities'),
  refreshWeather: () => ipcRenderer.invoke('weather:refresh'),
  onWeather: (cb) => ipcRenderer.on('weather:update', (e, st) => cb(st)),

  getAwake: () => ipcRenderer.invoke('awake:get'),
  toggleAwake: () => ipcRenderer.invoke('awake:toggle'),
  onAwake: (cb) => ipcRenderer.on('awake:state', (e, st) => cb(st)),

  notify: (title, body) => ipcRenderer.send('notify', title, body),
  openSettings: () => ipcRenderer.send('settings:open'),
  setSettingsDirty: (dirty) => ipcRenderer.send('settings:dirty', dirty),
  onSaveRequest: (cb) => ipcRenderer.on('settings:save-request', () => cb()),
  closeSettings: () => ipcRenderer.send('settings:close'),
  quit: () => ipcRenderer.send('app:quit'),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: (on) => ipcRenderer.invoke('login:set', on),
});
