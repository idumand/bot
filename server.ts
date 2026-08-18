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
let exchange: any = null;
let isDryRun = false; // Canlı işlem
let TRADING_PAIR = 'BTC/USDT'; // Default, will be updated by config
let targetLeverage = 1;
let currentStakeAmount = 0;

async function parseUsdtFromBalance(balance: any): Promise<{ total: number, free: number, used: number }> {
  let total = 0;
  let free = 0;
  let used = 0;

  if (!balance) return { total, free, used };

  // 1. Check standard ccxt USDT dict
  if (balance.USDT) {
    total = typeof balance.USDT.total === 'number' ? balance.USDT.total : parseFloat(balance.USDT.total || '0');
    free = typeof balance.USDT.free === 'number' ? balance.USDT.free : parseFloat(balance.USDT.free || '0');
    used = typeof balance.USDT.used === 'number' ? balance.USDT.used : parseFloat(balance.USDT.used || '0');
  }

  // 2. Check total / free mappings
  if (total === 0 && balance.total && balance.total.USDT !== undefined) {
    total = parseFloat(balance.total.USDT || '0');
  }
  if (free === 0 && balance.free && balance.free.USDT !== undefined) {
    free = parseFloat(balance.free.USDT || '0');
  }

  // 3. Check Binance raw Futures info payload (fapi/v2/account & fapi/v2/balance)
  if (balance.info) {
    const info = balance.info;
    if (total === 0) {
      if (info.totalWalletBalance) total = parseFloat(info.totalWalletBalance);
      else if (info.totalMarginBalance) total = parseFloat(info.totalMarginBalance);
      else if (info.availableBalance) total = parseFloat(info.availableBalance);
    }
    if (free === 0 && info.availableBalance) {
      free = parseFloat(info.availableBalance);
    }
    if (Array.isArray(info.assets)) {
      const usdt = info.assets.find((a: any) => a.asset === 'USDT');
      if (usdt) {
        const wBal = parseFloat(usdt.walletBalance || usdt.marginBalance || '0');
        const aBal = parseFloat(usdt.availableBalance || '0');
        if (wBal > 0) total = wBal;
        if (aBal > 0) free = aBal;
      }
    }
  }

  if (used === 0 && total > free) {
    used = total - free;
  }

  return { total, free, used };
}

async function initExchange(apiKey: string, secret: string): Promise<{success: boolean, balance_usdt?: number, message?: string}> {
  if (!apiKey || !secret) return { success: false, message: 'API Key veya Secret Key eksik.' };
  
  const cleanApiKey = apiKey.trim();
  const cleanSecret = secret.trim();
  
  // Try binanceusdm first (pure Binance USDT-M Futures client targeting fapi.binance.com)
  const ExchangeClasses = [
    (ccxt as any).binanceusdm,
    ccxt.binance
  ].filter(Boolean);

  let lastError = '';

  for (const ExClass of ExchangeClasses) {
    try {
      const tempExchange = new ExClass({
        apiKey: cleanApiKey,
        secret: cleanSecret,
        enableRateLimit: true,
        options: {
          defaultType: 'future',
          adjustForTimeDifference: true,
          recvWindow: 60000
        }
      });

      // Load markets to verify symbols
      try {
        await tempExchange.loadMarkets();
      } catch (mErr) {
        // Continue even if loadMarkets has warnings
      }

      // Fetch balance specifically from futures
      let bal: any = null;
      try {
        bal = await tempExchange.fetchBalance({ type: 'future' });
      } catch (bErr) {
        try {
          bal = await tempExchange.fetchBalance();
        } catch (bErr2) {
          throw bErr;
        }
      }

      const { total, free } = await parseUsdtFromBalance(bal);
      
      exchange = tempExchange;
      addEngineLog('INFO', `Binance USDT-M Vadeli İşlemler API başarıyla bağlandı! Vadeli Cüzdan Bakiyesi: $${total.toFixed(2)} USDT`);
      return { success: true, balance_usdt: total };
    } catch (e: any) {
      lastError = e.message || 'Bilinmeyen Hata';
      // If 451 error detected, format clearly
      if (lastError.includes('451') || lastError.includes('restricted location') || lastError.includes('Eligibility')) {
        lastError = 'Binance IP Kısıtlaması (451): Sunucunuz Binance tarafından kısıtlanan bir bölgede (Örn: ABD). Render.com kullanıyorsanız lütfen servisinizi "Frankfurt (Almanya)" bölgesinde oluşturun.';
      }
    }
  }

  addEngineLog('ERROR', 'Binance API bağlantı hatası: ' + lastError);
  exchange = null;
  return { success: false, message: lastError };
}

// Check on startup
(async () => {
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY) {
    await initExchange(process.env.BINANCE_API_KEY, process.env.BINANCE_SECRET_KEY);
  } else if (fs.existsSync('config.json')) {
    try {
      const conf = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      if (conf?.stake_amount) {
        currentStakeAmount = conf.stake_amount === 'unlimited' ? 0 : Number(conf.stake_amount) || 0;
      }
      if (conf?.leverage) {
        targetLeverage = Number(conf.leverage) || 1;
      }
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
  
  if (level !== 'ERROR' && !message.includes('API')) {
    console.log(`[${level}] ${message}`);
  }
}

interface TradeRecord {
  trade_id: number;
  pair: string;
  is_open: boolean;
  type: string;
  amount: number;
  open_rate: number;
  open_date: number;
  close_rate?: number;
  close_date?: number;
  profit_ratio?: number;
  profit_abs?: number;
  exit_reason?: string;
}

let allTrades: TradeRecord[] = [];
let tradeCounter = 1;

interface ActivePosition {
  trade_id?: number;
  type: 'long' | 'short';
  entryPrice: number;
  amount: number;
  peakPrice: number;
}
let activePosition: ActivePosition | null = null;
const MAX_DRAWDOWN_PCT = 0.01; // %1 trailing stop
const HARD_STOP_PCT = 0.02; // %2 hard stop

let isProcessingTrade = false;


async function executeRealTradeLogic() {
  if (botState !== 'running' || isProcessingTrade) return;
  isProcessingTrade = true;
  if (!exchange) {
    addEngineLog('WARN', 'API Anahtarları eksik. Lütfen BINANCE_API_KEY ve BINANCE_SECRET_KEY giriniz.');
    return;
  }
  
  try {
    // 1. Fetch Order Book & Trades for Deep Analysis
    const orderBook = await exchange.fetchOrderBook(TRADING_PAIR, 500);
    const ohlcv = await exchange.fetchOHLCV(TRADING_PAIR, '1m', undefined, 15);
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

    // Store for UI access
    latestOrderBook = orderBook;
    latestMetrics = { OBI, MicroPrice, MidPrice, deltaV, currentPrice, VWAP, stdDev, SpreadPct };

    // Log the quantitative metrics
    const pDrift = ((MicroPrice - MidPrice) / MidPrice * 100);
    addEngineLog('INFO', `Derin Analiz | OBI: ${OBI.toFixed(2)} | Mikro-Baskı: %${pDrift.toFixed(5)} | Spread: ${(SpreadPct*100).toFixed(4)}%`);

    
    // Sadece bir tane açık pozisyon olabilir, çift pozisyon açmayı engelle (Ekstra Güvenlik)
    const hasOpenTradeForPair = allTrades.some(t => t.is_open && t.pair === TRADING_PAIR);

    if (!activePosition && !hasOpenTradeForPair) {
       const maxSpreadAllowed = 0.005; 
       
       let TRADE_AMOUNT = 0.001; 
       if (currentStakeAmount > 0 && currentPrice > 0) {
           const rawAmount = (currentStakeAmount * targetLeverage) / currentPrice;
           if (exchange && exchange.markets && exchange.markets[TRADING_PAIR]) {
               TRADE_AMOUNT = Number(exchange.amountToPrecision(TRADING_PAIR, rawAmount));
           } else {
               TRADE_AMOUNT = Number(rawAmount.toFixed(4));
           }
       }
       
       if (SpreadPct < maxSpreadAllowed) {
           // BASİTLEŞTİRİLMİŞ GİRİŞ: Sadece Emir Defteri Dengesizliği (OBI) veya Balina/Duvar Tespiti
           const isSupportStrong = OBI > 0.05 || isBidWallStrong;
           const isResistanceStrong = OBI < -0.05 || isAskWallStrong;

           if (isSupportStrong) {
               let longReason = "Güçlü Alıcı Baskısı (OBI > 0.05) veya Destek";
               addEngineLog('TRADE', `[LONG SİNYAL] ${longReason}! (OBI: ${OBI.toFixed(2)})`);
               if (!isDryRun) {
                   addEngineLog('TRADE', `[Canlı İşlem] ${TRADING_PAIR} market alımı (LONG) başlatılıyor...`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketBuyOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'long', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', `[BAŞARILI] Long açıldı. İşlem ID: ${order.id}`);
               } else {
                   activePosition = { type: 'long', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'long', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', `[SİMÜLASYON] Long açıldı.`);
               }
           } 
           else if (isResistanceStrong) {
               let shortReason = "Güçlü Satıcı Baskısı (OBI < -0.05) veya Direnç";
               addEngineLog('TRADE', `[SHORT SİNYAL] ${shortReason}! (OBI: ${OBI.toFixed(2)})`);
               if (!isDryRun) {
                   addEngineLog('TRADE', `[Canlı İşlem] ${TRADING_PAIR} market satışı (SHORT) başlatılıyor...`);
                   try { await exchange.setLeverage(targetLeverage, TRADING_PAIR); } catch(e){}
                   const order = await exchange.createMarketSellOrder(TRADING_PAIR, TRADE_AMOUNT);
                   activePosition = { type: 'short', entryPrice: order.price || currentPrice, amount: TRADE_AMOUNT, peakPrice: order.price || currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', `[BAŞARILI] Short açıldı. İşlem ID: ${order.id}`);
               } else {
                   activePosition = { type: 'short', entryPrice: currentPrice, amount: TRADE_AMOUNT, peakPrice: currentPrice };
                   const newTrade = { trade_id: tradeCounter++, pair: TRADING_PAIR, is_open: true, type: 'short', amount: TRADE_AMOUNT, open_rate: activePosition.entryPrice, open_date: Date.now() };
                   allTrades.unshift(newTrade);
                   activePosition.trade_id = newTrade.trade_id;
                   addEngineLog('TRADE', `[SİMÜLASYON] Short açıldı.`);
               }
           }
       } else {
           addEngineLog('WARN', `Spread çok yüksek (${(SpreadPct*100).toFixed(4)}%). İşlem riski nedeniyle giriş reddedildi.`);
       }
    } else if (activePosition) {
       // EXIT LOGIC (Çıkış Stratejileri)
       let lossFromEntry = 0;
       let drawdownFromPeak = 0;
       let currentProfitPct = 0; // Kaldıraçlı Kâr Oranı (%) (Arayüz ve hesaplamalar için)
       let baseProfitPct = 0;    // 1X Kâr Oranı (%) (Piyasanın saf hareketi)

       if (activePosition.type === 'long') {
           activePosition.peakPrice = Math.max(activePosition.peakPrice, currentPrice);
           lossFromEntry = (activePosition.entryPrice - currentPrice) / activePosition.entryPrice;
           drawdownFromPeak = (activePosition.peakPrice - currentPrice) / activePosition.peakPrice;
           baseProfitPct = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100;
           currentProfitPct = baseProfitPct * targetLeverage;
       } else {
           activePosition.peakPrice = Math.min(activePosition.peakPrice, currentPrice);
           lossFromEntry = (currentPrice - activePosition.entryPrice) / activePosition.entryPrice;
           drawdownFromPeak = (currentPrice - activePosition.peakPrice) / activePosition.peakPrice;
           baseProfitPct = ((activePosition.entryPrice - currentPrice) / activePosition.entryPrice) * 100;
           currentProfitPct = baseProfitPct * targetLeverage;
       }
       
       let shouldExit = false;
       let exitReason = '';

       // 3.1 Hard Stop - Zararı kes
       if (lossFromEntry >= HARD_STOP_PCT) {
           shouldExit = true;
           exitReason = `Hard Stop (Zarar Kes: %${(lossFromEntry*100 * targetLeverage).toFixed(2)})`;
       } 
       // 3.2 Kâr Alma (Take Profit)
       else if (currentProfitPct >= TAKE_PROFIT_PCT) {
           shouldExit = true;
           exitReason = `Kâr Hedefi Yakalandı (Kâr: %${currentProfitPct.toFixed(2)})`;
       }
       // 3.3 Momentum Kaybı (Trendin Yön Değiştirmesi)
       else if ((activePosition.type === 'long' && OBI < -0.30) || (activePosition.type === 'short' && OBI > 0.30)) {
           shouldExit = true;
           exitReason = `Hızlı Trend Değişimi (Momentum Kırıldı, OBI: ${OBI.toFixed(2)})`;
       }
       // 3.4 Dynamic Trailing Exit (Zirveden %1 geri çekilme) SADECE KÂRDAYSAM ÇALIŞSIN
       else if (currentProfitPct > 2 && drawdownFromPeak >= MAX_DRAWDOWN_PCT) {
           shouldExit = true;
           exitReason = `Dinamik Kâr Koruma (Zirveden %1 Geri Çekilme)`;
       }

       if (shouldExit) {
           await closeActivePosition(exitReason);
       }
    }
  } catch (error: any) {
    // Geçersiz API Key veya IP kısıtlaması hatası alındığında motoru otomatik durdur
    if (error.message.includes('-2015') || error.message.includes('Invalid API-key')) {
      addEngineLog('WARN', 'DİKKAT: Binance API anahtarınız geçersiz veya IP kısıtlaması açık. Lütfen Binance üzerinden "Unrestricted (Kısıtlamasız)" seçeneğini işaretleyin.');
      stopTradingEngine();
    }
  } finally {
    isProcessingTrade = false;
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



async function closeActivePosition(reason: string) {
  if (!activePosition) return;
  const currentPrice = latestMetrics?.currentPrice || activePosition.entryPrice;
  addEngineLog('TRADE', `[ÇIKIŞ] ${reason}. Pozisyon Kapatılıyor...`);
  try {
    if (!isDryRun && exchange) {
        let order;
        if (activePosition.type === 'long') {
            order = await exchange.createMarketSellOrder(TRADING_PAIR, activePosition.amount);
        } else {
            order = await exchange.createMarketBuyOrder(TRADING_PAIR, activePosition.amount);
        }
        addEngineLog('TRADE', `[BAŞARILI] Pozisyon Kapatıldı. İşlem ID: ${order.id}`);
    } else {
        // Mock success for Dry Run
        addEngineLog('TRADE', `[SİMÜLASYON] Pozisyon Kapatıldı.`);
    }
    const closedTrade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
    if (closedTrade) {
        closedTrade.is_open = false;
        closedTrade.close_rate = currentPrice;
        closedTrade.close_date = Date.now();
        closedTrade.profit_ratio = activePosition.type === 'long' ? (currentPrice - closedTrade.open_rate) / closedTrade.open_rate : (closedTrade.open_rate - currentPrice) / closedTrade.open_rate;
        closedTrade.profit_abs = closedTrade.profit_ratio * currentStakeAmount * targetLeverage;
        closedTrade.exit_reason = reason;
    }
    activePosition = null;
  } catch (err: any) {
    activePosition = null;
    addEngineLog('ERROR', `Pozisyon kapatılırken hata: ${err.message}`);
  }
}

async function stopTradingEngine() {
  if (botState === 'stopped') return;
  botState = 'stopped';
  if (engineLoop) clearInterval(engineLoop);
  
  if (activePosition) {
     await closeActivePosition('Motor Durduruldu (Tüm Açık Pozisyonlar Kapatıldı)');
  }
  
  // Close any stray open trades from memory just in case
  allTrades.forEach(t => {
      if (t.is_open) {
          t.is_open = false;
          t.close_rate = latestMetrics?.currentPrice || t.open_rate;
          t.close_date = Date.now();
          t.exit_reason = 'Motor Durduruldu (Zorla)';
      }
  });
  
  addEngineLog('INFO', 'Sistem: Dahili Node.js Ticaret Motoru Durduruldu ve tüm işlemler sonlandırıldı.');
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
      const conf = req.body;
      fs.writeFileSync('config.json', JSON.stringify(conf, null, 2));
      
      if (conf?.stake_amount) {
        currentStakeAmount = conf.stake_amount === 'unlimited' ? 0 : Number(conf.stake_amount) || 0;
      }
      if (conf?.leverage) {
        targetLeverage = Number(conf.leverage) || 1;
      }
      
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
            balance = await exchange.fetchBalance();
          } catch (e2) {
            // ignore
          }
        }

        const { total, free, used } = await parseUsdtFromBalance(balance);

        return res.json({
          live: true,
          currencies: [
            { currency: 'USDT', free, used, total, est_stake: total }
          ],
          total,
          symbol: 'USDT',
          value: total,
          balance_usdt: total,
          free_usdt: free,
          used_usdt: used
        });
      }
    } catch (error: any) {
      // Ignore silently
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
    // latestMetrics.currentPrice has the current market price
    const cPrice = latestMetrics?.currentPrice || 0;
    const formattedTrades = allTrades.map(t => {
      const isPositive = t.is_open ? 
        (t.type === 'long' ? cPrice > t.open_rate : cPrice < t.open_rate) : 
        (t.profit_ratio > 0);
      
      let pratio = t.profit_ratio || 0;
      let pabs = t.profit_abs || 0;
      
      if (t.is_open) {
          pratio = t.type === 'long' ? (cPrice - t.open_rate)/t.open_rate : (t.open_rate - cPrice)/t.open_rate;
          pabs = pratio * currentStakeAmount * targetLeverage;
      }

      return {
        id: t.trade_id.toString(),
        pair: t.pair,
        is_open: t.is_open,
        type: t.type,
        leverage: targetLeverage,
        amount: t.amount,
        open_rate: t.open_rate,
        current_rate: cPrice,
        close_rate: t.close_rate,
        open_date: new Date(t.open_date).toLocaleString(),
        close_date: t.close_date ? new Date(t.close_date).toLocaleString() : undefined,
        close_reason: t.exit_reason,
        profit_ratio: pratio,
        profit_pct: pratio * 100 * targetLeverage,
        profit_abs: pabs,
        stop_loss_abs: 0,
        stop_loss_pct: 0
      };
    });

    res.json({
      trades: formattedTrades,
      trade_count: formattedTrades.length,
    });
  });

  app.get('/api/v1/profit', (req, res) => {
    const closedTrades = allTrades.filter(t => !t.is_open);
    const winningTrades = closedTrades.filter(t => (t.profit_abs || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.profit_abs || 0) <= 0);
    const totalProfit = closedTrades.reduce((acc, t) => acc + (t.profit_abs || 0), 0);
    
    res.json({
      profit_closed_coin: totalProfit,
      profit_closed_percent_mean: 0,
      profit_closed_ratio_mean: 0,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      winrate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
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

  
  app.post('/api/v1/forceexit', async (req, res) => {
    const { tradeid } = req.body;
    if (activePosition && (activePosition.trade_id.toString() === tradeid.toString() || tradeid === 'all')) {
        await closeActivePosition('Kullanıcı Tarafından Manuel Olarak Zorla Kapatıldı');
        res.json({ status: 'success', message: 'İşlem başarıyla kapatıldı.' });
    } else {
        res.status(400).json({ error: 'Aktif açık işlem bulunamadı veya ID eşleşmedi.' });
    }
  });

  app.post('/api/v1/stop', async (req, res) => {
    await stopTradingEngine();
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
