# Production Checklist

## Binance
- Exchange implementation: CCXT `binanceusdm`
- Market data: Binance USDⓈ-M Futures `fstream`
- No Spot trading path
- No dry-run trading path
- Private position sync is skipped until authenticated credentials are ready
- Render credentials: `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`

## Render
Build:
`npm install && npm run build`

Start:
`npm run start`

Recommended environment:
- `NODE_ENV=production`
- `BINANCE_API_KEY`
- `BINANCE_SECRET_KEY`
- `APP_API_TOKEN`
- `VITE_API_TOKEN` (same value as APP_API_TOKEN at build time)

## Important
Never enable Binance withdrawals for the API key.

## 2026-08 security and reliability hardening
- API routes under `/api/v1/*` require `X-API-Token`.
- Binance credentials are never returned by `/api/v1/config`.
- Live entry requires a successfully created protective STOP_MARKET; otherwise the engine attempts an emergency market close.
- Failed manual close never marks the local trade closed.
- Trading state and config persist under `PERSIST_DIR`; Render mounts `/data` as a persistent disk.
- Startup/reconnect verifies the exchange-side protective stop and recreates it when missing; if recreation fails, an emergency close is attempted.
- Multi-coin scanner evaluates liquid Futures candidates with Deep Analysis/order-book/whale confirmation.
- `/api/v1/backtest` provides historical candle-only validation. It must not be interpreted as a guarantee of live order-book performance.
- Set both `APP_API_TOKEN` and `VITE_API_TOKEN` to the same long random value in Render.
