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
  replyToMeeting: (input) => ipcRenderer.invoke(IPC.replyToMeeting, input),
  openUrl: (url) => ipcRenderer.invoke(IPC.openUrl, url),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  meetingMenu: (id) => ipcRenderer.invoke(IPC.meetingMenu, id),
  saveSettings: (u) => ipcRenderer.invoke(IPC.saveSettings, u),
  testConnection: (u) => ipcRenderer.invoke(IPC.testConnection, u),
  trustCertificate: (fp) => ipcRenderer.invoke(IPC.trustCertificate, fp),
  forgetCertificate: () => ipcRenderer.invoke(IPC.forgetCertificate),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  getNote: (id) => ipcRenderer.invoke(IPC.getNote, id),
  setNote: (id, text) => ipcRenderer.invoke(IPC.setNote, id, text),
  clearNotes: () => ipcRenderer.invoke(IPC.clearNotes),
  openLog: () => ipcRenderer.invoke(IPC.openLog),
  openSettings: () => ipcRenderer.invoke(IPC.openSettings),
  openAvailability: () => ipcRenderer.invoke(IPC.openAvailability),
  getAvailability: (r) => ipcRenderer.invoke(IPC.getAvailability, r),
  openStats: () => ipcRenderer.invoke(IPC.openStats),
  getStatsEvents: (r) => ipcRenderer.invoke(IPC.getStatsEvents, r),
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  quit: () => ipcRenderer.invoke(IPC.quit),
  onReminder: (cb) => subscribe(IPC.reminder, cb),
  getReminder: () => ipcRenderer.invoke(IPC.getReminder),
  snoozeReminder: (m) => ipcRenderer.invoke(IPC.snoozeReminder, m),
  onPopupShown: (cb) => subscribe(IPC.popupShown, () => cb()),
  onOpenEvent: (cb) => subscribe<string>(IPC.openEvent, (id) => cb(id)),
  resizePopup: (h) => ipcRenderer.send(IPC.resizePopup, h),
  resolvePeople: (q) => ipcRenderer.invoke(IPC.resolvePeople, q),
  createMeeting: (input) => ipcRenderer.invoke(IPC.createMeeting, input),
  openCreateMeeting: (prefill) => ipcRenderer.invoke(IPC.openCreateMeeting, prefill),
  getCreatePrefill: () => ipcRenderer.invoke(IPC.getCreatePrefill),
  onCreatePrefill: (cb) => subscribe(IPC.createPrefill, cb),
  openEditMeeting: (id) => ipcRenderer.invoke(IPC.openEditMeeting, id),
  editMeeting: (input) => ipcRenderer.invoke(IPC.editMeeting, input),
  cancelMeeting: (id) => ipcRenderer.invoke(IPC.cancelMeeting, id),
  openWelcome: () => ipcRenderer.invoke(IPC.openWelcome),
  finishWelcome: (openSettings) => ipcRenderer.invoke(IPC.finishWelcome, openSettings),
};

contextBridge.exposeInMainWorld('owa', api);
