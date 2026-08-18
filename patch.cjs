const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

// Update interval from 10000 to 2000
code = code.replace(/engineLoop = setInterval\(executeRealTradeLogic, 10000\);/g, "engineLoop = setInterval(executeRealTradeLogic, 2000);");

// Update API to return trades
code = code.replace(
  /app.get\('\/api\/v1\/trades', \(req, res\) => {[\s\S]*?}\);/m,
  "app.get('/api/v1/trades', (req, res) => {\n    res.json({\n      trades: allTrades,\n      trade_count: allTrades.length,\n    });\n  });"
);

// We need to properly save trades to allTrades when closing.
// Also add the active trade to allTrades when opening, and update it when closing.
code = code.replace(
  /activePosition = { type: 'long', entryPrice: order.price \|\| currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price \|\| currentPrice };/g,
  "activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };\n                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };\n                   allTrades.unshift(newTrade);\n                   activePosition.trade_id = newTrade.trade_id;"
);

code = code.replace(
  /activePosition = { type: 'short', entryPrice: order.price \|\| currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price \|\| currentPrice };/g,
  "activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };\n                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };\n                   allTrades.unshift(newTrade);\n                   activePosition.trade_id = newTrade.trade_id;"
);

// We need to add trade_id to ActivePosition interface
code = code.replace(
  /type: 'long' \| 'short';/g,
  "trade_id?: number;\n  type: 'long' | 'short';"
);

// On exit:
const exitCode = `
               addEngineLog('TRADE', \`[BAŞARILI] Pozisyon Kapatıldı. İşlem ID: \${order.id}\`);
           }
           const closedTrade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
           if (closedTrade) {
               closedTrade.is_open = false;
               closedTrade.close_rate = currentPrice;
               closedTrade.close_date = Date.now();
               closedTrade.profit_ratio = activePosition.type === 'long' ? (currentPrice - closedTrade.open_rate) / closedTrade.open_rate : (closedTrade.open_rate - currentPrice) / closedTrade.open_rate;
               closedTrade.profit_abs = closedTrade.profit_ratio * currentStakeAmount * targetLeverage;
               closedTrade.exit_reason = exitReason;
           }
           activePosition = null;
`;

code = code.replace(
  /addEngineLog\('TRADE', `\[BAŞARILI\] Pozisyon Kapatıldı. İşlem ID: \${order\.id}`\);\n           }\n           activePosition = null;/g,
  exitCode
);


// Update logic to be based on micro-price and millisecond predictions
const entryLogic = `
           // PREDİKTİF MİKRO-FİYAT ANALİZİ
           // MicroPrice, Order Book'taki alıcı/satıcı hacim dengesini fiyata yansıtır.
           // Eğer MicroPrice > MidPrice ise, alıcılar çok daha baskın demektir (Fiyatın yukarı fırlama olasılığı yüksek)
           const priceDrift = (MicroPrice - MidPrice) / MidPrice;
           const requiredProfitMargin = 0.0008; // %0.08 (Komisyon + Minimum Kâr)
           
           if (priceDrift > requiredProfitMargin && deltaV > 0) {
               addEngineLog('TRADE', \`[LONG GİRİŞ] Prediktif Sinyal: Yukarı yönlü mikro-baskı (%\${(priceDrift*100).toFixed(4)})\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market alımı başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Long açıldı. İşlem ID: \${order.id}\`);
               }
           } 
           else if (priceDrift < -requiredProfitMargin && deltaV < 0) {
               addEngineLog('TRADE', \`[SHORT GİRİŞ] Prediktif Sinyal: Aşağı yönlü mikro-baskı (%\${(priceDrift*100).toFixed(4)})\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market short başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Short açıldı. İşlem ID: \${order.id}\`);
               }
           }
`;

code = code.replace(
  /if \(OBI > 0\.05\) {[\s\S]*?else if \(OBI < -0\.05\) {[\s\S]*?}\n           }/g,
  entryLogic
);


fs.writeFileSync('server.ts', code);
