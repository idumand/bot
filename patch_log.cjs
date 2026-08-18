const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /addEngineLog\('INFO', `Derin Analiz \(Math\).*?%\`\);/g,
  "const pDrift = ((MicroPrice - MidPrice) / MidPrice * 100);\n    addEngineLog('INFO', `Derin Analiz | OBI: ${OBI.toFixed(2)} | Mikro-Baskı: %${pDrift.toFixed(5)} | Spread: ${(SpreadPct*100).toFixed(4)}%`);"
);

fs.writeFileSync('server.ts', code);
