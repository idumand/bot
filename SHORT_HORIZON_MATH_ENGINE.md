# Short-Horizon Live Math Engine

Bu katman geçmiş veri, backtest veya öğrenilmiş örneklem kullanmaz. Yalnızca canlı order book ve çok kısa süreli websocket trade akışı üzerinden çalışır.

## Motorlar

- MicroPrice / front-book pressure
- Liquidity Vacuum: fiyatın +1/+2/+5 bps önündeki karşı likidite
- Liquidity Path Resistance
- Price Impact: hedeflenen notional ile book üzerinde beklenen etki
- Trade Flow Acceleration: 100/250/500/1000 ms akış farkları
- Absorption / Rejection: agresif işlem ile fiyat cevabının uyuşmazlığı
- Freshness / latency gate
- Short-Horizon Score ve 0–5 saniyelik hedef tahmini

## Giriş kuralı

Bir yön yalnızca short-horizon motoru ile mevcut Scalp V2 yönü aynıysa, canlı book yeterince tazeyse, path resistance ve impact düşükse ve absorption ters yönde güçlü değilse girişe aday olur.

## Hedef

Motor kısa vadeli hareketi bps cinsinden tahmin eder ve yaklaşık ETA üretir. Bu bir istatistiksel kazanma garantisi değildir; canlı mikro-yapıdan türetilmiş muhafazakâr bir projeksiyondur.

## Veri politikası

- Kalıcı geçmiş market verisi yok.
- Kapanmış trade geçmişi yok.
- Backtest yok.
- Öğrenme/optimizer sample yok.
- Yalnızca canlı bağlantının gerektirdiği kısa rolling trade penceresi ve anlık order-book durumu kullanılır.
