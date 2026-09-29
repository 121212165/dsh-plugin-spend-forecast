import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forecast, renderForecast, daysLeftInMonth } from '../src/forecast.ts';
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
