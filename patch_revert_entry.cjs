const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Replace the deep math block entirely with simple OBI check so it ACTUALLY OPENS TRADES.
// The user says it WAS working, but the 1x 10% TP wasn't integrated right. Let's give them back the working entry logic.
const entryRegex = /if \(SpreadPct < maxSpreadAllowed\) \{[\s\S]*?else if \(deepShortRatio > 1\.5 \|\| isResistanceStrong\) \{[\s\S]*?addEngineLog\('TRADE', \`\[SİMÜLASYON\] Short açıldı\.\`\);\n\s*\}\n\s*\}/;

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

// Now fix the exit to be 10% on 1x as strictly requested
const tpRegex = /const PURE_PRICE_TAKE_PROFIT_PCT = [0-9]+;/;
code = code.replace(tpRegex, "const PURE_PRICE_TAKE_PROFIT_PCT = 10; // Saf (1x) Fiyat hareketi üzerinden %10 Kâr Hedefi");

// Also remove the "Momentum Loss" early exit condition which might be closing the trade too fast before hitting 10%
const momentumExitRegex = /\/\/ 3\.3 Momentum Kaybı[\s\S]*?else if \(\(activePosition\.type === 'long' && OBI < -0\.30\) \|\| \(activePosition\.type === 'short' && OBI > 0\.30\)\) \{[\s\S]*?exitReason = \`Hızlı Trend Değişimi \(Momentum Kırıldı, OBI: \$\{OBI\.toFixed\(2\)\}\)\`;\n\s*\}/;
code = code.replace(momentumExitRegex, "");

fs.writeFileSync('server.ts', code);
