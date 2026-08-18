const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Fix profit calculation in backend to include leverage for percentages
code = code.replace(
  "profit_pct: pratio * 100,",
  "profit_pct: pratio * 100 * targetLeverage,"
);

fs.writeFileSync('server.ts', code);
