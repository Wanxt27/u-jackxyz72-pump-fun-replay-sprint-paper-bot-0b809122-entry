// Pump.fun Replay Sprint — EMA momentum paper bot (LONG ONLY).
// (lamports of SOL per token), taken from each batch's marks, falling
// back to the latest TradeEvent reserves for mints without a mark.
// Strategy: buy a young coin ONCE, only while its fast EMA sits above
// its slow EMA and the price is stretched above the slow EMA (or the
// coin is up sharply over the last ~100 s); sell on take-profit,
// stop-loss, a max hold, or completion. Never re-buy a mint already
// traded, never short. Deterministic: no randomness, no clock, no
// network; mints processed in sorted order; ties broken by mint.

import * as readline from "node:readline";

// ---- sizing ----
const BUY_LAMPORTS = 120_000_000; // 0.12 SOL per buy (>= 0.01 SOL round-trip gate).
const SMALL_BUY_LAMPORTS = 40_000_000; // 0.04 SOL when real reserves unknown.
const ORDER_CAP_BPS = 90; // stay under the 100 bps of real reserve cap.
const MIN_ROUND_TRIP = 10_000_000; // 0.01 SOL minimum round trip.
const MAX_SLIPPAGE_BPS = 500;

// ---- trend ----
const FAST_SPAN_SLOTS = 60; // fast EMA horizon ~24 s
const SLOW_SPAN_SLOTS = 300; // slow EMA horizon ~2 min
const MIN_HISTORY = 4; // observations before a mint is buyable
const MAX_AGE_SLOTS = 12000; // only buy coins first seen within ~80 min
const STRETCH_MIN = 0.06; // +6% above the slow EMA to buy
const JUMP_MIN = 0.08; // or +8% over the last ~100 s
const JUMP_BACK_SLOTS = 250;

// ---- exits ----
const TAKE_PROFIT = 0.35; // +35% from entry
const STOP_LOSS = -0.1; // -10% from entry
const MAX_HOLD_SLOTS = 2700; // ~18 min, then exit

const MAX_POSITIONS_FALLBACK = 5; const MAX_ORDERS_FALLBACK = 16;
const HISTORY_CAP = 64; // price samples kept per mint

interface Sample {
  slot: number; price: number;
}

interface Coin {
  price: number;
  realQuote: number; // latest real quote reserves (lamports), 0 if unknown
  firstSlot: number;
  firstPrice: number;
  seen: number;
  fastEma: number; // 0 until seeded
  slowEma: number; // 0 until seeded
  history: Sample[]; // (slot, price), oldest first, one per batch observed
  entryPrice: number; // our cost per token, 0 when flat
  entrySlot: number;
}

const coins = new Map<string, Coin>(); const everBought = new Set<string>();
let maxOpenPositions = MAX_POSITIONS_FALLBACK; let maxOrdersPerBatch = MAX_ORDERS_FALLBACK;
let cashLamports = 10_000_000_000; // 10 SOL, replaced by hello capital
let orderCounter = 0;

function coinFor(mint: string, slot: number, price: number): Coin {
  let c = coins.get(mint);
  if (!c) {
    c = {
      price: 0, realQuote: 0,
      firstSlot: slot, firstPrice: price,
      seen: 0,
      fastEma: 0,
      slowEma: 0,
      history: [], entryPrice: 0, entrySlot: 0,
    };
    coins.set(mint, c);
  }
  return c;
}

// One observation per mint per batch. EMAs are seeded on the first
// observation and updated on every later one; the span is expressed
// in slots, so a mint observed every batch moves at the same rate
// regardless of how often other mints are marked.
function observe(
  mint: string,
  price: number,
  realQuote: number,
  slot: number,
): void {
  if (!(price > 0) || !Number.isFinite(price)) return;
  const c = coinFor(mint, slot, price);
  c.price = price;
  if (realQuote > 0) c.realQuote = realQuote;
  c.seen += 1;
  if (c.fastEma <= 0) {
    c.fastEma = price;
    c.slowEma = price;
  } else {
    const fastK = 2 / (FAST_SPAN_SLOTS + 1);
    const slowK = 2 / (SLOW_SPAN_SLOTS + 1);
    c.fastEma += fastK * (price - c.fastEma);
    c.slowEma += slowK * (price - c.slowEma);
  }
  const last = c.history[c.history.length - 1];
  if (!last || last.slot !== slot) {
    c.history.push({ slot, price });
    if (c.history.length > HISTORY_CAP) c.history.shift();
  } else {
    last.price = price;
  }
}

function priceBack(c: Coin, slot: number, back: number): number {
  const target = slot - back;
  for (let i = c.history.length - 1; i >= 0; i--) {
    if (c.history[i].slot <= target) return c.history[i].price;
  }
  return 0;
}

function reply(seq: number, orders: unknown[]): void {
  process.stdout.write(JSON.stringify({ type: "reply", seq, orders }) + "\n");
}

function handleBatch(msg: any): void {
  const seq: number = msg.seq; const slot: number = msg.slot;
  const orders: any[] = [];
  const seenThisBatch = new Set<string>();

  const marks: any[] = Array.isArray(msg.marks) ? msg.marks : [];
  for (const m of marks) {
    if (typeof m.mint !== "string") continue;
    const vt = Number(m.virtual_token_reserves); const vq = Number(m.virtual_quote_reserves);
    if (vt > 0 && vq > 0) {
      observe(m.mint, vq / vt, Number(m.real_quote_reserves ?? "0"), slot);
      seenThisBatch.add(m.mint);
    }
  }
  const events: any[] = Array.isArray(msg.events) ? msg.events : []; const completed = new Set<string>();
  for (const e of events) {
    if (!e || typeof e.mint !== "string") continue;
    if (e.event === "CompleteEvent") {
      completed.add(e.mint);
      continue;
    }
    if (e.event !== "TradeEvent") continue;
    if (seenThisBatch.has(e.mint)) continue;
    const vt = Number(e.virtual_token_reserves); const vs = Number(e.virtual_sol_reserves);
    if (vt > 0 && vs > 0) {
      observe(e.mint, vs / vt, Number(e.real_sol_reserves ?? "0"), slot);
      seenThisBatch.add(e.mint);
    }
  }

  const account = msg.account ?? { cash_lamports: "0", positions: [] };
  cashLamports = Number(account.cash_lamports ?? "0");
  const positions: any[] = Array.isArray(account.positions)
    ? account.positions
    : [];
  const held = new Map<string, bigint>();
  for (const p of positions) {
    if (typeof p.mint === "string") {
      held.set(p.mint, BigInt(p.token_amount ?? "0"));
    }
  }

  const fills: any[] = Array.isArray(msg.fills) ? msg.fills : [];
  for (const f of fills) {
    if (!f || f.status !== "filled" || f.side !== "buy") continue;
    const c = coins.get(f.mint);
    if (!c) continue;
    const quote = Number(f.quote_lamports ?? "0"); const tokens = Number(f.token_amount ?? "0");
    if (quote > 0 && tokens > 0) {
      c.entryPrice = quote / tokens; c.entrySlot = slot;
    }
  }

  const sellMints = [...held.keys()].sort();
  for (const mint of sellMints) {
    if (orders.length >= maxOrdersPerBatch) break;
    const tokens = held.get(mint) ?? 0n;
    if (tokens <= 0n) continue;
    const c = coins.get(mint);
    if (!c || !(c.price > 0)) continue;
    let sell = false;
    if (completed.has(mint)) sell = true;
    if (c.entryPrice > 0) {
      const ret = c.price / c.entryPrice - 1;
      if (ret <= STOP_LOSS || ret >= TAKE_PROFIT) sell = true;
    }
    if (c.entrySlot > 0 && slot - c.entrySlot >= MAX_HOLD_SLOTS) sell = true;
    if (sell) {
      orderCounter += 1;
      orders.push({
        side: "sell",
        client_id: `s-${seq}-${orderCounter}`,
        mint,
        token_amount: tokens.toString(),
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
      held.delete(mint); c.entryPrice = 0; c.entrySlot = 0;
    }
  }

  // 6. Buys: young coin, fast EMA above slow EMA and stretched above
  // it, or a sharp jump over the last ~100 s; never bought before.
  const freeSlots = maxOpenPositions - held.size;
  if (freeSlots > 0 && cashLamports > BUY_LAMPORTS) {
    const candidates: { mint: string; score: number }[] = [];
    for (const mint of [...coins.keys()].sort()) {
      if (held.has(mint)) continue;
      if (everBought.has(mint)) continue;
      const c = coins.get(mint)!;
      if (c.seen < MIN_HISTORY) continue;
      if (slot - c.firstSlot > MAX_AGE_SLOTS) continue;
      if (!(c.price > 0) || !(c.slowEma > 0)) continue;
      const uptrend = c.fastEma > c.slowEma;
      const stretch = c.price / c.slowEma - 1;
      const back = priceBack(c, slot, JUMP_BACK_SLOTS);
      const jump = back > 0 ? c.price / back - 1 : 0;
      const trendOk = uptrend && stretch >= STRETCH_MIN;
      const jumpOk = jump >= JUMP_MIN;
      if (!trendOk && !jumpOk) continue;
      candidates.push({ mint, score: Math.max(stretch, jump) });
    }
    // Strongest signal first; deterministic tie-break by mint.
    candidates.sort(
      (a, b) => b.score - a.score || (a.mint < b.mint ? -1 : 1),
    );
    for (const cand of candidates) {
      if (orders.length >= maxOrdersPerBatch) break;
      if (held.size >= maxOpenPositions) break;
      if (cashLamports <= BUY_LAMPORTS) break;
      const c = coins.get(cand.mint)!;
      let size = c.realQuote > 0 ? BUY_LAMPORTS : SMALL_BUY_LAMPORTS;
      if (c.realQuote > 0) {
        const cap = Math.floor((c.realQuote * ORDER_CAP_BPS) / 10000);
        if (cap < size) size = cap;
      }
      if (size < MIN_ROUND_TRIP) continue;
      if (size > cashLamports) continue;
      orderCounter += 1;
      orders.push({
        side: "buy",
        client_id: `b-${seq}-${orderCounter}`,
        mint: cand.mint,
        quote_lamports: String(size),
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
      held.set(cand.mint, 0n); // reserve the slot for this batch
      everBought.add(cand.mint); cashLamports -= size;
      c.entryPrice = c.price; // provisional; corrected by the fill
      c.entrySlot = slot;
    }
  }

  reply(seq, orders);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
rl.on("line", (line: string) => {
  if (!line.trim()) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === "hello") {
    if (msg.caps) {
      if (typeof msg.caps.max_open_positions === "number") {
        maxOpenPositions = msg.caps.max_open_positions;
      }
      if (typeof msg.caps.max_orders_per_batch === "number") {
        maxOrdersPerBatch = msg.caps.max_orders_per_batch;
      }
    }
    if (msg.capital && typeof msg.capital.lamports === "string") {
      cashLamports = Number(msg.capital.lamports);
    }
    return; // hello takes no reply
  }
  if (msg.type === "batch") {
    handleBatch(msg);
    return;
  }
  if (msg.type === "done") {
    rl.close(); process.exit(0);
  }
});
