export interface StoredRow extends Record<string, unknown> {
  $id: string;
  agencyId?: string;
}

export interface ListRowsResult<T extends StoredRow> { total: number; rows: T[]; }

export interface TablesGateway {
  createRow<T extends StoredRow>(input: { tableId: string; rowId: string; data: Omit<T, '$id'>; permissions?: string[]; transactionId?: string }): Promise<T>;
  getRow<T extends StoredRow>(tableId: string, rowId: string): Promise<T>;
  updateRow<T extends StoredRow>(input: { tableId: string; rowId: string; data: Partial<Omit<T, '$id'>>; permissions?: string[]; transactionId?: string }): Promise<T>;
  listRows<T extends StoredRow>(tableId: string, queries: string[]): Promise<ListRowsResult<T>>;
  createTransaction(ttlSeconds?: number): Promise<string>;
  commitTransaction(transactionId: string): Promise<void>;
  rollbackTransaction(transactionId: string): Promise<void>;
}
