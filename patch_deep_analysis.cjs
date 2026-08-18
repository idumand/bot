const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Increase order book depth from 50 to 500
code = code.replace(/await exchange.fetchOrderBook\(TRADING_PAIR, 50\);/, "await exchange.fetchOrderBook(TRADING_PAIR, 500);");

// Find the logic inside entry logic
const entryRegex = /if \(!activePosition && !hasOpenTradeForPair\) \{[\s\S]*?\/\/ EXIT LOGIC/;

const newEntry = `if (!activePosition && !hasOpenTradeForPair) {
       const maxSpreadAllowed = 0.005; 
       
       let TRADE_AMOUNT = 0.001; 
       if (currentStakeAmount > 0 && currentPrice > 0) {
           const rawAmount = (currentStakeAmount * targetLeverage) / currentPrice;
           if (exchange && exchange.markets && exchange.markets[TRADING_PAIR]) {
               TRADE_AMOUNT = Number(exchange.amountToPrecision(TRADING_PAIR, rawAmount));
           } else {
               TRADE_AMOUNT = Number(rawAmount.toFixed(4));
           }
       }
       
       if (SpreadPct < maxSpreadAllowed) {
           // DERİN MATEMATİKSEL ANALİZ (%10 HEDEF UZAYI)
           // Fiyatın +%10 yukarı gitmesini engelleyen satıcı hacmi vs -%10 düşmesini engelleyen alıcı hacmi
           const targetUpPrice = currentPrice * 1.10;
           const targetDownPrice = currentPrice * 0.90;
           
           let volUp10Pct = 0;
           orderBook.asks.forEach(a => { if (a[0] <= targetUpPrice) volUp10Pct += a[1]; });
           
           let volDown10Pct = 0;
           orderBook.bids.forEach(b => { if (b[0] >= targetDownPrice) volDown10Pct += b[1]; });
           
           // Boşluk (Void) Oranları: Bir taraf diğerinden 3 kat daha zayıfsa, o tarafa %10 patlama olasılığı çok yüksektir
           const deepLongRatio = volDown10Pct / (volUp10Pct || 1);  // Satıcılar zayıf, alıcılar güçlü -> Fiyat uçar
           const deepShortRatio = volUp10Pct / (volDown10Pct || 1); // Alıcılar zayıf, satıcılar güçlü -> Fiyat çöker
           
           // Eski tetikleyiciler de dursun
           const isSupportStrong = OBI > 0.3 || hasSupportWall;
           const isResistanceStrong = OBI < -0.3 || hasResistanceWall;

           // YENİ TETİK: %10'luk analizde inanılmaz bir zayıflık varsa VEYA standart destek varsa
           if (deepLongRatio > 3.0 || isSupportStrong) {
               
               let longReason = deepLongRatio > 3.0 ? "%10 Direnç Boşluğu Yakalandı (Derin Analiz)" : "Güçlü Alıcı Baskısı";
               addEngineLog('TRADE', \`[LONG SİNYAL] \${longReason}! (DeepRatio: \${deepLongRatio.toFixed(2)})\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market alımı (LONG) başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Long açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'long', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Long açıldı.\`);
               }
           } 
           else if (deepShortRatio > 3.0 || isResistanceStrong) {
               
               let shortReason = deepShortRatio > 3.0 ? "%10 Destek Boşluğu Yakalandı (Derin Analiz)" : "Güçlü Satıcı Baskısı";
               addEngineLog('TRADE', \`[SHORT SİNYAL] \${shortReason}! (DeepRatio: \${deepShortRatio.toFixed(2)})\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market satışı (SHORT) başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Short açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'short', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Short açıldı.\`);
               }
           }
       } else {
           addEngineLog('WARN', \`Spread çok yüksek (\${(SpreadPct*100).toFixed(4)}%). İşlem riski nedeniyle giriş reddedildi.\`);
       }
    } else if (activePosition) {
       // EXIT LOGIC`;

code = code.replace(entryRegex, newEntry);

// And wait, if the user strictly says "yüzde 10 kazanç yakalayınca pozisyon açsın", it could also mean the TAKE PROFIT should be set to 10% mathematically.
// Let's modify the exit logic to incorporate a 10% TP based on 1x.
const exitRegex = /const TP_PCT = 0\.02; \/\/ %2 Take Profit/;
const newExit = `const TP_PCT = 0.10; // %10 Take Profit (1x e göre)`;
code = code.replace(exitRegex, newExit);
fs.writeFileSync('server.ts', code);
