import { app, BrowserWindow } from 'electron';
import { fork } from 'node:child_process';
import { join } from 'node:path';

let mainWindow = null;
let serverProcess = null;
const port = 4179;

async function waitForServer(url, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return true;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become ready at ${url}`);
}

function startServer() {
  const serverEntry = join(app.getAppPath(), 'server', 'index.mjs');
  const runtimeRoot = join(app.getPath('userData'), 'runtime');
  const publicRoot = join(app.getAppPath(), 'dist');

  serverProcess = fork(serverEntry, {
    env: {
      ...process.env,
      PORT: String(port),
      HEALTH_RECORDS_RUNTIME_ROOT: runtimeRoot,
      HEALTH_RECORDS_PUBLIC_ROOT: publicRoot
    },
    stdio: 'ignore'
  });
}

async function createWindow() {
  startServer();
  await waitForServer(`http://127.0.0.1:${port}/health`);

  mainWindow = new BrowserWindow({
    width: 1460,
    height: 980,
    minWidth: 1180,
    minHeight: 820,
    backgroundColor: '#fefbf3',
    title: 'Health Records Vault',
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
