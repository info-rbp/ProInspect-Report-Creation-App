// Production entrypoint for the Appwrite-backed notification runtime.
// The implementation lives in index.ts so development, tests and the built service
// execute the same authority model during the migration away from Firestore.
export { deliverNotification, runTenantAutomation } from './index.js';
import './index.js';
