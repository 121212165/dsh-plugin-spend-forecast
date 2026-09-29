# dsh-plugin-spend-forecast

DeepSeek Harness (dsh) 插件：**花费预测**。读 [cost-ledger](https://github.com/121212165/dsh-plugin-cost-ledger) 的台账边车，算出日均花费、本月月末预测、以及按当前速率多少天烧穿预算。

适合回答："照这个速度我这个月要花多少？预算什么时候用完？"——cost-ledger 回答"已经花了多少"，本插件回答"接下来会花多少"。

同系列：[price-aware](https://github.com/121212165/dsh-plugin-price-aware) · [cost-ledger](https://github.com/121212165/dsh-plugin-cost-ledger) · [relay-quota](https://github.com/121212165/dsh-plugin-relay-quota)（中转余额，与本页口径不同：那是钱包余额，这是模型花费推算）。

## 用法

- **`/forecast`**：输出日均、本月已花、月末预测、触及预算天数。

```text
日均 $0.07（1/7 个活跃天） · 本月已花 $0.07
月末预测 $0.14（还剩 1 天）
按当前速率，276 天后触及预算 $20.00
```

## 预测口径（诚实声明）

- **日均 = 近 `windowDays` 天里"有花费的日子"的均值**，不是除以窗口全长。周末休息不会把预测砍半，窗口只用来平滑突发。因此输出会标出活跃天数（如 `1/7`）——样本少时这个数字就是不确定性本身。
- **月末预测 = 本月已花 + 日均 × 本月剩余天数**（按 UTC 日历）。
- **触及预算天数 = floor((预算 − 本月已花) / 日均)**，钳到 ≥0；没配预算或日均为 0 时不报这个数。
- 币种取自台账记录，不跨币种混算（继承 cost-ledger 的口径）。
- 前提是台账里 `costMicros` 非零——**必须在 cost-ledger 配好价目**，否则全月为 0，预测也就是 0。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | |
| `dataDir` | `~/.dsh/cost-ledger` | cost-ledger 台账目录（`ledger-YYYY-MM.jsonl`），本插件只读 |
| `budgetMajor` | `20` | 月度预算（货币整数单位，如 $20）；`0`/负数视为未设预算 |
| `windowDays` | `7` | 日均速率的回看窗口 |

## 安装

`npm i dsh-plugin-spend-forecast`；或克隆后 `npm install`（`prepare` 构建 `lib/`）再链进 profile 的 node_modules。挂载片段见 `cordis.patch.yml`。必须先装并配置 cost-ledger。

## 验证状态

- 纯函数（日均只算活跃天、月末外推、预算钳 0、剩余天数、空台账）5 个 `node --test` 全绿。
- 本机 live：读真实 cost-ledger 边车跑通，数字与手算一致。
- 未验证：跨月切换时的月末外推（只在本月内实测）。
