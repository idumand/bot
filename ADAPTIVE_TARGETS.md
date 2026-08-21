# Adaptive 1x Target Engine

- Leverage is never used to choose the price target.
- Baseline target is 10% underlying market move.
- Target tiers: 3%, 5%, 10%, 15%.
- Target is selected from 15m realized volatility, spread, and composite Deep Score.
- Weak microstructure caps the target at 5%.
- Strong volatility + Deep Score can extend the target to 10% or 15%.
- Once a trade opens, its selected target is locked; the engine does not move the goalpost.
- Continuous order-book analysis can still exit early when adverse pressure is confirmed.
- Risk protection remains independent: hard stop, break-even protection, and trailing protection.
- At very high leverage the hard-stop distance tightens so liquidation is less likely to occur before the protective stop.

This is a heuristic risk/exit engine, not a guarantee of future price movement. Test in LIVE Futures before enabling live Futures trading.
