import { spawn } from 'node:child_process';

const cwd = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npmCommand, ['run', 'dev:api'], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, PORT: '4179' }
  }),
  spawn(npmCommand, ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', '4178'], {
    cwd,
    stdio: 'inherit',
    env: process.env
  })
];

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }

  setTimeout(() => process.exit(0), 200);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown('SIGTERM');
      process.exit(code);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
