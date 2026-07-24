const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadChats: () => ipcRenderer.invoke('load-chats'),
  saveChat: (chatData) => ipcRenderer.invoke('save-chat', chatData),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),
  processDocument: (fileName, arrayBuffer) => ipcRenderer.invoke('process-document', fileName, arrayBuffer),
  searchWeb: (query) => ipcRenderer.invoke('search-web', query),
  exportChat: (markdown) => ipcRenderer.invoke('export-chat', markdown),
  executeCode: (language, code) => ipcRenderer.invoke('execute-code', language, code),
  loadData: (key) => ipcRenderer.invoke('load-data', key),
  saveData: (key, data) => ipcRenderer.invoke('save-data', key, data),
  fetchYouTubeTranscript: (url) => ipcRenderer.invoke('fetch-youtube-transcript', url)
});
