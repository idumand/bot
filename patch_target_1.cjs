const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Update Entry Prediction target from 10% to 1%
code = code.replace(/const TARGET_1X_PREDICTION = 10\.0;/g, "const TARGET_1X_PREDICTION = 1.0;");
code = code.replace(/1x Bazında >= %10 Hedefi/g, "1x Bazında >= %1 Hedefi");

// Update Exit target from 10% to 1% so trailing starts early
code = code.replace(/const PURE_PRICE_TAKE_PROFIT_PCT = 10;/g, "const PURE_PRICE_TAKE_PROFIT_PCT = 1;");
code = code.replace(/En Az %10 Hedefi Geçildi/g, "En Az %1 Hedefi Geçildi");

fs.writeFileSync('server.ts', code);
