# Binance Futures Wallet Integration

The application uses the working Binance USDT-M Futures connection pattern from the supplied reference application.

- `/api/v1/exchange-keys` validates API key + secret with CCXT Binance USDM before enabling live mode.
- `/api/v1/binance/wallet` returns wallet balance, margin, available balance, unrealized PNL and open positions.
- Private wallet polling is limited to 10 seconds so it does not hammer Binance REST endpoints.
- Public market polling remains fast and independent of private account polling.
- API keys are never returned to the browser after connection; the Secret input is cleared after a successful connection.
- Keep Binance withdrawal permission disabled. Enable only Futures trading / USER_DATA as required.
- On Render, `APP_API_TOKEN` and `VITE_API_TOKEN` must match if API-token protection is enabled.
