import { spawn } from 'node:child_process';
const children = [
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev:api'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await Promise.race(children.map((child) => new Promise((resolve) => child.once('exit', resolve))));
stop();
