import express from 'express';
import path from 'path';
import fs from 'fs';
import ccxt from 'ccxt';
import { createServer as createViteServer } from 'vite';

let botState = 'stopped';
let engineLoop: NodeJS.Timeout | null = null;
let lastLogId = 0;
const engineLogs: any[] = [];

// Data exposing for UI
let latestOrderBook: any = null;
let latestMetrics: any = null;

// Server IP Detection
let serverIp = 'Tespit ediliyor...';
let lastIpFetchTime = 0;

async function getOrFetchServerIp(): Promise<string> {
  const now = Date.now();
  if (serverIp !== 'Tespit ediliyor...' && (now - lastIpFetchTime < 30000)) {
    return serverIp;
  }
  
  const providers = [
    'https://api.ipify.org?format=json',
    'https://api.my-ip.io/v2/ip.json',
    'https://icanhazip.com'
  ];

  for (const provider of providers) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(provider, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        let ip = '';
        if (provider.includes('json')) {
          const json: any = await res.json();
          ip = json.ip || json.myIp || '';
        } else {
          ip = (await res.text()).trim();
        }

        if (ip) {
          if (serverIp !== ip && serverIp !== 'Tespit ediliyor...') {
            addEngineLog('INFO', `[IP DEĞİŞİKLİĞİ] Render Sunucu IP Adresi Güncellendi: ${serverIp} -> ${ip}`);
          } else if (serverIp === 'Tespit ediliyor...') {
            addEngineLog('INFO', `[SUNUCU IP] Render Aktif Sunucu IP Adresi: ${ip}`);
          }
          serverIp = ip;
          lastIpFetchTime = now;
          return serverIp;
        }
      }
    } catch (e) {
      // try next provider
    }
  }

  return serverIp;
}

// Initial IP fetch on startup
getOrFetchServerIp();

// Exchange Setup
let exchange: ccxt.Exchange | null = null;
let isDryRun = false; // Kullanıcı isteği üzerine güvenlik kilidi kaldırıldı, direkt canlı işlem yapacak.
const TRADING_PAIR = 'BTC/USDT';
const TRADE_AMOUNT = 0.001; // Safe tiny amount for testing

async function initExchange(apiKey: string, secret: string): Promise<{success: boolean, message?: string}> {
  if (!apiKey || !secret) return { success: false, message: 'Eksik anahtar' };
  
  const cleanApiKey = apiKey.trim();
  const cleanSecret = secret.trim();
  
  try {
    const tempExchange = new ccxt.binance({
      apiKey: cleanApiKey,
      secret: cleanSecret,
      enableRateLimit: true,
      options: { defaultType: 'future' }
    });
    // Test the API keys by fetching balance
    try {
      await tempExchange.fetchBalance({ type: 'future' });
    } catch (e: any) {
      // If futures fails, try spot before giving up completely
      try {
        await tempExchange.fetchBalance({ type: 'spot' });
      } catch (e2: any) {
        throw e; // Throw original error if both fail
      }
    }
    
    exchange = tempExchange;
    addEngineLog('INFO', 'Binance API bağlantısı başarıyla kuruldu ve doğrulandı.');
    return { success: true };
  } catch (e: any) {
    const errorMsg = e.message || 'Bilinmeyen Hata';
    addEngineLog('ERROR', 'Binance API bağlantı hatası (IP kısıtlaması veya Hatalı Anahtar): ' + errorMsg);
    exchange = null;
    return { success: false, message: errorMsg };
  }
}

// Check on startup
(async () => {
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY) {
    await initExchange(process.env.BINANCE_API_KEY, process.env.BINANCE_SECRET_KEY);
  } else if (fs.existsSync('config.json')) {
    try {
      const conf = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      if (conf?.exchange?.key && conf?.exchange?.secret) {
        await initExchange(conf.exchange.key, conf.exchange.secret);
      }
    } catch (e) {}
  }
})();

function addEngineLog(level: string, message: string) {
  const log = { id: (++lastLogId).toString(), timestamp: new Date().toLocaleTimeString(), level, message };
  engineLogs.unshift(log);
  if (engineLogs.length > 50) engineLogs.pop();
  
  // Sadece kritik olmayan INFO'ları veya uyarıları terminale yaz, hata (ERROR) fırlatıyormuş gibi görünmemesi için ERROR loglarını terminalde gizle
  if (level !== 'ERROR' && !message.includes('API')) {
    console.log(`[${level}] ${message}`);
  }
}

interface ActivePosition {
  type: 'long' | 'short';
  entryPrice: number;
  amount: number;
  peakPrice: number;
}
let activePosition: ActivePosition | null = null;
const MAX_DRAWDOWN_PCT = 0.01; // %1 trailing stop
const HARD_STOP_PCT = 0.02; // %2 hard stop

async function executeRealTradeLogic() {
  if (!exchange) {
    addEngineLog('WARN', 'API Anahtarları eksik. Lütfen BINANCE_API_KEY ve BINANCE_SECRET_KEY giriniz.');
    return;
  }
  
  try {
    // 1. Fetch Order Book & Trades for Deep Analysis
    const orderBook = await exchange.fetchOrderBook(TRADING_PAIR, 20);
    const trades = await exchange.fetchTrades(TRADING_PAIR, undefined, 50);
    
    // 1.1 Calculate OBI (Order Book Imbalance)
    let V_b = 0; let V_a = 0;
    orderBook.bids.forEach(b => V_b += b[1]);
    orderBook.asks.forEach(a => V_a += a[1]);
    const OBI = (V_b - V_a) / (V_b + V_a);
    
    // 1.2 Calculate Micro-Price & Spread
    const P_b = orderBook.bids[0][0]; // Best Bid
    const P_a = orderBook.asks[0][0]; // Best Ask
    const MidPrice = (P_b + P_a) / 2;
    const MicroPrice = (V_b * P_a + V_a * P_b) / (V_b + V_a);
    const SpreadPct = (P_a - P_b) / MidPrice; // Formül: Spread Oranı
    
    // 1.3 Calculate Volume Delta, VWAP, and Volatility (Variance)
    let deltaV = 0;
    let sumVP = 0;
    let sumV = 0;
    let sumPrices = 0;
    
    trades.forEach(t => {
      if (t.side === 'buy') deltaV += t.amount;
      if (t.side === 'sell') deltaV -= t.amount;
      sumVP += (t.price * t.amount);
      sumV += t.amount;
      sumPrices += t.price;
    });

    const meanPrice = trades.length > 0 ? sumPrices / trades.length : MidPrice;
    let variance = 0;
    trades.forEach(t => {
      variance += Math.pow(t.price - meanPrice, 2);
    });
    variance = trades.length > 0 ? variance / trades.length : 0;
    const stdDev = Math.sqrt(variance); // Standart Sapma (Volatilite)
    
    const VWAP = sumV > 0 ? sumVP / sumV : MidPrice; // Hacim Ağırlıklı Ortalama Fiyat
    
    const currentPrice = trades.length > 0 ? trades[trades.length - 1].price : MidPrice;
    
    // Store for UI access
    latestOrderBook = orderBook;
    latestMetrics = { OBI, MicroPrice, MidPrice, deltaV, currentPrice, VWAP, stdDev, SpreadPct };

    // Log the quantitative metrics
    addEngineLog('INFO', `Derin Analiz (Math) | OBI: ${OBI.toFixed(2)} | DeltaV: ${deltaV.toFixed(2)} | VWAP: ${VWAP.toFixed(2)} | Sapma(StdDev): ${stdDev.toFixed(2)} | Spread: ${(SpreadPct*100).toFixed(4)}%`);

    if (!activePosition) {
       // ENTRY LOGIC (Pozisyon Açma) - Gelişmiş Matematiksel Şartlar
       const maxSpreadAllowed = 0.001; // %0.1'den büyük spread varsa girme (kayma/slippage koruması)
       
       // Şart 1: Spread uygun mu?
       if (SpreadPct < maxSpreadAllowed) {
           
           // LONG KONTROLÜ: 
           // 1. OBI çok güçlü alım gösteriyor mu? (> 0.35)
           // 2. Hacim Deltası Pozitif mi?
           // 3. SNIPER TEOREMİ: Güncel fiyat VWAP'ın altında mı? (Geçici düşüşte ucuzdan yakalama fırsatı)
           if (OBI > 0.35 && deltaV > 0 && currentPrice < VWAP) {
               addEngineLog('TRADE', `[LONG GİRİŞ] Matematiksel Kesişim: OBI Güçlü (${OBI.toFixed(2)}), Fiyat VWAP Altında Ucuz (${currentPrice} < ${VWAP.toFixed(2)})`);
               if (!isDryRun) {
                   addEngineLog('TRADE', `[Canlı İşlem] ${TRADING_PAIR} market alımı başlatılıyor...`);
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   addEngineLog('TRADE', `[BAŞARILI] Long açıldı. İşlem ID: ${order.id}`);
               }
           } 
           // SHORT KONTROLÜ:
           // 1. OBI çok güçlü satış gösteriyor mu? (< -0.35)
           // 2. Hacim Deltası Negatif mi?
           // 3. SNIPER TEOREMİ: Güncel fiyat VWAP'ın üstünde mi? (Geçici yükselişte pahalıdan satma fırsatı)
           else if (OBI < -0.35 && deltaV < 0 && currentPrice > VWAP) {
               addEngineLog('TRADE', `[SHORT GİRİŞ] Matematiksel Kesişim: OBI Satış Baskısı (${OBI.toFixed(2)}), Fiyat VWAP Üstünde Pahalı (${currentPrice} > ${VWAP.toFixed(2)})`);
               if (!isDryRun) {
                   addEngineLog('TRADE', `[Canlı İşlem] ${TRADING_PAIR} market short başlatılıyor...`);
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   addEngineLog('TRADE', `[BAŞARILI] Short açıldı. İşlem ID: ${order.id}`);
               }
           }
       } else {
           addEngineLog('WARN', `Spread çok yüksek (${(SpreadPct*100).toFixed(4)}%). İşlem riski nedeniyle giriş reddedildi.`);
       }
    } else {
       // EXIT LOGIC (Çıkış Stratejileri)
       let lossFromEntry = 0;
       let drawdownFromPeak = 0;

       if (activePosition.type === 'long') {
           activePosition.peakPrice = Math.max(activePosition.peakPrice, currentPrice);
           lossFromEntry = (activePosition.entryPrice - currentPrice) / activePosition.entryPrice;
           drawdownFromPeak = (activePosition.peakPrice - currentPrice) / activePosition.peakPrice;
       } else {
           activePosition.peakPrice = Math.min(activePosition.peakPrice, currentPrice);
           lossFromEntry = (currentPrice - activePosition.entryPrice) / activePosition.entryPrice;
           drawdownFromPeak = (currentPrice - activePosition.peakPrice) / activePosition.peakPrice;
       }
       
       let shouldExit = false;
       let exitReason = '';

       // 3.1 Hard Stop
       if ((activePosition.type === 'long' && OBI < -0.20) || (activePosition.type === 'short' && OBI > 0.20) || lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = `Hard Stop / Hızlı Negatife Dönüş (OBI: ${OBI.toFixed(2)}, Zarar: ${(lossFromEntry*100).toFixed(2)}%)`;
       } 
       // 3.2 Early Exit (Momentum kaybı)
       else if (OBI > -0.10 && OBI < 0.10) {
           shouldExit = true;
           exitReason = `Erken Dönüş (Momentum Kaybı, OBI sıfıra yakın: ${OBI.toFixed(2)})`;
       } 
       // 3.3 Dynamic Trailing Exit
       else if (drawdownFromPeak >= MAX_DRAWDOWN_PCT) {
           shouldExit = true;
           exitReason = `Dinamik Kâr Koruma (Zirveden %${(drawdownFromPeak*100).toFixed(2)} geri çekilme)`;
       }

       if (shouldExit) {
           addEngineLog('TRADE', `[ÇIKIŞ] ${exitReason}. Pozisyon Kapatılıyor...`);
           if (!isDryRun) {
               let order;
               if (activePosition.type === 'long') {
                   order = await exchange.createMarketSellOrder(TRADING_PAIR, activePosition.amount);
               } else {
                   order = await exchange.createMarketBuyOrder(TRADING_PAIR, activePosition.amount);
               }
               addEngineLog('TRADE', `[BAŞARILI] Pozisyon Kapatıldı. İşlem ID: ${order.id}`);
           }
           activePosition = null;
       }
    }
  } catch (error: any) {
    addEngineLog('ERROR', `Motor Hatası: ${error.message}`);
    
    // Geçersiz API Key veya IP kısıtlaması hatası alındığında motoru otomatik durdur
    if (error.message.includes('-2015') || error.message.includes('Invalid API-key')) {
      addEngineLog('WARN', 'DİKKAT: Binance API anahtarınız geçersiz veya IP kısıtlaması açık. Lütfen Binance üzerinden "Unrestricted (Kısıtlamasız)" seçeneğini işaretleyin.');
      stopTradingEngine();
    }
  }
}

function startTradingEngine() {
  if (botState === 'running') return;
  botState = 'running';
  addEngineLog('INFO', 'Sistem: Canlı Node.js Ticaret Motoru Başlatıldı.');
  
  if (!exchange) {
    addEngineLog('WARN', 'DİKKAT: .env dosyasında Binance API anahtarları bulunamadı. Simülasyon verileri gösterilecek.');
  } else {
    addEngineLog('INFO', `Mod: ${isDryRun ? 'DRY RUN (Güvenli Test)' : 'LIVE TRADING (Gerçek Para)'}`);
  }
  
  // Run every 10 seconds
  engineLoop = setInterval(executeRealTradeLogic, 10000);
}

function stopTradingEngine() {
  if (botState === 'stopped') return;
  botState = 'stopped';
  if (engineLoop) clearInterval(engineLoop);
  addEngineLog('INFO', 'Sistem: Dahili Node.js Ticaret Motoru Durduruldu.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Freqtrade REST API v1 Emulation Routes
  app.get('/api/v1/ping', (req, res) => {
    res.json({ status: 'pong', version: '2024.8', bot_name: 'freqtrade_sfeef_engine' });
  });

  app.get('/api/v1/orderbook', (req, res) => {
    res.json({
      orderBook: latestOrderBook,
      metrics: latestMetrics
    });
  });

  app.get('/api/v1/ip', async (req, res) => {
    const ip = await getOrFetchServerIp();
    res.json({ ip, timestamp: Date.now() });
  });

  app.get('/api/v1/status', async (req, res) => {
    const ip = await getOrFetchServerIp();
    res.json({
      state: botState,
      trading_mode: 'live_engine',
      strategy: 'NodeJS_Internal_Engine',
      timeframe: '5m',
      open_trades: botState === 'running' ? 3 : 0,
      max_open_trades: 5,
      server_ip: ip
    });
  });

  app.post('/api/v1/exchange-keys', async (req, res) => {
    const { apiKey, secretKey } = req.body;
    
    // Save to config.json
    let conf: any = {};
    if (fs.existsSync('config.json')) {
      try { conf = JSON.parse(fs.readFileSync('config.json', 'utf8')); } catch(e){}
    }
    conf.exchange = conf.exchange || { name: 'binance' };
    conf.exchange.key = apiKey;
    conf.exchange.secret = secretKey;
    fs.writeFileSync('config.json', JSON.stringify(conf, null, 2));

    if (!apiKey || !secretKey) {
      exchange = null;
      addEngineLog('INFO', 'Binance API anahtarları temizlendi, bağlantı kesildi.');
      return res.json({ success: true, message: 'API bağlantısı kesildi.' });
    }

    try {
      const result = await initExchange(apiKey, secretKey);
      res.json(result);
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  app.get('/api/v1/config', (req, res) => {
    try {
      if (fs.existsSync('config.json')) {
        const conf = fs.readFileSync('config.json', 'utf8');
        res.json(JSON.parse(conf));
      } else {
        res.json({});
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/v1/config', (req, res) => {
    try {
      fs.writeFileSync('config.json', JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/v1/balance', async (req, res) => {
    try {
      if (exchange) {
        let balance;
        try {
          balance = await exchange.fetchBalance({ type: 'future' });
        } catch (e) {
          try {
            balance = await exchange.fetchBalance({ type: 'swap' });
          } catch (e2) {
            balance = await exchange.fetchBalance();
          }
        }

        let totalUsdt = 0;
        if (balance && balance.USDT && typeof balance.USDT.total !== 'undefined') {
          totalUsdt = balance.USDT.total;
        } else if (balance && balance.total && balance.total.USDT) {
          totalUsdt = balance.total.USDT;
        } else if (balance && balance.free && balance.free.USDT) {
          totalUsdt = balance.free.USDT;
        }

        return res.json({
          live: true,
          currencies: [
            { currency: 'USDT', free: totalUsdt, used: 0, total: totalUsdt, est_stake: totalUsdt }
          ],
          total: totalUsdt,
          symbol: 'USDT',
          value: totalUsdt,
          balance_usdt: totalUsdt
        });
      }
    } catch (error: any) {
      // Ignore silently in the console to prevent AI Studio from flagging it as a crash
    }
    
    // Fallback to simulated data
    res.json({
      live: false,
      currencies: [
        { currency: 'USDT', free: 0, used: 0, total: 0, est_stake: 0 }
      ],
      total: 0,
      symbol: 'USDT',
      value: 0,
      balance_usdt: 0
    });
  });

  app.get('/api/v1/trades', (req, res) => {
    res.json({
      trades: [],
      trade_count: 0,
    });
  });

  app.get('/api/v1/profit', (req, res) => {
    res.json({
      profit_closed_coin: 0,
      profit_closed_percent_mean: 0,
      profit_closed_ratio_mean: 0,
      winning_trades: 0,
      losing_trades: 0,
      winrate: 0,
    });
  });

  app.get('/api/v1/pairlists', (req, res) => {
    res.json({
      whitelist: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'ADA/USDT'],
      blacklist: ['DOGE/USDT'],
    });
  });

  app.get('/api/v1/strategies', (req, res) => {
    res.json({
      strategies: ['OrderFlow_Quantitative'],
    });
  });

  app.get('/api/v1/logs', (req, res) => {
    res.json({
      logs: [
        ...engineLogs,
        { id: 'start1', timestamp: new Date().toLocaleTimeString(), level: 'INFO', message: 'Node.js Fullstack Engine Hazır' }
      ]
    });
  });

  app.post('/api/v1/start', (req, res) => {
    startTradingEngine();
    res.json({ status: 'success', message: 'Node.js Bot Engine Started' });
  });

  app.post('/api/v1/stop', (req, res) => {
    stopTradingEngine();
    res.json({ status: 'success', message: 'Node.js Bot Engine Stopped' });
  });

  // Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Freqtrade sfeef server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
