const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The fundamental mathematical flaw is that 500 orderbook levels rarely cover even 1% for liquid pairs like BTC/USDT.
// We must fall back to the total available order book volume if the specific percentage target is out of bounds.

const regex = /\/\/ DERİN MATEMATİKSEL ANALİZ \(\%5 HEDEF UZAYI\)[\s\S]*?const isResistanceStrong = OBI < -0\.15 \|\| hasResistanceWall;/;

const replacement = `// DERİN MATEMATİKSEL ANALİZ (%1 HEDEF UZAYI)
           // Fiyatın +%1 yukarı gitmesini engelleyen satıcı hacmi vs -%1 düşmesini engelleyen alıcı hacmi
           const targetUpPrice = currentPrice * 1.01;
           const targetDownPrice = currentPrice * 0.99;
           
           let volUp1Pct = 0;
           orderBook.asks.forEach(a => { if (a[0] <= targetUpPrice) volUp1Pct += a[1]; });
           
           let volDown1Pct = 0;
           orderBook.bids.forEach(b => { if (b[0] >= targetDownPrice) volDown1Pct += b[1]; });
           
           // KRİTİK DÜZELTME: Borsa 500 kademede bile %1'lik derinliğe inemiyorsa, mecburen elimizdeki tüm 500 kademeyi kullan.
           if (volUp1Pct === 0) orderBook.asks.forEach(a => volUp1Pct += a[1]);
           if (volDown1Pct === 0) orderBook.bids.forEach(b => volDown1Pct += b[1]);

           // Boşluk (Void) Oranları: Bir taraf diğerinden 1.5 kat daha zayıfsa, o tarafa %1 patlama olasılığı yüksektir
           const deepLongRatio = volDown1Pct / (volUp1Pct || 1);  // Satıcılar zayıf, alıcılar güçlü -> Fiyat uçar
           const deepShortRatio = volUp1Pct / (volDown1Pct || 1); // Alıcılar zayıf, satıcılar güçlü -> Fiyat çöker
           
           // Daha hassas tetikleyiciler
           const isSupportStrong = OBI > 0.10 || hasSupportWall;
           const isResistanceStrong = OBI < -0.10 || hasResistanceWall;`;

code = code.replace(regex, replacement);

// Update conditions in if statements
code = code.replace(/deepLongRatio > 2\.0/g, "deepLongRatio > 1.5");
code = code.replace(/%5 Direnç Boşluğu Yakalandı/g, "%1 Direnç Boşluğu Yakalandı");
code = code.replace(/deepShortRatio > 2\.0/g, "deepShortRatio > 1.5");
code = code.replace(/%5 Destek Boşluğu Yakalandı/g, "%1 Destek Boşluğu Yakalandı");
code = code.replace(/Güçlü Alıcı Baskısı \(OBI > 0\.15\)/g, "Güçlü Alıcı Baskısı (OBI > 0.10)");
code = code.replace(/Güçlü Satıcı Baskısı \(OBI < -0\.15\)/g, "Güçlü Satıcı Baskısı (OBI < -0.10)");

// Update take profit
code = code.replace(/const PURE_PRICE_TAKE_PROFIT_PCT = 5;/g, "const PURE_PRICE_TAKE_PROFIT_PCT = 1;");

fs.writeFileSync('server.ts', code);
