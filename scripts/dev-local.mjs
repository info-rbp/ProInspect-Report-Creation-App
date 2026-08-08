import { spawn } from 'node:child_process';
const commands = [
  ['npm', ['run', 'emulators']],
  ['npm', ['run', 'dev:api']],
  ['npm', ['run', 'dev:web']],
];
const children = commands.map(([command,args]) => spawn(command, args, { stdio:'inherit', shell: process.platform === 'win32' }));
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await Promise.race(children.map((child) => new Promise((resolve) => child.once('exit', resolve)))); stop();
