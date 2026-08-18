const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The activePosition needs to be correctly reset inside closeActivePosition, 
// even if we're in DryRun mode, otherwise it loops and never closes.

code = code.replace(
  "activePosition = null;\n  } catch (err: any) {",
  "activePosition = null;\n  } catch (err: any) {\n    activePosition = null;\n    addEngineLog('ERROR', `Pozisyon kapatılırken hata: ${err.message}`);\n  }"
);

// We need to also ensure DryRun creates mock orders
const mockOrder = `
    if (!isDryRun && exchange) {
        let order;
        if (activePosition.type === 'long') {
            order = await exchange.createMarketSellOrder(TRADING_PAIR, activePosition.amount);
        } else {
            order = await exchange.createMarketBuyOrder(TRADING_PAIR, activePosition.amount);
        }
        addEngineLog('TRADE', \`[BAŞARILI] Pozisyon Kapatıldı. İşlem ID: \${order.id}\`);
    } else {
        // Mock success for Dry Run
        addEngineLog('TRADE', \`[SİMÜLASYON] Pozisyon Kapatıldı.\`);
    }
`;

code = code.replace(
  /if \(!isDryRun && exchange\) \{[\s\S]*?addEngineLog\('TRADE', `\[BAŞARILI\] Pozisyon Kapatıldı\. İşlem ID: \$\{order\.id\}`\);\n    \}/,
  mockOrder.trim()
);

// We also need to fix entry logic for dry run
const mockEntryLong = `
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market alımı başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Long açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'long', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Long açıldı.\`);
               }
`;

code = code.replace(
  /if \(!isDryRun\) \{[\s\S]*?addEngineLog\('TRADE', `\[BAŞARILI\] Long açıldı\. İşlem ID: \$\{order\.id\}`\);\n               \}/,
  mockEntryLong.trim()
);


const mockEntryShort = `
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market short başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Short açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'short', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Short açıldı.\`);
               }
`;

code = code.replace(
  /if \(!isDryRun\) \{[\s\S]*?addEngineLog\('TRADE', `\[BAŞARILI\] Short açıldı\. İşlem ID: \$\{order\.id\}`\);\n               \}/,
  mockEntryShort.trim()
);

fs.writeFileSync('server.ts', code);
