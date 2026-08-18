const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /if \(!activePosition\) \{[\s\S]*?\/\/ Geçersiz API Key veya IP kısıtlaması/m;

const newLogic = `
    // Sadece bir tane açık pozisyon olabilir, çift pozisyon açmayı engelle (Ekstra Güvenlik)
    const hasOpenTradeForPair = allTrades.some(t => t.is_open && t.pair === TRADING_PAIR);

    if (!activePosition && !hasOpenTradeForPair) {
       // ENTRY LOGIC (Pozisyon Açma) - Gelişmiş Matematiksel Şartlar
       const maxSpreadAllowed = 0.005; // Maksimum binde 5 spread kabul edilebilir (kayma/slippage koruması)
       
       // Calculate dynamic TRADE_AMOUNT based on config
       let TRADE_AMOUNT = 0.001; // fallback
       if (currentStakeAmount > 0 && currentPrice > 0) {
           const rawAmount = (currentStakeAmount * targetLeverage) / currentPrice;
           if (exchange && exchange.markets && exchange.markets[TRADING_PAIR]) {
               TRADE_AMOUNT = Number(exchange.amountToPrecision(TRADING_PAIR, rawAmount));
           } else {
               TRADE_AMOUNT = Number(rawAmount.toFixed(4));
           }
       }
       
       if (SpreadPct < maxSpreadAllowed) {
           // PREDİKTİF MİKRO-FİYAT ANALİZİ
           const priceDrift = (MicroPrice - MidPrice) / MidPrice;
           
           // Giriş için daha katı ve zeki matematiksel eşikler (Akıllı motor)
           // Hacim OBI %50'den büyük olmalı VE fiyatta yukarı yönlü ciddi baskı olmalı
           const requiredDrift = 0.0001; 
           
           // LONG KONTROLÜ
           if (priceDrift > requiredDrift && OBI > 0.5 && currentPrice < VWAP) {
               addEngineLog('TRADE', \`[LONG SİNYAL] Hacim ve Fiyat Uyuşmazlığı Saptandı! OBI: \${OBI.toFixed(2)}, Drift: \${(priceDrift*100).toFixed(4)}%\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market alımı (LONG) başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Long açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'long', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Long açıldı.\`);
               }
           } 
           // SHORT KONTROLÜ
           else if (priceDrift < -requiredDrift && OBI < -0.5 && currentPrice > VWAP) {
               addEngineLog('TRADE', \`[SHORT SİNYAL] Satış Baskısı Teyit Edildi! OBI: \${OBI.toFixed(2)}, Drift: \${(priceDrift*100).toFixed(4)}%\`);
               if (!isDryRun) {
                   addEngineLog('TRADE', \`[Canlı İşlem] \${TRADING_PAIR} market satışı (SHORT) başlatılıyor...\`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[BAŞARILI] Short açıldı. İşlem ID: \${order.id}\`);
               } else {
                   activePosition = { type: 'short', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade: TradeRecord = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', \`[SİMÜLASYON] Short açıldı.\`);
               }
           }

       } else {
           addEngineLog('WARN', \`Spread çok yüksek (\${(SpreadPct*100).toFixed(4)}%). İşlem riski nedeniyle giriş reddedildi.\`);
       }
    } else if (activePosition) {
       // EXIT LOGIC (Çıkış Stratejileri)
       let lossFromEntry = 0;
       let drawdownFromPeak = 0;
       let currentProfitPct = 0; // Kaldıraçlı Kâr Oranı (%)

       if (activePosition.type === 'long') {
           activePosition.peakPrice = Math.max(activePosition.peakPrice, currentPrice);
           lossFromEntry = (activePosition.entryPrice - currentPrice) / activePosition.entryPrice;
           drawdownFromPeak = (activePosition.peakPrice - currentPrice) / activePosition.peakPrice;
           currentProfitPct = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100 * targetLeverage;
       } else {
           activePosition.peakPrice = Math.min(activePosition.peakPrice, currentPrice);
           lossFromEntry = (currentPrice - activePosition.entryPrice) / activePosition.entryPrice;
           drawdownFromPeak = (currentPrice - activePosition.peakPrice) / activePosition.peakPrice;
           currentProfitPct = ((activePosition.entryPrice - currentPrice) / activePosition.entryPrice) * 100 * targetLeverage;
       }
       
       let shouldExit = false;
       let exitReason = '';

       const DYNAMIC_TAKE_PROFIT_PCT = 10; // %10 Net kâr yakalandığında çık

       // 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = \`Hard Stop (Zarar Kes: %\${(lossFromEntry*100 * targetLeverage).toFixed(2)})\`;
       } 
       // 3.2 Kâr Alma (Take Profit) - %10 yakalanınca otomatik kapat
       else if (currentProfitPct >= DYNAMIC_TAKE_PROFIT_PCT) {
           shouldExit = true;
           exitReason = \`Hedef Kâr Yakalandı (Kâr: %\${currentProfitPct.toFixed(2)})\`;
       }
       // 3.3 Momentum Kaybı (Trendin Yön Değiştirmesi)
       else if ((activePosition.type === 'long' && OBI < -0.30) || (activePosition.type === 'short' && OBI > 0.30)) {
           shouldExit = true;
           exitReason = \`Hızlı Trend Değişimi (Momentum Kırıldı, OBI: \${OBI.toFixed(2)})\`;
       }
       // 3.4 Dynamic Trailing Exit (Zirveden %1 geri çekilme) SADECE KÂRDAYSAM ÇALIŞSIN
       else if (currentProfitPct > 2 && drawdownFromPeak >= MAX_DRAWDOWN_PCT) {
           shouldExit = true;
           exitReason = \`Dinamik Kâr Koruma (Zirveden %1 Geri Çekilme)\`;
       }

       if (shouldExit) {
           await closeActivePosition(exitReason);
       }
    }
  } catch (error: any) {
    // Geçersiz API Key veya IP kısıtlaması`;

code = code.replace(regex, newLogic);
fs.writeFileSync('server.ts', code);
