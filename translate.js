const fs = require('fs');
const path = require('path');

const replacements = [
  // Header.tsx
  ["Dashboard", "Gösterge Paneli"],
  ["Backtesting", "Geriye Dönük Test"],
  ["Strategies", "Stratejiler"],
  ["Pairlists & Markets", "Pariteler ve Piyasalar"],
  ["Configuration", "Yapılandırma"],
  ["REST API", "REST API"],
  ["Logs", "Sistem Kayıtları"],
  ["DRY-RUN (Simulated)", "SİMÜLASYON (Dry-Run)"],
  ["LIVE TRADING", "CANLI TİCARET"],
  ["Start Bot", "Botu Başlat"],
  ["Resume", "Devam Et"],
  ["Pause", "Duraklat"],
  ["Stop", "Durdur"],
  ["Reload Config", "Ayarları Yenile"],
  ["Total Balance", "Vadeli İşlem Cüzdanı"],
  
  // TradingDashboard.tsx
  ["Total PnL", "Toplam Kâr/Zarar"],
  ["Daily PnL:", "Günlük K/Z:"],
  ["Win Rate", "Kazanma Oranı"],
  ["Total Executed Trades:", "Gerçekleşen Toplam İşlem:"],
  ["Open Positions", "Açık Pozisyonlar"],
  ["Stake per Trade:", "İşlem Tutarı:"],
  ["Risk Metrics", "Risk Metrikleri"],
  ["Max Drawdown:", "Maksimum Düşüş:"],
  [">Pair:<", ">Parite:<"],
  ["Force Buy", "Hızlı Satın Al"],
  ["Market Watchlist", "Piyasa İzleme Listesi"],
  ["Bot Trades", "Bot İşlemleri"],
  ["Open (", "Açık ("],
  ["Closed (", "Kapalı ("],
  ["All (", "Tümü ("],
  ["Trade ID / Pair", "İşlem ID / Parite"],
  [">Type<", ">Tür<"],
  ["Open Date", "Açılış Tarihi"],
  ["Entry Rate", "Giriş Fiyatı"],
  ["Current / Close Rate", "Mevcut / Kapanış"],
  ["Stoploss / Take Profit", "Zarar Kes / Kâr Al"],
  ["Profit % (USDT)", "Kâr % (USDT)"],
  ["Action / Exit Reason", "İşlem / Çıkış Nedeni"],
  ["No trades match the selected filter.", "Seçilen filtreye uygun işlem bulunamadı."],
  ["Force Exit", "Zorla Kapat"],
  ["Recent Bot Activity Stream", "Son Bot Aktiviteleri"],
  ["Live Sync", "Canlı Senk."],

  // CandleChart.tsx
  ["SMA (20/50)", "SMA (20/50)"],
  ["Bollinger Bands", "Bollinger Bantları"],
  ["RSI (14) Indicator", "RSI (14) Göstergesi"],
  ["Current:", "Mevcut:"],
  [">Open:<", ">Açılış:<"],
  [">High:<", ">Yüksek:<"],
  [">Low:<", ">Düşük:<"],
  [">Close:<", ">Kapanış:<"],
  [">Volume:<", ">Hacim:<"],

  // BacktestEngine.tsx
  ["Backtesting Engine & Simulation", "Geriye Dönük Test & Simülasyon"],
  ["Test trading strategies on historical candle data to calculate expected ROI, Sharpe ratio, and drawdowns.", "Beklenen ROI, Sharpe oranı ve düşüşleri hesaplamak için stratejileri geçmiş veriler üzerinde test edin."],
  ["Strategy", "Strateji"],
  ["Market Pair", "Parite"],
  ["Candle Timeframe", "Zaman Dilimi"],
  ["Starting Balance (USDT)", "Başlangıç Bakiyesi (USDT)"],
  ["Stake Per Trade (USDT)", "İşlem Tutarı (USDT)"],
  ["Max Open Trades", "Maks. Açık İşlem"],
  ["Timerange", "Tarih Aralığı"],
  ["Run Backtest", "Testi Başlat"],
  ["Backtest Profit", "Test Kârı"],
  ["Win Rate & Trades", "Kazanma Oranı & İşlemler"],
  ["Total Trades:", "Toplam İşlem:"],
  ["Profit Factor & Sharpe", "Kâr Faktörü & Sharpe"],
  ["Max Drawdown", "Maksimum Düşüş"],
  ["Max DD USDT:", "Maks. Düşüş USDT:"],
  ["Simulated Equity Growth & Portfolio Drawdown", "Simüle Edilmiş Bakiye Büyümesi"],
  ["Export Report JSON", "Raporu İndir (JSON)"],
  ["Backtest Executed Trades Log", "Test Edilen İşlemlerin Kaydı"],
  ["Entry Date", "Giriş Tarihi"],
  ["Close Date", "Çıkış Tarihi"],
  ["Exit Reason", "Çıkış Nedeni"],

  // StrategyStudio.tsx
  ["Strategy Studio & Parameter Tuner", "Strateji Stüdyosu & Parametre Ayarları"],
  ["Configure, optimize, and edit Python trading strategies for Freqtrade sfeef.", "Freqtrade için Python stratejilerini yapılandırın, optimize edin ve düzenleyin."],
  ["Active Strategy:", "Aktif Strateji:"],
  ["Strategy Parameters", "Strateji Parametreleri"],
  ["Description", "Açıklama"],
  [">Timeframe<", ">Zaman Dilimi<"],
  ["Minimal ROI Matrix", "Minimum Kâr (ROI) Matrisi"],
  ["Stoploss %", "Zarar Kes (Stoploss) %"],
  ["Negative decimal e.g. -0.03 for 3% stoploss", "Negatif ondalık girin, örn: %3 için -0.03"],
  ["Trailing Stoploss", "İzleyen Zarar Kes (Trailing)"],
  ["Dynamically raise stoploss as price rises", "Fiyat arttıkça zarar kes seviyesini dinamik olarak yükseltir"],
  ["Save Strategy Changes", "Değişiklikleri Kaydet"],
  ["Validate Strategy Code", "Strateji Kodunu Doğrula"],
  ["Copied", "Kopyalandı"],
  [">Copy<", ">Kopyala<"],

  // PairlistsManager.tsx
  ["Pairlist & Whitelist / Blacklist Manager", "Parite ve Beyaz/Kara Liste Yönetimi"],
  ["Configure dynamic pairlists, whitelisted trading pairs, and blacklisted crypto assets.", "Dinamik parite listelerini, izin verilen ve yasaklı kripto varlıkları yapılandırın."],
  ["Add Pair", "Parite Ekle"],
  ["Whitelist (", "Beyaz Liste ("],
  ["Blacklist (", "Kara Liste ("],
  ["All Markets (", "Tüm Piyasalar ("],
  ["Search crypto pair...", "Kripto parite ara..."],
  ["Symbol / Asset", "Sembol / Varlık"],
  ["Price (USDT)", "Fiyat (USDT)"],
  ["24h Change", "24S Değişim"],
  ["24h Volume", "24S Hacim"],
  ["Bot Signal", "Bot Sinyali"],
  [">Status<", ">Durum<"],
  ["Whitelist / Blacklist Action", "Liste İşlemi"],
  ["No crypto pairs found matching criteria.", "Kriterlere uygun kripto parite bulunamadı."],
  ["Whitelisted", "Beyaz Listede"],
  ["Blacklisted", "Kara Listede"],
  ["Remove Whitelist", "Beyaz Listeden Çıkar"],
  ["Add Whitelist", "Beyaz Listeye Ekle"],
  ["Un-Blacklist", "Kara Listeden Çıkar"],
  [">Blacklist<", ">Kara Listeye Ekle<"],

  // ConfigEditor.tsx
  ["Freqtrade Configuration Editor (config.json)", "Freqtrade Yapılandırma Düzenleyici (config.json)"],
  ["Edit bot settings, API keys, stake amounts, exchanges, pairlists, and dry-run balances.", "Bot ayarlarını, API anahtarlarını, bakiye ve borsa ayarlarını düzenleyin."],
  ["Download config.json", "config.json İndir"],
  ["Save Configuration", "Yapılandırmayı Kaydet"],
  ["Exchange API Settings", "Borsa API & Vadeli İşlem Ayarları"],
  ["Exchange Name", "Borsa Adı"],
  ["API Key", "API Anahtarı"],
  ["Enter your API Key", "API Anahtarınızı Girin"],
  ["API Secret", "API Şifresi"],
  ["Enter your API Secret", "API Şifrenizi Girin"],
  ["Keys are stored locally in the configuration JSON. They will be sent to the bot backend upon clicking Save Configuration.", "Anahtarlar yapılandırma JSON dosyasında yerel olarak saklanır. 'Yapılandırmayı Kaydet' butonuna tıkladığınızda arka plana iletilir."],
  ["JSON Mode", "JSON Modu"],

  // ApiDocumentation.tsx
  ["Freqtrade REST API Console & Documentation", "Freqtrade REST API Konsolu & Dokümantasyonu"],
  ["Interactive REST API endpoint explorer allowing programmatic control and telemetry monitoring of Freqtrade.", "Freqtrade'in programatik olarak kontrol edilmesini ve telemetri izlemesini sağlayan etkileşimli API gezgini."],
  ["API Endpoints", "API Uç Noktaları"],
  ["Send Request", "İsteği Gönder"],
  ["Executing...", "Çalıştırılıyor..."],
  ["Response Payload (JSON)", "Gelen Yanıt (JSON)"],

  // LogsViewer.tsx
  ["Freqtrade System Terminal & Event Logs", "Freqtrade Sistem Terminali & Olay Kayıtları"],
  ["Realtime event stream of strategy signals, order execution, bot heartbeats, and exchange API responses.", "Strateji sinyalleri, emir yürütme, bot durumu ve borsa API yanıtlarının gerçek zamanlı yayın akışı."],
  ["Export Logs", "Kayıtları Dışa Aktar"],
  ["Clear Logs", "Kayıtları Temizle"],
  ["Search log messages...", "Kayıt (Log) mesajlarında ara..."],
  ["No log entries found.", "Kayıt bulunamadı."],

  // App.tsx specific messages
  ["Switched trading mode to", "İşlem modu değiştirildi:"],
  ["Force exit executed for", "Zorla kapatma işlemi uygulandı:"],
  ["Manual Force Buy executed for", "Manuel Hızlı Satın Alma işlemi uygulandı:"],
  ["Reloaded strategy", "Strateji ve yapılandırma JSON dosyası yeniden yüklendi:"],
  ["Added new trading pair", "Beyaz listeye yeni parite eklendi:"],
  ["Starting backtest simulation for", "Geriye dönük test simülasyonu başlatılıyor:"],
  ["Backtest completed for", "Geriye dönük test tamamlandı:"],
  ["Updated Freqtrade config.json parameters", "Freqtrade config.json parametreleri güncellendi."],
  ["Open Source Crypto Algorithmic Trading Suite", "Açık Kaynaklı Kripto Algoritmik Ticaret Aracı"],
  ["Node.js / Express / React Fullstack Web Application", "Node.js / Express / React Fullstack Web Uygulaması"]
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Perform strict replacements
      for (const [search, replace] of replacements) {
        content = content.split(search).join(replace);
      }
      
      // Additional targeted replacements
      if (fullPath.includes('Header.tsx')) {
        content = content.replace(/Total Balance/g, "Vadeli İşlem Cüzdanı");
      }
      if (fullPath.includes('TradingDashboard.tsx')) {
        content = content.replace(/Total Executed Trades:/g, "Gerçekleşen İşlem:");
      }
      
      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }
}

processDirectory('./src');
console.log('Translations applied successfully.');
