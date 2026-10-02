/** The cost-ledger JSONL contract, mirrored (never imported): the forecast
 * reads only what it needs and tolerates the rest. */
export interface LedgerRecordLike {
  v?: number;
  sessionId?: string;
  at: string;
  costMicros?: number;
  currency?: string;
  buckets?: Record<string, number | undefined>;
  /** cost-ledger stamps the model pair that produced the cost */
  modelId?: string;
  provider?: string;
}
