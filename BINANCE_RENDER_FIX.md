# Binance Futures + Render diagnostics

## Mum grafiği

The dashboard now accepts both legacy raw Binance kline arrays and the current backend response shape:
`{ symbol, interval, candles }`.

The backend remains the source for initial Futures candles; the browser WebSocket continues the live candle updates.

## Binance API authentication

The server now reports the actual outbound public IP and classifies common Binance errors separately:

- HTTP 451 / restricted location
- HTTP 403 / WAF or IP security block
- -2015 invalid API key, IP restriction, or permissions
- -1022 invalid signature / secret
- -1021 timestamp / clock issue
- testnet/mainnet mismatch

Render's selected service region is not the same thing as a guaranteed single outbound IP. Check the service's Outbound IP ranges in Render and compare the actual `/api/v1/ip` result with the Binance API key's IP restrictions.

For live USD-M Futures, use a mainnet Futures API key with the required account permissions. Do not put a secret key in the frontend build.
