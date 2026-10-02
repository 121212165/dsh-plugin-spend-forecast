import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCELERATING_RATIO, EASING_RATIO, MODEL_TOP_N, forecast, modelBreakdown, rateWindow, renderForecast, daysLeftInMonth, trendOf } from '../src/forecast.ts';
import type { LedgerRecordLike } from '../src/ledger-contract.ts';

const NOW = new Date('2026-09-29T12:00:00.000Z'); // 1 day left in September

const record = (day: string, costMicros: number): LedgerRecordLike => ({ at: `${day}T10:00:00.000Z`, costMicros, currency: 'USD' });

test('daysLeftInMonth counts UTC calendar days', () => {
  assert.equal(daysLeftInMonth(NOW), 1);
  assert.equal(daysLeftInMonth(new Date('2026-09-01T00:00:00.000Z')), 29);
});

test('rate averages active days only; quiet days do not dilute', () => {
  // 4 active days within the 7d window (each 2_000_000), plus a zero-cost day outside
  const records = [
    record('2026-09-23', 2_000_000),
    record('2026-09-25', 2_000_000),
    record('2026-09-27', 2_000_000),
    record('2026-09-29', 2_000_000),
    record('2026-09-29', 0),
  ];
  const result = forecast(records, NOW, 7, null);
  assert.equal(result.dailyRateMicros, 2_000_000);
  assert.equal(result.activeDays, 4);
  assert.equal(result.daysLeftInMonth, 1);
  assert.equal(result.projectedMonthEndMicros, 8_000_000 + 2_000_000); // this-month 8M + 1 day left
  assert.equal(result.daysUntilBudget, null); // no budget configured
});

test('records outside the window and previous months are excluded from the rate', () => {
  const records = [record('2026-09-10', 9_000_000), record('2026-08-29', 9_000_000), record('2026-09-29', 1_000_000)];
  const result = forecast(records, NOW, 7, null);
  assert.equal(result.dailyRateMicros, 1_000_000);
  assert.equal(result.spentThisMonthMicros, 10_000_000); // includes the 09-10 outlier this month
});

test('budget countdown uses integer floor and flags exhaustion', () => {
  const records = [record('2026-09-29', 3_000_000)];
  const result = forecast(records, NOW, 7, 10);
  assert.equal(result.daysUntilBudget, 2); // (10-3)/3 = 2.33 → 2
  const exhausted = forecast(records, NOW, 7, 2);
  assert.equal(exhausted.daysUntilBudget, 0);
  assert.ok(renderForecast(exhausted, 'USD').includes('已用尽'));
});

test('no data renders a clean fallback', () => {
  assert.ok(renderForecast(forecast([], NOW, 7, null), 'USD').includes('无法预测'));
  const text = renderForecast(forecast([record('2026-09-29', 1_000_000)], NOW, 7, null), 'USD');
  assert.ok(text.includes('$1.00'));
  assert.ok(text.includes('月末预测'));
});

const stamp = (at: string, costMicros: number, modelId?: string): LedgerRecordLike => ({ at, costMicros, currency: 'USD', ...(modelId ? { modelId } : {}) });

/** Short window hot, long window cooler, one August outlier that must not count. */
const spread: LedgerRecordLike[] = [
  stamp('2026-09-29T10:00:00.000Z', 4_000_000, 'deepseek-chat'),
  stamp('2026-09-29T11:00:00.000Z', 500_000),
  stamp('2026-09-28T10:00:00.000Z', 4_000_000, 'step-5'),
  stamp('2026-09-01T10:00:00.000Z', 1_000_000, 'deepseek-chat'),
  stamp('2026-08-20T10:00:00.000Z', 9_000_000, 'long-gone'),
];

test('dual windows: the 7d rate says today, the 30d rate says the baseline', () => {
  assert.deepEqual(rateWindow(spread, NOW, 7), { days: 7, activeDays: 2, dailyRateMicros: 4_250_000 });
  assert.deepEqual(rateWindow(spread, NOW, 30), { days: 30, activeDays: 3, dailyRateMicros: 3_166_667 });
  assert.equal(rateWindow(spread, NOW, 1).activeDays, 1, 'only 09-29 falls in a one-day window');
  assert.deepEqual(rateWindow([], NOW, 7), { days: 7, activeDays: 0, dailyRateMicros: 0 });

  const result = forecast(spread, NOW, 7, 20);
  assert.equal(result.short.days, 7);
  assert.equal(result.long.days, 30);
  assert.equal(result.dailyRateMicros, result.short.dailyRateMicros, 'the headline rate stays the short window');
  assert.equal(result.trend, 'accelerating');
  assert.ok(result.rateRatio !== null && result.rateRatio > 1.3 && result.rateRatio < 1.35, String(result.rateRatio));
  assert.equal(result.spentThisMonthMicros, 9_500_000, 'the August outlier is out of this month');
  assert.equal(result.projectedMonthEndMicros, 9_500_000 + 4_250_000);
  assert.equal(result.daysUntilBudget, 2, 'floor((20M - 9.5M) / 4.25M)');
  assert.equal(result.budgetExhaustionDate, '2026-10-01', 'the plan wants a date, not a bare day count');
});

test('a short window never longer than the long one cannot invent a trend', () => {
  const cases: Array<[number, number, string]> = [
    [1_250_000, 1_000_000, 'accelerating'],
    [1_249_999, 1_000_000, 'flat'],
    [800_000, 1_000_000, 'easing'],
    [800_001, 1_000_000, 'flat'],
  ];
  for (const [shortRate, longRate, expected] of cases) {
    const got = trendOf({ days: 7, activeDays: 1, dailyRateMicros: shortRate }, { days: 30, activeDays: 9, dailyRateMicros: longRate });
    assert.equal(got.trend, expected, `${shortRate}/${longRate}`);
  }
  assert.equal(ACCELERATING_RATIO, 1.25);
  assert.equal(EASING_RATIO, 0.8, 'the two thresholds leave a dead band, not a knife edge');
  assert.deepEqual(trendOf({ days: 7, activeDays: 0, dailyRateMicros: 0 }, { days: 30, activeDays: 9, dailyRateMicros: 1_000_000 }), { trend: 'unknown', ratio: null });
  assert.deepEqual(trendOf({ days: 7, activeDays: 3, dailyRateMicros: 1_000_000 }, { days: 30, activeDays: 0, dailyRateMicros: 0 }), { trend: 'unknown', ratio: null });

  // a configured window of 60 days must not be "shorter than" the long window
  const wide = forecast(spread, NOW, 60, null, 30);
  assert.equal(wide.long.days, 60, 'the long window is never narrower than the short one');
  assert.equal(wide.trend, 'flat', 'same window against itself is by definition flat');
});

test('spend is broken down by the model that produced it', () => {
  const models = modelBreakdown(spread, NOW, 7);
  assert.deepEqual(models.map((entry) => entry.model), ['deepseek-chat', 'step-5', '未知模型'], 'ties sort by name, missing model is named honestly');
  assert.equal(models[0]!.micros, 4_000_000);
  assert.ok(Math.abs(models.reduce((total, entry) => total + entry.share, 0) - 1) < 1e-9);
  assert.equal(models[2]!.share, 0.5 / 8.5);
  assert.deepEqual(modelBreakdown(spread, NOW, 1).map((entry) => entry.model), ['deepseek-chat', '未知模型'], 'the 09-28 step-5 spend is outside a one-day window');
  assert.deepEqual(modelBreakdown([], NOW, 7), []);

  const many = Array.from({ length: MODEL_TOP_N + 2 }, (_, index) => stamp('2026-09-29T10:00:00.000Z', (index + 1) * 1_000_000, `model-${index}`));
  const rendered = renderForecast(forecast(many, NOW, 7, null), 'USD');
  assert.ok(rendered.includes('其他 2 个 $3.00（11%）'), rendered);
});

test('the render carries the trend, the exhaustion date, and the model split', () => {
  const text = renderForecast(forecast(spread, NOW, 7, 20), 'USD');
  assert.ok(text.includes('短窗 7 天 $4.25/天 · 长窗 30 天 $3.17/天'), text);
  assert.ok(text.includes('趋势 在加速 ↑（短/长 134%）'), text);
  assert.ok(text.includes('2 天后烧完预算 $20.00，即 2026-10-01'), text);
  assert.ok(text.includes('按模型（近 7 天）：deepseek-chat $4.00（47%） · step-5 $4.00（47%） · 未知模型 $0.50（6%）'), text);

  // no budget configured means no exhaustion line at all, not a zero-day one
  const noBudget = renderForecast(forecast(spread, NOW, 7, null), 'USD');
  assert.ok(!noBudget.includes('烧完'), noBudget);
  assert.ok(noBudget.includes('月末预测 $13.75'), noBudget);
});
