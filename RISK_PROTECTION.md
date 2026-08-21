# Zarar Koruması v2

Uygulama artık üç risk profili sunar. Tüm eşikler 1x referansındaki fiyat hareketi olarak değerlendirilir; kaldıraç yalnızca marjin ROI'ını büyütür.

## 1. Muhafazakar
- Hard stop: %0,8 ters fiyat hareketi
- Başabaş koruması: +%1,0
- Trailing aktivasyonu: +%1,5
- Zirveden trailing: %0,8
- Kârda derin analiz erken çıkışı: en az +%0,3 ve 2 doğrulama
- Zararda derin analiz erken çıkışı: en az -%0,2 ve 2 doğrulama

## 2. Dengeli
- Hard stop: %1,5
- Başabaş koruması: +%2,0
- Trailing aktivasyonu: +%3,0
- Zirveden trailing: %1,2
- Kârda derin analiz erken çıkışı: en az +%0,2 ve 2 doğrulama
- Zararda derin analiz erken çıkışı: en az -%0,4 ve 2 doğrulama

## 3. Agresif
- Hard stop: %2,5
- Başabaş koruması: +%3,0
- Trailing aktivasyonu: +%5,0
- Zirveden trailing: %2,0
- Kârda derin analiz erken çıkışı: en az +%0,5 ve 3 doğrulama
- Zararda derin analiz erken çıkışı: en az -%0,7 ve 3 doğrulama

Canlı Futures modunda hard/dinamik stop Binance tarafında `STOP_MARKET` olarak korunur. Motor ayrıca order-book Deep Score ile daha erken çıkış verebilir. Aşırı kaldıraçta hard stop otomatik olarak sıkılaştırılır; amaç likidasyona yaklaşmadan pozisyonu kapatmaktır.
