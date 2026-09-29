export { name, Config, apply, inject, expandHome, readLedger } from './plugin.ts';
export type { Config as SpendForecastConfig } from './plugin.ts';
export { forecast, renderForecast, daysLeftInMonth, type Forecast } from './forecast.ts';
export type { LedgerRecordLike } from './ledger-contract.ts';
