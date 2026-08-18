const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Use replace with a function or precise strings to ensure it works.
const longRegex = /if \(priceDrift > requiredDrift && OBI > 0\.4 && currentPrice < VWAP && \(isRsiOversold \|\| whaleBuy \|\| hasSupportWall\)\) \{/;
const newLong = `if (OBI > 0.3 || hasSupportWall) {`;
code = code.replace(longRegex, newLong);

const shortRegex = /else if \(priceDrift < \-requiredDrift && OBI < \-0\.4 && currentPrice > VWAP && \(isRsiOverbought \|\| whaleSell \|\| hasResistanceWall\)\) \{/;
const newShort = `else if (OBI < -0.3 || hasResistanceWall) {`;
code = code.replace(shortRegex, newShort);

const longReasonRegex = /               let longReason = "Aşırı Satım \\(RSI Dipten Dönüş\\)";\n               if \\(whaleBuy\\) longReason = "Balina Alımı \\(Hacim Patlaması\\)";\n               if \\(hasSupportWall\\) longReason = "Destek Duvarından Sekme";/m;
const newLongReason = `               let longReason = hasSupportWall ? "Destek Duvarından Sekme" : "Güçlü Alıcı Baskısı (OBI > 0.3)";`;
// We will just do a generic replace for the reason block to be safe.
code = code.replace(/let longReason = "Aşırı Satım \(RSI Dipten Dönüş\)";[\s\S]*?if \(hasSupportWall\) longReason = "Destek Duvarından Sekme";/, newLongReason);

const shortReasonRegex = /let shortReason = "Aşırı Alım \(RSI Tepeden Dönüş\)";[\s\S]*?if \(hasResistanceWall\) shortReason = "Direnç Duvarından Dönüş";/;
const newShortReason = `               let shortReason = hasResistanceWall ? "Direnç Duvarından Dönüş" : "Güçlü Satıcı Baskısı (OBI < -0.3)";`;
code = code.replace(shortReasonRegex, newShortReason);

fs.writeFileSync('server.ts', code);
