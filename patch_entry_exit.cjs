const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Revert entry logic back to the simple OBI > 0.05
const entryRegex = /if \(SpreadPct < maxSpreadAllowed\) \{[\s\S]*?else \{ \/\/ Satıcı baskısı varsa SHORT[\s\S]*?addEngineLog\('TRADE', \`\[SİMÜLASYON\] Short açıldı\.\`\);\n\s*\}\n\s*\}\n\s*\}/;

const simpleEntry = `if (SpreadPct < maxSpreadAllowed) {
           // BASİTLEŞTİRİLMİŞ GİRİŞ: Sadece Emir Defteri Dengesizliği (OBI) veya Balina/Duvar Tespiti
           const isSupportStrong = OBI > 0.05 || hasSupportWall;
           const isResistanceStrong = OBI < -0.05 || hasResistanceWall;

           if (isSupportStrong) {
               let longReason = "Güçlü Alıcı Baskısı (OBI > 0.05) veya Destek";
               addEngineLog('TRADE', \`[LONG SİNYAL] \${longReason}! (OBI: \${OBI.toFixed(2)})\`);
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
           else if (isResistanceStrong) {
               let shortReason = "Güçlü Satıcı Baskısı (OBI < -0.05) veya Direnç";
               addEngineLog('TRADE', \`[SHORT SİNYAL] \${shortReason}! (OBI: \${OBI.toFixed(2)})\`);
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
           }`;

code = code.replace(entryRegex, simpleEntry);

// Now fix the exit logic based on exact 10% of MARGIN.
// baseProfitPct = price change.
// currentProfitPct = price change * leverage = Return on Margin.
// User says "10 dolara göre ... 2 dolar kar ... pozisyon açılsın [kapansın]". That means 20% ROE.
// User says "15 x yapsam bile hesaplama 1 x üzerinden yapılsın yüz dolar işlem yaparsam bu da 10 dolar bir ön görme demektir". 10% of margin.
// So they want the take profit to trigger when currentProfitPct (ROE) >= 10%.
// OR do they mean they want the PRICE to move 10%? If they say "15x yapsam bile hesaplama 1x üzerinden yapılsın", "1x üzerinden" means without leverage. 10% without leverage means the price moves 10%.
// Let's use baseProfitPct >= 10 for price movement of 10%.

const exitRegex = /const PURE_PRICE_TAKE_PROFIT_PCT = 1;[\s\S]*?exitReason = \`En Az \%1 Hedefi Geçildi ve Zirveden Dönüş Yakalandı \(1x Kâr: \%([^`]+)\)\`;\n\s*\}/;

const simpleExit = `const PURE_PRICE_TAKE_PROFIT_PCT = 10; // Saf (1x) Fiyat hareketi üzerinden en az %10 Kâr Hedefi

       // 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = \`Hard Stop (Zarar Kes: %\${(lossFromEntry*100 * targetLeverage).toFixed(2)})\`;
       } 
       // 3.2 Kâr Alma (1x fiyat hareketi üzerinden %10)
       else if (baseProfitPct >= PURE_PRICE_TAKE_PROFIT_PCT) {
           const TRAILING_STOP_AFTER_10_PCT = 0.015; // Zirveden %1.5 düşerse
           if (drawdownFromPeak >= TRAILING_STOP_AFTER_10_PCT) {
               shouldExit = true;
               exitReason = \`En Az %10 Hedefi Geçildi ve Zirveden Dönüş Yakalandı (1x Kâr: %\${baseProfitPct.toFixed(2)}, Gerçek Kâr: %\${currentProfitPct.toFixed(2)})\`;
           }
       }`;

code = code.replace(exitRegex, simpleExit);

fs.writeFileSync('server.ts', code);
