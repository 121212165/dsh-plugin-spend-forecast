import { sumMicros, type Micros } from './money.ts';
import type { LedgerRecordLike } from './ledger-contract.ts';

/** Pure spend forecasting over cost-ledger records. The daily rate is the mean
 * spend of the trailing window **on days that had any spend** — a quiet Sunday
 * should not halve the projection; the window only smooths bursts. */

export interface Forecast {
  windowDays: number;
  activeDays: number;
  totalMicros: number;
  dailyRateMicros: Micros;
  /** YYYY-MM of "today" */
  month: string;
  daysLeftInMonth: number;
  spentThisMonthMicros: Micros;
  projectedMonthEndMicros: Micros;
  budgetMajor: number | null;
  /** days until budget exhaustion at the current rate; null without a budget */
  daysUntilBudget: number | null;
  /** projected month-end spend in whole units */
  projectedMonthEndMajor: number;
}

export function daysLeftInMonth(now: Date): number {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return end.getUTCDate() - now.getUTCDate();
}

export function forecast(records: LedgerRecordLike[], now: Date, windowDays: number, budgetMajor: number | null): Forecast {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const cutoff = Date.now() - windowDays * 86_400_000;
  const byDay = new Map<string, Micros>();
  let totalMicros: Micros = 0;
  let spentThisMonthMicros: Micros = 0;
  for (const record of records) {
    const micros = record.costMicros ?? 0;
    totalMicros = sumMicros(totalMicros, micros);
    if (record.at.slice(0, 7) === month) spentThisMonthMicros = sumMicros(spentThisMonthMicros, micros);
    if (Date.parse(record.at) >= cutoff && micros > 0) {
      const day = record.at.slice(0, 10);
      byDay.set(day, sumMicros(byDay.get(day) ?? 0, micros));
    }
  }
  const dayValues = [...byDay.values()];
  const dailyRateMicros = dayValues.length ? Math.round(dayValues.reduce((a, b) => a + b, 0) / dayValues.length) : 0;
  const left = daysLeftInMonth(now);
  const projectedMonthEndMicros = sumMicros(spentThisMonthMicros, dailyRateMicros * left);
  const projectedMonthEndMajor = projectedMonthEndMicros / 1_000_000;
  const budget = budgetMajor && budgetMajor > 0 ? budgetMajor : null;
  const daysUntilBudget = budget === null || dailyRateMicros === 0 ? null : Math.max(0, Math.floor((budget * 1_000_000 - spentThisMonthMicros) / dailyRateMicros));
  return {
    windowDays,
    activeDays: dayValues.length,
    totalMicros,
    dailyRateMicros,
    month,
    daysLeftInMonth: left,
    spentThisMonthMicros,
    projectedMonthEndMicros,
    budgetMajor: budget,
    daysUntilBudget,
    projectedMonthEndMajor,
  };
}

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' };

function money(micros: Micros, currency: string): string {
  return `${SYMBOL[currency] ?? '?'}${(micros / 1_000_000).toFixed(2)}`;
}

export function renderForecast(forecastResult: Forecast, currency: string): string {
  if (forecastResult.activeDays === 0) return '窗口内没有花费记录，无法预测。';
  const lines = [
    `日均 ${money(forecastResult.dailyRateMicros, currency)}（${forecastResult.activeDays}/${forecastResult.windowDays} 个活跃天） · 本月已花 ${money(forecastResult.spentThisMonthMicros, currency)}`,
    `月末预测 ${money(forecastResult.projectedMonthEndMicros, currency)}（还剩 ${forecastResult.daysLeftInMonth} 天）`,
  ];
  if (forecastResult.daysUntilBudget !== null) {
    lines.push(
      forecastResult.daysUntilBudget <= 0
        ? `❌ 预算 ${money((forecastResult.budgetMajor ?? 0) * 1_000_000, currency)} 已用尽`
        : `按当前速率，${forecastResult.daysUntilBudget} 天后触及预算 ${money((forecastResult.budgetMajor ?? 0) * 1_000_000, currency)}`,
    );
  }
  return lines.join('\n');
}
