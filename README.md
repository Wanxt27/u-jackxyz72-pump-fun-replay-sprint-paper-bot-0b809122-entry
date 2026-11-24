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

## Dev grade

(TODO — filled in after `grade-local` runs.)

## Run

```sh
node main.ts  # reads agent-fun/replay/v2 NDJSON on stdin, replies on stdout
```

## License

MIT — see [LICENSE](LICENSE).
