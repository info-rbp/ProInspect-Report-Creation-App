import { access } from 'node:fs/promises';
const required = ['apps/web/package.json','apps/api/package.json','packages/domain/package.json','infrastructure/firebase/firebase.json'];
await Promise.all(required.map((path) => access(path)));
