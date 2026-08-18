const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Change from 10% to 5% target space
code = code.replace(/const targetUpPrice = currentPrice \* 1\.10;/, "const targetUpPrice = currentPrice * 1.05;");
code = code.replace(/const targetDownPrice = currentPrice \* 0\.90;/, "const targetDownPrice = currentPrice * 0.95;");

// Update comments/logs
code = code.replace(/\/\/ DERİN MATEMATİKSEL ANALİZ \(%10 HEDEF UZAYI\)/, "// DERİN MATEMATİKSEL ANALİZ (%5 HEDEF UZAYI)");
code = code.replace(/Fiyatın \+%10 yukarı gitmesini engelleyen satıcı hacmi vs -%10 düşmesini engelleyen alıcı hacmi/, "Fiyatın +%5 yukarı gitmesini engelleyen satıcı hacmi vs -%5 düşmesini engelleyen alıcı hacmi");
code = code.replace(/o tarafa %10 patlama olasılığı/, "o tarafa %5 patlama olasılığı");

// Lower the deep ratio to 2.0 (from 3.0) to make it more sensitive
code = code.replace(/if \(deepLongRatio > 3\.0 \|\| isSupportStrong\) \{/g, "if (deepLongRatio > 2.0 || isSupportStrong) {");
code = code.replace(/deepLongRatio > 3\.0 \? "%10 Direnç Boşluğu Yakalandı/g, 'deepLongRatio > 2.0 ? "%5 Direnç Boşluğu Yakalandı');

code = code.replace(/else if \(deepShortRatio > 3\.0 \|\| isResistanceStrong\) \{/g, "else if (deepShortRatio > 2.0 || isResistanceStrong) {");
code = code.replace(/deepShortRatio > 3\.0 \? "%10 Destek Boşluğu Yakalandı/g, 'deepShortRatio > 2.0 ? "%5 Destek Boşluğu Yakalandı');

// Lower the OBI thresholds from 0.3 to 0.15 for more sensitivity
code = code.replace(/const isSupportStrong = OBI > 0\.3 \|\| hasSupportWall;/g, "const isSupportStrong = OBI > 0.15 || hasSupportWall;");
code = code.replace(/const isResistanceStrong = OBI < -0\.3 \|\| hasResistanceWall;/g, "const isResistanceStrong = OBI < -0.15 || hasResistanceWall;");

code = code.replace(/Güçlü Alıcı Baskısı \(OBI > 0\.3\)/g, "Güçlü Alıcı Baskısı (OBI > 0.15)");
code = code.replace(/Güçlü Satıcı Baskısı \(OBI < -0\.3\)/g, "Güçlü Satıcı Baskısı (OBI < -0.15)");

// Update Take Profit to 5% instead of 10%
code = code.replace(/const PURE_PRICE_TAKE_PROFIT_PCT = 10; \/\/ Saf \(1x\) Fiyat hareketi üzerinden %10 Kâr Hedefi/g, "const PURE_PRICE_TAKE_PROFIT_PCT = 5; // Saf (1x) Fiyat hareketi üzerinden %5 Kâr Hedefi");

fs.writeFileSync('server.ts', code);
