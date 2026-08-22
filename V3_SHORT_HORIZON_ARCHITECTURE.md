# V3 Short-Horizon Architecture

Canlı karar zinciri:

8X venues + Binance Futures book + live trades
→ MicroPrice / front pressure
→ Liquidity Vacuum
→ Path Resistance (+1/+2/+5 bps)
→ Price Impact
→ Trade Flow Acceleration (100/250/500/1000 ms)
→ Absorption/Rejection
→ Freshness/Latency Gate
→ Short-Horizon Score
→ Live Execution Simulator
→ Fair Value / Expected Move / ETA
→ Expected Value + execution cost gate
→ IOC limit entry (no chase)
→ Dynamic EV exit / TP1 / runner / hard stop

Veri politikası:
- Kalıcı market history: YOK
- Closed trade history: YOK
- Backtest: YOK
- Learning: YOK
- Optimizer sample: YOK
- Sadece canlı karar için gereken çok kısa rolling trade buffer + anlık order book state
