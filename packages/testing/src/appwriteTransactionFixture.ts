type Row = Record<string, unknown>;
export function transactionFixture(workerSchema: Record<string, Array<{ key: string; required: boolean }>> = {}) {
  const rows = new Map<string, Row>();
  const transactions = new Map<string, { base: Map<string, Row>; staged: Map<string, Row>; reads: Set<string>; writes: Set<string> }>();
  let sequence = 0; let commits = 0; let rollbacks = 0; let failTable: string | undefined; let commitConflicts = 0;
  const calls: Array<{ method: string; input: Row }> = [];
  const error = (code: number) => Object.assign(new Error(`injected ${code}`), { code });
  const view = (id?: string) => id ? transactions.get(id)!.staged : rows;
  const mark = (id: string | undefined, key: string, write = false) => { if (id) { const tx = transactions.get(id)!; tx.reads.add(key); if (write) tx.writes.add(key); } };
  const tables = {
    async createTransaction() { const id = `tx-${++sequence}`; transactions.set(id, { base: structuredClone(rows), staged: structuredClone(rows), reads: new Set(), writes: new Set() }); return { $id: id }; },
    async updateTransaction(input: { transactionId: string; commit?: boolean; rollback?: boolean }) {
      const tx = transactions.get(input.transactionId)!;
      if (input.rollback) { rollbacks++; transactions.delete(input.transactionId); return {}; }
      if (commitConflicts > 0) { commitConflicts--; throw error(409); }
      for (const key of tx.reads) if (JSON.stringify(rows.get(key)) !== JSON.stringify(tx.base.get(key))) throw error(409);
      for (const key of tx.writes) { const value = tx.staged.get(key); if (value) rows.set(key, value); else rows.delete(key); }
      commits++; transactions.delete(input.transactionId); return {};
    },
    async getRow(input: { tableId: string; rowId: string; transactionId?: string }) {
      calls.push({ method: 'getRow', input }); const key = `${input.tableId}:${input.rowId}`; mark(input.transactionId, key);
      const row = view(input.transactionId).get(key); if (!row) throw error(404); return structuredClone(row);
    },
    async listRows(input: { tableId: string; queries?: string[]; transactionId?: string }) {
      calls.push({ method: 'listRows', input }); let values = [...view(input.transactionId)].filter(([key]) => key.startsWith(`${input.tableId}:`)).map(([, v]) => structuredClone(v));
      const queries = (input.queries ?? []).map((q) => JSON.parse(q) as { method: string; attribute: string; values: unknown[] });
      for (const q of queries) if (q.method === 'equal') values = values.filter((v) => q.values.includes(v[q.attribute]));
      const total = values.length;
      for (const q of queries) { if (q.method === 'cursorAfter') values = values.slice(values.findIndex((v) => v.$id === q.values[0]) + 1); if (q.method === 'limit') values = values.slice(0, Number(q.values[0])); }
      return { total, rows: values };
    },
    async createRow(input: { tableId: string; rowId: string; data: Row; transactionId?: string; permissions?: string[] }) {
      calls.push({ method: 'createRow', input }); const key = `${input.tableId}:${input.rowId}`;
      if (input.tableId === failTable) throw error(500);
      if (view(input.transactionId).has(key)) throw error(409);
      const columns = workerSchema[input.tableId];
      if (columns) {
        if (Object.keys(input.data).some((name) => !columns.some((c) => c.key === name))) throw new Error(`Unknown schema field in ${input.tableId}`);
        if (columns.some((c) => c.required && input.data[c.key] == null)) throw new Error(`Required schema field missing in ${input.tableId}`);
      }
      const row = { ...input.data, $id: input.rowId }; mark(input.transactionId, key, true); view(input.transactionId).set(key, row); return structuredClone(row);
    },
    async updateRow(input: { tableId: string; rowId: string; data: Row; transactionId?: string }) {
      calls.push({ method: 'updateRow', input }); const key = `${input.tableId}:${input.rowId}`;
      if (input.tableId === failTable) throw error(500);
      if (!view(input.transactionId).has(key)) throw error(404);
      mark(input.transactionId, key, true); const row = { ...view(input.transactionId).get(key), ...input.data }; view(input.transactionId).set(key, row); return structuredClone(row);
    },
    async deleteRow(input: { tableId: string; rowId: string; transactionId?: string }) { const key = `${input.tableId}:${input.rowId}`; mark(input.transactionId, key, true); view(input.transactionId).delete(key); return {}; },
  };
  return { rows, calls, services: { tables, databaseId: 'proinspect_core' }, fault: (table?: string) => { failTable = table; }, conflict: (count = 1) => { commitConflicts = count; }, stats: () => ({ commits, rollbacks }) };
}
