/** Wire tests for spend-forecast: the ledger reader against a real temp directory
 * and the real apply() against a scripted mock context. The forecast math itself
 * lives in forecast.test.ts; this file covers the seams — file scanning, config
 * probes, and what /forecast actually prints.
 * @module test/ledger */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, readLedger } from '../src/plugin.ts';

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spend-forecast-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface CapturedCommand {
  name: string;
  description: string;
  handler: () => { kind: string; text: string };
}

/** Mount the real apply() over a throwaway ledger directory. The forecast
 * contract defaults inside the temp dir too — tests must never write ~/.dsh. */
function mount(config: Record<string, unknown> = {}): { commands: CapturedCommand[]; dataDir: string } {
  const dataDir = tempDir();
  const commands: CapturedCommand[] = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {} }),
    commands: { register: (definition: CapturedCommand) => void commands.push(definition) },
  };
  apply(ctx as never, { enabled: true, dataDir, budgetMajor: 20, windowDays: 7, longWindowDays: 30, forecastPath: join(dataDir, 'forecast.json'), ...config } as never);
  return { commands, dataDir };
}

test('readLedger scans month files only, keeps the contract fields, and counts what it drops', () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, 'ledger-2026-09.jsonl'),
    [
      JSON.stringify({ at: '2026-09-29T10:00:00.000Z', costMicros: 4_000_000, currency: 'USD', modelId: 'deepseek-chat' }),
      JSON.stringify({ at: '2026-09-28T10:00:00.000Z', currency: 'USD' }),
      '{ half-written',
      JSON.stringify({ at: 'not a date', costMicros: 1 }),
      JSON.stringify({ at: '2026-09-27T10:00:00.000Z', costMicros: -5 }),
      '"a bare string"',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(join(dir, 'ledger-2026-13.jsonl'), JSON.stringify({ at: '2026-12-01T00:00:00.000Z', costMicros: 1 }), 'utf8');
  writeFileSync(join(dir, 'notes.jsonl'), JSON.stringify({ at: '2026-09-29T00:00:00.000Z', costMicros: 9 }), 'utf8');

  const { records, skipped } = readLedger(dir);
  assert.equal(records.length, 2, 'only the month-named file is read, only well-formed lines survive');
  assert.equal(skipped, 4);
  assert.equal(records[0]!.modelId, 'deepseek-chat', 'the model stamp must survive for the breakdown');
  assert.equal(records[1]!.costMicros, undefined, 'a record with no cost is still a record');

  assert.deepEqual(readLedger(join(dir, 'never-created')), { records: [], skipped: 0 });
});

test('apply mounts one command; bad windows fail loud naming the plugin', () => {
  assert.deepEqual(mount().commands.map((command) => command.name), ['forecast']);
  assert.equal(mount().commands[0]!.description.includes('双窗'), true, 'the description advertises what the panel prints');

  for (const [bad, fragment] of [
    [{ windowDays: 0 }, 'windowDays'],
    [{ windowDays: 1.5 }, 'windowDays'],
    [{ longWindowDays: -1 }, 'longWindowDays'],
    [{ budgetMajor: Number.NaN }, 'budgetMajor'],
    [{ budgetMajor: -1 }, 'budgetMajor'],
  ] as const) {
    assert.throws(() => mount(bad), new RegExp(`spend-forecast: ${fragment}`));
  }

  const off = tempDir();
  const commands: CapturedCommand[] = [];
  apply({ logger: () => ({ info() {}, warn() {}, debug() {} }), commands: { register: (d: CapturedCommand) => void commands.push(d) } } as never, {
    enabled: false,
    dataDir: off,
    budgetMajor: 20,
    windowDays: 7,
    longWindowDays: 30,
  } as never);
  assert.equal(commands.length, 0, 'disabled mounts nothing');
});

test('/forecast reads the ledger and prints both windows, the trend, and the model split', () => {
  const { commands, dataDir } = mount();
  const empty = commands[0]!.handler();
  assert.equal(empty.kind, 'error', 'an empty ledger is a refusal, not a zero-cost forecast');
  assert.ok(empty.text.includes('台账为空'), empty.text);

  const day = 86_400_000;
  const at = (ago: number): string => new Date(Date.now() - ago * day).toISOString();
  writeFileSync(
    join(dataDir, 'ledger-2026-09.jsonl'),
    [
      { at: at(0), costMicros: 4_000_000, currency: 'CNY', modelId: 'deepseek-chat' },
      { at: at(1), costMicros: 2_000_000, currency: 'CNY', modelId: 'step-5' },
      { at: at(9), costMicros: 1_000_000, currency: 'CNY', modelId: 'deepseek-chat' },
      { at: at(0), costMicros: 500_000, currency: 'USD', modelId: 'us-priced' },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
    'utf8',
  );

  const text = commands[0]!.handler().text;
  assert.ok(text.includes('短窗 7 天 ¥3.00/天'), text);
  assert.ok(text.includes('长窗 30 天 ¥2.33/天'), text);
  assert.ok(text.includes('趋势 在加速 ↑'), text);
  assert.ok(text.includes('按模型（近 7 天）：deepseek-chat ¥4.00（67%） · step-5 ¥2.00（33%）'), text);
  assert.ok(text.includes('非 CNY 记录未计入预测'), text);
  assert.ok(!text.includes('us-priced'), 'a foreign-currency model is scoped out of every line, breakdown included');
  assert.ok(text.includes('烧完预算'), text);
});

test('/forecast publishes the forecast.json contract for /today to mirror', () => {
  const { commands, dataDir } = mount();
  const day = 86_400_000;
  const at = (ago: number): string => new Date(Date.now() - ago * day).toISOString();
  writeFileSync(
    join(dataDir, 'ledger-2026-09.jsonl'),
    [
      { at: at(0), costMicros: 4_000_000, currency: 'CNY', modelId: 'deepseek-chat' },
      { at: at(1), costMicros: 2_000_000, currency: 'CNY', modelId: 'step-5' },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
    'utf8',
  );

  const result = commands[0]!.handler();
  assert.equal(result.kind, 'success');
  const summary = JSON.parse(readFileSync(join(dataDir, 'forecast.json'), 'utf8'));
  assert.equal(summary.v, 1);
  assert.equal(summary.currency, 'CNY');
  assert.equal(summary.dailyRateMicros, 3_000_000);
  assert.equal(typeof summary.daysUntilBudget, 'number');
  assert.equal(typeof summary.budgetExhaustionDate, 'string');
  assert.ok(summary.updatedAt, 'stamped with when it was computed');

  // an empty ledger refuses and must not publish a lie
  const fresh = mount();
  fresh.commands[0]!.handler();
  assert.equal(existsSync(join(fresh.dataDir, 'forecast.json')), false, 'no ledger, no contract file');
});
