# Futures Engine Fixes

This version uses LIVE Binance USDT-M Futures only. There is no paper-trading wallet or simulated order path; P&L comes from real fills and live market data.

## Main fixes

- Binance USDT-M Futures is used for market data and candles instead of spot endpoints.
- LONG and SHORT manual entry now send real backend Futures orders.
- Closing uses `reduceOnly` and supports Binance one-way/hedge position mode.
- A protective `STOP_MARKET` is placed after a live entry; if it cannot be created, the entry is aborted/closed for safety.
- Leverage is applied through CCXT and capped by the symbol's exchange limit.
- Margin is capped by available Futures balance and `tradable_balance_ratio`; a $15 account can no longer accidentally open a $1,000 margin position.
- P&L is calculated from actual linear USDT-M quantity and fill prices:
  - gross P&L = price difference × contracts
  - ROI % = net P&L / initial margin
  - fees are included
- Frontend no longer overwrites backend P&L with stale WebSocket calculations.
- Stop-loss and take-profit values are shown as actual price levels and ROI percentages.
- Extreme leverage gets a tighter hard-stop distance so the engine does not wait for an unrealistic 2% move before reacting.
- Existing live Futures positions are synchronized from the exchange.
- External/manual closes are detected.
- The broken `isProcessingTrade` lock path is fixed.
- Undefined `TAKE_PROFIT_PCT` and several inconsistent state calculations are fixed.
- Bot status no longer reports fake open-trade counts.
- Public Futures data works in LIVE Futures without API keys.
- Real trading is only performed when `trading_mode: futures`.
- Optional `APP_API_TOKEN` / `VITE_API_TOKEN` protection was added for trade, config and control endpoints.

## Important

The configuration is **LIVE Futures only**. Binance API credentials with trading permission are required:

```json
"trading_mode": "futures"
```

and configure Binance USDT-M API keys with Futures trading permission.

For a public deployment, set the same long random value for:

- `APP_API_TOKEN`
- `VITE_API_TOKEN`

Do not enable Binance withdrawals on the API key.

The engine intentionally allows one net Futures position at a time. This avoids accidentally mixing multiple live positions while the UI remains simple and the exchange position state stays authoritative.


## 2026-08-19 — Futures Coin Arama / Algoritma Senkronizasyonu
- Yapılandırma ekranındaki coin alanı artık chip/tag tabanlı çalışıyor.
- Kullanıcı `S` gibi bir başlangıç harfi yazdığında Binance USDT-M perpetual pariteleri otomatik aranıyor; ör. SOL, SUI, SEI, 1000SHIB, SAND.
- Seçilen parite yeşil etiket olarak kutuya ekleniyor ve `exchange.pair_whitelist` içine yazılıyor.
- Etiket üzerindeki X ile coin listeden çıkarılabiliyor.
- Binance public `fapi/v1/exchangeInfo` kullanılamazsa uygulamadaki mevcut market listesi fallback olarak kullanılıyor.
- Futures motoru artık yalnızca ilk whitelist paritesine kilitlenmiyor; kayıtlı whitelist içinden en fazla 12 adayı analiz edip sinyal oluşan pariteyi seçebiliyor.
- Bir açık pozisyon varken yalnızca pozisyonun kendi paritesi analiz edilmeye devam ediyor.
- Yapılandırmadaki seçimlerin algoritmaya geçmesi için **Save Configuration** düğmesine basılması gerekir.


## 2026-08-19 — Derin Analiz / 1x Referans Hedefi / Dinamik Risk
- Kâr hedefi artık kaldıraç ROI'sine göre değil, **1x referans piyasa hareketine** göre hesaplanıyor: varsayılan hedef %10.
- Örneğin 15x pozisyonda fiyat lehine %10 hareket ederse kaldıraçlı ROI yaklaşık %150 olur (ücretler ve funding hariç); motor hedefi yine %10 fiyat hareketidir.
- Pozisyon açıkken order book her motor turunda (5 saniye) yeniden analiz ediliyor; analiz yalnızca girişte yapılmıyor.
- Derin analiz 500 order-book kademesini ve %0.1/%0.25/%0.5/%1 fiyat bantlarını kullanıyor.
- Composite Deep Score; çok bantlı OBI, Micro-Price, trade delta, VWAP konumu ve derinlik değişimini birlikte değerlendiriyor.
- Kâr oluşmuşken karşı yön Deep Score iki ardışık analiz turunda güçlenirse %10 hedef beklenmeden pozisyon kapatılıyor.
- Başlangıç zarar koruması %1.5 piyasa hareketine çekildi.
- +%2 lehine harekette break-even + ücret tamponu, +%3'te %1.2 trailing stop devreye giriyor.
- Dinamik stop canlı Binance Futures üzerinde STOP_MARKET olarak güncelleniyor.
- Binance Hedge Mode'da `reduceOnly` ile `positionSide` çakışması düzeltildi; Hedge Mode emirlerinde yalnızca uygun `positionSide` gönderiliyor.
- Arayüze Deep Score ve 1x referans hedef göstergesi eklendi.

**Not:** %10 hedef bir kâr garantisi veya piyasanın %10 yükseleceği tahmini değildir. Bu, motorun çıkış hedefidir; Deep Score yalnızca yön/mikroyapı koşullarını ölçer.

## 2026-08-20 — Spot Merkezli Matematiksel Derin Analiz

- Derin Analiz yön sinyalinin ana kaynağı Futures yerine Binance Spot order book yapıldı.
- Spot emir defterinde 500 kademe çok bantlı ve mesafeye göre ağırlıklı OBI hesaplanıyor.
- Best bid/ask Micro-Price, yakın likidite baskısı, order-book değişimi, OBI hızı ve OBI ivmesi birlikte skorlanıyor.
- Binance Spot `aggTrades` verisinden agresif alış/satış delta'sı hesaplanıyor.
- Futures order book yalnızca teyit filtresi olarak kullanılıyor; yön sinyalini tek başına değiştiremiyor.
- Composite Deep Score sigmoid fonksiyonuyla yukarı/aşağı model olasılığına çevriliyor.
- Pozisyon girişi için model olasılığı, minimum skor, Spot OBI, trade delta, OBI hızı, Futures teyidi ve spread birlikte kontrol ediliyor.
- Spot order book alınamazsa sentetik/fake order book ile canlı işlem sinyali üretilmiyor.

## Zeki Mod (Adaptive Ensemble)

Üçüncü motor olarak `engine_mode: "intelligent"` eklendi. Bu mod tek bir skorun üzerine kurulmaz; canlı order-book, micro-price, agresif akış/delta, derinlik değişimi, OBI momentum/ivmesi, Futures teyidi ve whale akışını bağımsız kanıtlar olarak birleştirir.

Ek olarak:
- piyasa rejimi kalitesi,
- sinyaller arası uyum/dağılım,
- spread ve görünür likidite kalitesi,
- trend sürekliliği,
- çatışan kanıtlar için abstain (işlemden kaçınma)

hesaplanır.

Zeki Mod sabit bir başarı yüzdesi garanti etmez ve probability alanlarını sahte bir istatistiksel doğruluk olarak kullanmaz; `edge`, `regime quality` ve `agreement` ile seçici davranır.
