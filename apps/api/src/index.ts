import { createServer } from 'node:http';
import { loadRuntimeConfig } from '@pcr/config';
import { requestHandler } from './app.js';
const config = loadRuntimeConfig();
createServer(requestHandler).listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'api.started', port: config.port, environment: config.environment }));
});
