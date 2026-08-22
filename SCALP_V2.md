# Scalp Engine V2

Bu sürüm, 8 borsalı motoru yalnızca fiyat sapmasına dayalı bir arbitraj filtresinden çıkarıp hızlı vadeli işlem için mikro-yapı filtresine dönüştürür.

## Yeni giriş kapıları

1. **Freshness-weighted 8X consensus**
   - İlk 5 kademe OBI her borsada veri yaşına göre ağırlıklandırılır.
   - 1500 ms'den eski borsa giriş teyidinde kullanılamaz.
   - En az %62.5 yön konsensüsü gerekir.

2. **Order Flow Imbalance**
   - 250 ms / 1 s / 3 s / 5 s pencereleri.
   - Agresif alış/satış notional farkı ölçülür.
   - Flow velocity kısa vadeli hızlanmayı yakalar.

3. **Liquidity Consumption**
   - Binance ilk 5 kademedeki likiditenin önceki snapshot'a göre tükenmesi ölçülür.
   - Tüketim, yönle uyumlu trade flow ile birlikte değerlendirilir.

4. **Absorption block**
   - Güçlü agresif flow olmasına rağmen karşı taraftaki likidite absorbe ediyorsa giriş engellenir.

5. **Execution Edge**
   - Spread + tahmini depth slippage + çift yön taker fee hesaba katılır.
   - Net edge pozitif ve minimum eşikten büyük değilse işlem açılmaz.

6. **Fast scalp target**
   - V2 skoru yükseldikçe referans hedef yaklaşık %0.30–%0.80 fiyat hareketi aralığında ölçeklenir.
   - Pozisyon açma fonksiyonunun minimum hedef sınırı hızlı işlem için düşürüldü.

## Önemli davranış değişikliği

`min_gap_pct` artık **zorunlu giriş koşulu değildir**. 8 borsa fiyat farkı hâlâ analizde ve execution edge hesabında kullanılır; ancak hızlı scalp yönü esas olarak order-flow + book consensus + liquidity consumption üzerinden belirlenir.

## Giriş mantığı

```text
8X freshness consensus
        +
front-book OBI
        +
order-flow (250ms/1s/3s/5s)
        +
liquidity consumption
        +
liquidity echo
        +
spread/slippage/fee gate
        +
absorption check
        ↓
   SCALP V2 SCORE
        ↓
 LONG / SHORT / NO TRADE
```

## Test notu

Kod statik TypeScript kontrolünde yeni eklenen bölüm için tip/sözdizimi hatası üretmiyor. Tam proje `npm run lint/build` doğrulaması için bağımlılıkların kurulmuş olması gerekiyor; çalışma ortamında `node_modules` bulunmadığı için paket kurulumu zaman aşımına uğradı. Görülen tek TypeScript uyarısı mevcut projenin `server.ts` içindeki eski 3066. satır karşılaştırmasıdır.

Gerçek para ile kullanmadan önce **dry-run/backtest ve küçük notional forward test** yapılmalıdır. Bu motor kârlılık garantisi vermez.


## Scalp Engine V2.1 — Delta / Spoof / Queue Layer

V2.1, mevcut order-flow ve Liquidity Echo katmanının üzerine mikro-yapı delta katmanı ekler:

- **Add / Cancel / Execute:** Ardışık ilk 20 kademe snapshot'ları karşılaştırılır. Miktar artışı `add`, miktar azalması trade akışıyla eşleşiyorsa `execute`, eşleşmiyorsa `cancel` olarak sınıflandırılır.
- **Execution imbalance:** Ask tarafında gerçekleşen tüketim ile bid tarafında gerçekleşen tüketim karşılaştırılır.
- **Queue depletion:** Kuyrukta gerçekleşen tüketim/cancel baskısının yönü ölçülür.
- **Spoof risk:** Büyük miktar azalmalarının ne kadarının gerçek trade ile eşleşmediği ölçülür. Yüksek cancel-dominant davranış sinyali cezalandırır.
- **Replenishment:** Tüketim sonrasında aynı tarafta yeniden likidite oluşması izlenir; absorption/iceberg benzeri davranış için yardımcı özellik olarak döndürülür.
- **8X delta:** Her borsanın add/cancel akışı ayrı tutulur; işlem kararında Binance execution delta'sı ana ağırlığı taşırken diğer borsalar mikro-yapı teyidi sağlar.

> Not: Public snapshot feed üzerinde bu sınıflandırma gerçek matching-engine order ID delta'sı değildir; trade ile zaman/fiyat eşleştirilmiş bir **inference** katmanıdır. Kesin Add/Cancel/Execute ayrımı için borsanın native diff-depth feed'i ve mümkünse order-level feed gerekir.

## V2.2 — Binance Native Diff-Depth

Binance Spot order book artık `@depth@100ms` native diff stream ile senkronize edilir.
Yerel kitap REST `depth?limit=1000` snapshot ile bootstrap edilir ve Binance'in `U/u`
sequence kuralı uygulanır. Bir sequence gap tespit edilirse mevcut kitap güvenilmez
sayılır ve otomatik snapshot resync başlatılır.

İzlenen runtime metrikleri:
- `synced`: local book sequence senkron mu?
- `lastUpdateId`: son uygulanan Binance update id
- `gapCount`: sequence gap sayısı
- `resyncCount`: snapshot yeniden senkronizasyon sayısı
- `ageMs`: son native diff event yaşı

Bu katman, V2.1 Add/Cancel/Execute inference motorunun Binance tarafındaki book
verisini snapshot yerine sequence-consistent delta ile besler. Add/Cancel/Execute
ayrımı yine public market data üzerinden yapılan bir inference katmanıdır; native
matching-engine order-level feed olarak yorumlanmamalıdır.

## V2.3 — Binance Futures Native Diff-Depth

Futures tarafı artık Spot'tan bağımsız sequence-consistent native diff-depth kullanır:

```text
Futures REST depth snapshot (1000)
        ↓
@depth@100ms (U/u)
        ↓
sequence validation
        ↓
local Futures book
        ↓
Futures OBI / spread / divergence confirmation
```

Kurallar:
- Snapshot `lastUpdateId` alınır ve buffer'daki ilk geçerli event `U <= lastUpdateId+1 <= u` şartıyla seçilir.
- Senkronize olduktan sonra sequence gap (`U > lastUpdateId+1`) tespit edilirse Futures book geçersiz sayılır ve otomatik resync başlatılır.
- Futures native book, `fetchFuturesOrderBook()` içinde snapshot/depth20 verisinin öncelikli kaynağıdır.
- Generic Futures multiplex feed artık order-book snapshot taşımıyor; yalnızca `aggTrade` akışı taşır.
- Runtime health: `synced`, `lastUpdateId`, `gapCount`, `resyncCount`, `ageMs`.
- Native Futures book yalnızca aktif işlem paritesi için açılır; diğer Futures sembolleri gereksiz websocket yükünü önlemek için `aggTrade` ile izlenir.

Böylece Spot native book ile Futures native book aynı anda karşılaştırılabilir. Futures tarafındaki OBI artık kayıp snapshot örneklerine değil, sequence-consistent local book'a dayanır.

## V2.5 — Binance PNL Reconciliation

V2.5 closes the accounting gap between the bot dashboard and Binance USDT-M Futures:

- `fetchMyTrades` is used to read actual Futures fills and commissions.
- Binance `fapiPrivateGetIncome` is used as a fallback for Futures income when CCXT `fetchLedger` does not expose it.
- Realized PnL, commission and funding are reconciled per closed trade over its open→close window.
- Net realized PnL is calculated as `realizedPnl - commission + funding`.
- Binance fill commission is preferred over a configured taker-fee estimate.
- Closed trades expose `entry_order_id`, `exit_order_id`, `realized_pnl_binance`, `commission_binance`, `funding_binance`, and `reconciled_at`.
- `/api/v1/binance/reconciliation` exposes reconciliation telemetry.
- The close log is updated with the reconciled Binance net PnL when live data is available.

This removes the old fixed-fee-only accounting from the final closed-trade result. Estimated fees remain only as a fallback when Binance execution data is temporarily unavailable.


## SCALP V2.7 — High Conviction / Dynamic Sizing / Runner / EV

V2.7, V2.6'nın üzerine dört kontrollü optimizasyon ekler:

- **A+ High Conviction:** V2 score, 8X agreement, net edge ve rejim kalitesi aynı anda güçlü ise ayrı sınıf.
- **Dynamic Position Sizing:** temel stake sinyal kalitesi ve rejime göre 0.50x–1.50x aralığında ayarlanır; CHAOS rejimi yeni girişi engeller.
- **Partial TP + Runner:** A+ işlemlerde ilk %35 pozisyon TP1'de realize edilir; kalan %65 mikro-yapı trailing ile daha büyük hareketi takip eder.
- **EV optimizer:** kapanmış işlemlerin son 80 kaydından win-rate, ortalama kazanç/kayıp ve expectancy çıkarılır. Pozitif ve yeterli örneklem oluştuğunda sizing'e sınırlı katkı verir.

Hedefler sabit getiri vaadi değildir. V2.7'nin amacı daha iyi setup'larda riski sınırlı şekilde artırmak ve büyük kazananları erken kapatmamak.
