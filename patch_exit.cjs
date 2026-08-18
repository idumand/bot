const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The user wants AT LEAST 10%. Meaning, they don't want the bot to automatically close the trade AT EXACTLY 10%.
// They want it to RIDE THE TREND if the trend is still strong past 10%.
// We need to implement a Trailing Stop for the Take Profit.
// Instead of closing immediately at 10%, we activate a trailing mechanism at 10%.

const exitRegex = /const PURE_PRICE_TAKE_PROFIT_PCT = 10;[\s\S]*?else if \(currentProfitPct > 2 && drawdownFromPeak >= MAX_DRAWDOWN_PCT\) \{[\s\S]*?exitReason = \`Dinamik Kâr Koruma \(Zirveden \%1 Geri Çekilme\)\`;\n\s*\}/;

const newExit = `const PURE_PRICE_TAKE_PROFIT_PCT = 10; // Saf (1x) Fiyat hareketi üzerinden en az %10 Kâr Hedefi

       // 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = \`Hard Stop (Zarar Kes: %\${(lossFromEntry*100 * targetLeverage).toFixed(2)})\`;
       } 
       // 3.2 Kâr Alma (En Az %10 ve Trend Takibi - Trailing)
       // Kullanıcı "En az %10" istediği için, %10'a ulaştığında direkt kapatmıyoruz. 
       // %10'u geçtikten sonra, zirveden %1.5 (veya belirli bir miktar) geri çekilirse kapatıyoruz ki trend sürdükçe kâr büyüsün.
       else if (baseProfitPct >= PURE_PRICE_TAKE_PROFIT_PCT) {
           // Kâr %10'u geçti! Artık trendi sonuna kadar sömürmek için Zirveden (Peak) geri çekilme (drawdown) bekleyeceğiz.
           const TRAILING_STOP_AFTER_10_PCT = 0.015; // %10 kârı geçtikten sonra zirveden %1.5 düşerse kârı al
           
           if (drawdownFromPeak >= TRAILING_STOP_AFTER_10_PCT) {
               shouldExit = true;
               exitReason = \`En Az %10 Hedefi Geçildi ve Zirveden Dönüş Yakalandı (1x Kâr: %\${baseProfitPct.toFixed(2)}, Gerçek Kâr: %\${currentProfitPct.toFixed(2)})\`;
           }
       }`;

code = code.replace(exitRegex, newExit);

fs.writeFileSync('server.ts', code);
