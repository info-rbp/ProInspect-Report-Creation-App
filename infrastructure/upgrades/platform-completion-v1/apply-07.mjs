import { insertAfter, replaceOnce } from './patch-lib.mjs';

const offlineReceiptTable = `  agencyEntity('offline_sync_receipts', [str('inspectionJobId',36,true),str('operationId',128,true),str('operation',128,true),str('deviceId',128),str('userId',36,true),str('entityType',96),str('entityId',36),integer('baseVersion'),integer('resultVersion'),str('payloadHash',64,true),str('resultHash',64),datetime('receivedAt',true),datetime('appliedAt'),text('conflictReason')], [unique('operation_once',['agencyId','operationId']),index('job_received',['inspectionJobId','receivedAt']),index('user_received',['userId','receivedAt']),index('status_received',['status','receivedAt'])]),\n`;

export async function applyStage07() {
  insertAfter(
    'infrastructure/appwrite/tables/schema.mjs',
    "  agencyEntity('route_plan_stops', [str('routePlanId',36,true),str('propertyId',36),str('inspectionJobId',36),integer('sequence',true),str('status',32),number('latitude'),number('longitude'),datetime('eta'),datetime('arrivedAt'),datetime('departedAt')], [index('plan_sequence',['routePlanId','sequence']),index('job_status',['inspectionJobId','status'])]),\n",
    offlineReceiptTable,
    'offline sync receipt table',
  );
  replaceOnce(
    'infrastructure/appwrite/tables/schema.test.mjs',
    "'external_access_grants','client_approvals'])",
    "'external_access_grants','client_approvals','offline_sync_receipts'])",
    'offline receipt schema contract',
  );
  replaceOnce(
    'infrastructure/appwrite/tables/schema.test.mjs',
    'expect(allTables).toHaveLength(120);',
    'expect(allTables).toHaveLength(121);',
    '121-table Stage 7 baseline',
  );
}
