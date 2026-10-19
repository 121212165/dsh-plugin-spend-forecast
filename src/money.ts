/**
 * Money is an integer count of micro-units (1e-6 of the billing currency).
 * The family canonical implementation lives in @dsh-family/pricing; this
 * module is a thin subpath re-export so in-plugin `./money.ts` imports stay
 * short while there is exactly one authoring source (T2-4 in
 * OPTIMIZATION-PLAN-2026-10-19).
 */
export * from '@dsh-family/pricing/money';
