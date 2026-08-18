const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// I introduced a syntax error when patching the exit logic. An extra }
const badBlock = `           if (drawdownFromPeak >= TRAILING_STOP_AFTER_10_PCT) {
               shouldExit = true;
               exitReason = \`En Az %10 Hedefi Geçildi ve Zirveden Dönüş Yakalandı (1x Kâr: %\${baseProfitPct.toFixed(2)}, Gerçek Kâr: %\${currentProfitPct.toFixed(2)})\`;
           }
       }
       }`;

const fixedBlock = `           if (drawdownFromPeak >= TRAILING_STOP_AFTER_10_PCT) {
               shouldExit = true;
               exitReason = \`En Az %10 Hedefi Geçildi ve Zirveden Dönüş Yakalandı (1x Kâr: %\${baseProfitPct.toFixed(2)}, Gerçek Kâr: %\${currentProfitPct.toFixed(2)})\`;
           }
       }`;

code = code.replace(badBlock, fixedBlock);

fs.writeFileSync('server.ts', code);
