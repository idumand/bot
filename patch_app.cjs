const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /const \[statusRes, logsRes\] = await Promise\.all\(\[\n\s*fetch\('\/api\/v1\/status'\),\n\s*fetch\('\/api\/v1\/logs'\)\n\s*\]\);/,
  "const [statusRes, logsRes, tradesRes, profitRes] = await Promise.all([\n          fetch('/api/v1/status'),\n          fetch('/api/v1/logs'),\n          fetch('/api/v1/trades'),\n          fetch('/api/v1/profit')\n        ]);"
);

code = code.replace(
  /const logsData = await logsRes\.json\(\);/,
  "const logsData = await logsRes.json();\n        const tradesData = await tradesRes.json();\n        const profitData = await profitRes.json();\n        if (tradesData.trades) setTrades(tradesData.trades);\n        if (profitData) setMetrics(prev => ({ ...prev, totalProfitAbs: profitData.profit_closed_coin, winningTrades: profitData.winning_trades, losingTrades: profitData.losing_trades, winRate: profitData.winrate * 100 }));"
);

fs.writeFileSync('src/App.tsx', code);
