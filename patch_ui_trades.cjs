const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacement = `
        if (tradesData.trades) {
          setTrades(prevTrades => {
            return tradesData.trades.map((newTrade: any) => {
              const existing = prevTrades.find((t) => t.id === newTrade.id);
              if (existing && existing.is_open && newTrade.is_open) {
                 return {
                   ...newTrade,
                   current_rate: existing.current_rate,
                   profit_pct: existing.profit_pct,
                   profit_abs: existing.profit_abs,
                   profit_ratio: existing.profit_ratio
                 };
              }
              return newTrade;
            });
          });
        }
`;

code = code.replace(
  "if (tradesData.trades) setTrades(tradesData.trades);",
  replacement.trim()
);

fs.writeFileSync('src/App.tsx', code);
