# Zarar Koruması v2

Uygulama artık üç risk profili sunar. Tüm eşikler 1x referansındaki fiyat hareketi olarak değerlendirilir; kaldıraç yalnızca marjin ROI'ını büyütür.

## Varsayılan
- Başlangıç profili: **Muhafazakar**
- Seçilen profil Profesyonel + Algoritma + Yapay Zekâ modlarının tamamına ortak uygulanır.
- Yapay Zekâ ayrıca pozisyon ve kaldıraç kararlarını bu profilin üst sınırları içinde verir.

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

## 3. Riskli
- Hard stop: %2,5
- Başabaş koruması: +%3,0
- Trailing aktivasyonu: +%5,0
- Zirveden trailing: %2,0
- Kârda derin analiz erken çıkışı: en az +%0,5 ve 3 doğrulama
- Zararda derin analiz erken çıkışı: en az -%0,7 ve 3 doğrulama

Canlı Futures modunda hard/dinamik stop Binance tarafında `STOP_MARKET` olarak korunur. Motor ayrıca order-book Deep Score ile daha erken çıkış verebilir. Aşırı kaldıraçta hard stop otomatik olarak sıkılaştırılır; amaç likidasyona yaklaşmadan pozisyonu kapatmaktır.

## Yapay Zekâ risk sınırları
- Muhafazakar: maksimum 4X, bakiye marjininin en fazla %5'i, işlem başına hesap riski %0,25
- Dengeli: maksimum 8X, bakiye marjininin en fazla %10'u, işlem başına hesap riski %0,50
- Riskli: maksimum 12X, bakiye marjininin en fazla %15'i, işlem başına hesap riski %1,00
- AI, uygun EV/order-flow/whale/likidite teyidi yoksa işlem açmaz.
