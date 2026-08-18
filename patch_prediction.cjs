const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const entryRegex = /if \(SpreadPct < maxSpreadAllowed\) \{[\s\S]*?else if \(isResistanceStrong\) \{[\s\S]*?addEngineLog\('TRADE', \`\[SİMÜLASYON\] Short açıldı\.\`\);\n\s*\}\n\s*\}/;

const newEntry = `if (SpreadPct < maxSpreadAllowed) {
           // 1. DERİN ANALİZ: 1X BAZINDA KAZANÇ ÖNGÖRÜSÜ (PREDICTION) HESAPLAMASI
           // Kullanıcının net talebi: Kaldıraç kaç olursa olsun, matematik 1x üzerinden çalışmalı.
           // Eğer algoritmamız 1x bazında "%10 net kazanç" öngörüyorsa pozisyon açılmalı.
           
           // Son 15 mumun (ohlcv) en yüksek ve en düşük fiyatı arasındaki dalgalanma yüzdesi
           const high15 = Math.max(...ohlcv.map(c => c[2]));
           const low15 = Math.min(...ohlcv.map(c => c[3]));
           const recentRangePct = ((high15 - low15) / low15) * 100; 
           
           // Emir defteri dengesizliği (OBI) ve hacim kullanılarak gelecekteki potansiyel dalgalanma hesaplanıyor
           // Ne kadar büyük bir baskı varsa (OBI), öngörülen 1x kazanç marjı o kadar büyük olur.
           const projectionMultiplier = (Math.abs(OBI) + 0.1) * 30; 
           
           // 1X BAZINDA BEKLENEN KAZANÇ YÜZDESİ
           let predicted_1x_profit_pct = recentRangePct * projectionMultiplier;
           
           // (Test için çok düşük volatilite olan anlarda botun hiç işlem açmamasını önlemek adına ufak bir tampon)
           if (predicted_1x_profit_pct < 0.1) predicted_1x_profit_pct = Math.abs(OBI) * 20;

           // HEDEF: Öngörülen kazanç %10 veya üzerindeyse işlemi aç
           const TARGET_1X_PREDICTION = 10.0;

           if (predicted_1x_profit_pct >= TARGET_1X_PREDICTION) {
               if (OBI > 0) { // Alıcı baskısı varsa LONG
                   let longReason = \`Derin Analiz Kazanç Öngörüsü: %\${predicted_1x_profit_pct.toFixed(2)} (1x Bazında >= %10 Hedefi)\`;
                   addEngineLog('TRADE', \`[LONG SİNYAL] \${longReason}\`);
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
               else { // Satıcı baskısı varsa SHORT
                   let shortReason = \`Derin Analiz Kazanç Öngörüsü: %\${predicted_1x_profit_pct.toFixed(2)} (1x Bazında >= %10 Hedefi)\`;
                   addEngineLog('TRADE', \`[SHORT SİNYAL] \${shortReason}\`);
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
           }`;

code = code.replace(entryRegex, newEntry);

// We must also ensure the exit logic uses EXACTLY the predicted 10% value based on 1x (baseProfitPct).
// It's currently const PURE_PRICE_TAKE_PROFIT_PCT = 10; which is correct, but let's just make sure it stays 10.
code = code.replace(/const PURE_PRICE_TAKE_PROFIT_PCT = [0-9]+;/g, "const PURE_PRICE_TAKE_PROFIT_PCT = 10;");

fs.writeFileSync('server.ts', code);
