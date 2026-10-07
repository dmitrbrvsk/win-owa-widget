import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type OwaApi } from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: OwaApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (cb) => subscribe(IPC.snapshot, cb),
  syncNow: () => ipcRenderer.invoke(IPC.syncNow),
  getDetails: (id) => ipcRenderer.invoke(IPC.getDetails, id),
  respond: (id, action) => ipcRenderer.invoke(IPC.respond, id, action),
  openUrl: (url) => ipcRenderer.invoke(IPC.openUrl, url),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  saveSettings: (u) => ipcRenderer.invoke(IPC.saveSettings, u),
  testConnection: (u) => ipcRenderer.invoke(IPC.testConnection, u),
  trustCertificate: (fp) => ipcRenderer.invoke(IPC.trustCertificate, fp),
  forgetCertificate: () => ipcRenderer.invoke(IPC.forgetCertificate),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  openLog: () => ipcRenderer.invoke(IPC.openLog),
  openSettings: () => ipcRenderer.invoke(IPC.openSettings),
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  quit: () => ipcRenderer.invoke(IPC.quit),
  setTrayStatus: (s) => ipcRenderer.send(IPC.setTrayStatus, s),
  onReminder: (cb) => subscribe(IPC.reminder, cb),
  getReminder: () => ipcRenderer.invoke(IPC.getReminder),
  snoozeReminder: (m) => ipcRenderer.invoke(IPC.snoozeReminder, m),
  onPopupShown: (cb) => subscribe(IPC.popupShown, () => cb()),
  onOpenEvent: (cb) => subscribe<string>(IPC.openEvent, (id) => cb(id)),
  resizePopup: (h) => ipcRenderer.send(IPC.resizePopup, h),
};

contextBridge.exposeInMainWorld('owa', api);
