/**
 * Wire-level (assembly layer) tests for spend-forecast: mount the real apply()
 * against a scripted cordis context, point the forecast command at a temp
 * ledger directory, and drive the ledger read → forecast → publication
 * pipeline end to end. Template: dsh-plugin-quota/test/harness.ts.
 * @module test/wire
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { apply, type Config } from '../src/plugin.ts';

interface CapturedCommand { name: string; handler: (...args: unknown[]) => unknown }

interface Ctx {
  logger: (name: string) => Record<string, unknown>;
  on: (event: string, callback: (...args: unknown[]) => unknown) => void;
  commands: { register: (definition: CapturedCommand) => void };
}

function makeCtx() {
  const commands: CapturedCommand[] = [];
  const listeners: { event: string; callback: (...args: unknown[]) => unknown }[] = [];
  const logs: string[] = [];
  const ctx: Ctx = {
    logger() {
      return { info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message), debug() {} };
    },
    on(event: string, callback: (...args: unknown[]) => unknown) {
      listeners.push({ event, callback });
    },
    commands: { register(definition: CapturedCommand) { commands.push(definition); } },
  };
  const command = (name: string): CapturedCommand => {
    const found = commands.find((candidate) => candidate.name === name);
    assert.ok(found, `command ${name} was never registered`);
    return found;
  };
  return { ctx: ctx as unknown, commands, listeners, logs, command };
}

function applyDefaults(config: Partial<Config>): Config {
  return { enabled: true, dataDir: '', budgetMajor: 20, windowDays: 7, longWindowDays: 30, forecastPath: '', ...config };
}

/** A JSONL ledger in cost-ledger's format, seeded for "today" so windows never
 *  go stale across test runs. Two models share the day: 1.2m + 0.5m micros. */
function seedLedger(dir: string, extraLine: boolean): string {
  mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  const record = (modelId: string, costMicros: number): string =>
    JSON.stringify({ v: 1, sessionId: 'sess-x', at, costMicros, currency: 'CNY', modelId, provider: 'relay' });
  const lines: string[] = [record('deepseek/deepseek-v3', 1_200_000), record('deepseek/deepseek-v3', 700_000), record('stealth/space-bunny-alpha', 500_000)];
  if (extraLine) lines.push('not-json at all', JSON.stringify({ costMicros: 100 }));
  writeFileSync(join(dir, 'ledger-2026-10.jsonl'), lines.join('\n') + '\n', 'utf8');
  return dir;
}

const work = mkdtempSync(join(tmpdir(), 'spend-forecast-wire-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('disabled config mounts nothing (an invalid window stays silent too)', () => {
  const wired = makeCtx();
  apply(wired.ctx as never, applyDefaults({ enabled: false, windowDays: 0 }));
  assert.equal(wired.commands.length, 0);
  assert.ok(wired.logs.some((line) => line.includes('disabled by config')), `disable notice logged: ${wired.logs.join('|')}`);
});

test('a bad window, long window, or budget fails startup naming spend-forecast', () => {
  for (const [key, value] of [['windowDays', 0], ['windowDays', 1.5], ['longWindowDays', -30], ['budgetMajor', -1], ['budgetMajor', Number.NaN]] as const) {
    assert.throws(() => apply(makeCtx().ctx as never, applyDefaults({ [key]: value } as Partial<Config>)), TypeError, `${key}=${value} must reject`);
  }
});

test('mount wires exactly the /forecast command pointed at the configured ledger dir', () => {
  const dataDir = join(work, 'ledger-live');
  const wired = makeCtx();
  apply(wired.ctx as never, applyDefaults({ dataDir, forecastPath: join(work, 'f.json') }));
  assert.deepEqual(wired.commands.map((candidate) => candidate.name), ['forecast']);
  assert.ok(wired.logs.some((line) => line.includes(`dataDir=${dataDir}`) && line.includes('budget=20')), `mount shadow logged: ${wired.logs.join('|')}`);
});

test('/forecast reads the temp ledger, projects, and publishes the contract file atomically', () => {
  const ledger = seedLedger(join(work, 'ledger-pub'), false);
  const forecastPath = join(work, 'published', 'forecast.json');
  const wired = makeCtx();
  apply(wired.ctx as never, applyDefaults({ dataDir: ledger, forecastPath }));

  const panel = wired.command('forecast').handler({}) as { kind: string; text: string };
  assert.equal(panel.kind, 'success');
  // all three records share today → one active day, day sum 2.4m micros is the rate
  assert.ok(panel.text.startsWith('日均 ¥2.40（1/7 个活跃天）'), `daily rate line: ${panel.text}`);
  assert.ok(panel.text.includes('月末预测 ¥'), panel.text);
  assert.ok(panel.text.includes('按模型'), panel.text);
  assert.ok(panel.text.includes('deepseek/deepseek-v3'), panel.text);
  assert.ok(panel.text.includes('天后烧完预算 ¥20.00'), `budget line: ${panel.text}`);

  const summary = JSON.parse(readFileSync(forecastPath, 'utf8')) as Record<string, unknown>;
  assert.equal(summary.v, 1);
  assert.equal(summary.currency, 'CNY', 'currency follows the ledger rows');
  assert.equal(summary.dailyRateMicros, 2_400_000);
  assert.equal(summary.spentThisMonthMicros, 2_400_000);
  assert.ok(summary.budgetExhaustionDate !== null, 'budget exhaustion date published');
  assert.equal(summary.budgetMajor, 20);
});

test('corrupt and incomplete ledger lines are skipped with a visible note, never crash the forecast', () => {
  const ledger = seedLedger(join(work, 'ledger-corrupt'), true);
  const wired = makeCtx();
  apply(wired.ctx as never, applyDefaults({ dataDir: ledger, forecastPath: join(work, 'f2.json') }));

  const panel = wired.command('forecast').handler({}) as { kind: string; text: string };
  assert.equal(panel.kind, 'success');
  assert.ok(panel.text.includes('2 行损坏/不完整被跳过'), `skip note: ${panel.text}`);
  assert.ok(panel.text.includes('⚠') || panel.text.includes('另有'), panel.text);
});

test('an empty ledger answers with a loud "empty" error instead of a fake forecast', () => {
  const empty = join(work, 'ledger-empty');
  mkdirSync(empty, { recursive: true });
  const wired = makeCtx();
  apply(wired.ctx as never, applyDefaults({ dataDir: empty, forecastPath: join(work, 'f3.json') }));

  const panel = wired.command('forecast').handler({}) as { kind: string; text: string };
  assert.equal(panel.kind, 'error');
  assert.ok(panel.text.includes(`台账为空（${empty}）`), panel.text);
  assert.ok(panel.text.includes('dsh-plugin-cost-ledger'), 'points the user at the ledger producer');
  assert.equal(
    existsJoin(work, 'f3.json'),
    false,
    'nothing was published from an empty ledger',
  );
});

function existsJoin(dir: string, name: string): boolean {
  try {
    readFileSync(join(dir, name), 'utf8');
    return true;
  } catch {
    return false;
  }
}
