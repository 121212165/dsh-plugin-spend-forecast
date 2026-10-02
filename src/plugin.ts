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
  longWindowDays: number;
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  dataDir: Schema.string().default(''),
  budgetMajor: Schema.number().default(20),
  windowDays: Schema.natural().default(7),
  longWindowDays: Schema.natural().default(30),
});

export function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

export function readLedger(dataDir: string): { records: LedgerRecordLike[]; skipped: number } {
  const records: LedgerRecordLike[] = [];
  let skipped = 0;
  if (!existsSync(dataDir)) return { records, skipped };
  for (const name of readdirSync(dataDir).filter((file) => /^ledger-\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(file)).sort()) {
    for (const line of readFileSync(join(dataDir, name), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as LedgerRecordLike;
        // the forecast touches .at (slice/Date.parse) and .costMicros — a line
        // missing either would throw mid-aggregation, so it's skipped instead
        if (typeof value?.at !== 'string' || Number.isNaN(Date.parse(value.at))) {
          skipped++;
          continue;
        }
        if (value.costMicros !== undefined && (typeof value.costMicros !== 'number' || !Number.isFinite(value.costMicros) || value.costMicros < 0)) {
          skipped++;
          continue;
        }
        records.push(value);
      } catch {
        skipped++;
      }
    }
  }
  return { records, skipped };
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
  // Startup probe contract (family convention): a bad window must fail startup,
  // never limp along rendering a forecast built on a nonsensical window.
  if (!Number.isInteger(config.windowDays) || config.windowDays < 1) throw new TypeError('spend-forecast: windowDays must be a positive integer');
  if (!Number.isInteger(config.longWindowDays) || config.longWindowDays < 1) throw new TypeError('spend-forecast: longWindowDays must be a positive integer');
  if (!Number.isFinite(config.budgetMajor) || config.budgetMajor < 0) throw new TypeError('spend-forecast: budgetMajor must be a non-negative finite number');

  ctx.commands.register({
    name: 'forecast',
    description: '花费预测：7/30 天双窗日均与趋势、月末预测、烧完预算的日期、按模型分解（读 cost-ledger 台账）',
    handler: () => {
      const { records, skipped } = readLedger(dataDir);
      if (!records.length) return { kind: 'error', text: `台账为空（${dataDir}）。先装 dsh-plugin-cost-ledger 积累数据。` };
      // Currencies are never summed together — forecast on the dominant
      // currency's records only and say what was left out.
      const dominant = currencyOf(records);
      const scoped = records.filter((record) => !record.currency || record.currency === dominant);
      const foreign = records.length - scoped.length;
      const result = forecast(scoped, new Date(), config.windowDays, config.budgetMajor, config.longWindowDays);
      const notes: string[] = [];
      if (foreign > 0) notes.push(`另有 ${foreign} 条非 ${dominant} 记录未计入预测（币种不混算）`);
      if (skipped > 0) notes.push(`台账里有 ${skipped} 行损坏/不完整被跳过`);
      const text = renderForecast(result, dominant) + (notes.length ? `\n⚠ ${notes.join('；')}` : '');
      return { kind: 'success', text };
    },
  });

  log.info(`mounted · dataDir=${dataDir} budget=${config.budgetMajor}`);
}
