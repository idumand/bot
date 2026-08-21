const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const exitRegex = /const PURE_PRICE_TAKE_PROFIT_PCT = 10;[\s\S]*?else if \(baseProfitPct >= PURE_PRICE_TAKE_PROFIT_PCT\) \{[\s\S]*?exitReason = \`En Az \%10 Hedefi Geçildi ve Zirveden Dönüş Yakalandı \(1x Kâr: \%\\\$\\\{baseProfitPct\.toFixed\(2\)\\\}, Gerçek Kâr: \%\\\$\\\{currentProfitPct\.toFixed\(2\)\\\}\)\`;\n\s*\}\n\s*\}/;

const startIdx = code.indexOf('const PURE_PRICE_TAKE_PROFIT_PCT = 10;');
const endStr = 'Gerçek Kâr: %${currentProfitPct.toFixed(2)})`;\n           }\n       }';
const endIdx = code.indexOf(endStr) + endStr.length;

if (startIdx !== -1 && endIdx !== -1) {
    const originalExit = `// 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = \`Hard Stop (Zarar Kes: %\${(lossFromEntry*100 * targetLeverage).toFixed(2)})\`;
       } 
       // 3.2 Kâr Alma (Take Profit)
       else if (currentProfitPct >= TAKE_PROFIT_PCT) {
           shouldExit = true;
           exitReason = \`Kâr Hedefi Yakalandı (Kâr: %\${currentProfitPct.toFixed(2)})\`;
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
       }`;

    code = code.substring(0, startIdx) + originalExit + code.substring(endIdx);
    fs.writeFileSync('server.ts', code);
}
