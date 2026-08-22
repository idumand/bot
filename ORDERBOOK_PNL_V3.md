# Order Book PnL V3

This version adds a live order-book PnL layer on top of the existing execution planner.

## What it calculates

- Entry VWAP from the first 80 executable levels.
- Immediate round-trip PnL if the position is opened and closed at the current book.
- Target exit VWAP and net PnL.
- Stop exit VWAP and net PnL.
- Exit depth sufficiency for target and stop.
- Liquidity visible on the directional path from entry to target.
- PnL at 0.10%, 0.20%, 0.30%, 0.50%, 0.75% and 1.00% moves.
- A 0-100 PnL quality score combining reward/risk and executable depth.

## Future-book assumption

The future order book is unknowable. For target/stop simulation, the current book's price axis is shifted by the projected target/stop move while preserving displayed quantities. This is deliberately exposed in the UI as a model assumption; it is not presented as a guaranteed future fill.

## Why this is different from the old EV

The previous EV used a projected fair price and an execution-cost percentage. V3 additionally asks whether the visible order book can actually provide the expected exit liquidity and how much net USDT remains after the simulated entry and exit.

## Important limitation

This is an execution/liquidity model, not a statistically calibrated profit probability. The existing `winProbability` remains a live model-confidence score and is not converted into a historical win-rate claim.

## V3.1 — Microstructure-Aware PnL

Order-book PnL is now weighted by live execution context rather than treating displayed liquidity as guaranteed future liquidity.

The execution-probability layer uses directional:
- whale flow
- absorption
- replenishment
- queue depletion
- 1s trade flow
- consumption

It produces optimistic, base and adverse target PnL plus a probability-weighted executable PnL. The adjusted expected net edge uses a 55% analytical fair-value component and 45% order-book executable component. This is a bounded scenario model, not a claim that future order-book liquidity is known.
