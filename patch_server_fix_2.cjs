const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Add an isProcessing flag to prevent concurrent execution
const variablesToAdd = `
let isProcessingTrade = false;
`;

code = code.replace(
  "const HARD_STOP_PCT = 0.02; // %2 hard stop",
  "const HARD_STOP_PCT = 0.02; // %2 hard stop\n" + variablesToAdd
);

// Modify executeRealTradeLogic to use the flag and check botState
const executeRealTradeLogicRegex = /async function executeRealTradeLogic\(\) \{/;
code = code.replace(
  executeRealTradeLogicRegex,
  `async function executeRealTradeLogic() {\n  if (botState !== 'running' || isProcessingTrade) return;\n  isProcessingTrade = true;`
);

// Make sure to reset isProcessingTrade at the end of executeRealTradeLogic
// We need to find the try-catch block
code = code.replace(
  /  \} catch \(error: any\) \{/g,
  `  } catch (error: any) {`
);

// The end of executeRealTradeLogic is around line 430
// I will just append `isProcessingTrade = false;` to the end of both success and catch blocks or just at the end of the function.
// Let's replace the end of the function.
const endOfFunctionRegex = /    if \(error\.message\.includes\('-2015'\) \|\| error\.message\.includes\('Invalid API-key'\)\) \{[\s\S]*?stopTradingEngine\(\);\n    \}\n  \}\n\}/;
code = code.replace(
  endOfFunctionRegex,
  `    if (error.message.includes('-2015') || error.message.includes('Invalid API-key')) {\n      addEngineLog('WARN', 'DİKKAT: Binance API anahtarınız geçersiz veya IP kısıtlaması açık. Lütfen Binance üzerinden "Unrestricted (Kısıtlamasız)" seçeneğini işaretleyin.');\n      stopTradingEngine();\n    }\n  } finally {\n    isProcessingTrade = false;\n  }\n}`
);


// Stop Trading Engine changes: make sure all active positions are closed and set state correctly
const stopLogicRegex = /async function stopTradingEngine\(\) \{[\s\S]*?addEngineLog\('INFO', 'Sistem: Dahili Node\.js Ticaret Motoru Durduruldu\.'\);\n\}/;
const newStopLogic = `
async function stopTradingEngine() {
  if (botState === 'stopped') return;
  botState = 'stopped';
  if (engineLoop) clearInterval(engineLoop);
  
  if (activePosition) {
     await closeActivePosition('Motor Durduruldu (Tüm Açık Pozisyonlar Kapatıldı)');
  }
  
  // Close any stray open trades from memory just in case
  allTrades.forEach(t => {
      if (t.is_open) {
          t.is_open = false;
          t.close_rate = latestMetrics?.currentPrice || t.open_rate;
          t.close_date = Date.now();
          t.exit_reason = 'Motor Durduruldu (Zorla)';
      }
  });
  
  addEngineLog('INFO', 'Sistem: Dahili Node.js Ticaret Motoru Durduruldu ve tüm işlemler sonlandırıldı.');
}
`;
code = code.replace(stopLogicRegex, newStopLogic.trim());

fs.writeFileSync('server.ts', code);
