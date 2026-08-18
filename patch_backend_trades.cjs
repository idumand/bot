const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const tradesApiLogic = `
  app.get('/api/v1/trades', (req, res) => {
    // latestMetrics.currentPrice has the current market price
    const cPrice = latestMetrics.currentPrice || 0;
    const formattedTrades = allTrades.map(t => {
      const isPositive = t.is_open ? 
        (t.type === 'long' ? cPrice > t.open_rate : cPrice < t.open_rate) : 
        (t.profit_ratio > 0);
      
      let pratio = t.profit_ratio || 0;
      let pabs = t.profit_abs || 0;
      
      if (t.is_open) {
          pratio = t.type === 'long' ? (cPrice - t.open_rate)/t.open_rate : (t.open_rate - cPrice)/t.open_rate;
          pabs = pratio * currentStakeAmount * targetLeverage;
      }

      return {
        id: t.trade_id.toString(),
        pair: t.pair,
        is_open: t.is_open,
        type: t.type,
        leverage: targetLeverage,
        amount: t.amount,
        open_rate: t.open_rate,
        current_rate: cPrice,
        close_rate: t.close_rate,
        open_date: new Date(t.open_date).toLocaleString(),
        close_date: t.close_date ? new Date(t.close_date).toLocaleString() : undefined,
        close_reason: t.exit_reason,
        profit_ratio: pratio,
        profit_pct: pratio * 100,
        profit_abs: pabs,
        stop_loss_abs: 0,
        stop_loss_pct: 0
      };
    });

    res.json({
      trades: formattedTrades,
      trade_count: formattedTrades.length,
    });
  });
`;

code = code.replace(
  /app.get\('\/api\/v1\/trades', \(req, res\) => {[\s\S]*?}\);/m,
  tradesApiLogic.trim()
);

fs.writeFileSync('server.ts', code);
