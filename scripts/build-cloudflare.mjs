import { spawnSync } from 'node:child_process';

function run(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const buildEnv = {
  ...process.env,
  VITE_API_BASE_URL: '/',
  VITE_USE_DEV_API_PROXY: 'false',
  VITE_DEMO_MODE: process.env.VITE_DEMO_MODE || 'false',
};

run('npm', ['run', 'build:packages'], buildEnv);
run('npm', ['run', 'build', '--workspace', '@pcr/web'], buildEnv);

console.log(JSON.stringify({
  event: 'cloudflare.build.complete',
  commit: process.env.WORKERS_CI_COMMIT_SHA || 'local',
  apiMode: 'same-origin-worker-proxy',
}));
