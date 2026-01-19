import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    win.loadURL(devServer);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const runCommand = (command, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: process.env,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

ipcMain.handle('run-shell', async (_event, command) => {
  if (!command) {
    return { code: 1, stdout: '', stderr: 'No command provided.' };
  }
  return runCommand(command);
});

ipcMain.handle('run-python', async (_event, code) => {
  if (!code) {
    return { code: 1, stdout: '', stderr: 'No python code provided.' };
  }
  const pythonCommand = `python - <<'PY'
${code}
PY`;
  return runCommand(pythonCommand);
});

ipcMain.handle('run-node', async (_event, code) => {
  if (!code) {
    return { code: 1, stdout: '', stderr: 'No node code provided.' };
  }
  const nodeCommand = `node - <<'JS'
${code}
JS`;
  return runCommand(nodeCommand);
});

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
