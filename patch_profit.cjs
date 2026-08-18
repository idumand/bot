const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const replacement = `
    } else if (activePosition) {
       // EXIT LOGIC (Çıkış Stratejileri)
       let lossFromEntry = 0;
       let drawdownFromPeak = 0;
       let currentProfitPct = 0; // Kaldıraçlı Kâr Oranı (%) (Arayüz ve hesaplamalar için)
       let baseProfitPct = 0;    // 1X Kâr Oranı (%) (Piyasanın saf hareketi)

       if (activePosition.type === 'long') {
           activePosition.peakPrice = Math.max(activePosition.peakPrice, currentPrice);
           lossFromEntry = (activePosition.entryPrice - currentPrice) / activePosition.entryPrice;
           drawdownFromPeak = (activePosition.peakPrice - currentPrice) / activePosition.peakPrice;
           baseProfitPct = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100;
           currentProfitPct = baseProfitPct * targetLeverage;
       } else {
           activePosition.peakPrice = Math.min(activePosition.peakPrice, currentPrice);
           lossFromEntry = (currentPrice - activePosition.entryPrice) / activePosition.entryPrice;
           drawdownFromPeak = (currentPrice - activePosition.peakPrice) / activePosition.peakPrice;
           baseProfitPct = ((activePosition.entryPrice - currentPrice) / activePosition.entryPrice) * 100;
           currentProfitPct = baseProfitPct * targetLeverage;
       }
       
       let shouldExit = false;
       let exitReason = '';

       const PURE_PRICE_TAKE_PROFIT_PCT = 10; // Saf (1x) Fiyat hareketi üzerinden %10 Kâr Hedefi

       // 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = \`Hard Stop (Zarar Kes: %\${(lossFromEntry*100 * targetLeverage).toFixed(2)})\`;
       } 
       // 3.2 Kâr Alma (Take Profit) - Saf Piyasada %10 hareket yakalanınca
       else if (baseProfitPct >= PURE_PRICE_TAKE_PROFIT_PCT) {
           shouldExit = true;
           exitReason = \`Büyük Trend Hedefi Yakalandı (1x Fiyat Hareketi: %\${baseProfitPct.toFixed(2)}, Gerçek Kâr: %\${currentProfitPct.toFixed(2)})\`;
       }
       // 3.3 Momentum Kaybı (Trendin Yön Değiştirmesi)
       else if ((activePosition.type === 'long' && OBI < -0.30) || (activePosition.type === 'short' && OBI > 0.30)) {
           shouldExit = true;
           exitReason = \`Hızlı Trend Değişimi (Momentum Kırıldı, OBI: \${OBI.toFixed(2)})\`;
       }
       // 3.4 Dynamic Trailing Exit (Zirveden %1 geri çekilme) SADECE KÂRDAYSAM ÇALIŞSIN
       else if (currentProfitPct > 2 && drawdownFromPeak >= MAX_DRAWDOWN_PCT) {
           shouldExit = true;
           exitReason = \`Dinamik Kâr Koruma (Zirveden %1 Geri Çekilme)\`;
       }

       if (shouldExit) {
`;

// we need to replace from `} else if (activePosition) {` to `if (shouldExit) {`
const regex = /\} else if \(activePosition\) \{[\s\S]*?if \(shouldExit\) \{/;
code = code.replace(regex, replacement.trim());

fs.writeFileSync('server.ts', code);
