/**
 * dsh wiring for spend-forecast: reads the cost-ledger sidecars (same JSONL
 * contract, same default dir) and projects spend. Pure math, no model surface.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-commands';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { forecast, renderForecast } from './forecast.ts';
import type { LedgerRecordLike } from './ledger-contract.ts';

export const name = 'spend-forecast';
export const inject = ['commands'];

export interface Config {
  enabled: boolean;
  dataDir?: string;
  budgetMajor: number;
  windowDays: number;
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string(),
  budgetMajor: Schema.number().default(20),
  windowDays: Schema.natural().default(7),
});

export function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

export function readLedger(dataDir: string): LedgerRecordLike[] {
  const records: LedgerRecordLike[] = [];
  if (!existsSync(dataDir)) return records;
  for (const name of readdirSync(dataDir).filter((file) => /^ledger-\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(file)).sort()) {
    for (const line of readFileSync(join(dataDir, name), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as LedgerRecordLike);
      } catch {
        // torn line — the ledger owns the file; we just skip
      }
    }
  }
  return records;
}

/** dominant currency of the recent records, for display only */
function currencyOf(records: LedgerRecordLike[]): string {
  const counts = new Map<string, number>();
  for (const record of records.slice(-50)) {
    if (record.currency) counts.set(record.currency, (counts.get(record.currency) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'CNY';
}

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('spend-forecast');
  if (!config.enabled) return void log.info('disabled by config');
  const dataDir = config.dataDir ? expandHome(config.dataDir) : join(homedir(), '.dsh', 'cost-ledger');

  ctx.commands.register({
    name: 'forecast',
    description: '花费预测：日均速率、月末预测、预算耗尽天数（读 cost-ledger 台账）',
    handler: () => {
      const records = readLedger(dataDir);
      if (!records.length) return { kind: 'error', text: `台账为空（${dataDir}）。先装 dsh-plugin-cost-ledger 积累数据。` };
      const result = forecast(records, new Date(), config.windowDays, config.budgetMajor);
      return { kind: 'success', text: renderForecast(result, currencyOf(records)) };
    },
  });

  log.info(`mounted · dataDir=${dataDir} budget=${config.budgetMajor}`);
}
