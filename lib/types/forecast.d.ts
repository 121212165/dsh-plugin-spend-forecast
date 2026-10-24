import { type Micros } from './money.ts';
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
export declare const ACCELERATING_RATIO = 1.25;
export declare const EASING_RATIO = 0.8;
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
export declare function daysLeftInMonth(now: Date): number;
export declare function rateWindow(records: LedgerRecordLike[], now: Date, days: number): RateWindow;
/** Spend split by the model that produced it, largest first, over the short window. */
export declare function modelBreakdown(records: LedgerRecordLike[], now: Date, days: number): ModelSpend[];
export declare function trendOf(short: RateWindow, long: RateWindow): {
    trend: Trend;
    ratio: number | null;
};
export declare function forecast(records: LedgerRecordLike[], now: Date, windowDays: number, budgetMajor: number | null, longWindowDays?: number): Forecast;
/** The published contract for /today: ide-hub mirrors this file (separate
 * packages cannot import each other). Append-only — fields may be added later,
 * never renamed or redefined. */
export interface ForecastSummary {
    v: 1;
    updatedAt: string;
    currency: string;
    dailyRateMicros: Micros;
    trend: Trend;
    month: string;
    spentThisMonthMicros: Micros;
    projectedMonthEndMajor: number;
    budgetMajor: number | null;
    daysUntilBudget: number | null;
    budgetExhaustionDate: string | null;
}
export declare function composeForecastSummary(result: Forecast, currency: string, now?: Date): ForecastSummary;
/** How many models get named before the rest fold into 其他. */
export declare const MODEL_TOP_N = 5;
export declare function renderForecast(forecastResult: Forecast, currency: string): string;
//# sourceMappingURL=forecast.d.ts.map