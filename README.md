# dsh-plugin-spend-forecast

**EN** · Projects spend from cost-ledger sidecars: dual-window daily burn (7d vs 30d) with a trend verdict, month-end extrapolation, the exact date a budget runs dry, and a per-model breakdown (`/forecast`). · 12 `node --test` green (9 pure + 3 wire) · ran against a real ledger on this machine and matched hand calculation · month-boundary extrapolation not exercised.

DeepSeek Harness (dsh) 插件：**花费预测**。读 [cost-ledger](https://github.com/121212165/dsh-plugin-cost-ledger) 的台账边车，算出**双窗日均（7 天 vs 30 天）与趋势**、本月月末预测、烧穿预算的**具体日期**、以及这些钱花在哪个模型上。

适合回答："照这个速度我这个月要花多少？预算什么时候用完？"——cost-ledger 回答"已经花了多少"，本插件回答"接下来会花多少"。

同系列：[price-aware](https://github.com/121212165/dsh-plugin-price-aware) · [cost-ledger](https://github.com/121212165/dsh-plugin-cost-ledger) · [relay-quota](https://github.com/121212165/dsh-plugin-relay-quota)（中转余额，与本页口径不同：那是钱包余额，这是模型花费推算）。

## 用法

- **`/forecast`**：双窗日均与趋势、本月已花、月末预测、烧完预算的日期、按模型分解。

```text
日均 $3.00（2/7 个活跃天） · 本月已花 $6.00
短窗 7 天 $3.00/天 · 长窗 30 天 $2.33/天 · 趋势 在加速 ↑（短/长 129%）
月末预测 $15.00（还剩 3 天）
按短窗速率 4 天后烧完预算 $20.00，即 2026-10-06
按模型（近 7 天）：deepseek-chat $4.00（67%） · step-5 $2.00（33%）
```

## 预测口径（诚实声明）

- **日均 = 近 `windowDays` 天里"有花费的日子"的均值**，不是除以窗口全长。周末休息不会把预测砍半，窗口只用来平滑突发。因此输出会标出活跃天数（如 `1/7`）——样本少时这个数字就是不确定性本身。
- **两个窗口分开算**：短窗（`windowDays`，默认 7）说"最近这几天什么火气"，长窗（`longWindowDays`，默认 30）说"这个月的基线"。长窗永远不会比短窗窄（配 60 天短窗时两个窗口自动对齐，趋势即为持平）。
- **趋势 = 短窗日均 / 长窗日均**：≥1.25 判"在加速"、≤0.8 判"在降温"、中间是"基本持平"；任一侧没有活跃天就明说"样本不足以判断"，不硬凑一个 100%。留出 0.8–1.25 的死区是因为日均本来就抖，把抖动说成趋势等于骗人。
- **烧完预算给的是日期**：按 `floor((预算 − 本月已花) / 短窗日均)` 天推出具体那一天（`即 YYYY-MM-DD`），只报"还有 N 天"还得用户自己去翻日历。
- **按模型分解只看短窗**（前 5 个模型，其余折成"其他 N 个"），因为"上个月谁在花钱"对今天没有行动意义。
- **月末预测 = 本月已花 + 短窗日均 × 本月剩余天数**（按 UTC 日历）。
- 币种取自台账记录，不跨币种混算（继承 cost-ledger 的口径）。
- 前提是台账里 `costMicros` 非零——**必须在 cost-ledger 配好价目**，否则全月为 0，预测也就是 0。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | |
| `dataDir` | `~/.dsh/cost-ledger` | cost-ledger 台账目录（`ledger-YYYY-MM.jsonl`），本插件只读 |
| `budgetMajor` | `20` | 月度预算（货币整数单位，如 $20）；`0`/负数视为未设预算 |
| `windowDays` | `7` | 短窗：日均速率与模型分解的回看窗口 |
| `longWindowDays` | `30` | 长窗：趋势基线的回看窗口 |

## 安装

三步，实测于 `@deepseek-ai/dsh@0.1.7-alpha.1`（需 `pnpm` 在 PATH 上）：

```sh
# ① 装进 profile：dsh plugin 把参数原样转发给 pnpm，git 包会自动跑 prepare 构建 lib/
dsh plugin --profile web add github:121212165/dsh-plugin-spend-forecast
```

② 把本仓库根目录 `cordis.patch.yml` 的内容**并进** `$DSH_HOME/profiles/web/cordis.patch.yml`。
该文件默认是 `[]`，所以要么整份替换，要么把 insert 条目并进同一个数组；**不要直接追加**——
追加会形成两个 YAML 文档，启动即报
`failed to parse overlay ... end of the stream or a document separator is expected`（本机实测踩过）。

③ 重启 dsh。配置层与 client 半都要重启才生效（客户端按 boot 时算出的内容 rev 下发，硬刷新浏览器没用）。

自检挂载：`dsh --profile web --dump-config | grep dsh-plugin-spend-forecast`，应看到该条目。
## 验证状态

- 12 个 `node --test` 全绿：`test/forecast.test.ts` 9 个纯函数（双窗日均只算活跃天、趋势死区上下界、模型分组与份额、月末外推、预算钳 0 与烧完日期、空台账）+ `test/ledger.test.ts` 3 个装配层（`readLedger` 只认月份文件并计数坏行、坏配置启动点名 spend-forecast、`/forecast` 端到端读真临时台账并核对每一行输出）。
- 本机 live：读真实 cost-ledger 边车跑通，数字与手算一致。
- 未验证：跨月切换时的月末外推（只在本月内实测）。
