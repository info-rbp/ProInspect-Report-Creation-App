import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppwriteServerServices } from './client.js';
type State = { raw: AppwriteServerServices; wrapped: AppwriteServerServices };
const states = new WeakMap<AppwriteServerServices, State>();
const scope = new AsyncLocalStorage<{ state: State; id: string }>();
const stagedMethods = new Set(['getRow', 'listRows', 'createRow', 'updateRow', 'upsertRow', 'deleteRow', 'incrementRowColumn', 'decrementRowColumn']);

/** Share one real TablesDB transaction across repository, audit, receipt and outbox adapters. */
export function transactionalAppwriteServices(services: AppwriteServerServices): AppwriteServerServices {
  const existing = states.get(services); if (existing) return existing.wrapped;
  const state: State = { raw: services, wrapped: services };
  const tables = new Proxy(services.tables, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (input: Record<string, unknown> = {}) => {
        const current = scope.getStore();
        if (current?.state === state) {
          if (property === 'createTransaction') return Promise.resolve({ $id: current.id });
          if (property === 'updateTransaction') {
            if (input.transactionId !== current.id) throw new Error('Nested transaction identity mismatch');
            return Promise.resolve({ $id: current.id }); // Only the outer owner commits or rolls back.
          }
          if (stagedMethods.has(String(property))) {
            if (input.transactionId && input.transactionId !== current.id) throw new Error('Transaction identity mismatch');
            return value.call(target, { ...input, transactionId: current.id });
          }
        }
        return value.call(target, input);
      };
    },
  });
  state.wrapped = { ...services, tables }; states.set(services, state); states.set(state.wrapped, state); return state.wrapped;
}
export async function inAppwriteTransaction<T>(services: AppwriteServerServices, operation: () => Promise<T>): Promise<T> {
  transactionalAppwriteServices(services); const state = states.get(services)!;
  if (scope.getStore()?.state === state) return operation();
  for (let attempt = 0; ; attempt++) {
    const tx = await state.raw.tables.createTransaction({ ttl: 60 });
    try {
      const result = await scope.run({ state, id: tx.$id }, operation);
      await state.raw.tables.updateTransaction({ transactionId: tx.$id, commit: true });
      return result;
    } catch (error) {
      await state.raw.tables.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => undefined);
      if (Number((error as { code?: number }).code) !== 409 || attempt >= 2) throw error;
    }
  }
}
