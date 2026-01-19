import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dataWorkbench', {
  runShell: (command) => ipcRenderer.invoke('run-shell', command),
  runPython: (code) => ipcRenderer.invoke('run-python', code),
  runNode: (code) => ipcRenderer.invoke('run-node', code),
  openFile: () => ipcRenderer.invoke('open-file'),
});
