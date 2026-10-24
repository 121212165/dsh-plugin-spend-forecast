/**
 * dsh wiring for spend-forecast: reads the cost-ledger sidecars (same JSONL
 * contract, same default dir) and projects spend. Pure math, no model surface.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { LedgerRecordLike } from './ledger-contract.ts';
export declare const name = "spend-forecast";
export declare const inject: string[];
export interface Config {
    enabled: boolean;
    dataDir?: string;
    budgetMajor: number;
    windowDays: number;
    longWindowDays: number;
    /** where the published forecast contract lives; ide-hub's /today mirrors it */
    forecastPath?: string;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    dataDir: Schema<string, string>;
    budgetMajor: Schema<number, number>;
    windowDays: Schema<number, number>;
    longWindowDays: Schema<number, number>;
    forecastPath: Schema<string, string>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    dataDir: Schema<string, string>;
    budgetMajor: Schema<number, number>;
    windowDays: Schema<number, number>;
    longWindowDays: Schema<number, number>;
    forecastPath: Schema<string, string>;
}>>;
export declare function expandHome(path: string): string;
export declare function readLedger(dataDir: string): {
    records: LedgerRecordLike[];
    skipped: number;
};
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=plugin.d.ts.map