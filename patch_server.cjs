const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const closeFunction = `
async function closeActivePosition(reason: string) {
  if (!activePosition) return;
  const currentPrice = latestMetrics?.currentPrice || activePosition.entryPrice;
  addEngineLog('TRADE', \`[ÇIKIŞ] \${reason}. Pozisyon Kapatılıyor...\`);
  try {
    if (!isDryRun && exchange) {
        let order;
        if (activePosition.type === 'long') {
            order = await exchange.createMarketSellOrder(TRADING_PAIR, activePosition.amount);
        } else {
            order = await exchange.createMarketBuyOrder(TRADING_PAIR, activePosition.amount);
        }
        addEngineLog('TRADE', \`[BAŞARILI] Pozisyon Kapatıldı. İşlem ID: \${order.id}\`);
    }
    const closedTrade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
    if (closedTrade) {
        closedTrade.is_open = false;
        closedTrade.close_rate = currentPrice;
        closedTrade.close_date = Date.now();
        closedTrade.profit_ratio = activePosition.type === 'long' ? (currentPrice - closedTrade.open_rate) / closedTrade.open_rate : (closedTrade.open_rate - currentPrice) / closedTrade.open_rate;
        closedTrade.profit_abs = closedTrade.profit_ratio * currentStakeAmount * targetLeverage;
        closedTrade.exit_reason = reason;
    }
    activePosition = null;
  } catch (err: any) {
    addEngineLog('ERROR', \`Pozisyon kapatılırken hata: \${err.message}\`);
  }
}
`;

// Inject the function before stopTradingEngine
code = code.replace(
  "function stopTradingEngine() {",
  closeFunction + "\nasync function stopTradingEngine() {"
);

// Call it inside stopTradingEngine
code = code.replace(
  "if (engineLoop) clearInterval(engineLoop);\n  addEngineLog('INFO', 'Sistem: Dahili Node.js Ticaret Motoru Durduruldu.');",
  "if (engineLoop) clearInterval(engineLoop);\n  if (activePosition) await closeActivePosition('Motor Durduruldu (Manuel Çıkış)');\n  addEngineLog('INFO', 'Sistem: Dahili Node.js Ticaret Motoru Durduruldu.');"
);

// Fix the shouldExit block to use closeActivePosition
const exitBlockRegex = /if \(shouldExit\) \{[\s\S]*?activePosition = null;\s*\n\s*\}/;
code = code.replace(
  exitBlockRegex,
  "if (shouldExit) {\n           await closeActivePosition(exitReason);\n       }"
);

fs.writeFileSync('server.ts', code);
