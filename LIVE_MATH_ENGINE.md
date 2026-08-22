# Live Math Engine

Bu sürüm geçmiş işlem verisi tutmaz ve backtest/learning/optimizer örneklemesi yapmaz.

## Karar zinciri

1. 8 borsa + Binance Futures canlı order-book verisi.
2. Microstructure: OBI, weighted OBI, microprice, trade-flow, consumption, queue depletion, spoof/absorption, liquidity ve spot/futures divergence.
3. Canlı execution simulator: mevcut book üzerinde beklenen VWAP, spread ve slippage.
4. Fair-value projection: yalnızca mevcut microstructure bileşenlerinden hesaplanır.
5. Net edge ve Expected Value hesaplanır.
6. Risk: stop mesafesine göre margin, toplam kullanılabilir bakiyenin %0.5 hesap-risk bütçesiyle sınırlandırılır; seçilen kaldıraç üst sınırdır.
7. Giriş: canlıda IOC limit emir. Onaylanan fiyat bölgesinde dolmazsa emir kovalanmaz ve işlem iptal edilir.
8. Çıkış: TP1/runner yanında açık pozisyonun canlı EV'si yeniden hesaplanır; edge kaybolursa pozisyon hedefi beklemeden kapatılır.
9. Kapanan işlem bellekte ve diskte tutulmaz.

## Önemli sınır

`winProbability` istatistiksel olarak geçmişten kalibre edilmiş gerçek olasılık değildir. Geçmiş veri özellikle kapatıldığı için bu değer canlı microstructure kalitesinden türetilen konservatif model güvenidir. Kesin kâr garantisi yoktur.

## Devre dışı

- Historical backtest
- MFE/MAE geçmişinden optimizer
- Closed-trade learning
- Kalıcı trade history
- Geçmiş mumlardan volatility/feature öğrenimi
