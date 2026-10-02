export { name, Config, apply, inject, expandHome, readLedger } from './plugin.ts';
export type { Config as SpendForecastConfig } from './plugin.ts';
export {
  forecast,
  renderForecast,
  daysLeftInMonth,
  rateWindow,
  modelBreakdown,
  trendOf,
  ACCELERATING_RATIO,
  EASING_RATIO,
  MODEL_TOP_N,
  type Forecast,
  type RateWindow,
  type ModelSpend,
  type Trend,
} from './forecast.ts';
export type { LedgerRecordLike } from './ledger-contract.ts';
