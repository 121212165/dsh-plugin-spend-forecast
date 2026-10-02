import { sumMicros, type Micros } from './money.ts';
import type { LedgerRecordLike } from './ledger-contract.ts';

/** Pure spend forecasting over cost-ledger records. The daily rate is the mean
 * spend of the trailing window **on days that had any spend** — a quiet Sunday
 * should not halve the projection; the window only smooths bursts. */

/** One trailing window's burn rate. Quiet days are excluded from the mean on
 * purpose: a Sunday with no spend should not halve the projection. */
export interface RateWindow {
  days: number;
  activeDays: number;
  dailyRateMicros: Micros;
}

export interface ModelSpend {
  model: string;
  micros: Micros;
  /** share of the window's total spend, 0..1 */
  share: number;
}

/** Short window against long window — a single average cannot say whether
 * spending is climbing or cooling, and that is the only part worth acting on. */
export type Trend = 'accelerating' | 'easing' | 'flat' | 'unknown';

export const ACCELERATING_RATIO = 1.25;
export const EASING_RATIO = 0.8;

export interface Forecast {
  /** the short (configured) window */
  windowDays: number;
  activeDays: number;
  totalMicros: number;
  dailyRateMicros: Micros;
  short: RateWindow;
  long: RateWindow;
  trend: Trend;
  rateRatio: number | null;
  byModel: ModelSpend[];
  /** YYYY-MM of "today" */
  month: string;
  daysLeftInMonth: number;
  spentThisMonthMicros: Micros;
  projectedMonthEndMicros: Micros;
  budgetMajor: number | null;
  /** days until budget exhaustion at the short-window rate; null without a budget */
  daysUntilBudget: number | null;
  /** YYYY-MM-DD the budget runs out; null when there is no budget or no rate */
  budgetExhaustionDate: string | null;
  /** projected month-end spend in whole units */
  projectedMonthEndMajor: number;
}

export function daysLeftInMonth(now: Date): number {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return end.getUTCDate() - now.getUTCDate();
}

function withinWindow(record: LedgerRecordLike, cutoff: number): boolean {
  const micros = record.costMicros ?? 0;
  return micros > 0 && Date.parse(record.at) >= cutoff;
}

export function rateWindow(records: LedgerRecordLike[], now: Date, days: number): RateWindow {
  const cutoff = now.getTime() - days * 86_400_000;
  const byDay = new Map<string, Micros>();
  for (const record of records) {
    if (!withinWindow(record, cutoff)) continue;
    const day = record.at.slice(0, 10);
    byDay.set(day, sumMicros(byDay.get(day) ?? 0, record.costMicros ?? 0));
  }
  const values = [...byDay.values()];
  return {
    days,
    activeDays: values.length,
    dailyRateMicros: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
  };
}

/** Spend split by the model that produced it, largest first, over the short window. */
export function modelBreakdown(records: LedgerRecordLike[], now: Date, days: number): ModelSpend[] {
  const cutoff = now.getTime() - days * 86_400_000;
  const byModel = new Map<string, Micros>();
  let total: Micros = 0;
  for (const record of records) {
    if (!withinWindow(record, cutoff)) continue;
    const model = record.modelId?.trim() || '未知模型';
    const micros = record.costMicros ?? 0;
    byModel.set(model, sumMicros(byModel.get(model) ?? 0, micros));
    total = sumMicros(total, micros);
  }
  return [...byModel.entries()]
    .map(([model, micros]) => ({ model, micros, share: total > 0 ? micros / total : 0 }))
    .sort((a, b) => (b.micros - a.micros || (a.model < b.model ? -1 : 1)));
}

export function trendOf(short: RateWindow, long: RateWindow): { trend: Trend; ratio: number | null } {
  if (long.dailyRateMicros <= 0 || short.dailyRateMicros <= 0) return { trend: 'unknown', ratio: null };
  const ratio = short.dailyRateMicros / long.dailyRateMicros;
  if (ratio >= ACCELERATING_RATIO) return { trend: 'accelerating', ratio };
  if (ratio <= EASING_RATIO) return { trend: 'easing', ratio };
  return { trend: 'flat', ratio };
}

export function forecast(records: LedgerRecordLike[], now: Date, windowDays: number, budgetMajor: number | null, longWindowDays = 30): Forecast {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let totalMicros: Micros = 0;
  let spentThisMonthMicros: Micros = 0;
  for (const record of records) {
    const micros = record.costMicros ?? 0;
    totalMicros = sumMicros(totalMicros, micros);
    if (record.at.slice(0, 7) === month) spentThisMonthMicros = sumMicros(spentThisMonthMicros, micros);
  }
  const short = rateWindow(records, now, windowDays);
  const long = rateWindow(records, now, Math.max(longWindowDays, windowDays));
  const { trend, ratio } = trendOf(short, long);
  const dailyRateMicros = short.dailyRateMicros;
  const left = daysLeftInMonth(now);
  const projectedMonthEndMicros = sumMicros(spentThisMonthMicros, dailyRateMicros * left);
  const projectedMonthEndMajor = projectedMonthEndMicros / 1_000_000;
  const budget = budgetMajor && budgetMajor > 0 ? budgetMajor : null;
  const daysUntilBudget = budget === null || dailyRateMicros === 0 ? null : Math.max(0, Math.floor((budget * 1_000_000 - spentThisMonthMicros) / dailyRateMicros));
  return {
    windowDays,
    activeDays: short.activeDays,
    totalMicros,
    dailyRateMicros,
    short,
    long,
    trend,
    rateRatio: ratio,
    byModel: modelBreakdown(records, now, windowDays),
    month,
    daysLeftInMonth: left,
    spentThisMonthMicros,
    projectedMonthEndMicros,
    budgetMajor: budget,
    daysUntilBudget,
    budgetExhaustionDate: daysUntilBudget === null ? null : new Date(now.getTime() + daysUntilBudget * 86_400_000).toISOString().slice(0, 10),
    projectedMonthEndMajor,
  };
}

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' };

function money(micros: Micros, currency: string): string {
  return `${SYMBOL[currency] ?? '?'}${(micros / 1_000_000).toFixed(2)}`;
}

const TREND_LABEL: Record<Trend, string> = {
  accelerating: '在加速 ↑',
  easing: '在降温 ↓',
  flat: '基本持平',
  unknown: '样本不足以判断',
};

/** How many models get named before the rest fold into 其他. */
export const MODEL_TOP_N = 5;

function renderModels(models: ModelSpend[], days: number, currency: string): string {
  if (!models.length) return '';
  const named = models.slice(0, MODEL_TOP_N);
  const rest = models.slice(MODEL_TOP_N);
  const parts = named.map((entry) => `${entry.model} ${money(entry.micros, currency)}（${Math.round(entry.share * 100)}%）`);
  if (rest.length) {
    const share = rest.reduce((total, entry) => total + entry.share, 0);
    parts.push(`其他 ${rest.length} 个 ${money(rest.reduce((total, entry) => total + entry.micros, 0), currency)}（${Math.round(share * 100)}%）`);
  }
  return `按模型（近 ${days} 天）：${parts.join(' · ')}`;
}

export function renderForecast(forecastResult: Forecast, currency: string): string {
  if (forecastResult.activeDays === 0) return '窗口内没有花费记录，无法预测。';
  const f = forecastResult;
  const lines = [
    `日均 ${money(f.dailyRateMicros, currency)}（${f.activeDays}/${f.windowDays} 个活跃天） · 本月已花 ${money(f.spentThisMonthMicros, currency)}`,
    `短窗 ${f.short.days} 天 ${money(f.short.dailyRateMicros, currency)}/天 · 长窗 ${f.long.days} 天 ${money(f.long.dailyRateMicros, currency)}/天 · 趋势 ${TREND_LABEL[f.trend]}${f.rateRatio === null ? '' : `（短/长 ${Math.round(f.rateRatio * 100)}%）`}`,
    `月末预测 ${money(f.projectedMonthEndMicros, currency)}（还剩 ${f.daysLeftInMonth} 天）`,
  ];
  if (f.daysUntilBudget !== null) {
    const budget = money((f.budgetMajor ?? 0) * 1_000_000, currency);
    lines.push(
      f.daysUntilBudget <= 0
        ? `❌ 预算 ${budget} 已用尽（按短窗速率）`
        : `按短窗速率 ${f.daysUntilBudget} 天后烧完预算 ${budget}，即 ${f.budgetExhaustionDate}`,
    );
  }
  const models = renderModels(f.byModel, f.windowDays, currency);
  if (models) lines.push(models);
  return lines.join('\n');
}
