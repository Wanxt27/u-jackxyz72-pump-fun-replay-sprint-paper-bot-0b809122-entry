# Pump Sprint — EMA Momentum Paper Bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Wanxt27/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Wanxt27/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-entry/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Referral code: `qzc860x6`

A paper-trading bot for the [Pump.fun Replay Sprint — Paper Bot, Real Ranking](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) bounty on make.fun. One program, `main.ts` (Node 22), speaking the `agent-fun/replay/v2` protocol: it reads `hello` / `batch` / `done` NDJSON on stdin and answers each batch with one `reply` carrying its orders. Paper trading only — no real funds, ever.

## Strategy

Long-only EMA momentum trend-follower, one buy per mint, ever:

- **Price** per mint = virtual quote reserves / virtual token reserves, from each batch's `marks` (falling back to the latest `TradeEvent`).
- **Buy** a young coin (first seen within ~80 min) when its fast EMA (~24 s) sits above its slow EMA (~2 min) and the price is stretched ≥6% above the slow EMA — or on a sharp jump of ≥8% over the last ~100 s.
- **Size** 0.12 SOL per buy (0.04 SOL when the mint's real reserves are unknown), always capped under 90 bps of the mint's real quote reserves, never below the 0.01 SOL round-trip gate.
- **Sell** on take-profit +35%, stop-loss −10%, a ~18 min max hold, or a `CompleteEvent`.
- **Never re-buys** a mint it already traded, and never shorts. Deterministic: no randomness, no clock, no network; mints processed in sorted order.

## Dev grade (kit's `grade-local`, `--driver process`)

- Net PnL **−0.581 SOL** on the 24 h dev window (90% interval −0.868 … −0.327 SOL), return −5.8%
- **59 coins** traded, 59 round trips (≥ 0.01 SOL each), 113 fills, win rate 8.5%
- Max drawdown **5.9%** — guardrails met (≥ 20 coins, drawdown ≤ 50%)
- Two executions reproduce byte for byte (deterministic); 16 orders rejected, 5 failed
- Fees: 0.081 SOL curve + 0.013 SOL tx; net PnL at 2× fees −0.668 SOL
- Top 3 coins made 80% of the gains; without them net PnL is −0.69 SOL

The dev window is a hard tape for momentum (most coins fade after their first spike), so the bot is built to survive it with a small drawdown and a wide coin count rather than to chase a single runner. PnL is below holding cash, so it would rank but win no prize on this window.

## Run

```sh
node main.ts  # reads agent-fun/replay/v2 NDJSON on stdin, replies on stdout
```

## License

MIT — see [LICENSE](LICENSE).
