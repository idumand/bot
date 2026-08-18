const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const longTarget = /           const isRsiOversold = rsi < 40;\n           const hasSupportWall = isBidWallStrong && distToBidWall < 0\.005; \/\/ %0\.5 yakında dev destek\n           \n           if \(priceDrift > requiredDrift && OBI > 0\.4 && currentPrice < VWAP && \(isRsiOversold \|\| whaleBuy \|\| hasSupportWall\)\) \{\n                  \n               let longReason = "Aşırı Satım \(RSI Dipten Dönüş\)";\n               if \(whaleBuy\) longReason = "Balina Alımı \(Hacim Patlaması\)";\n               if \(hasSupportWall\) longReason = "Destek Duvarından Sekme";/m;

const newLong = `           const isRsiOversold = rsi < 40;
           const hasSupportWall = isBidWallStrong && distToBidWall < 0.005;

           const rsiLongTrigger = isRsiOversold && OBI > 0.1;
           const whaleLongTrigger = whaleBuy && priceDrift > 0;
           const wallLongTrigger = hasSupportWall && currentPrice < VWAP;
           
           if (rsiLongTrigger || whaleLongTrigger || wallLongTrigger) {
                  
               let longReason = "Bilinmeyen Sinyal";
               if (rsiLongTrigger) longReason = "Aşırı Satım (RSI Dipten Dönüş)";
               else if (whaleLongTrigger) longReason = "Balina Alımı (Hacim Patlaması)";
               else if (wallLongTrigger) longReason = "Destek Duvarından Sekme";`;


const shortTarget = /           const isRsiOverbought = rsi > 60;\n           const hasResistanceWall = isAskWallStrong && distToAskWall < 0\.005;\n\n           else if \(priceDrift < -requiredDrift && OBI < -0\.4 && currentPrice > VWAP && \(isRsiOverbought \|\| whaleSell \|\| hasResistanceWall\)\) \{\n                  \n               let shortReason = "Aşırı Alım \(RSI Tepeden Dönüş\)";\n               if \(whaleSell\) shortReason = "Balina Satışı \(Hacim Patlaması\)";\n               if \(hasResistanceWall\) shortReason = "Direnç Duvarından Dönüş";/m;

const newShort = `           const isRsiOverbought = rsi > 60;
           const hasResistanceWall = isAskWallStrong && distToAskWall < 0.005;

           const rsiShortTrigger = isRsiOverbought && OBI < -0.1;
           const whaleShortTrigger = whaleSell && priceDrift < 0;
           const wallShortTrigger = hasResistanceWall && currentPrice > VWAP;

           else if (rsiShortTrigger || whaleShortTrigger || wallShortTrigger) {
                  
               let shortReason = "Bilinmeyen Sinyal";
               if (rsiShortTrigger) shortReason = "Aşırı Alım (RSI Tepeden Dönüş)";
               else if (whaleShortTrigger) shortReason = "Balina Satışı (Hacim Patlaması)";
               else if (wallShortTrigger) shortReason = "Direnç Duvarından Dönüş";`;


code = code.replace(longTarget, newLong);
code = code.replace(shortTarget, newShort);

fs.writeFileSync('server.ts', code);
