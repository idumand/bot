const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Change fetchOrderBook depth and add fetchOHLCV
code = code.replace(
  "const orderBook = await exchange.fetchOrderBook(TRADING_PAIR, 20);",
  "const orderBook = await exchange.fetchOrderBook(TRADING_PAIR, 50);\n    const ohlcv = await exchange.fetchOHLCV(TRADING_PAIR, '1m', undefined, 15);"
);

// 2. Insert Advanced Metrics calculation before "// Store for UI access"
const metricsRegex = /\/\/ Store for UI access/;
const advancedMetricsLogic = `
    // --- YENİ NESİL KISA VADELİ (SCALPING) GÖSTERGELERİ ---
    
    // 1. RSI (Göreceli Güç Endeksi) - 14 Dakikalık
    let gains = 0, losses = 0;
    for(let i=1; i<ohlcv.length; i++) {
        const diff = ohlcv[i][4] - ohlcv[i-1][4]; // Kapanış fiyatı farkı
        if(diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rs = avgLoss === 0 ? 100 : (avgGain / avgLoss);
    const rsi = 100 - (100 / (1 + rs));

    // 2. Emir Duvarı Tespiti (Destek / Direnç)
    const avgBidSize = orderBook.bids.reduce((sum, b) => sum + b[1], 0) / (orderBook.bids.length || 1);
    const avgAskSize = orderBook.asks.reduce((sum, a) => sum + a[1], 0) / (orderBook.asks.length || 1);
    
    let maxBidWall = {price: 0, size: 0};
    orderBook.bids.forEach(b => { if(b[1] > maxBidWall.size) maxBidWall = {price: b[0], size: b[1]} });
    
    let maxAskWall = {price: 0, size: 0};
    orderBook.asks.forEach(a => { if(a[1] > maxAskWall.size) maxAskWall = {price: a[0], size: a[1]} });

    // Ortalama emrin 5 katından büyükse bu güçlü bir duvardır.
    const isBidWallStrong = maxBidWall.size > avgBidSize * 5; 
    const isAskWallStrong = maxAskWall.size > avgAskSize * 5;
    
    const distToBidWall = (currentPrice - maxBidWall.price) / currentPrice;
    const distToAskWall = (maxAskWall.price - currentPrice) / currentPrice;

    // 3. Balina (Whale) Hacim Sıçraması Tespiti
    const avgTradeSize = trades.reduce((sum, t) => sum + t.amount, 0) / (trades.length || 1);
    // Son 50 işlemde ortalamanın 10 katı tekil işlem var mı?
    const whaleBuy = trades.some(t => t.side === 'buy' && t.amount > avgTradeSize * 10);
    const whaleSell = trades.some(t => t.side === 'sell' && t.amount > avgTradeSize * 10);

    // Store for UI access`;
code = code.replace(metricsRegex, advancedMetricsLogic);


// 3. Update the Entry Logic Conditions
const longRegex = /if \(priceDrift > requiredDrift && OBI > 0\.5 && currentPrice < VWAP\) \{/;
const newLongLogic = `
           const isRsiOversold = rsi < 40;
           const hasSupportWall = isBidWallStrong && distToBidWall < 0.005; // %0.5 yakında dev destek
           
           if (priceDrift > requiredDrift && OBI > 0.4 && currentPrice < VWAP && (isRsiOversold || whaleBuy || hasSupportWall)) {`;
code = code.replace(longRegex, newLongLogic);

const shortRegex = /else if \(priceDrift < \-requiredDrift && OBI < \-0\.5 && currentPrice > VWAP\) \{/;
const newShortLogic = `
           const isRsiOverbought = rsi > 60;
           const hasResistanceWall = isAskWallStrong && distToAskWall < 0.005;

           else if (priceDrift < -requiredDrift && OBI < -0.4 && currentPrice > VWAP && (isRsiOverbought || whaleSell || hasResistanceWall)) {`;
code = code.replace(shortRegex, newShortLogic);

// 4. Update the Logging inside to show the exact reason
const longLogRegex = /addEngineLog\('TRADE', \`\[LONG SİNYAL\] Hacim ve Fiyat Uyuşmazlığı Saptandı! OBI: \$\{OBI\.toFixed\(2\)\}, Drift: \$\{\(priceDrift\*100\)\.toFixed\(4\)\}\%\`\);/;
const newLongLog = `
               let longReason = "Aşırı Satım (RSI Dipten Dönüş)";
               if (whaleBuy) longReason = "Balina Alımı (Hacim Patlaması)";
               if (hasSupportWall) longReason = "Destek Duvarından Sekme";
               addEngineLog('TRADE', \`[LONG SİNYAL] \${longReason}! (RSI: \${rsi.toFixed(1)}, OBI: \${OBI.toFixed(2)})\`);`;
code = code.replace(longLogRegex, newLongLog);


const shortLogRegex = /addEngineLog\('TRADE', \`\[SHORT SİNYAL\] Satış Baskısı Teyit Edildi! OBI: \$\{OBI\.toFixed\(2\)\}, Drift: \$\{\(priceDrift\*100\)\.toFixed\(4\)\}\%\`\);/;
const newShortLog = `
               let shortReason = "Aşırı Alım (RSI Tepeden Dönüş)";
               if (whaleSell) shortReason = "Balina Satışı (Hacim Patlaması)";
               if (hasResistanceWall) shortReason = "Direnç Duvarından Dönüş";
               addEngineLog('TRADE', \`[SHORT SİNYAL] \${shortReason}! (RSI: \${rsi.toFixed(1)}, OBI: \${OBI.toFixed(2)})\`);`;
code = code.replace(shortLogRegex, newShortLog);


fs.writeFileSync('server.ts', code);
