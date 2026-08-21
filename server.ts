import express from 'express';
import path from 'path';
import fs from 'fs';
import ccxt from 'ccxt';
import WebSocket from 'ws';
import { createServer as createViteServer } from 'vite';

const PERSIST_DIR = process.env.PERSIST_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(PERSIST_DIR, 'config.json');
const STATE_FILE = path.join(PERSIST_DIR, 'trading-state.json');
fs.mkdirSync(PERSIST_DIR, { recursive: true });

type Side = 'long' | 'short';

let botState: 'running' | 'stopped' = 'stopped';
let engineLoop: NodeJS.Timeout | null = null;
let lastLogId = 0;
const engineLogs: any[] = [];

let latestOrderBook: any = null;
let latestMetrics: any = null;
let exchange: any = null;
let hedgeMode = false;
let privateExchangeReady = false;
let privateSyncWarningLogged = false;

let serverIp = 'Tespit ediliyor...';
let lastIpFetchTime = 0;

const LIVE_TRADING_ONLY = true;
let TRADING_PAIR = 'BTC/USDT';
let targetLeverage = 1;
let currentStakeAmount = 1000;
let maxOpenTrades = 1;
let tradableBalanceRatio = 0.99;
let marginMode: 'isolated' | 'cross' = 'isolated';
let takerFeeRate = 0.0005;
let riskProtectionMode: 'conservative' | 'balanced' | 'aggressive' = 'balanced';

const RISK_PROFILES = {
  conservative: {
    label: 'Muhafazakar',
    hardStopPct: 0.008,
    breakevenTriggerPct: 0.010,
    trailingActivationPct: 0.015,
    trailingStopPct: 0.008,
    deepProfitMinPct: 0.003,
    deepLossExitPct: 0.002,
    reversalScore: 0.50,
    confirmations: 2
  },
  balanced: {
    label: 'Dengeli',
    hardStopPct: 0.015,
    breakevenTriggerPct: 0.020,
    trailingActivationPct: 0.030,
    trailingStopPct: 0.012,
    deepProfitMinPct: 0.002,
    deepLossExitPct: 0.004,
    reversalScore: 0.55,
    confirmations: 2
  },
  aggressive: {
    label: 'Agresif',
    hardStopPct: 0.025,
    breakevenTriggerPct: 0.030,
    trailingActivationPct: 0.050,
    trailingStopPct: 0.020,
    deepProfitMinPct: 0.005,
    deepLossExitPct: 0.007,
    reversalScore: 0.65,
    confirmations: 3
  }
} as const;

function getRiskProfile() { return RISK_PROFILES[riskProtectionMode]; }

// Risk/target are defined from the underlying market move (the 1x reference),
// NOT from leveraged ROI. A 10% reference target therefore stays 10% at 1x, 5x or 15x.
const REFERENCE_TAKE_PROFIT_PCT = 0.10;
const HARD_STOP_PCT = 0.015;              // 1.5% adverse market move
const BREAKEVEN_TRIGGER_PCT = 0.02;       // after +2% market move, protect entry + fees
const TRAILING_ACTIVATION_PCT = 0.03;     // activate trailing after +3% market move
const TRAILING_STOP_PCT = 0.012;          // 1.2% retracement from peak
const DEEP_ENTRY_SCORE = 0.55;            // strong directional microstructure
const DEEP_REVERSAL_SCORE = 0.55;          // strong opposite pressure
const DEEP_REVERSAL_CONFIRMATIONS = 2;     // avoid one-tick exits
const ORDERBOOK_LEVELS = 500;

const DEFAULT_SIMPLE_MODE = {
  enabled: false,
  orderbook_history_minutes: 5,
  target_market_move_pct: 0.10,
  obi_projection_multiplier_pct: 0.15,
  min_obi: 0.45,
  snapshot_seconds: 5,
  min_liquidity_usdt: 250000,
  max_spread_pct: 0.10,
  min_obi_velocity: 0.03,
  require_obi_acceleration: true,
  wall_weakening_pct: 0.10,
  timeout_minutes: 5,
  cooldown_seconds: 60,
  reversal_obi: 0.12,
  profit_lock_trigger_pct: 0.04,
  profit_lock_pct: 0.015,
};

const DEFAULT_INTELLIGENT_MODE = {
  enabled: false,
  min_edge: 0.62,
  min_regime_quality: 0.58,
  min_liquidity_usdt: 500000,
  max_spread_pct: 0.12,
  lookback_minutes: 8,
  abstain_on_conflict: true,
  target_market_move_pct: 0.06,
  max_target_market_move_pct: 0.12,
  stop_market_move_pct: 0.012,
  max_hold_minutes: 8,
  cooldown_seconds: 90,
};

const DEFAULT_DEEP_ANALYSIS = {
  enabled: true,
  history_minutes: 10,
  snapshot_seconds: 5,
  min_long_probability: 0.70,
  min_short_probability: 0.70,
  whale_detection: true,
  whale_window_seconds: 60,
  whale_min_trade_usdt: 1000000,
  whale_net_flow_usdt: 2000000,
  whale_position_multiplier: 2.0,
  whale_max_multiplier: 3.0,
  whale_requires_directional_confirmation: true,
};

let deepAnalysisConfig = { ...DEFAULT_DEEP_ANALYSIS };
let simpleModeConfig = { ...DEFAULT_SIMPLE_MODE };
let intelligentModeConfig = { ...DEFAULT_INTELLIGENT_MODE };
let tradingMode: 'professional' | 'simple' | 'intelligent' = 'professional';
let coinSelectionMode: 'manual' | 'algorithmic' = 'manual';
let algorithmMaxOpenTrades = 1;
let algorithmMinOpportunityScore = 0.62;
let algorithmMinLiquidityUsdt = 250000;
let algorithmMaxSpreadPct = 0.12;

const whaleCache = new Map<string, { at: number; result: any }>();
const simpleCooldownUntil = new Map<string, number>();

// Live market-data caches. WebSocket feeds are the primary source; REST is only a
// short-lived fallback so the engine stays live without hammering Binance.
type LiveBook = { bids: number[][]; asks: number[][]; ts: number };
const liveBooks = new Map<string, LiveBook>();
const livePrices = new Map<string, { price: number; ts: number }>();
const liveMarkPrices = new Map<string, { price: number; ts: number }>();
const liveTradeBuffers = new Map<string, Array<{ price: number; qty: number; ts: number; maker: boolean }>>();
const restCache = new Map<string, { at: number; value: any }>();
const futuresContextCache = new Map<string, { at: number; value: any }>();
const futuresContextHistory = new Map<string, Array<{ ts: number; openInterest: number; fundingRate: number }>>();
let marketStreamsStarted = false;
let activeStreamKey = '';
let streamRefreshTimer: NodeJS.Timeout | null = null;
const streamSockets: WebSocket[] = [];
let streamGeneration = 0;

function cleanSymbol(pair: string) { return pair.replace('/', '').toLowerCase(); }
function cachedFresh<T>(key: string, ttlMs: number): T | null {
  const c = restCache.get(key);
  return c && Date.now() - c.at <= ttlMs ? c.value as T : null;
}
function setCached(key: string, value: any) { restCache.set(key, { at: Date.now(), value }); }
function getLiveBook(pair: string, market: 'spot' | 'futures') {
  const key = `${market}:${pair.replace('/', '').toUpperCase()}`;
  const b = liveBooks.get(key);
  return b && Date.now() - b.ts <= 2500 ? { bids: b.bids, asks: b.asks } : null;
}
function getLivePrice(pair: string) {
  const p = livePrices.get(pair.replace('/', '').toUpperCase());
  return p && Date.now() - p.ts <= 2500 ? p.price : 0;
}
function getLiveMarkPrice(pair: string) {
  const p = liveMarkPrices.get(pair.replace('/', '').toUpperCase());
  return p && Date.now() - p.ts <= 2500 ? p.price : 0;
}

function closeMarketSockets() {
  while (streamSockets.length) {
    try { streamSockets.pop()!.close(); } catch {}
  }
}

function startMarketDataStreams(forceReconnect = false) {
  const symbols = Array.from(new Set([
    ...configuredTradingPairs(),
    ...latestMarkets.slice(0, 50).map((m: any) => m.symbol)
  ])).map(cleanSymbol).filter(Boolean).sort();
  if (!symbols.length) return;
  const streamKey = symbols.join(',');
  if (!forceReconnect && marketStreamsStarted && streamKey === activeStreamKey) return;
  activeStreamKey = streamKey;
  closeMarketSockets();
  const generation = ++streamGeneration;
  const spotStreams = symbols.flatMap(s => [`${s}@depth20@100ms`, `${s}@aggTrade`]);
  const futuresStreams = symbols.flatMap(s => [`${s}@depth20@100ms`, `${s}@aggTrade`, `${s}@markPrice@1s`]);

  const connect = (base: string, streams: string[], market: 'spot' | 'futures') => {
    const url = `${base}/stream?streams=${streams.join('/')}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { return; }
    streamSockets.push(ws);
    ws.on('open', () => addEngineLog('INFO', `[WS] ${market.toUpperCase()} canlı veri bağlantısı açıldı (${symbols.length} parite)`));
    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        const d = msg?.data || msg;
        const symbol = String(d?.s || '').toUpperCase();
        if (!symbol) return;
        if (Array.isArray(d?.b) && Array.isArray(d?.a)) {
          liveBooks.set(`${market}:${symbol}`, {
            bids: d.b.map((x: any[]) => [safeNum(x?.[0]), safeNum(x?.[1])]).filter((x: number[]) => x[0] > 0 && x[1] >= 0),
            asks: d.a.map((x: any[]) => [safeNum(x?.[0]), safeNum(x?.[1])]).filter((x: number[]) => x[0] > 0 && x[1] >= 0),
            ts: Date.now()
          });
          const b = d.b?.[0]; const a = d.a?.[0];
          const mid = b && a ? (safeNum(b[0]) + safeNum(a[0])) / 2 : 0;
          if (mid > 0) livePrices.set(symbol, { price: mid, ts: Date.now() });
        }
        if (d?.e === 'markPriceUpdate' && market === 'futures') {
          const mark = safeNum(d?.p);
          if (mark > 0) liveMarkPrices.set(symbol, { price: mark, ts: Date.now() });
        }
        if (d?.e === 'aggTrade') {
          const buf = liveTradeBuffers.get(`${market}:${symbol}`) || [];
          buf.push({ price: safeNum(d.p), qty: safeNum(d.q), ts: safeNum(d.T, Date.now()), maker: Boolean(d.m) });
          const cutoff = Date.now() - 60_000;
          while (buf.length && buf[0].ts < cutoff) buf.shift();
          liveTradeBuffers.set(`${market}:${symbol}`, buf);
          if (safeNum(d.p) > 0) livePrices.set(symbol, { price: safeNum(d.p), ts: Date.now() });
        }
      } catch {}
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (marketStreamsStarted && generation === streamGeneration) {
        setTimeout(() => {
          if (marketStreamsStarted && generation === streamGeneration) startMarketDataStreams(true);
        }, 5000);
      }
    });
  };
  connect('wss://stream.binance.com:9443', spotStreams, 'spot');
  connect('wss://fstream.binance.com', futuresStreams, 'futures');
  marketStreamsStarted = true;
}

function getHardStopPct(leverage: number) {
  // At extreme leverage the hard stop must tighten so liquidation is not reached first.
  return Math.min(getRiskProfile().hardStopPct, 0.60 / Math.max(1, leverage));
}

const deepHistory = new Map<string, {
  score: number; priorScore: number; adverseConfirmations: number; lastAt: number;
  bidVolume: number; askVolume: number; obi: number; obiVelocity: number; previousObiVelocity: number;
  snapshots: Array<{ ts: number; price: number; obi: number; weightedOBI: number; maxAskWallUsdt?: number; maxBidWallUsdt?: number }>;
}>();
const ENGINE_INTERVAL_MS = 5000;
const APP_API_TOKEN = process.env.APP_API_TOKEN?.trim() || '';

interface TradeRecord {
  trade_id: number;
  pair: string;
  is_open: boolean;
  type: Side;
  amount: number;
  leverage: number;
  open_rate: number;
  open_date: number;
  close_rate?: number;
  close_date?: number;
  profit_ratio?: number;
  profit_abs?: number;
  exit_reason?: string;
  stop_loss_abs?: number;
  stop_loss_pct?: number;
  take_profit_abs?: number;
  take_profit_pct?: number;
  fee_open?: number;
  fee_close?: number;
  exchange_order_id?: string;
  protective_order_id?: string;
  position_mode?: 'one-way' | 'hedge';
  reference_target_pct?: number;
  reference_price_move_pct?: number;
  adaptive_target_pct?: number;
  adaptive_target_price?: number;
  adaptive_target_reason?: string;
}

interface ActivePosition {
  trade_id: number;
  type: Side;
  entryPrice: number;
  amount: number;
  peakPrice: number;
  margin: number;
  leverage: number;
  feeOpen: number;
  orderId?: string;
  protectiveOrderId?: string;
  currentStopPrice?: number;
  deepScore?: number;
  adaptiveTargetPct?: number;
}

let allTrades: TradeRecord[] = [];
let tradeCounter = 1;
let activePosition: ActivePosition | null = null;
let isProcessingTrade = false;
let startingBalance = 0;

function saveTradingState() {
  try {
    const payload = { version: 2, savedAt: Date.now(), tradeCounter, allTrades, activePosition, startingBalance, botState, riskProtectionMode, TRADING_PAIR, targetLeverage };
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  } catch (e: any) { addEngineLog('WARN', `[STATE] Kalıcı durum kaydedilemedi: ${e?.message || e}`); }
}

function loadTradingState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(state.allTrades)) allTrades = state.allTrades;
    if (state.activePosition) activePosition = state.activePosition;
    tradeCounter = Math.max(1, safeNum(state.tradeCounter, tradeCounter));
    startingBalance = safeNum(state.startingBalance, startingBalance);
    if (state.botState === 'running' || state.botState === 'stopped') botState = state.botState;
    addEngineLog('INFO', `[STATE] Kalıcı işlem durumu yüklendi | ${allTrades.length} kayıt | ${activePosition ? 'açık pozisyon mevcut' : 'açık pozisyon yok'}`);
  } catch (e: any) { addEngineLog('WARN', `[STATE] Durum dosyası okunamadı: ${e?.message || e}`); }
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function addEngineLog(level: string, message: string) {
  const log = {
    id: (++lastLogId).toString(),
    timestamp: new Date().toLocaleTimeString(),
    level,
    message
  };
  engineLogs.unshift(log);
  if (engineLogs.length > 100) engineLogs.pop();
  console.log(`[${level}] ${message}`);
}

async function getOrFetchServerIp(): Promise<string> {
  const now = Date.now();
  if (serverIp !== 'Tespit ediliyor...' && now - lastIpFetchTime < 30000) return serverIp;

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
      if (!res.ok) continue;
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        serverIp = json.ip || json.address || serverIp;
      } catch {
        serverIp = text.trim() || serverIp;
      }
      if (serverIp !== 'Tespit ediliyor...') {
        lastIpFetchTime = now;
        return serverIp;
      }
    } catch {}
  }
  return serverIp;
}

async function parseUsdtFromBalance(balance: any): Promise<{ total: number; free: number; used: number }> {
  if (!balance) return { total: 0, free: 0, used: 0 };

  let total = safeNum(balance?.USDT?.total);
  let free = safeNum(balance?.USDT?.free);
  let used = safeNum(balance?.USDT?.used);

  total ||= safeNum(balance?.total?.USDT);
  free ||= safeNum(balance?.free?.USDT);
  used ||= safeNum(balance?.used?.USDT);

  const info = balance?.info;
  if (info) {
    total ||= safeNum(info.totalMarginBalance) || safeNum(info.totalWalletBalance) || safeNum(info.availableBalance);
    free ||= safeNum(info.availableBalance);
    if (Array.isArray(info.assets)) {
      const usdt = info.assets.find((a: any) => a.asset === 'USDT');
      if (usdt) {
        total ||= safeNum(usdt.marginBalance) || safeNum(usdt.walletBalance);
        free ||= safeNum(usdt.availableBalance);
      }
    }
  }

  if (!used && total > free) used = total - free;
  return { total, free, used };
}

function applyConfig(conf: any) {
  const next = conf || {};
  currentStakeAmount = next.stake_amount === 'unlimited'
    ? 0
    : Math.max(0, safeNum(next.stake_amount, 1000));
  targetLeverage = Math.max(1, Math.floor(safeNum(next.leverage, 1)));
  algorithmMaxOpenTrades = Math.floor(clamp(safeNum(next.coin_selection?.max_open_trades, 1), 1, 10));
  maxOpenTrades = 1; // Current engine tracks one live net position; selector still limits ranked entries safely.
  coinSelectionMode = next.coin_selection?.mode === 'algorithmic' ? 'algorithmic' : 'manual';
  algorithmMinOpportunityScore = clamp(safeNum(next.coin_selection?.min_opportunity_score, 0.62), 0.40, 0.95);
  algorithmMinLiquidityUsdt = Math.max(0, safeNum(next.coin_selection?.min_liquidity_usdt, 250000));
  algorithmMaxSpreadPct = clamp(safeNum(next.coin_selection?.max_spread_pct, 0.12), 0.01, 2);
  tradableBalanceRatio = Math.min(1, Math.max(0.01, safeNum(next.tradable_balance_ratio, 0.99)));
  marginMode = next.margin_mode === 'cross' ? 'cross' : 'isolated';
  takerFeeRate = Math.max(0, safeNum(next.fee_rate, 0.0005));
  const requestedRisk = String(next.risk_protection?.mode || next.risk_protection_mode || 'balanced').toLowerCase();
  riskProtectionMode = (requestedRisk === 'conservative' || requestedRisk === 'aggressive') ? requestedRisk : 'balanced';

  const requestedMode = String(next.trading_mode_mode || next.engine_mode || 'professional').toLowerCase();
  tradingMode = requestedMode === 'simple' ? 'simple' : requestedMode === 'intelligent' ? 'intelligent' : 'professional';

  const sm = next.simple_mode || {};
  simpleModeConfig = {
    ...DEFAULT_SIMPLE_MODE,
    ...sm,
    enabled: sm.enabled === true,
    orderbook_history_minutes: clamp(safeNum(sm.orderbook_history_minutes, DEFAULT_SIMPLE_MODE.orderbook_history_minutes), 1, 120),
    target_market_move_pct: clamp(safeNum(sm.target_market_move_pct, DEFAULT_SIMPLE_MODE.target_market_move_pct), 0.01, 1),
    obi_projection_multiplier_pct: clamp(safeNum(sm.obi_projection_multiplier_pct, DEFAULT_SIMPLE_MODE.obi_projection_multiplier_pct), 0.01, 1),
    min_obi: clamp(safeNum(sm.min_obi, DEFAULT_SIMPLE_MODE.min_obi), 0.05, 0.95),
    snapshot_seconds: clamp(safeNum(sm.snapshot_seconds, DEFAULT_SIMPLE_MODE.snapshot_seconds), 2, 60),
    min_liquidity_usdt: Math.max(0, safeNum(sm.min_liquidity_usdt, DEFAULT_SIMPLE_MODE.min_liquidity_usdt)),
    max_spread_pct: clamp(safeNum(sm.max_spread_pct, DEFAULT_SIMPLE_MODE.max_spread_pct), 0.01, 2),
    min_obi_velocity: clamp(safeNum(sm.min_obi_velocity, DEFAULT_SIMPLE_MODE.min_obi_velocity), 0, 0.50),
    require_obi_acceleration: sm.require_obi_acceleration !== false,
    wall_weakening_pct: clamp(safeNum(sm.wall_weakening_pct, DEFAULT_SIMPLE_MODE.wall_weakening_pct), 0, 1),
    timeout_minutes: clamp(safeNum(sm.timeout_minutes, DEFAULT_SIMPLE_MODE.timeout_minutes), 1, 60),
    cooldown_seconds: clamp(safeNum(sm.cooldown_seconds, DEFAULT_SIMPLE_MODE.cooldown_seconds), 0, 3600),
    reversal_obi: clamp(safeNum(sm.reversal_obi, DEFAULT_SIMPLE_MODE.reversal_obi), 0.02, 0.80),
    profit_lock_trigger_pct: clamp(safeNum(sm.profit_lock_trigger_pct, DEFAULT_SIMPLE_MODE.profit_lock_trigger_pct), 0.005, 0.50),
    profit_lock_pct: clamp(safeNum(sm.profit_lock_pct, DEFAULT_SIMPLE_MODE.profit_lock_pct), 0, 0.20),
  };
  simpleModeConfig.enabled = tradingMode === 'simple';

  const im = next.intelligent_mode || {};
  intelligentModeConfig = {
    ...DEFAULT_INTELLIGENT_MODE,
    ...im,
    enabled: tradingMode === 'intelligent',
    min_edge: clamp(safeNum(im.min_edge, DEFAULT_INTELLIGENT_MODE.min_edge), 0.50, 0.95),
    min_regime_quality: clamp(safeNum(im.min_regime_quality, DEFAULT_INTELLIGENT_MODE.min_regime_quality), 0.40, 0.95),
    min_liquidity_usdt: Math.max(0, safeNum(im.min_liquidity_usdt, DEFAULT_INTELLIGENT_MODE.min_liquidity_usdt)),
    max_spread_pct: clamp(safeNum(im.max_spread_pct, DEFAULT_INTELLIGENT_MODE.max_spread_pct), 0.01, 2),
    lookback_minutes: clamp(safeNum(im.lookback_minutes, DEFAULT_INTELLIGENT_MODE.lookback_minutes), 2, 60),
    abstain_on_conflict: im.abstain_on_conflict !== false,
    target_market_move_pct: clamp(safeNum(im.target_market_move_pct, DEFAULT_INTELLIGENT_MODE.target_market_move_pct), 0.01, 0.20),
    max_target_market_move_pct: clamp(safeNum(im.max_target_market_move_pct, DEFAULT_INTELLIGENT_MODE.max_target_market_move_pct), 0.02, 0.30),
    stop_market_move_pct: clamp(safeNum(im.stop_market_move_pct, DEFAULT_INTELLIGENT_MODE.stop_market_move_pct), 0.003, 0.05),
    max_hold_minutes: clamp(safeNum(im.max_hold_minutes, DEFAULT_INTELLIGENT_MODE.max_hold_minutes), 1, 120),
    cooldown_seconds: clamp(safeNum(im.cooldown_seconds, DEFAULT_INTELLIGENT_MODE.cooldown_seconds), 0, 3600),
  };

  const da = next.deep_analysis || {};
  deepAnalysisConfig = {
    ...DEFAULT_DEEP_ANALYSIS,
    ...da,
    history_minutes: clamp(safeNum(da.history_minutes, DEFAULT_DEEP_ANALYSIS.history_minutes), 1, 120),
    snapshot_seconds: clamp(safeNum(da.snapshot_seconds, DEFAULT_DEEP_ANALYSIS.snapshot_seconds), 2, 60),
    min_long_probability: clamp(safeNum(da.min_long_probability, DEFAULT_DEEP_ANALYSIS.min_long_probability), 0.50, 0.99),
    min_short_probability: clamp(safeNum(da.min_short_probability, DEFAULT_DEEP_ANALYSIS.min_short_probability), 0.50, 0.99),
    whale_window_seconds: clamp(safeNum(da.whale_window_seconds, DEFAULT_DEEP_ANALYSIS.whale_window_seconds), 10, 300),
    whale_min_trade_usdt: Math.max(10000, safeNum(da.whale_min_trade_usdt, DEFAULT_DEEP_ANALYSIS.whale_min_trade_usdt)),
    whale_net_flow_usdt: Math.max(10000, safeNum(da.whale_net_flow_usdt, DEFAULT_DEEP_ANALYSIS.whale_net_flow_usdt)),
    whale_position_multiplier: clamp(safeNum(da.whale_position_multiplier, DEFAULT_DEEP_ANALYSIS.whale_position_multiplier), 1, 5),
    whale_max_multiplier: clamp(safeNum(da.whale_max_multiplier, DEFAULT_DEEP_ANALYSIS.whale_max_multiplier), 1, 5),
  };

  const whitelist = Array.isArray(next?.exchange?.pair_whitelist)
    ? next.exchange.pair_whitelist.filter((p: any) => typeof p === 'string' && p.includes('/'))
    : [];
  if (whitelist.length) TRADING_PAIR = whitelist[0];
}

function readConfig(): any {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e: any) {
    addEngineLog('ERROR', `config.json okunamadı: ${e.message}`);
  }
  return {};
}

const initialConfig = readConfig();
applyConfig(initialConfig);
loadTradingState();

function getConfiguredBinanceCredentials(): { apiKey: string; secret: string } {
  const conf = readConfig();
  const apiKey = String(process.env.BINANCE_API_KEY || conf?.exchange?.key || '').trim();
  const secret = String(process.env.BINANCE_SECRET_KEY || conf?.exchange?.secret || '').trim();
  return { apiKey, secret };
}

function hasPrivateBinanceCredentials(): boolean {
  const { apiKey, secret } = getConfiguredBinanceCredentials();
  return Boolean(apiKey && secret);
}

function requirePrivateExchange(): void {
  if (!exchange || !privateExchangeReady) {
    throw new Error('Binance USDT-M Futures API anahtarları bağlı değil. Render ortam değişkenlerinde BINANCE_API_KEY ve BINANCE_SECRET_KEY tanımlayın.');
  }
}

async function createPublicExchange() {
  const ExClass = (ccxt as any).binanceusdm;
  if (!ExClass) throw new Error('CCXT Binance USDT-M sınıfı bulunamadı.');
  const ex = new ExClass({
    enableRateLimit: true,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
      recvWindow: 60000
    }
  });
  await ex.loadMarkets();
  return ex;
}

async function detectPositionMode(ex: any) {
  try {
    if (typeof ex.fetchPositionMode === 'function') {
      const result = await ex.fetchPositionMode();
      hedgeMode = Boolean(result?.hedged);
    }
  } catch {
    hedgeMode = false;
  }
}

async function initExchange(apiKey: string, secret: string): Promise<{ success: boolean; balance_usdt?: number; message?: string }> {
  privateExchangeReady = false;
  privateSyncWarningLogged = false;
  if (!apiKey?.trim() || !secret?.trim()) {
    return { success: false, message: 'API Key veya Secret Key eksik.' };
  }

  const ExchangeClasses = [(ccxt as any).binanceusdm].filter(Boolean);

  let lastError = 'Bilinmeyen hata';

  for (const ExClass of ExchangeClasses) {
    try {
      const tempExchange = new ExClass({
        apiKey: apiKey.trim(),
        secret: secret.trim(),
        enableRateLimit: true,
        options: {
          defaultType: 'future',
          adjustForTimeDifference: true,
          recvWindow: 60000
        }
      });

      await tempExchange.loadMarkets();
      const bal = await tempExchange.fetchBalance({ type: 'future' });
      const { total } = await parseUsdtFromBalance(bal);
      await detectPositionMode(tempExchange);

      exchange = tempExchange;
      privateExchangeReady = true;
      privateSyncWarningLogged = false;
      if (total > 0 && startingBalance <= 0) startingBalance = total;

      addEngineLog('INFO', `Binance USDT-M bağlı. Futures bakiye: ${total.toFixed(2)} USDT | Mod: LIVE`);
      return { success: true, balance_usdt: total };
    } catch (e: any) {
      lastError = e?.message || String(e);
      if (lastError.includes('451') || lastError.toLowerCase().includes('restricted location')) {
        lastError = 'Binance IP kısıtlaması (451): Sunucu bölgesi Binance tarafından desteklenmiyor.';
      }
    }
  }

  addEngineLog('ERROR', `Binance API bağlantı hatası: ${lastError}`);
  return { success: false, message: lastError };
}

async function ensureExchange() {
  if (exchange) return;
  try {
    exchange = await createPublicExchange();
    await detectPositionMode(exchange);
    addEngineLog('INFO', `Binance USDT-M Futures piyasa verisi hazır. ${hasPrivateBinanceCredentials() ? 'Özel API bağlantısı başlatılıyor.' : 'API anahtarı bekleniyor; yalnızca public piyasa verisi aktif.'}`);
  } catch (e: any) {
    addEngineLog('ERROR', `Binance piyasa bağlantısı kurulamadı: ${e.message}`);
    exchange = null;
  }
}

async function getFuturesBalance(): Promise<{ total: number; free: number; used: number }> {
  if (!exchange) return { total: 0, free: 0, used: 0 };

  const balance = await exchange.fetchBalance({ type: 'future' });
  return parseUsdtFromBalance(balance);
}

async function fetchPublicDepth(pair: string, market: 'spot' | 'futures', limit = 500) {
  const symbolClean = pair.replace('/', '').toUpperCase();
  const endpoints = market === 'spot'
    ? [
        `https://data-api.binance.vision/api/v3/depth?symbol=${symbolClean}&limit=${limit}`,
        `https://api.binance.com/api/v3/depth?symbol=${symbolClean}&limit=${limit}`
      ]
    : [`https://fapi.binance.com/fapi/v1/depth?symbol=${symbolClean}&limit=${limit}`];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) });
      if (resp.ok) {
        const json = await resp.json();
        if (json?.bids?.length && json?.asks?.length) {
          return {
            bids: json.bids.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: json.asks.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])])
          };
        }
      }
    } catch {}
  }
  return null;
}

async function fetchSpotOrderBook(pair: string, limit = ORDERBOOK_LEVELS) {
  const live = getLiveBook(pair, 'spot');
  if (live) return live;
  const key = `depth:spot:${pair}`;
  const cached = cachedFresh<any>(key, 1200);
  if (cached) return cached;
  const value = await fetchPublicDepth(pair, 'spot', limit);
  if (value) setCached(key, value);
  return value;
}

async function fetchFuturesOrderBook(pair: string, limit = 100) {
  const live = getLiveBook(pair, 'futures');
  if (live) return live;
  const key = `depth:futures:${pair}`;
  const cached = cachedFresh<any>(key, 1200);
  if (cached) return cached;
  const value = await fetchPublicDepth(pair, 'futures', limit);
  if (value) setCached(key, value);
  return value;
}

async function fetchSpotTicker(pair: string): Promise<number> {
  const live = getLivePrice(pair);
  if (live > 0) return live;
  const cacheKey = `ticker:spot:${pair}`;
  const cached = cachedFresh<number>(cacheKey, 2000);
  if (cached) return cached;
  const symbolClean = pair.replace('/', '').toUpperCase();
  for (const url of [
    `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbolClean}`,
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbolClean}`
  ]) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const json = await resp.json();
        const p = parseFloat(json?.price);
        if (p > 0) { setCached(cacheKey, p); return p; }
      }
    } catch {}
  }
  return 0;
}

async function fetchRecentTradeDelta(pair: string, market: 'spot' | 'futures' = 'spot') {
  const symbolClean = pair.replace('/', '').toUpperCase();
  const cacheKey = `delta:${market}:${symbolClean}`;
  const cached = cachedFresh<any>(cacheKey, 10_000);
  if (cached) return cached;
  const live = liveTradeBuffers.get(`${market}:${symbolClean}`);
  if (live && live.length) {
    let buy = 0, sell = 0, whaleBuyUsdt = 0, whaleSellUsdt = 0, whaleCount = 0, largestTradeUsdt = 0;
    const cutoff = Date.now() - deepAnalysisConfig.whale_window_seconds * 1000;
    for (const t of live) {
      const usdt = t.qty * t.price;
      if (t.maker) sell += t.qty; else buy += t.qty;
      if (t.ts >= cutoff && usdt >= deepAnalysisConfig.whale_min_trade_usdt) {
        whaleCount++; largestTradeUsdt = Math.max(largestTradeUsdt, usdt);
        if (t.maker) whaleSellUsdt += usdt; else whaleBuyUsdt += usdt;
      }
    }
    const volume = buy + sell;
    const result = { delta: buy - sell, volume, ratio: volume > 0 ? clamp((buy - sell) / volume, -1, 1) : 0,
      whaleBuyUsdt, whaleSellUsdt, whaleNetUsdt: whaleBuyUsdt - whaleSellUsdt, whaleCount, largestTradeUsdt,
      whaleScore: clamp((whaleBuyUsdt - whaleSellUsdt) / Math.max(deepAnalysisConfig.whale_net_flow_usdt, 1), -1, 1) };
    setCached(cacheKey, result);
    return result;
  }
  const endpoint = market === 'spot'
    ? `https://data-api.binance.vision/api/v3/aggTrades?symbol=${symbolClean}&limit=1000`
    : `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbolClean}&limit=1000`;
  try {
    const resp = await fetch(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) });
    if (!resp.ok) return { delta: 0, volume: 0, ratio: 0, whaleScore: 0, whaleBuyUsdt: 0, whaleSellUsdt: 0, whaleNetUsdt: 0, whaleCount: 0, largestTradeUsdt: 0 };
    const trades = await resp.json();
    let buy = 0, sell = 0, whaleBuyUsdt = 0, whaleSellUsdt = 0, whaleCount = 0, largestTradeUsdt = 0;
    const cutoff = Date.now() - deepAnalysisConfig.whale_window_seconds * 1000;
    for (const t of Array.isArray(trades) ? trades : []) {
      const qty = safeNum(t?.q); const price = safeNum(t?.p); const ts = safeNum(t?.T || t?.E, Date.now());
      if (qty <= 0 || price <= 0) continue;
      const usdt = qty * price; if (t?.m) sell += qty; else buy += qty;
      if (ts >= cutoff && usdt >= deepAnalysisConfig.whale_min_trade_usdt) { whaleCount++; largestTradeUsdt = Math.max(largestTradeUsdt, usdt); if (t?.m) whaleSellUsdt += usdt; else whaleBuyUsdt += usdt; }
    }
    const volume = buy + sell;
    const result = { delta: buy - sell, volume, ratio: volume > 0 ? clamp((buy - sell) / volume, -1, 1) : 0, whaleBuyUsdt, whaleSellUsdt,
      whaleNetUsdt: whaleBuyUsdt - whaleSellUsdt, whaleCount, largestTradeUsdt,
      whaleScore: clamp((whaleBuyUsdt - whaleSellUsdt) / Math.max(deepAnalysisConfig.whale_net_flow_usdt, 1), -1, 1) };
    setCached(cacheKey, result);
    return result;
  } catch { return { delta: 0, volume: 0, ratio: 0, whaleScore: 0, whaleBuyUsdt: 0, whaleSellUsdt: 0, whaleNetUsdt: 0, whaleCount: 0, largestTradeUsdt: 0 }; }
}
async function fetchFuturesMarketContext(pair: string) {
  const symbol = pair.replace('/', '').toUpperCase();
  const cached = futuresContextCache.get(symbol);
  if (cached && Date.now() - cached.at < 5000) return cached.value;
  const empty = { openInterest: 0, openInterestChange: 0, fundingRate: 0, fundingChange: 0, markPrice: 0, liquidationBuyUsdt: 0, liquidationSellUsdt: 0, liquidationNetUsdt: 0, liquidationCount: 0, takerBuyVolume: 0, takerSellVolume: 0, takerDelta: 0, takerDeltaRatio: 0 };
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    const [oiResp, premiumResp, takerResp, liqResp] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { headers, signal: AbortSignal.timeout(2500) }),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { headers, signal: AbortSignal.timeout(2500) }),
      fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`, { headers, signal: AbortSignal.timeout(2500) }),
      fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${symbol}&limit=100`, { headers, signal: AbortSignal.timeout(2500) })
    ]);
    const oiJson = oiResp.ok ? await oiResp.json() : {};
    const premium = premiumResp.ok ? await premiumResp.json() : {};
    const taker = takerResp.ok ? await takerResp.json() : [];
    const liqs = liqResp.ok ? await liqResp.json() : [];
    const openInterest = safeNum(oiJson?.openInterest);
    const fundingRate = safeNum(premium?.lastFundingRate);
    const markPrice = safeNum(premium?.markPrice);
    const prev = futuresContextHistory.get(symbol) || [];
    const prevOi = prev.length ? prev[prev.length - 1].openInterest : openInterest;
    const prevFunding = prev.length ? prev[prev.length - 1].fundingRate : fundingRate;
    const openInterestChange = prevOi > 0 ? clamp((openInterest - prevOi) / prevOi, -1, 1) : 0;
    const fundingChange = fundingRate - prevFunding;
    const ratio = Array.isArray(taker) && taker[0] ? safeNum(taker[0].buySellRatio, 1) : 1;
    const takerBuyVolume = Math.max(0, ratio);
    const takerSellVolume = ratio > 0 ? 1 / ratio : 0;
    const takerDeltaRatio = clamp((takerBuyVolume - takerSellVolume) / Math.max(takerBuyVolume + takerSellVolume, 1e-9), -1, 1);
    let liquidationBuyUsdt = 0, liquidationSellUsdt = 0, liquidationCount = 0;
    for (const x of Array.isArray(liqs) ? liqs : []) {
      const q = safeNum(x?.origQty); const price = safeNum(x?.price || x?.avgPrice); const usdt = q * price;
      if (usdt <= 0) continue;
      liquidationCount++;
      const side = String(x?.side || '').toUpperCase();
      if (side === 'SELL') liquidationSellUsdt += usdt; else if (side === 'BUY') liquidationBuyUsdt += usdt;
    }
    const result = { openInterest, openInterestChange, fundingRate, fundingChange, markPrice, liquidationBuyUsdt, liquidationSellUsdt, liquidationNetUsdt: liquidationBuyUsdt - liquidationSellUsdt, liquidationCount, takerBuyVolume, takerSellVolume, takerDelta: takerBuyVolume - takerSellVolume, takerDeltaRatio };
    const history = [...prev, { ts: Date.now(), openInterest, fundingRate }].slice(-60);
    futuresContextHistory.set(symbol, history);
    futuresContextCache.set(symbol, { at: Date.now(), value: result });
    return result;
  } catch { return cached?.value || empty; }
}

async function fetchBinancePublicTicker(pair: string): Promise<number> {
  const live = getLivePrice(pair);
  if (live > 0) return live;
  const cacheKey = `ticker:futures:${pair}`;
  const cached = cachedFresh<number>(cacheKey, 2000);
  if (cached) return cached;
  const symbolClean = pair.replace('/', '').toUpperCase();
  if (exchange) {
    try {
      const ticker = await exchange.fetchTicker(pair);
      const p = safeNum(ticker?.last) || safeNum(ticker?.close) || safeNum(ticker?.mark);
      if (p > 0) { setCached(cacheKey, p); return p; }
    } catch {}
  }
  const endpoints = [
    `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbolClean}`,
    `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbolClean}`,
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbolClean}`
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const json = await resp.json();
        const p = parseFloat(json?.price);
        if (p > 0) { setCached(cacheKey, p); return p; }
      }
    } catch {}
  }
  return safeNum(latestMetrics?.currentPrice, 96000);
}

async function fetchSpotKlines(pair: string, interval = '15m', limit = 48) {
  const cacheKey = `klines:spot:${pair}:${interval}:${limit}`;
  const cached = cachedFresh<any[]>(cacheKey, 30_000);
  if (cached) return cached;
  const symbolClean = pair.replace('/', '').toUpperCase();
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbolClean}&interval=${interval}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${symbolClean}&interval=${interval}&limit=${limit}`
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json) && json.length) {
          const value = json.map((d: any) => ({
            timestamp: Number(d[0]),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
          }));
          setCached(cacheKey, value);
          return value;
        }
      }
    } catch {}
  }
  return [];
}

async function fetchBinancePublicKlines(pair: string, interval = '5m', limit = 80) {
  const symbolClean = pair.replace('/', '').toUpperCase();
  let rawKlines: any[] = [];
  
  if (exchange) {
    try {
      const ohlcv = await exchange.fetchOHLCV(pair, interval, undefined, limit);
      if (ohlcv && ohlcv.length) {
        rawKlines = ohlcv.map((c: any) => [c[0], c[1], c[2], c[3], c[4], c[5]]);
      }
    } catch {}
  }

  if (!rawKlines.length) {
    const endpoints = [
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbolClean}&interval=${interval}&limit=${limit}`,
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbolClean}&interval=${interval}&limit=${limit}`,
      `https://api.binance.com/api/v3/klines?symbol=${symbolClean}&interval=${interval}&limit=${limit}`
    ];
    for (const url of endpoints) {
      try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) });
        if (resp.ok) {
          const json = await resp.json();
          if (Array.isArray(json) && json.length) {
            rawKlines = json;
            break;
          }
        }
      } catch {}
    }
  }

  const candles = rawKlines.map((d: any) => ({
    time: new Date(Number(d[0])).toISOString(),
    timestamp: Number(d[0]),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    sma20: undefined as number | undefined,
    sma50: undefined as number | undefined,
    bbUpper: undefined as number | undefined,
    bbLower: undefined as number | undefined,
    rsi: undefined as number | undefined
  }));

  const closes = candles.map(c => c.close);
  for (let i = 0; i < candles.length; i++) {
    if (i >= 19) {
      const slice20 = closes.slice(i - 19, i + 1);
      const avg20 = slice20.reduce((a, b) => a + b, 0) / 20;
      candles[i].sma20 = parseFloat(avg20.toFixed(2));
      const variance = slice20.reduce((s, v) => s + Math.pow(v - avg20, 2), 0) / 20;
      const sd = Math.sqrt(variance);
      candles[i].bbUpper = parseFloat((avg20 + 2 * sd).toFixed(2));
      candles[i].bbLower = parseFloat((avg20 - 2 * sd).toFixed(2));
    }
    if (i >= 49) {
      const slice50 = closes.slice(i - 49, i + 1);
      candles[i].sma50 = parseFloat((slice50.reduce((a, b) => a + b, 0) / 50).toFixed(2));
    }
  }

  if (candles.length > 14) {
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / 14;
    let avgLoss = losses / 14;
    candles[14].rsi = avgLoss === 0 ? 100 : parseFloat((100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2));
    for (let i = 15; i < candles.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const g = diff >= 0 ? diff : 0;
      const l = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * 13 + g) / 14;
      avgLoss = (avgLoss * 13 + l) / 14;
      candles[i].rsi = avgLoss === 0 ? 100 : parseFloat((100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2));
    }
  }

  return candles;
}

async function fetchBinancePublic24hrMarkets() {
  const cached = cachedFresh<any[]>('markets:24hr', 30_000);
  if (cached) return cached;
  const endpoints = [
    'https://fapi.binance.com/fapi/v1/ticker/24hr',
    'https://data-api.binance.vision/api/v3/ticker/24hr',
    'https://api.binance.com/api/v3/ticker/24hr'
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json) && json.length) {
          const usdtMarkets = json
            .filter((x: any) => typeof x.symbol === 'string' && x.symbol.endsWith('USDT') && !x.symbol.includes('_'))
            .map((x: any) => {
              const base = x.symbol.replace(/USDT$/, '');
              const symbol = `${base}/USDT`;
              const price = parseFloat(x.lastPrice || x.price || 0);
              const change_24h_pct = parseFloat(x.priceChangePercent || 0);
              const volume_24h_usdt = parseFloat(x.quoteVolume || x.volume || 0);
              const high_24h = parseFloat(x.highPrice || 0);
              const low_24h = parseFloat(x.lowPrice || 0);
              return {
                symbol,
                base,
                quote: 'USDT',
                price,
                change_24h_pct,
                volume_24h_usdt,
                high_24h,
                low_24h,
                in_whitelist: configuredTradingPairs().includes(symbol),
                in_blacklist: false,
                signal: change_24h_pct > 1 ? 'BUY' : change_24h_pct < -1 ? 'SELL' : 'NEUTRAL'
              };
            })
            .sort((a: any, b: any) => b.volume_24h_usdt - a.volume_24h_usdt)
            .slice(0, 100);

          if (usdtMarkets.length > 0) { setCached('markets:24hr', usdtMarkets); return usdtMarkets; }
        }
      }
    } catch {}
  }
  return null;
}

async function getCurrentPrice(symbol = TRADING_PAIR): Promise<number> {
  const live = getLivePrice(symbol);
  if (live > 0) return live;
  const p = await fetchBinancePublicTicker(symbol);
  if (p > 0) return p;
  return safeNum(latestMetrics?.currentPrice, 96000);
}

async function getMarkPrice(symbol = TRADING_PAIR): Promise<number> {
  const liveMark = getLiveMarkPrice(symbol);
  if (liveMark > 0) return liveMark;
  try {
    const cached = cachedFresh<number>(`mark:${symbol}`, 2000);
    if (cached) return cached;
    const clean = symbol.replace('/', '').toUpperCase();
    const resp = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${clean}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(2500) });
    if (resp.ok) { const j = await resp.json(); const m = safeNum(j?.markPrice); if (m > 0) { setCached(`mark:${symbol}`, m); return m; } }
  } catch {}
  return await getCurrentPrice(symbol);
}

function orderParams(side: Side, reduceOnly = false) {
  const params: any = {};
  // Binance does not accept reduceOnly together with positionSide in Hedge Mode.
  if (reduceOnly && !hedgeMode) params.reduceOnly = true;
  if (hedgeMode) params.positionSide = side === 'long' ? 'LONG' : 'SHORT';
  return params;
}

async function setRiskParameters(symbol: string, leverage: number) {
  if (!exchange) return leverage;
  const market = exchange.market(symbol);
  const maxLev = safeNum(market?.limits?.leverage?.max, 125);
  const lev = Math.max(1, Math.min(leverage, maxLev || 125));

  try {
    if (typeof exchange.setMarginMode === 'function') {
      await exchange.setMarginMode(marginMode, symbol);
    }
  } catch (e: any) {
    const msg = e?.message || '';
    if (!msg.toLowerCase().includes('already')) {
      addEngineLog('WARN', `Margin mode ayarlanamadı (${marginMode}): ${msg}`);
    }
  }

  if (typeof exchange.setLeverage === 'function') {
    await exchange.setLeverage(lev, symbol);
  }
  return lev;
}

async function resolveOrderPrice(order: any, symbol: string, fallback: number): Promise<number> {
  let price = safeNum(order?.average) || safeNum(order?.price);
  if (price > 0) return price;

  try {
    if (order?.id && typeof exchange?.fetchOrder === 'function') {
      const filled = await exchange.fetchOrder(order.id, symbol);
      price = safeNum(filled?.average) || safeNum(filled?.price);
    }
  } catch {}
  return price > 0 ? price : fallback;
}

function makeTradeStats(trade: TradeRecord, currentPrice: number) {
  const priceMove = trade.type === 'long'
    ? (currentPrice - trade.open_rate) / trade.open_rate
    : (trade.open_rate - currentPrice) / trade.open_rate;

  const grossPnl = trade.type === 'long'
    ? (currentPrice - trade.open_rate) * trade.amount
    : (trade.open_rate - currentPrice) * trade.amount;

  const margin = (trade.open_rate * trade.amount) / Math.max(1, trade.leverage);
  const estimatedCloseFee = currentPrice * trade.amount * takerFeeRate;
  const netPnl = grossPnl - safeNum(trade.fee_open) - estimatedCloseFee;
  const roi = margin > 0 ? netPnl / margin : 0;

  const stopMove = getHardStopPct(trade.leverage);
  const baseStopPrice = trade.type === 'long'
    ? trade.open_rate * (1 - stopMove)
    : trade.open_rate * (1 + stopMove);
  const targetPct = safeNum(trade.adaptive_target_pct, REFERENCE_TAKE_PROFIT_PCT) || REFERENCE_TAKE_PROFIT_PCT;
  const takeProfitPrice = trade.type === 'long'
    ? trade.open_rate * (1 + targetPct)
    : trade.open_rate * (1 - targetPct);

  // Dynamic stop: once the trade has moved +2% in its favour, protect the entry.
  // Once +3% is reached, use the trailing stop around the best observed price.
  let dynamicStopPrice = baseStopPrice;
  if (activePosition && activePosition.trade_id === trade.trade_id) {
    if (priceMove >= getRiskProfile().trailingActivationPct) {
      dynamicStopPrice = trade.type === 'long'
        ? Math.max(baseStopPrice, activePosition.peakPrice * (1 - getRiskProfile().trailingStopPct))
        : Math.min(baseStopPrice, activePosition.peakPrice * (1 + getRiskProfile().trailingStopPct));
    } else if (priceMove >= getRiskProfile().breakevenTriggerPct) {
      const feeBuffer = trade.open_rate * Math.max(0.0005, takerFeeRate * 2);
      dynamicStopPrice = trade.type === 'long'
        ? Math.max(baseStopPrice, trade.open_rate + feeBuffer)
        : Math.min(baseStopPrice, trade.open_rate - feeBuffer);
    }
  }

  return {
    priceMove,
    grossPnl,
    netPnl,
    margin,
    roi,
    stopPrice: dynamicStopPrice,
    baseStopPrice,
    takeProfitPrice,
    // These percentages intentionally describe the underlying 1x market move.
    stopRoiPct: -stopMove * 100,
    takeProfitRoiPct: targetPct * 100,
    referenceMovePct: priceMove * 100,
    referenceTargetPct: targetPct * 100
  };
}
async function placeProtectiveStop(trade: TradeRecord): Promise<string | undefined> {
  if (!exchange || !privateExchangeReady) return undefined;
  const stopPrice = safeNum(trade.stop_loss_abs);
  if (stopPrice <= 0) return undefined;

  const closeSide = trade.type === 'long' ? 'sell' : 'buy';
  const params = {
    ...orderParams(trade.type, true),
    stopPrice,
    workingType: 'MARK_PRICE'
  };

  const order = await exchange.createOrder(
    trade.pair,
    'STOP_MARKET',
    closeSide,
    trade.amount,
    undefined,
    params
  );
  return order?.id;
}

async function updateProtectiveStop(trade: TradeRecord, stopPrice: number) {
  if (!exchange || !activePosition) return;
  const rounded = safeNum(exchange.priceToPrecision(trade.pair, stopPrice));
  if (rounded <= 0) return;

  const previous = safeNum(trade.stop_loss_abs);
  const improves = trade.type === 'long' ? rounded > previous : rounded < previous;
  if (!improves) return;

  const oldId = activePosition.protectiveOrderId;
  const oldStop = trade.stop_loss_abs;
  // Create the replacement first. If Binance rejects it, the old stop remains active.
  const candidateTrade = { ...trade, stop_loss_abs: rounded } as TradeRecord;
  let newId: string | undefined;
  try {
    newId = await placeProtectiveStop(candidateTrade);
  } catch (e: any) {
    addEngineLog('WARN', `[RİSK] Yeni stop oluşturulamadı; eski stop korunuyor: ${e?.message || e}`);
    return;
  }
  if (!newId) {
    addEngineLog('WARN', '[RİSK] Yeni stop ID alınamadı; eski stop korunuyor.');
    return;
  }
  if (oldId && typeof exchange.cancelOrder === 'function') {
    try { await exchange.cancelOrder(oldId, trade.pair); }
    catch (e: any) {
      addEngineLog('WARN', `[RİSK] Eski stop iptal edilemedi; iki koruyucu stop kısa süre birlikte tutuluyor: ${e?.message || e}`);
    }
  }
  trade.stop_loss_abs = rounded;
  trade.protective_order_id = newId;
  activePosition.protectiveOrderId = newId;
  activePosition.currentStopPrice = rounded;
  addEngineLog('INFO', `[RİSK] ${trade.pair} koruyucu stop güncellendi: ${rounded}`);
}

async function openPosition(side: Side, symbol: string, requestedMargin?: number, adaptiveTargetPct?: number, adaptiveTargetReason?: string) {
  const price = await getCurrentPrice(symbol);
  if (price <= 0) throw new Error('Geçerli Futures fiyatı alınamadı.');

  const targetPct = clamp(safeNum(adaptiveTargetPct, REFERENCE_TAKE_PROFIT_PCT), 0.03, 0.15);
  const targetReason = adaptiveTargetReason || '1x referans hedefi (%10)';
  const leverage = targetLeverage || 1;

  if (!exchange || !privateExchangeReady) {
    throw new Error('Binance API Anahtarları tanımlı değil. Canlı Futures emri göndermek için Ayarlar sekmesinden Binance API Key ve Secret Key giriniz.');
  }

  const market = exchange.market(symbol);
  const { free } = await getFuturesBalance();
  const availableMargin = free;
  const configuredMargin = requestedMargin !== undefined ? Math.max(0, requestedMargin) : currentStakeAmount;
  const marginCap = availableMargin * tradableBalanceRatio;
  const margin = configuredMargin > 0 ? Math.min(configuredMargin, marginCap) : marginCap;

  if (margin <= 0) throw new Error(`Yeterli kullanılabilir USDT yok. Free: ${free.toFixed(2)} USDT.`);
  if (free < 1) throw new Error(`Kullanılabilir Futures bakiyesi çok düşük: ${free.toFixed(2)} USDT.`);

  const activeLev = await setRiskParameters(symbol, leverage);
  const rawAmount = (margin * activeLev) / price;
  const amount = safeNum(exchange.amountToPrecision(symbol, rawAmount));
  if (amount <= 0) throw new Error('Emir miktarı borsanın precision kurallarına göre 0 oldu.');

  let order: any = null;
  order = side === 'long'
    ? await exchange.createMarketBuyOrder(symbol, amount, undefined, orderParams(side))
    : await exchange.createMarketSellOrder(symbol, amount, undefined, orderParams(side));
  const fillPrice = await resolveOrderPrice(order, symbol, price);

  const actualMargin = (fillPrice * amount) / activeLev;
  const feeOpen = fillPrice * amount * takerFeeRate;

  const trade: TradeRecord = {
    trade_id: tradeCounter++,
    pair: symbol,
    is_open: true,
    type: side,
    amount,
    leverage: activeLev,
    open_rate: fillPrice,
    open_date: Date.now(),
    profit_ratio: 0,
    profit_abs: -feeOpen,
    stop_loss_abs: side === 'long'
      ? fillPrice * (1 - getHardStopPct(activeLev))
      : fillPrice * (1 + getHardStopPct(activeLev)),
    stop_loss_pct: -getHardStopPct(activeLev) * activeLev * 100,
    take_profit_abs: side === 'long' ? fillPrice * (1 + targetPct) : fillPrice * (1 - targetPct),
    take_profit_pct: targetPct * 100,
    reference_target_pct: targetPct * 100,
    adaptive_target_pct: targetPct,
    adaptive_target_price: side === 'long' ? fillPrice * (1 + targetPct) : fillPrice * (1 - targetPct),
    adaptive_target_reason: targetReason,
    fee_open: feeOpen,
    fee_close: 0,
    exchange_order_id: order?.id,
    position_mode: hedgeMode ? 'hedge' : 'one-way'
  };

  try {
    trade.protective_order_id = await placeProtectiveStop(trade);
  } catch (stopErr: any) {
    addEngineLog('ERROR', `[GÜVENLİK] Koruyucu stop emri borsaya iletilemedi: ${stopErr?.message || stopErr}`);
    try {
      const emergency = side === 'long'
        ? await exchange.createMarketSellOrder(symbol, amount, undefined, orderParams(side, true))
        : await exchange.createMarketBuyOrder(symbol, amount, undefined, orderParams(side, true));
      addEngineLog('ERROR', `[GÜVENLİK] Stop kurulamadığı için pozisyon acil olarak kapatıldı | ${emergency?.id || '-'}`);
    } catch (closeErr: any) {
      addEngineLog('ERROR', `[KRİTİK] STOP YOK + ACİL KAPATMA BAŞARISIZ: ${closeErr?.message || closeErr}`);
      throw new Error(`Koruyucu stop kurulamadı ve acil kapatma başarısız oldu: ${closeErr?.message || closeErr}`);
    }
    throw new Error('Koruyucu stop oluşturulamadı; pozisyon güvenlik nedeniyle açılmış sayılmadı.');
  }
  if (!trade.protective_order_id) {
    try {
      const emergency = side === 'long'
        ? await exchange.createMarketSellOrder(symbol, amount, undefined, orderParams(side, true))
        : await exchange.createMarketBuyOrder(symbol, amount, undefined, orderParams(side, true));
      addEngineLog('ERROR', `[GÜVENLİK] Stop ID alınamadı; pozisyon acil kapatıldı | ${emergency?.id || '-'}`);
    } catch (closeErr: any) {
      addEngineLog('ERROR', `[KRİTİK] STOP ID YOK + ACİL KAPATMA BAŞARISIZ: ${closeErr?.message || closeErr}`);
    }
    throw new Error('Koruyucu stop oluşturulamadı. Pozisyon güvenlik nedeniyle açılmış sayılmadı.');
  }

  allTrades.unshift(trade);
  activePosition = {
    trade_id: trade.trade_id,
    type: side,
    entryPrice: fillPrice,
    amount,
    peakPrice: fillPrice,
    margin: actualMargin,
    leverage: activeLev,
    feeOpen,
    orderId: order?.id,
    protectiveOrderId: trade.protective_order_id,
    currentStopPrice: trade.stop_loss_abs,
    adaptiveTargetPct: targetPct
  };

  saveTradingState();
  addEngineLog('TRADE', `[LIVE BINANCE] ${side.toUpperCase()} ${symbol} açıldı | ${amount} adet @ $${fillPrice.toFixed(2)} | ${activeLev}x | Hedef ${(targetPct * 100).toFixed(1)}% | Order ID: ${order?.id || '-'}`);
  return trade;
}

async function closeActivePosition(reason: string) {
  if (!activePosition) return null;

  const position = activePosition;
  const trade = allTrades.find(t => t.trade_id === position.trade_id);
  if (!trade) {
    activePosition = null;
    return null;
  }

  let currentPrice = await getMarkPrice(trade.pair);
  let closeOrder: any = null;

  if (exchange && privateExchangeReady) {
    try {
      if (position.protectiveOrderId && typeof exchange.cancelOrder === 'function') {
        try { await exchange.cancelOrder(position.protectiveOrderId, trade.pair); } catch {}
      }
      closeOrder = trade.type === 'long'
        ? await exchange.createMarketSellOrder(trade.pair, trade.amount, undefined, orderParams(trade.type, true))
        : await exchange.createMarketBuyOrder(trade.pair, trade.amount, undefined, orderParams(trade.type, true));
      currentPrice = await resolveOrderPrice(closeOrder, trade.pair, currentPrice);
    } catch (err: any) {
      addEngineLog('ERROR', `[GÜVENLİK] Borsa kapatma emri başarısız: ${err?.message}. Yerel pozisyon KAPATILMADI.`);
      saveTradingState();
      return null;
    }
  } else {
    addEngineLog('ERROR', '[GÜVENLİK] Binance özel bağlantısı yok; açık canlı pozisyon yerel olarak kapatılamaz.');
    saveTradingState();
    return null;
  }

  const grossPnl = trade.type === 'long'
    ? (currentPrice - trade.open_rate) * trade.amount
    : (trade.open_rate - currentPrice) * trade.amount;
  const feeClose = currentPrice * trade.amount * takerFeeRate;
  const netPnl = grossPnl - safeNum(trade.fee_open) - feeClose;
  const margin = (trade.open_rate * trade.amount) / Math.max(1, trade.leverage);
  const roi = margin > 0 ? netPnl / margin : 0;

  trade.is_open = false;
  trade.close_rate = currentPrice;
  trade.close_date = Date.now();
  trade.profit_abs = netPnl;
  trade.profit_ratio = roi;
  trade.fee_close = feeClose;
  trade.exit_reason = reason;
  trade.exchange_order_id = closeOrder?.id || trade.exchange_order_id;

  activePosition = null;
  if (tradingMode === 'simple') simpleCooldownUntil.set(trade.pair, Date.now() + simpleModeConfig.cooldown_seconds * 1000);
  if (tradingMode === 'intelligent') simpleCooldownUntil.set(trade.pair, Date.now() + intelligentModeConfig.cooldown_seconds * 1000);
  saveTradingState();
  addEngineLog('TRADE', `[ÇIKIŞ] ${trade.pair} ${trade.type.toUpperCase()} kapandı @ $${currentPrice.toFixed(2)} | Net K/Z: ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT (${(roi * 100).toFixed(2)}%) | ${reason}`);
  return trade;
}

async function syncLivePosition() {
  // Public CCXT instances can load markets/tickers, but fetchPositions is private.
  // Never call it without authenticated Futures credentials; otherwise CCXT emits
  // the repeated "requires apiKey credential" warning seen on Render.
  if (!exchange || typeof exchange.fetchPositions !== 'function' || !privateExchangeReady) {
    if (!privateExchangeReady && hasPrivateBinanceCredentials() === false && !privateSyncWarningLogged) {
      addEngineLog('INFO', 'Futures pozisyon senkronizasyonu beklemede: Binance API anahtarları yapılandırılmamış.');
      privateSyncWarningLogged = true;
    }
    return;
  }

  try {
    const syncPair = activePosition
      ? (allTrades.find(t => t.trade_id === activePosition?.trade_id)?.pair || TRADING_PAIR)
      : TRADING_PAIR;
    const positions = await exchange.fetchPositions([syncPair]);
    const open = positions.find((p: any) => {
      const contracts = Math.abs(safeNum(p?.contracts) || safeNum(p?.info?.positionAmt));
      return contracts > 0;
    });

    if (!open) {
      if (activePosition) {
        const current = await getCurrentPrice(syncPair);
        const trade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
        if (trade?.is_open) {
          const stats = makeTradeStats(trade, current);
          trade.is_open = false;
          trade.close_rate = current;
          trade.close_date = Date.now();
          trade.profit_abs = stats.netPnl;
          trade.profit_ratio = stats.roi;
          trade.exit_reason = 'Borsada pozisyon harici olarak kapatıldı';
        }
        activePosition = null;
        saveTradingState();
      }
      return;
    }

    const contracts = Math.abs(safeNum(open?.contracts) || safeNum(open?.info?.positionAmt));
    const side: Side = open?.side === 'short' || safeNum(open?.info?.positionAmt) < 0 ? 'short' : 'long';
    const entry = safeNum(open?.entryPrice) || safeNum(open?.info?.entryPrice);
    const lev = safeNum(open?.leverage, targetLeverage) || targetLeverage;

    if (contracts <= 0 || entry <= 0) return;

    if (!activePosition) {
      const existing = allTrades.find(t =>
        t.is_open && t.pair === syncPair && t.type === side
      );
      const trade = existing || {
        trade_id: tradeCounter++,
        pair: syncPair,
        is_open: true,
        type: side,
        amount: contracts,
        leverage: lev,
        open_rate: entry,
        open_date: Date.now(),
        fee_open: 0,
        fee_close: 0,
        position_mode: hedgeMode ? 'hedge' : 'one-way'
      } as TradeRecord;

      if (!existing) allTrades.unshift(trade);

      activePosition = {
        trade_id: trade.trade_id,
        type: side,
        entryPrice: entry,
        amount: contracts,
        peakPrice: entry,
        margin: (entry * contracts) / lev,
        leverage: lev,
        feeOpen: safeNum(trade.fee_open)
      };
      saveTradingState();
      addEngineLog('INFO', `Borsadaki açık ${side.toUpperCase()} pozisyon senkronize edildi: ${syncPair} ${contracts} @ ${entry}`);
    } else {
      activePosition.amount = contracts;
      activePosition.entryPrice = entry;
      activePosition.leverage = lev;
    }

    // Restart/reconnect safety: verify that the exchange actually has a protective stop.
    const currentTrade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
    if (currentTrade && activePosition) {
      let stopPresent = false;
      try {
        if (typeof exchange.fetchOpenOrders === 'function') {
          const orders = await exchange.fetchOpenOrders(syncPair);
          const expectedSide = side === 'long' ? 'SELL' : 'BUY';
          const expectedPositionSide = side === 'long' ? 'LONG' : 'SHORT';
          stopPresent = orders.some((o: any) => {
            const type = String(o?.type || o?.info?.type || '').toUpperCase();
            const reduce = Boolean(o?.reduceOnly || o?.info?.reduceOnly);
            const orderSide = String(o?.side || o?.info?.side || '').toUpperCase();
            const positionSide = String(o?.positionSide || o?.info?.positionSide || '').toUpperCase();
            const amount = safeNum(o?.amount ?? o?.info?.origQty);
            const amountOk = !amount || amount >= contracts * 0.995;
            const sideOk = orderSide === expectedSide;
            const positionOk = !hedgeMode || positionSide === expectedPositionSide;
            const reduceOk = hedgeMode ? true : reduce;
            return (type.includes('STOP') || type === 'STOP_MARKET') && reduceOk && sideOk && positionOk && amountOk;
          });
        }
      } catch (e: any) {
        addEngineLog('WARN', `[RİSK] Açık stop emirleri doğrulanamadı: ${e?.message || e}`);
      }
      if (!stopPresent) {
        if (!currentTrade.stop_loss_abs) {
          const stopMove = getHardStopPct(lev);
          currentTrade.stop_loss_abs = side === 'long' ? entry * (1 - stopMove) : entry * (1 + stopMove);
          currentTrade.stop_loss_pct = -stopMove * lev * 100;
        }
        try {
          const newStop = await placeProtectiveStop(currentTrade);
          if (!newStop) throw new Error('Stop ID alınamadı');
          currentTrade.protective_order_id = newStop;
          activePosition.protectiveOrderId = newStop;
          activePosition.currentStopPrice = currentTrade.stop_loss_abs;
          saveTradingState();
          addEngineLog('ERROR', `[GÜVENLİK] Yeniden başlatma sonrası eksik koruyucu stop yeniden oluşturuldu: ${newStop}`);
        } catch (stopErr: any) {
          addEngineLog('ERROR', `[KRİTİK] Açık pozisyon koruyucu stopsuz bulundu: ${stopErr?.message || stopErr}`);
          try {
            const emergency = side === 'long'
              ? await exchange.createMarketSellOrder(syncPair, contracts, undefined, orderParams(side, true))
              : await exchange.createMarketBuyOrder(syncPair, contracts, undefined, orderParams(side, true));
            addEngineLog('ERROR', `[GÜVENLİK] Stop yeniden kurulamadı; pozisyon acil kapatıldı: ${emergency?.id || '-'}`);
          } catch (closeErr: any) {
            addEngineLog('ERROR', `[KRİTİK] STOPSUZ POZİSYON ACİL KAPATMA BAŞARISIZ: ${closeErr?.message || closeErr}`);
          }
        }
      }
    }
  } catch (e: any) {
    const message = e?.message || String(e);
    if (!privateSyncWarningLogged || !/requires .*apiKey|api key|credential/i.test(message)) {
      addEngineLog('WARN', `Futures pozisyon senkronizasyonu başarısız: ${message}`);
    }
    if (/requires .*apiKey|api key|credential/i.test(message)) privateSyncWarningLogged = true;
  }
}

function configuredTradingPairs(): string[] {
  try {
    const conf = readConfig();
    const pairs = Array.isArray(conf?.exchange?.pair_whitelist)
      ? conf.exchange.pair_whitelist.filter((p: any) => typeof p === 'string' && p.includes('/'))
      : [];
    return Array.from(new Set([...(pairs.length ? pairs : [TRADING_PAIR]), TRADING_PAIR]));
  } catch {
    return [TRADING_PAIR];
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function bandVolume(levels: any[][], referencePrice: number, pct: number) {
  const maxDistance = referencePrice * pct;
  return levels.reduce((sum, level) => {
    const price = safeNum(level?.[0]);
    const amount = safeNum(level?.[1]);
    return price > 0 && Math.abs(price - referencePrice) <= maxDistance ? sum + amount : sum;
  }, 0);
}

function chooseAdaptiveTargetPct(params: { volatilityPct: number; deepScore: number; spreadPct: number; }) {
  const { volatilityPct, deepScore, spreadPct } = params;
  // 1x reference remains the baseline. The engine may shorten/extend the price target,
  // but leverage never changes this calculation.
  let target = 0.10;
  let reason = '1x referans hedefi (%10)';

  if (spreadPct > 0.0015) {
    target = 0.03;
    reason = 'Yüksek spread: daha kısa hedef (%3)';
  } else if (volatilityPct < 1.8) {
    target = 0.03;
    reason = 'Düşük gerçekleşen volatilite: %3';
  } else if (volatilityPct < 3.5) {
    target = 0.05;
    reason = 'Orta volatilite: %5';
  } else if (volatilityPct >= 8.0 && Math.abs(deepScore) >= 0.80) {
    target = 0.15;
    reason = 'Yüksek volatilite + güçlü derin analiz: %15';
  } else if (volatilityPct >= 4.5 && Math.abs(deepScore) >= 0.65) {
    target = 0.10;
    reason = 'Yüksek volatilite + teyitli derin analiz: %10';
  }

  // Weak microstructure should never justify a distant target.
  if (Math.abs(deepScore) < 0.60) {
    target = Math.min(target, 0.05);
    reason = 'Derin analiz güveni zayıf: %5 üst sınır';
  }

  return { targetPct: target, reason, volatilityPct };
}

async function analyzeSimpleOrderBookPair(pair: string) {
  const orderBook = await fetchFuturesOrderBook(pair, 100);
  if (!orderBook?.bids?.length || !orderBook?.asks?.length) throw new Error(`Order book alınamadı: ${pair}`);

  const bids = orderBook.bids;
  const asks = orderBook.asks;
  const bestBid = safeNum(bids[0]?.[0]);
  const bestAsk = safeNum(asks[0]?.[0]);
  const mid = (bestBid + bestAsk) / 2;
  const spreadPct = mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : 0;
  const bidVolume = bids.reduce((sum: number, x: any[]) => sum + safeNum(x?.[1]), 0);
  const askVolume = asks.reduce((sum: number, x: any[]) => sum + safeNum(x?.[1]), 0);
  const total = bidVolume + askVolume;
  const obi = total > 0 ? (bidVolume - askVolume) / total : 0;
  const nearBid = bandVolume(bids, mid, 0.001);
  const nearAsk = bandVolume(asks, mid, 0.001);
  const nearTotal = nearBid + nearAsk;
  const nearObi = nearTotal > 0 ? (nearBid - nearAsk) / nearTotal : 0;
  const bestBidQty = safeNum(bids[0]?.[1]);
  const bestAskQty = safeNum(asks[0]?.[1]);
  const topTotal = bestBidQty + bestAskQty;
  const microPrice = topTotal > 0 ? (bestBidQty * bestAsk + bestAskQty * bestBid) / topTotal : mid;
  const microBias = mid > 0 ? clamp(((microPrice - mid) / mid) * 5000, -1, 1) : 0;

  const topLevels = Math.min(20, bids.length, asks.length);
  const visibleLiquidityUsdt = [...bids.slice(0, topLevels), ...asks.slice(0, topLevels)]
    .reduce((sum: number, x: any[]) => sum + safeNum(x?.[0]) * safeNum(x?.[1]), 0);
  const maxAskWallUsdt = asks.slice(0, topLevels).reduce((m: number, x: any[]) => Math.max(m, safeNum(x?.[0]) * safeNum(x?.[1])), 0);
  const maxBidWallUsdt = bids.slice(0, topLevels).reduce((m: number, x: any[]) => Math.max(m, safeNum(x?.[0]) * safeNum(x?.[1])), 0);

  const previous = deepHistory.get(pair);
  const windowMs = simpleModeConfig.orderbook_history_minutes * 60_000;
  const history = (previous?.snapshots || []).filter((x: any) => Date.now() - safeNum(x.ts) <= windowMs);
  const historicalObi = history.length ? history.reduce((sum: number, x: any) => sum + safeNum(x.obi), 0) / history.length : obi;
  const historyTrend = clamp((obi - historicalObi) * 3, -1, 1);
  const previousObi = safeNum(previous?.obi, obi);
  const obiVelocity = obi - previousObi;
  const previousVelocity = safeNum(previous?.obiVelocity, 0);
  const obiAcceleration = obiVelocity - previousVelocity;
  const previousAskWall = safeNum((previous?.snapshots || []).slice(-1)[0]?.maxAskWallUsdt, maxAskWallUsdt);
  const wallWeakening = previousAskWall > 0 ? (previousAskWall - maxAskWallUsdt) / previousAskWall : 0;

  const projectedMove = clamp(Math.abs((historicalObi * 0.65 + nearObi * 0.35)) * simpleModeConfig.obi_projection_multiplier_pct + Math.abs(microBias) * 0.002, 0, 1);
  const directionScore = clamp(historicalObi * 0.65 + nearObi * 0.25 + historyTrend * 0.10 + microBias * 0.05, -1, 1);
  const directionLong = directionScore >= simpleModeConfig.min_obi;
  const directionShort = directionScore <= -simpleModeConfig.min_obi;
  const commonFilters = visibleLiquidityUsdt >= simpleModeConfig.min_liquidity_usdt && spreadPct <= simpleModeConfig.max_spread_pct && Math.abs(obiVelocity) >= simpleModeConfig.min_obi_velocity;
  const accelerationLong = !simpleModeConfig.require_obi_acceleration || obiAcceleration > 0;
  const accelerationShort = !simpleModeConfig.require_obi_acceleration || obiAcceleration < 0;
  const wallLong = wallWeakening >= simpleModeConfig.wall_weakening_pct || previousAskWall <= 0;
  const wallShort = (() => {
    const previousBidWall = safeNum((previous?.snapshots || []).slice(-1)[0]?.maxBidWallUsdt, maxBidWallUsdt);
    const weakening = previousBidWall > 0 ? (previousBidWall - maxBidWallUsdt) / previousBidWall : 0;
    return weakening >= simpleModeConfig.wall_weakening_pct || previousBidWall <= 0;
  })();
  const signal = projectedMove >= simpleModeConfig.target_market_move_pct && commonFilters &&
    ((directionLong && accelerationLong && wallLong) || (directionShort && accelerationShort && wallShort))
    ? (directionLong ? 'long' : 'short') : null;

  const now = Date.now();
  const snapshots = [...history, { ts: now, price: mid, obi, weightedOBI: nearObi, maxAskWallUsdt, maxBidWallUsdt }]
    .slice(-Math.max(20, Math.ceil((simpleModeConfig.orderbook_history_minutes * 60) / simpleModeConfig.snapshot_seconds)));
  deepHistory.set(pair, {
    score: directionScore,
    priorScore: previous?.score ?? directionScore,
    adverseConfirmations: previous?.adverseConfirmations ?? 0,
    lastAt: now,
    bidVolume, askVolume, obi, obiVelocity, previousObiVelocity: previous?.obiVelocity ?? 0,
    snapshots: snapshots.map((x: any) => ({ ts: safeNum(x.ts), price: safeNum(x.price, mid), obi: safeNum(x.obi), weightedOBI: safeNum(x.weightedOBI), maxAskWallUsdt: safeNum(x.maxAskWallUsdt), maxBidWallUsdt: safeNum(x.maxBidWallUsdt) }))
  } as any);

  return {
    pair, bids, asks, OBI: obi, weightedOBI: nearObi, MicroPrice: microPrice, MidPrice: mid,
    SpreadPct: spreadPct / 100, currentPrice: mid, simpleProjectedMovePct: projectedMove,
    simpleDirectionScore: directionScore, simpleHistoryObi: historicalObi,
    simpleSignal: signal, longSignal: signal === 'long', shortSignal: signal === 'short',
    confidence: Math.abs(directionScore), deepScore: directionScore,
    probabilityLong: directionScore > 0 ? 0.5 + Math.abs(directionScore) / 2 : 0.5,
    probabilityShort: directionScore < 0 ? 0.5 + Math.abs(directionScore) / 2 : 0.5,
    adaptiveTargetPct: simpleModeConfig.target_market_move_pct,
    adaptiveTargetReason: `Basit Mod: 1x referans hedefi ${(simpleModeConfig.target_market_move_pct * 100).toFixed(1)}%`,
    volatilityPct: 0, VWAP: mid, deltaV: 0, deltaBias: 0, depthChangeScore: historyTrend,
    depthPressure: nearObi, obiVelocity, obiAcceleration,
    futuresOBI: 0, futuresSpreadPct: 0, whaleScore: 0, whaleNetUsdt: 0, whaleCount: 0,
    whaleDetected: false, historicalObi, historicalScore: 0, historyTrend,
    historyMinutes: simpleModeConfig.orderbook_history_minutes, whalePositionMultiplier: 1,
    simpleVisibleLiquidityUsdt: visibleLiquidityUsdt, simpleMaxAskWallUsdt: maxAskWallUsdt,
    simpleMaxBidWallUsdt: maxBidWallUsdt, simpleWallWeakening: wallWeakening,
    simpleFilters: { liquidity: visibleLiquidityUsdt >= simpleModeConfig.min_liquidity_usdt, spread: spreadPct <= simpleModeConfig.max_spread_pct, velocity: Math.abs(obiVelocity) >= simpleModeConfig.min_obi_velocity, acceleration: accelerationLong || accelerationShort, projectedMove: projectedMove >= simpleModeConfig.target_market_move_pct }
  };
}
async function analyzeFuturesPair(pair: string) {
  // The directional model is intentionally based on the SPOT book.
  // Futures data is used only as confirmation because the actual trade is executed on Futures.
  const spotOrderBook = await fetchSpotOrderBook(pair, ORDERBOOK_LEVELS);
  if (!spotOrderBook?.bids?.length || !spotOrderBook?.asks?.length) {
    throw new Error(`Spot order book alınamadı: ${pair}`);
  }

  const futuresOrderBook = await fetchFuturesOrderBook(pair, 100);
  const spotPrice = await fetchSpotTicker(pair);
  const currentPrice = spotPrice > 0 ? spotPrice : await getCurrentPrice(pair);

  const bids = spotOrderBook.bids;
  const asks = spotOrderBook.asks;
  const bestBid = safeNum(bids[0]?.[0]);
  const bestAsk = safeNum(asks[0]?.[0]);
  const MidPrice = (bestBid + bestAsk) / 2;
  const SpreadPct = MidPrice > 0 ? (bestAsk - bestBid) / MidPrice : 0;

  let volatilityPct = 1.8;
  try {
    const candles = await fetchSpotKlines(pair, '15m', 48);
    const closes = (candles || []).map((c: any) => safeNum(c?.close)).filter((v: number) => v > 0);
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = (closes[i] - closes[i - 1]) / closes[i - 1];
      if (Number.isFinite(r)) returns.push(r);
    }
    if (returns.length >= 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
      volatilityPct = Math.sqrt(variance) * Math.sqrt(4) * 100;
    }
  } catch {}

  // Distance-weighted multi-level OBI. Near-price liquidity matters more than distant walls.
  const bands = [0.0005, 0.001, 0.0025, 0.005, 0.01];
  const bandWeights = [5, 4, 3, 2, 1];
  const bandImbalances = bands.map(pct => {
    const bid = bandVolume(bids, MidPrice, pct);
    const ask = bandVolume(asks, MidPrice, pct);
    const total = bid + ask;
    return total > 0 ? (bid - ask) / total : 0;
  });
  const weightTotal = bandWeights.reduce((a, b) => a + b, 0);
  const weightedOBI = bandImbalances.reduce((sum, v, i) => sum + v * bandWeights[i], 0) / weightTotal;

  const bidVolume = bids.slice(0, ORDERBOOK_LEVELS).reduce((sum: number, b: any[]) => sum + safeNum(b?.[1]), 0);
  const askVolume = asks.slice(0, ORDERBOOK_LEVELS).reduce((sum: number, a: any[]) => sum + safeNum(a?.[1]), 0);
  const totalVolume = bidVolume + askVolume;
  const OBI = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;

  // Micro-price using best-level pressure, not the whole book.
  const bestBidQty = safeNum(bids[0]?.[1]);
  const bestAskQty = safeNum(asks[0]?.[1]);
  const topTotal = bestBidQty + bestAskQty;
  const MicroPrice = topTotal > 0
    ? (bestBidQty * bestAsk + bestAskQty * bestBid) / topTotal
    : MidPrice;
  const microBias = MidPrice > 0 ? clamp(((MicroPrice - MidPrice) / MidPrice) * 5000, -1, 1) : 0;

  const previous = deepHistory.get(pair);
  const historyWindowMs = deepAnalysisConfig.history_minutes * 60_000;
  const recentSnapshots = (previous?.snapshots || []).filter((x: any) => Date.now() - x.ts <= historyWindowMs);
  const previousObi = previous?.obi ?? OBI;
  const historicalObi = recentSnapshots.length ? recentSnapshots.reduce((sum, x) => sum + safeNum(x.obi), 0) / recentSnapshots.length : OBI;
  const historicalScore = historicalObi;
  const historyTrend = clamp((OBI - historicalObi) * 3, -1, 1);
  const obiVelocity = clamp((OBI - previousObi) * 4, -1, 1);
  const previousObiVelocity = previous?.obiVelocity ?? 0;
  const obiAcceleration = clamp((obiVelocity - previousObiVelocity) * 3, -1, 1);

  // Realized aggressive buy/sell volume from Binance aggregated trades.
  const tradeDelta = await fetchRecentTradeDelta(pair, 'spot');
  const deltaV = tradeDelta.delta;
  const deltaBias = tradeDelta.ratio;
  const whaleScore = deepAnalysisConfig.whale_detection ? safeNum(tradeDelta.whaleScore) : 0;
  const whaleNetUsdt = safeNum(tradeDelta.whaleNetUsdt);
  const whaleCount = safeNum(tradeDelta.whaleCount);
  const whaleDetected = deepAnalysisConfig.whale_detection && whaleCount > 0 && Math.abs(whaleNetUsdt) >= deepAnalysisConfig.whale_net_flow_usdt;

  // Liquidity pressure by distance. This catches a large wall immediately around price.
  const nearBid = bandVolume(bids, MidPrice, 0.001);
  const nearAsk = bandVolume(asks, MidPrice, 0.001);
  const nearTotal = nearBid + nearAsk;
  const depthPressure = nearTotal > 0 ? clamp((nearBid - nearAsk) / nearTotal, -1, 1) : 0;

  // Detect whether the book is becoming thinner/thicker in the same direction.
  const depthBalance = previous && (previous.bidVolume + previous.askVolume) > 0
    ? ((bidVolume - previous.bidVolume) - (askVolume - previous.askVolume)) / (previous.bidVolume + previous.askVolume)
    : 0;
  const depthChangeScore = clamp(depthBalance * 5, -1, 1);

  // Spot VWAP over the visible book is intentionally not called trade VWAP.
  // Use price-volume weighted visible liquidity as a stable location estimate.
  let vwapNumerator = 0;
  let vwapDenominator = 0;
  for (const level of [...bids.slice(0, 100), ...asks.slice(0, 100)]) {
    const price = safeNum(level?.[0]);
    const qty = safeNum(level?.[1]);
    if (price > 0 && qty > 0) {
      vwapNumerator += price * qty;
      vwapDenominator += qty;
    }
  }
  const VWAP = vwapDenominator > 0 ? vwapNumerator / vwapDenominator : MidPrice;
  const vwapBias = currentPrice > 0 && VWAP > 0
    ? clamp(((currentPrice - VWAP) / VWAP) * 50, -1, 1)
    : 0;

  // Futures confirmation: direction must broadly agree, but Futures never overrides Spot.
  let futuresOBI = 0;
  let futuresSpreadPct = 0;
  if (futuresOrderBook?.bids?.length && futuresOrderBook?.asks?.length) {
    const fb = futuresOrderBook.bids.slice(0, 50);
    const fa = futuresOrderBook.asks.slice(0, 50);
    const fbv = fb.reduce((sum: number, x: any[]) => sum + safeNum(x?.[1]), 0);
    const fav = fa.reduce((sum: number, x: any[]) => sum + safeNum(x?.[1]), 0);
    const ft = fbv + fav;
    futuresOBI = ft > 0 ? (fbv - fav) / ft : 0;
    const fMid = (safeNum(fb[0]?.[0]) + safeNum(fa[0]?.[0])) / 2;
    futuresSpreadPct = fMid > 0 ? (safeNum(fa[0]?.[0]) - safeNum(fb[0]?.[0])) / fMid : 0;
  }
  const futuresConfirmation = clamp(futuresOBI * 0.7 + (futuresOBI * OBI >= 0 ? Math.abs(futuresOBI) * 0.3 : -Math.abs(futuresOBI) * 0.3), -1, 1);
  const futuresContext = await fetchFuturesMarketContext(pair);
  const oiSignal = clamp(futuresContext.openInterestChange * 8, -1, 1);
  const fundingSignal = clamp(-futuresContext.fundingRate * 25 - futuresContext.fundingChange * 80, -1, 1);
  const liquidationSignal = clamp((futuresContext.liquidationBuyUsdt - futuresContext.liquidationSellUsdt) / Math.max(futuresContext.liquidationBuyUsdt + futuresContext.liquidationSellUsdt, 1), -1, 1);
  const takerFlowSignal = clamp(futuresContext.takerDeltaRatio, -1, 1);

  // Mathematical composite. Positive = upward pressure, negative = downward pressure.
  // The model deliberately gives the SPOT book the largest weight.
  const rawScore =
    weightedOBI * 0.26 +
    OBI * 0.10 +
    microBias * 0.10 +
    depthPressure * 0.12 +
    obiVelocity * 0.10 +
    obiAcceleration * 0.06 +
    deltaBias * 0.14 +
    depthChangeScore * 0.04 +
    vwapBias * 0.03 +
    futuresConfirmation * 0.05 +
    oiSignal * 0.07 +
    fundingSignal * 0.04 +
    liquidationSignal * 0.06 +
    takerFlowSignal * 0.06 +
    historyTrend * 0.05 +
    historicalScore * 0.03 +
    whaleScore * 0.08;

  const spreadPenalty = clamp((SpreadPct - 0.0005) / 0.0025, 0, 1) * 0.10;
  const deepScore = clamp(rawScore * (1 - spreadPenalty), -1, 1);

  // Convert directional score to a calibrated-looking probability, while keeping the
  // neutral zone wide enough to avoid over-trading noise.
  const probabilityLong = 1 / (1 + Math.exp(-5 * deepScore));
  const probabilityShort = 1 - probabilityLong;
  const probabilityEdge = Math.max(probabilityLong, probabilityShort);
  const confidence = Math.round(clamp((probabilityEdge - 0.5) * 200, 0, 100));

  const adaptive = chooseAdaptiveTargetPct({ volatilityPct, deepScore, spreadPct: SpreadPct });
  const confirmationOkLong = OBI > 0.08 && deltaBias >= -0.05 && futuresOBI >= -0.10 && obiVelocity >= -0.20;
  const confirmationOkShort = OBI < -0.08 && deltaBias <= 0.05 && futuresOBI <= 0.10 && obiVelocity <= 0.20;
  const whaleLongOk = !deepAnalysisConfig.whale_requires_directional_confirmation || !whaleDetected || whaleScore > -0.25;
  const whaleShortOk = !deepAnalysisConfig.whale_requires_directional_confirmation || !whaleDetected || whaleScore < 0.25;
  const longSignal = probabilityLong >= deepAnalysisConfig.min_long_probability && deepScore >= 0.35 && confirmationOkLong && whaleLongOk && SpreadPct <= 0.0025;
  const shortSignal = probabilityShort >= deepAnalysisConfig.min_short_probability && deepScore <= -0.35 && confirmationOkShort && whaleShortOk && SpreadPct <= 0.0025;

  const nowTs = Date.now();
  const shouldSnapshot = !previous?.snapshots?.length || nowTs - safeNum(previous.snapshots[previous.snapshots.length - 1]?.ts) >= deepAnalysisConfig.snapshot_seconds * 1000;
  const snapshots = shouldSnapshot
    ? [...recentSnapshots, { ts: nowTs, price: currentPrice, obi: OBI, weightedOBI }]
    : recentSnapshots;
  deepHistory.set(pair, {
    score: deepScore,
    priorScore: previous?.score ?? deepScore,
    adverseConfirmations: previous?.adverseConfirmations ?? 0,
    lastAt: nowTs,
    bidVolume, askVolume, obi: OBI, obiVelocity, previousObiVelocity: previousObiVelocity,
    snapshots: snapshots.slice(-Math.max(20, Math.ceil((deepAnalysisConfig.history_minutes * 60) / deepAnalysisConfig.snapshot_seconds)))
  });

  return {
    pair,
    bids,
    asks,
    OBI,
    weightedOBI,
    MicroPrice,
    microBias,
    MidPrice,
    deltaV,
    VWAP,
    SpreadPct,
    currentPrice,
    deepScore,
    confidence,
    probabilityLong,
    probabilityShort,
    deltaBias,
    depthChangeScore,
    depthPressure,
    obiVelocity,
    obiAcceleration,
    futuresOBI,
    futuresSpreadPct,
    openInterest: futuresContext.openInterest,
    openInterestChange: futuresContext.openInterestChange,
    fundingRate: futuresContext.fundingRate,
    fundingChange: futuresContext.fundingChange,
    markPrice: futuresContext.markPrice,
    liquidationBuyUsdt: futuresContext.liquidationBuyUsdt,
    liquidationSellUsdt: futuresContext.liquidationSellUsdt,
    liquidationNetUsdt: futuresContext.liquidationNetUsdt,
    liquidationCount: futuresContext.liquidationCount,
    takerDeltaRatio: futuresContext.takerDeltaRatio,
    oiSignal, fundingSignal, liquidationSignal, takerFlowSignal,
    volatilityPct,
    adaptiveTargetPct: adaptive.targetPct,
    adaptiveTargetReason: adaptive.reason,
    longSignal,
    shortSignal,
    visibleLiquidityUsdt: [...bids.slice(0, 30), ...asks.slice(0, 30)].reduce((sum: number, x: any[]) => sum + safeNum(x?.[0]) * safeNum(x?.[1]), 0),
    whaleScore, whaleNetUsdt, whaleCount, whaleDetected,
    historicalObi, historicalScore, historyTrend,
    historyMinutes: deepAnalysisConfig.history_minutes,
    whalePositionMultiplier: whaleDetected ? clamp(Math.min(deepAnalysisConfig.whale_position_multiplier, deepAnalysisConfig.whale_max_multiplier), 1, 5) : 1
  };
}
async function analyzeIntelligentPair(pair: string) {
  // Adaptive ensemble: it does not pretend to be a quantum computer and it does not
  // promise a fixed win rate. It combines independent microstructure signals, detects
  // the current regime, penalizes disagreement/poor liquidity, and abstains when the
  // evidence is weak. The model is deliberately harder to trigger than Professional.
  const base = await analyzeFuturesPair(pair);
  const previous = deepHistory.get(pair);
  const history = (previous?.snapshots || []).filter((x: any) => Date.now() - safeNum(x.ts) <= intelligentModeConfig.lookback_minutes * 60_000);
  const visibleLiquidity = [...base.bids.slice(0, 30), ...base.asks.slice(0, 30)]
    .reduce((sum: number, x: any[]) => sum + safeNum(x?.[0]) * safeNum(x?.[1]), 0);
  const spreadPct = base.SpreadPct * 100;
  const liquidityQuality = clamp(visibleLiquidity / Math.max(intelligentModeConfig.min_liquidity_usdt, 1), 0, 2) / 2;
  const spreadQuality = 1 - clamp(spreadPct / intelligentModeConfig.max_spread_pct, 0, 1);
  const volatility = safeNum(base.volatilityPct);
  const volatilityQuality = volatility <= 0 ? 0.5 : clamp(1 - Math.abs(Math.log(Math.max(volatility, 0.1) / 3.0)) / 3, 0, 1);
  const trendPersistence = history.length >= 3
    ? clamp(history.filter((x: any, i: number) => i === 0 || Math.sign(safeNum(x.obi)) === Math.sign(safeNum(history[i - 1]?.obi))).length / history.length, 0, 1)
    : 0.5;

  const book = clamp(base.weightedOBI * 0.65 + base.OBI * 0.35, -1, 1);
  const micro = clamp(base.microBias || 0, -1, 1);
  const flow = clamp(base.deltaBias || 0, -1, 1);
  const depth = clamp(base.depthPressure * 0.65 + base.depthChangeScore * 0.35, -1, 1);
  const momentum = clamp(base.obiVelocity * 0.45 + base.obiAcceleration * 0.25 + base.historyTrend * 0.30, -1, 1);
  const futures = clamp(base.futuresOBI, -1, 1);
  const whale = clamp(base.whaleScore, -1, 1);
  const oi = clamp(base.oiSignal || 0, -1, 1);
  const funding = clamp(base.fundingSignal || 0, -1, 1);
  const liquidation = clamp(base.liquidationSignal || 0, -1, 1);
  const taker = clamp(base.takerFlowSignal || 0, -1, 1);

  const components = [book, micro, flow, depth, momentum, futures, whale, oi, funding, liquidation, taker];
  const directionalMean = components.reduce((a, b) => a + b, 0) / components.length;
  const dispersion = Math.sqrt(components.reduce((a, b) => a + Math.pow(b - directionalMean, 2), 0) / components.length);
  const agreement = clamp(1 - dispersion / 0.75, 0, 1);

  // Regime classifier: trend, chop, stressed liquidity and expansion are inferred from
  // existing live measurements rather than historical labels.
  const directionalStrength = clamp(Math.abs(directionalMean), 0, 1);
  const trendRegime = clamp(0.45 * directionalStrength + 0.30 * trendPersistence + 0.25 * Math.abs(base.obiVelocity), 0, 1);
  const regimeQuality = clamp(0.30 * agreement + 0.25 * liquidityQuality + 0.20 * spreadQuality + 0.15 * volatilityQuality + 0.10 * trendRegime, 0, 1);

  // Consensus-weighted edge. Signals that disagree with the majority are down-weighted.
  const consensus = clamp(
    book * 0.20 + micro * 0.08 + flow * 0.14 + depth * 0.10 + momentum * 0.10 + futures * 0.08 + whale * 0.08 + oi * 0.08 + funding * 0.04 + liquidation * 0.06 + taker * 0.04,
    -1, 1
  );
  const qualityMultiplier = 0.55 + 0.45 * regimeQuality;
  const intelligentScore = clamp(consensus * (0.55 + 0.45 * agreement) * qualityMultiplier, -1, 1);
  const edge = Math.abs(intelligentScore);
  const conflict = agreement < 0.45 || (base.futuresOBI * intelligentScore < -0.10 && Math.abs(base.futuresOBI) > 0.25);
  const liquidEnough = visibleLiquidity >= intelligentModeConfig.min_liquidity_usdt;
  const spreadOkay = spreadPct <= intelligentModeConfig.max_spread_pct;
  const eligible = regimeQuality >= intelligentModeConfig.min_regime_quality && edge >= intelligentModeConfig.min_edge && liquidEnough && spreadOkay && (!intelligentModeConfig.abstain_on_conflict || !conflict);
  const longSignal = eligible && intelligentScore > 0;
  const shortSignal = eligible && intelligentScore < 0;

  const target = clamp(
    intelligentModeConfig.target_market_move_pct + (intelligentModeConfig.max_target_market_move_pct - intelligentModeConfig.target_market_move_pct) * clamp((regimeQuality - intelligentModeConfig.min_regime_quality) / Math.max(1 - intelligentModeConfig.min_regime_quality, 0.01), 0, 1),
    intelligentModeConfig.target_market_move_pct,
    intelligentModeConfig.max_target_market_move_pct
  );

  const reason = `Zeki Mod | rejim ${(regimeQuality * 100).toFixed(0)}% | uyum ${(agreement * 100).toFixed(0)}% | edge ${(edge * 100).toFixed(0)}% | hedef ${(target * 100).toFixed(1)}% (1x)`;
  return {
    ...base,
    deepScore: intelligentScore,
    confidence: Math.round(edge * 100),
    probabilityLong: 0.5 + 0.5 * Math.max(intelligentScore, 0),
    probabilityShort: 0.5 + 0.5 * Math.max(-intelligentScore, 0),
    intelligentScore,
    intelligentEdge: edge,
    intelligentAgreement: agreement,
    intelligentRegimeQuality: regimeQuality,
    intelligentConflict: conflict,
    intelligentLiquidityQuality: liquidityQuality,
    intelligentSpreadQuality: spreadQuality,
    intelligentTrendPersistence: trendPersistence,
    intelligentComponents: { book, micro, flow, depth, momentum, futures, whale, oi, funding, liquidation, taker },
    openInterest: base.openInterest, openInterestChange: base.openInterestChange, fundingRate: base.fundingRate, fundingChange: base.fundingChange, markPrice: base.markPrice, liquidationBuyUsdt: base.liquidationBuyUsdt, liquidationSellUsdt: base.liquidationSellUsdt, liquidationCount: base.liquidationCount, takerDeltaRatio: base.takerDeltaRatio,
    longSignal,
    shortSignal,
    adaptiveTargetPct: target,
    adaptiveTargetReason: reason,
  };
}
async function executeRealTradeLogic() {
  if (botState !== 'running' || isProcessingTrade) return;
  isProcessingTrade = true;

  try {
    await ensureExchange();
    if (!exchange) throw new Error('Binance Futures piyasa bağlantısı yok.');

    await syncLivePosition();

    const activeTradeBeforeAnalysis = activePosition
      ? allTrades.find(t => t.trade_id === activePosition?.trade_id && t.is_open)
      : null;

    const scannerPairs = scannerSummary.map((x: any) => x.symbol).filter(Boolean);
    const algorithmPairs = Array.from(new Set([
      ...scannerPairs,
      ...latestMarkets.slice(0, 100).map((m: any) => m.symbol).filter(Boolean)
    ]));
    const manualPairs = configuredTradingPairs();
    const candidatePairs = activeTradeBeforeAnalysis
      ? [activeTradeBeforeAnalysis.pair]
      : (coinSelectionMode === 'algorithmic'
        ? algorithmPairs
        : manualPairs);

    let analysis: any = null;
    let selectedSignal: 'long' | 'short' | null = null;
    const evaluated: any[] = [];

    for (const candidate of candidatePairs) {
      try {
        const result = tradingMode === 'simple' ? await analyzeSimpleOrderBookPair(candidate) : tradingMode === 'intelligent' ? await analyzeIntelligentPair(candidate) : await analyzeFuturesPair(candidate);
        evaluated.push(result);
      } catch (e: any) {
        addEngineLog('WARN', `Parite analiz edilemedi: ${candidate} | ${e?.message || e}`);
      }
    }
    if (evaluated.length) {
      const scoreForSelection = (r: any) => {
        const signal = r.longSignal || r.shortSignal;
        const direction = r.longSignal ? 1 : r.shortSignal ? -1 : 0;
        const edge = Math.abs(safeNum(r.intelligentEdge, 0));
        const confidence = safeNum(r.confidence, 0) / 100;
        const agreement = safeNum(r.intelligentAgreement, 0);
        const regime = safeNum(r.intelligentRegimeQuality, 0);
        const liquidity = safeNum(r.intelligentLiquidityQuality, 0);
        const spreadPenalty = Math.min(1, safeNum(r.SpreadPct, 1) / 0.005);
        const base = tradingMode === 'intelligent' ? edge * 0.45 + agreement * 0.25 + regime * 0.15 + liquidity * 0.15 : Math.abs(safeNum(r.deepScore, 0)) * 0.5 + confidence * 0.5;
        return signal ? base * (1 - 0.5 * spreadPenalty) : -1 + direction;
      };
      const maxSpread = algorithmMaxSpreadPct / 100;
      const signaled = evaluated
        .filter((r: any) => (r.longSignal || r.shortSignal)
          && safeNum(r.SpreadPct, 1) <= maxSpread
          && (coinSelectionMode !== 'algorithmic' || safeNum(r.visibleLiquidityUsdt, 0) >= algorithmMinLiquidityUsdt))
        .sort((a, b) => scoreForSelection(b) - scoreForSelection(a));
      const scored = evaluated.sort((a, b) => scoreForSelection(b) - scoreForSelection(a));
      analysis = signaled[0] || scored[0];
      const bestScore = analysis ? scoreForSelection(analysis) : -1;
      if (!activeTradeBeforeAnalysis && analysis && (analysis.longSignal || analysis.shortSignal)
          && safeNum(analysis.SpreadPct, 1) <= maxSpread
          && (coinSelectionMode !== 'algorithmic' || bestScore >= algorithmMinOpportunityScore)) {
        selectedSignal = analysis.longSignal ? 'long' : 'short';
        addEngineLog('INFO', `[COIN SELECTION] ${coinSelectionMode === 'algorithmic' ? 'Algoritmik' : 'Manuel'} | Aday: ${analysis.pair} | Skor: ${bestScore.toFixed(3)} | Maks. işlem: ${algorithmMaxOpenTrades}`);
      }
    }

    if (!analysis) throw new Error('İzlenen Futures paritelerinden geçerli piyasa verisi alınamadı.');

    const { pair: analysisPair, bids, asks, OBI, MicroPrice, MidPrice, deltaV, VWAP, SpreadPct, currentPrice } = analysis;
    latestOrderBook = { bids, asks, timestamp: Date.now() };
    latestMetrics = { OBI, weightedOBI: analysis.weightedOBI, MicroPrice, MidPrice, deltaV, deltaBias: analysis.deltaBias, depthChangeScore: analysis.depthChangeScore, depthPressure: analysis.depthPressure, obiVelocity: analysis.obiVelocity, obiAcceleration: analysis.obiAcceleration, futuresOBI: analysis.futuresOBI, probabilityLong: analysis.probabilityLong, probabilityShort: analysis.probabilityShort, deepScore: analysis.deepScore, confidence: analysis.confidence, volatilityPct: analysis.volatilityPct, adaptiveTargetPct: analysis.adaptiveTargetPct * 100, adaptiveTargetReason: analysis.adaptiveTargetReason, currentPrice, VWAP, SpreadPct, pair: analysisPair, referenceTargetPct: REFERENCE_TAKE_PROFIT_PCT * 100, markPrice: safeNum(analysis.markPrice, currentPrice), openInterest: analysis.openInterest, openInterestChange: analysis.openInterestChange, fundingRate: analysis.fundingRate, fundingChange: analysis.fundingChange, liquidationNetUsdt: analysis.liquidationNetUsdt, liquidationCount: analysis.liquidationCount, takerDeltaRatio: analysis.takerDeltaRatio };

    addEngineLog('INFO', tradingMode === 'simple'
      ? `Basit Mod [ORDER BOOK] | ${analysisPair} | OBI ${OBI.toFixed(2)} | 1x Öngörü ${(safeNum(analysis.simpleProjectedMovePct) * 100).toFixed(2)}% / Hedef ${(safeNum(simpleModeConfig.target_market_move_pct) * 100).toFixed(1)}% | Fiyat: ${currentPrice}`
      : tradingMode === 'intelligent'
        ? `Zeki Mod [ADAPTIVE ENSEMBLE] | ${analysisPair} | Edge ${(safeNum(analysis.intelligentEdge) * 100).toFixed(0)}% | Rejim ${(safeNum(analysis.intelligentRegimeQuality) * 100).toFixed(0)}% | Uyum ${(safeNum(analysis.intelligentAgreement) * 100).toFixed(0)}% | ${analysis.adaptiveTargetReason}`
        : `Derin Analiz [SPOT] | ${analysisPair} | Score ${analysis.deepScore.toFixed(2)} | Long ${(analysis.probabilityLong * 100).toFixed(0)}% / Short ${(analysis.probabilityShort * 100).toFixed(0)}% | Spot OBI ${OBI.toFixed(2)} | Futures OBI ${analysis.futuresOBI.toFixed(2)} | Fiyat: ${currentPrice}`);

    if (activePosition) {
      const trade = allTrades.find(t => t.trade_id === activePosition?.trade_id);
      if (!trade) {
        activePosition = null;
        return;
      }

      if (trade.type === 'long') {
        activePosition.peakPrice = Math.max(activePosition.peakPrice, currentPrice);
      } else {
        activePosition.peakPrice = Math.min(activePosition.peakPrice, currentPrice);
      }

      const stats = makeTradeStats(trade, currentPrice);
      trade.reference_price_move_pct = stats.referenceMovePct;
      trade.reference_target_pct = stats.referenceTargetPct;
      activePosition.deepScore = safeNum(analysis.deepScore);
      saveTradingState();

      // Update the exchange-side stop as the trade moves in our favour.
      if (stats.stopPrice > 0 && Math.abs(stats.stopPrice - safeNum(trade.stop_loss_abs)) > currentPrice * 0.0002) {
        try { await updateProtectiveStop(trade, stats.stopPrice); } catch (e: any) {
          addEngineLog('WARN', `[RİSK] Dinamik stop güncellenemedi: ${e?.message || e}`);
        }
      }

      const adverseMove = trade.type === 'long'
        ? (trade.open_rate - currentPrice) / trade.open_rate
        : (currentPrice - trade.open_rate) / trade.open_rate;
      const favorableMove = trade.type === 'long'
        ? (currentPrice - trade.open_rate) / trade.open_rate
        : (trade.open_rate - currentPrice) / trade.open_rate;
      const peakDrawdown = trade.type === 'long'
        ? (activePosition.peakPrice - currentPrice) / activePosition.peakPrice
        : (currentPrice - activePosition.peakPrice) / activePosition.peakPrice;

      let reason = '';
      if (tradingMode === 'simple') {
        const heldMinutes = (Date.now() - safeNum(trade.open_date)) / 60000;
        const reversal = trade.type === 'long' ? OBI <= -simpleModeConfig.reversal_obi : OBI >= simpleModeConfig.reversal_obi;
        if (heldMinutes >= simpleModeConfig.timeout_minutes) reason = `Basit Mod zaman aşımı: ${heldMinutes.toFixed(1)} dk`;
        else if (reversal) reason = `Basit Mod OBI ters dönüşü: ${OBI.toFixed(2)}`;
        else if (favorableMove >= simpleModeConfig.profit_lock_trigger_pct && peakDrawdown >= simpleModeConfig.profit_lock_pct) reason = `Basit Mod kâr kilidi: zirveden ${(peakDrawdown * 100).toFixed(2)}% geri çekilme`;
      }

      if (tradingMode === 'intelligent') {
        const heldMinutes = (Date.now() - safeNum(trade.open_date)) / 60000;
        const intelligentScore = safeNum(analysis.intelligentScore, analysis.deepScore);
        const opposite = trade.type === 'long' ? intelligentScore <= -0.45 : intelligentScore >= 0.45;
        const qualityCollapse = safeNum(analysis.intelligentRegimeQuality) < intelligentModeConfig.min_regime_quality * 0.75;
        if (heldMinutes >= intelligentModeConfig.max_hold_minutes) reason = `Zeki Mod zaman aşımı: ${heldMinutes.toFixed(1)} dk`;
        else if (opposite && safeNum(analysis.intelligentAgreement) >= 0.55) reason = `Zeki Mod karşı yön konsensüsü: ${intelligentScore.toFixed(2)}`;
        else if (qualityCollapse) reason = `Zeki Mod rejim kalitesi düştü: ${(safeNum(analysis.intelligentRegimeQuality) * 100).toFixed(0)}%`;
      }

      const history = deepHistory.get(trade.pair);
      const risk = getRiskProfile();
      const oppositePressure = trade.type === 'long'
        ? analysis.deepScore <= -risk.reversalScore
        : analysis.deepScore >= risk.reversalScore;
      if (oppositePressure) {
        if (history) history.adverseConfirmations += 1;
      } else if (history) {
        history.adverseConfirmations = Math.max(0, history.adverseConfirmations - 1);
      }

      if (!reason && tradingMode === 'intelligent' && adverseMove >= intelligentModeConfig.stop_market_move_pct) {
        reason = `Zeki Mod adaptif zarar koruması: ${(adverseMove * 100).toFixed(2)}%`;
      } else if (!reason && adverseMove >= getHardStopPct(trade.leverage)) {
        reason = `${risk.label} Zarar Koruması: ${(adverseMove * 100).toFixed(2)}% ters hareket | Hard Stop`;
      } else if (favorableMove >= safeNum(trade.adaptive_target_pct, REFERENCE_TAKE_PROFIT_PCT)) {
        reason = `Akıllı Hedef: ${(favorableMove * 100).toFixed(2)}% piyasa hareketi / hedef ${(safeNum(trade.adaptive_target_pct, REFERENCE_TAKE_PROFIT_PCT) * 100).toFixed(1)}% (1x) | ${trade.leverage}x ROI ${(stats.roi * 100).toFixed(1)}%`;
      } else if (favorableMove >= risk.trailingActivationPct && peakDrawdown >= risk.trailingStopPct) {
        reason = `Kâr Koruma: ${risk.label} trailing | zirveden ${(peakDrawdown * 100).toFixed(2)}% geri çekilme`;
      } else if (tradingMode === 'simple' && favorableMove >= safeNum(trade.adaptive_target_pct, simpleModeConfig.target_market_move_pct)) {
        reason = `Basit Mod Hedefi: ${(favorableMove * 100).toFixed(2)}% piyasa hareketi / 1x hedef ${(safeNum(trade.adaptive_target_pct, simpleModeConfig.target_market_move_pct) * 100).toFixed(1)}%`;
      } else if (tradingMode !== 'simple' &&
        favorableMove >= risk.deepProfitMinPct &&
        history && history.adverseConfirmations >= risk.confirmations
      ) {
        reason = `Derin Analiz Kâr Koruması: kâr varken karşı yön baskısı ${history.adverseConfirmations} tur doğrulandı | Score ${analysis.deepScore.toFixed(2)}`;
      } else if (tradingMode !== 'simple' &&
        adverseMove >= risk.deepLossExitPct &&
        history && history.adverseConfirmations >= risk.confirmations
      ) {
        reason = `Derin Analiz Erken Zarar Kes: zarar ${(adverseMove * 100).toFixed(2)}% oldu ve karşı yön baskısı ${history.adverseConfirmations} tur doğrulandı | Score ${analysis.deepScore.toFixed(2)}`;
      }

      addEngineLog('INFO', `[POZİSYON ANALİZİ] ${trade.pair} ${trade.type.toUpperCase()} | 1x Move ${(favorableMove * 100).toFixed(2)}% / Hedef ${(safeNum(trade.adaptive_target_pct, REFERENCE_TAKE_PROFIT_PCT) * 100).toFixed(1)}% | Vol ${safeNum(analysis.volatilityPct).toFixed(2)}% | DeepScore ${analysis.deepScore.toFixed(2)} | OBI ${OBI.toFixed(2)}`);

      if (reason) await closeActivePosition(reason);
      return;
    }

    if (allTrades.filter(t => t.is_open).length >= maxOpenTrades) return;
    if (SpreadPct > 0.005) {
      addEngineLog('WARN', `Spread çok yüksek: ${(SpreadPct * 100).toFixed(4)}%`);
      return;
    }

    if (selectedSignal) {
      if (tradingMode === 'simple' || tradingMode === 'intelligent') {
        const cooldownUntil = simpleCooldownUntil.get(analysisPair) || 0;
        if (cooldownUntil > Date.now()) {
          addEngineLog('INFO', `[${tradingMode === 'intelligent' ? 'ZEKİ MOD' : 'BASİT MOD'}] ${analysisPair} cooldown aktif: ${Math.ceil((cooldownUntil - Date.now()) / 1000)} sn`);
          return;
        }
      }
      try {
        const whaleMultiplier = tradingMode === 'professional' && analysis.whaleDetected && ((selectedSignal === 'long' && analysis.whaleScore > 0) || (selectedSignal === 'short' && analysis.whaleScore < 0))
          ? Math.min(deepAnalysisConfig.whale_position_multiplier, deepAnalysisConfig.whale_max_multiplier) : 1;
        const requestedMargin = currentStakeAmount > 0 ? currentStakeAmount * whaleMultiplier : undefined;
        await openPosition(selectedSignal, analysisPair, requestedMargin, analysis.adaptiveTargetPct, analysis.adaptiveTargetReason);
      } catch (e: any) {
        addEngineLog('ERROR', `Giriş emri reddedildi: ${analysisPair} | ${e?.message || e}`);
      }
    }
  } catch (error: any) {
    addEngineLog('ERROR', `Ticaret motoru hatası: ${error?.message || error}`);
  } finally {
    isProcessingTrade = false;
  }
}

function startTradingEngine() {
  if (botState === 'running') return;
  botState = 'running';
  addEngineLog('INFO', `Ticaret motoru başlatıldı | LIVE TRADING | ${tradingMode === 'simple' ? 'BASİT MOD / ORDER BOOK' : tradingMode === 'intelligent' ? 'ZEKİ MOD / ADAPTIVE ENSEMBLE' : 'PROFESYONEL MOD'} | ${TRADING_PAIR} | ${targetLeverage}x`);
  if (engineLoop) clearInterval(engineLoop);
  engineLoop = setInterval(() => void executeRealTradeLogic(), ENGINE_INTERVAL_MS);
  void executeRealTradeLogic();
}

async function stopTradingEngine() {
  if (engineLoop) clearInterval(engineLoop);
  engineLoop = null;

  if (activePosition) {
    await closeActivePosition('Motor durduruldu');
  }

  botState = 'stopped';
  addEngineLog('INFO', 'Ticaret motoru durduruldu.');
}

function tradeToApi(t: TradeRecord) {
  const currentRate = t.is_open
    ? safeNum(latestMetrics?.currentPrice, t.open_rate)
    : safeNum(t.close_rate, t.open_rate);
  const stats = makeTradeStats(t, currentRate);

  return {
    id: String(t.trade_id),
    pair: t.pair,
    is_open: t.is_open,
    type: t.type,
    amount: t.amount,
    leverage: t.leverage,
    open_rate: t.open_rate,
    current_rate: currentRate,
    close_rate: t.close_rate,
    open_date: new Date(t.open_date).toLocaleString(),
    close_date: t.close_date ? new Date(t.close_date).toLocaleString() : undefined,
    close_reason: t.exit_reason,
    profit_ratio: t.is_open ? stats.roi : safeNum(t.profit_ratio),
    profit_pct: (t.is_open ? stats.roi : safeNum(t.profit_ratio)) * 100,
    profit_abs: t.is_open ? stats.netPnl : safeNum(t.profit_abs),
    stop_loss_abs: safeNum(t.stop_loss_abs, stats.stopPrice),
    stop_loss_pct: safeNum(t.stop_loss_pct, stats.stopRoiPct),
    take_profit_abs: safeNum(t.take_profit_abs, stats.takeProfitPrice),
    take_profit_pct: safeNum(t.take_profit_pct, stats.takeProfitRoiPct),
    reference_target_pct: stats.referenceTargetPct,
    reference_price_move_pct: stats.referenceMovePct,
    adaptive_target_pct: safeNum(t.adaptive_target_pct, stats.referenceTargetPct / 100) * 100,
    adaptive_target_price: safeNum(t.adaptive_target_price, stats.takeProfitPrice),
    adaptive_target_reason: t.adaptive_target_reason,
    deep_score: activePosition?.trade_id === t.trade_id ? safeNum(activePosition.deepScore) : undefined,
    fee_open: safeNum(t.fee_open),
    fee_close: safeNum(t.fee_close),
    exchange_order_id: t.exchange_order_id
  };
}

let latestMarkets: any[] = [];
let scannerLastRun = 0;
let scannerBusy = false;
let scannerSummary: any[] = [];

async function updateMarketsTelemetry() {
  try {
    const markets = await fetchBinancePublic24hrMarkets();
    if (markets && markets.length) {
      latestMarkets = markets;
      const now = Date.now();
      if (!scannerBusy && now - scannerLastRun >= 15000) {
        scannerBusy = true; scannerLastRun = now;
        const candidates = markets
          .filter((m: any) => m.volume_24h_usdt >= 1000000 && Math.abs(m.change_24h_pct) <= 35)
          .sort((a: any, b: any) => b.volume_24h_usdt - a.volume_24h_usdt)
          .slice(0, 20);
        try {
          const results = await Promise.all(candidates.map(async (m: any) => {
            try {
              const a = tradingMode === 'simple' ? await analyzeSimpleOrderBookPair(m.symbol) : tradingMode === 'intelligent' ? await analyzeIntelligentPair(m.symbol) : await analyzeFuturesPair(m.symbol);
              return { symbol: m.symbol, price: a.currentPrice, change_24h_pct: m.change_24h_pct, volume_24h_usdt: m.volume_24h_usdt, deepScore: a.deepScore, confidence: a.confidence, probabilityLong: a.probabilityLong, probabilityShort: a.probabilityShort, volatilityPct: a.volatilityPct, whaleScore: a.whaleScore, whaleDetected: a.whaleDetected, longSignal: a.longSignal, shortSignal: a.shortSignal, adaptiveTargetPct: a.adaptiveTargetPct * 100, signal: a.longSignal ? 'BUY' : a.shortSignal ? 'SELL' : 'NEUTRAL' };
            } catch { return null; }
          }));
          scannerSummary = results.filter(Boolean).sort((a: any, b: any) => Math.max(b.deepScore || 0, Math.abs(b.whaleScore || 0)) - Math.max(a.deepScore || 0, Math.abs(a.whaleScore || 0)));
          const bySymbol = new Map(scannerSummary.map((x: any) => [x.symbol, x]));
          latestMarkets = latestMarkets.map((m: any) => bySymbol.has(m.symbol) ? { ...m, ...bySymbol.get(m.symbol), scanner_rank: scannerSummary.findIndex((x: any) => x.symbol === m.symbol) + 1 } : m);
        } finally { scannerBusy = false; }
      }
    }
  } catch {}
}

async function runHistoricalBacktest(pair: string, interval = '5m', limit = 500, horizonBars = 3) {
  const candles = await fetchBinancePublicKlines(pair, interval, Math.min(500, Math.max(100, limit)));
  if (candles.length < 80) throw new Error('Backtest için yeterli tarihsel mum verisi yok.');
  let signals = 0, wins = 0, losses = 0, neutral = 0;
  const outcomes: any[] = [];
  for (let i = 55; i < candles.length - horizonBars; i++) {
    const c = candles[i]; const prev = candles[i-1];
    const recent = candles.slice(i-10, i);
    const low = Math.min(...recent.map((x: any) => x.low));
    const high = Math.max(...recent.map((x: any) => x.high));
    const drop = (c.close - high) / high;
    const rebound = (c.close - low) / low;
    const rsi = safeNum(c.rsi, 50);
    const volumeAvg = recent.reduce((s: number, x: any) => s + safeNum(x.volume), 0) / recent.length;
    const volumeBoost = safeNum(c.volume) > volumeAvg * 1.15;
    const longSignal = drop < -0.03 && rebound > 0.006 && rsi > 28 && rsi < 55 && c.close > prev.close && volumeBoost;
    const shortSignal = (c.close - low) / Math.max(low, 1) > 0.03 && (high - c.close) / Math.max(high, 1) > 0.006 && rsi < 72 && rsi > 45 && c.close < prev.close && volumeBoost;
    if (!longSignal && !shortSignal) { neutral++; continue; }
    signals++;
    const future = candles.slice(i+1, i+1+horizonBars);
    const entry = c.close;
    const target = longSignal ? entry * 1.01 : entry * 0.99;
    const stop = longSignal ? entry * 0.992 : entry * 1.008;
    let result = 'loss';
    for (const f of future) {
      if (longSignal && f.low <= stop) { result = 'loss'; break; }
      if (longSignal && f.high >= target) { result = 'win'; break; }
      if (shortSignal && f.high >= stop) { result = 'loss'; break; }
      if (shortSignal && f.low <= target) { result = 'win'; break; }
    }
    if (result === 'win') wins++; else losses++;
    outcomes.push({ timestamp: c.timestamp, direction: longSignal ? 'long' : 'short', entry, result });
  }
  return { pair, interval, candles: candles.length, signals, wins, losses, neutral, winrate: signals ? wins / signals : 0, methodology: 'Historical candle-only dip/reversal validation; live order-book/whale data cannot be reconstructed from OHLCV.' , outcomes: outcomes.slice(-100) };
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: '1mb' }));

  const requireApiToken = (req: any, res: any, next: any) => {
    if (!APP_API_TOKEN) return res.status(503).json({ error: 'APP_API_TOKEN sunucuda tanımlı değil.' });
    const supplied = String(req.headers['x-api-token'] || '');
    if (!supplied || supplied !== APP_API_TOKEN) return res.status(401).json({ error: 'API token gerekli veya geçersiz.' });
    next();
  };

  if (!APP_API_TOKEN) addEngineLog('ERROR', 'APP_API_TOKEN tanımlı değil. API güvenlik nedeniyle kilitli.');

  app.use('/api/v1', requireApiToken);

  let liveAnalysisInterval: NodeJS.Timeout | null = null;
  let liveMarketsInterval: NodeJS.Timeout | null = null;

  const updateTelemetry = async () => {
    try {
      const res = tradingMode === 'simple' ? await analyzeSimpleOrderBookPair(TRADING_PAIR) : tradingMode === 'intelligent' ? await analyzeIntelligentPair(TRADING_PAIR) : await analyzeFuturesPair(TRADING_PAIR);
      if (res) {
        latestOrderBook = { bids: res.bids, asks: res.asks, timestamp: Date.now() };
        latestMetrics = {
          OBI: res.OBI,
          weightedOBI: res.weightedOBI,
          MicroPrice: res.MicroPrice,
          MidPrice: res.MidPrice,
          deltaV: res.deltaV,
          deltaBias: res.deltaBias,
          depthChangeScore: res.depthChangeScore,
          depthPressure: res.depthPressure,
          obiVelocity: res.obiVelocity,
          obiAcceleration: res.obiAcceleration,
          futuresOBI: res.futuresOBI,
          probabilityLong: res.probabilityLong,
          probabilityShort: res.probabilityShort,
          deepScore: res.deepScore,
          confidence: res.confidence,
          volatilityPct: res.volatilityPct,
          adaptiveTargetPct: res.adaptiveTargetPct * 100,
          adaptiveTargetReason: res.adaptiveTargetReason,
          currentPrice: res.currentPrice,
          VWAP: res.VWAP,
          SpreadPct: res.SpreadPct,
          pair: res.pair,
          referenceTargetPct: REFERENCE_TAKE_PROFIT_PCT * 100,
          longSignal: res.longSignal,
          shortSignal: res.shortSignal,
          whaleScore: res.whaleScore, whaleNetUsdt: res.whaleNetUsdt, whaleCount: res.whaleCount, whaleDetected: res.whaleDetected, historyMinutes: res.historyMinutes, historicalObi: res.historicalObi, historicalScore: res.historicalScore
        };
      }
    } catch {}
  };

  // Immediate first run and continuous telemetry loops
  updateTelemetry();
  updateMarketsTelemetry();
  liveAnalysisInterval = setInterval(updateTelemetry, 2000);
  liveMarketsInterval = setInterval(updateMarketsTelemetry, 30000);
  startMarketDataStreams();
  addEngineLog('INFO', 'Canlı Binance WebSocket veri akışları başlatıldı | Order Book 100ms | Trade canlı | Ticker canlı | Kline/Market REST önbellekli');
  if (streamRefreshTimer) clearInterval(streamRefreshTimer);
  streamRefreshTimer = setInterval(() => startMarketDataStreams(false), 30000);

  app.get('/api/v1/ping', (_req, res) => {
    res.json({ status: 'pong', version: 'futures-engine-1.0', bot_name: 'freqtrade_sfeef_engine' });
  });

  app.get('/api/v1/orderbook', async (req, res) => {
    const pair = typeof req.query.pair === 'string' ? req.query.pair : TRADING_PAIR;
    if (pair !== TRADING_PAIR || !latestOrderBook || !latestMetrics) {
      try {
        const analysis = await analyzeFuturesPair(pair);
        return res.json({
          orderBook: { bids: analysis.bids, asks: analysis.asks, timestamp: Date.now() },
          metrics: {
            pair: analysis.pair,
            OBI: analysis.OBI,
            weightedOBI: analysis.weightedOBI,
            MicroPrice: analysis.MicroPrice,
            MidPrice: analysis.MidPrice,
            deltaV: analysis.deltaV,
            VWAP: analysis.VWAP,
            SpreadPct: analysis.SpreadPct,
            currentPrice: analysis.currentPrice,
            deepScore: analysis.deepScore,
            confidence: analysis.confidence,
            deltaBias: analysis.deltaBias,
            depthChangeScore: analysis.depthChangeScore,
            depthPressure: analysis.depthPressure,
            obiVelocity: analysis.obiVelocity,
            obiAcceleration: analysis.obiAcceleration,
            futuresOBI: analysis.futuresOBI,
            probabilityLong: analysis.probabilityLong,
            probabilityShort: analysis.probabilityShort,
            volatilityPct: analysis.volatilityPct,
            adaptiveTargetPct: analysis.adaptiveTargetPct * 100,
            adaptiveTargetReason: analysis.adaptiveTargetReason,
            referenceTargetPct: REFERENCE_TAKE_PROFIT_PCT * 100,
            longSignal: analysis.longSignal,
            shortSignal: analysis.shortSignal,
            whaleScore: analysis.whaleScore, whaleNetUsdt: analysis.whaleNetUsdt, whaleCount: analysis.whaleCount, whaleDetected: analysis.whaleDetected, historyMinutes: analysis.historyMinutes, historicalObi: analysis.historicalObi, historicalScore: analysis.historicalScore
          }
        });
      } catch {}
    }
    res.json({ orderBook: latestOrderBook, metrics: latestMetrics });
  });

  app.get('/api/v1/klines', async (req, res) => {
    const pair = typeof req.query.symbol === 'string' ? req.query.symbol : TRADING_PAIR;
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
    try {
      const candles = await fetchBinancePublicKlines(pair, interval, limit);
      res.json({ symbol: pair, interval, candles });
    } catch (e: any) {
      res.status(500).json({ error: e.message, candles: [] });
    }
  });

  app.get('/api/v1/ip', async (_req, res) => {
    res.json({ ip: await getOrFetchServerIp(), timestamp: Date.now() });
  });

  app.get('/api/v1/status', async (_req, res) => {
    await syncLivePosition();
    res.json({
      state: botState,
      trading_mode: 'live_futures',
      strategy: tradingMode === 'simple' ? 'Simple_OrderBook_Engine' : tradingMode === 'intelligent' ? 'Intelligent_Adaptive_Ensemble' : 'NodeJS_Internal_Engine',
      engine_mode: tradingMode,
      simple_mode_config: simpleModeConfig,
      timeframe: '1m',
      pair: TRADING_PAIR,
      open_trades: allTrades.filter(t => t.is_open).length,
      max_open_trades: maxOpenTrades,
      leverage: targetLeverage,
      margin_mode: marginMode,
      hedge_mode: hedgeMode,
      reference_target_pct: REFERENCE_TAKE_PROFIT_PCT * 100,
      hard_stop_pct: getHardStopPct(targetLeverage) * 100,
      trailing_stop_pct: getRiskProfile().trailingStopPct * 100,
      risk_protection_mode: riskProtectionMode,
      risk_protection_label: getRiskProfile().label,
      deep_entry_score: DEEP_ENTRY_SCORE,
      deep_reversal_score: DEEP_REVERSAL_SCORE,
      server_ip: await getOrFetchServerIp(),
      deep_analysis_config: deepAnalysisConfig,
      intelligent_mode: intelligentModeConfig,
      deep_analysis: latestMetrics || null,
      scanner: { last_run: scannerLastRun, busy: scannerBusy, candidates: scannerSummary.slice(0, 10) },
      persistence: { state_file: STATE_FILE, trade_records: allTrades.length, active_position: Boolean(activePosition) }
    });
  });

  app.get('/api/v1/backtest', async (req, res) => {
    try {
      const pair = typeof req.query.pair === 'string' ? req.query.pair : TRADING_PAIR;
      const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
      const limit = Math.min(500, Math.max(100, Number(req.query.limit) || 500));
      const horizonBars = Math.min(12, Math.max(1, Number(req.query.horizonBars) || 3));
      res.json(await runHistoricalBacktest(pair, interval, limit, horizonBars));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });


  app.get('/api/v1/config', requireApiToken, (_req, res) => {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const conf = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        conf.trading_mode = 'futures';
        if (conf.exchange) { delete conf.exchange.key; delete conf.exchange.secret; }
        return res.json(conf);
      }
      const conf = { ...initialConfig };
      conf.trading_mode = 'futures';
      if (conf.exchange) { delete conf.exchange.key; delete conf.exchange.secret; }
      res.json(conf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/v1/config', requireApiToken, (req, res) => {
    try {
      const previous = readConfig();
      const conf = { ...(previous || {}), ...(req.body || {}) };
      conf.exchange = { ...(previous?.exchange || {}), ...(req.body?.exchange || {}) };
      if (!conf.exchange.key && process.env.BINANCE_API_KEY) conf.exchange.key = process.env.BINANCE_API_KEY;
      if (!conf.exchange.secret && process.env.BINANCE_SECRET_KEY) conf.exchange.secret = process.env.BINANCE_SECRET_KEY;
      conf.trading_mode = 'futures';
      applyConfig(conf);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
      res.json({
        success: true,
        leverage: targetLeverage,
        margin_mode: marginMode,
        pair: TRADING_PAIR,
        engine_mode: tradingMode
      });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  app.post('/api/v1/exchange-keys', requireApiToken, async (req, res) => {
    const { apiKey = '', secretKey = '' } = req.body || {};
    const conf = readConfig();
    conf.trading_mode = 'futures';
    conf.exchange ||= { name: 'binance' };
    conf.exchange.key = apiKey;
    conf.exchange.secret = secretKey;
    applyConfig(conf);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });

    if (!apiKey || !secretKey) {
      privateExchangeReady = false;
      privateSyncWarningLogged = false;
      exchange = null;
      await ensureExchange();
      return res.json({ success: true, message: 'API anahtarları temizlendi. Public Futures veri bağlantısı açık.' });
    }

    const result = await initExchange(apiKey, secretKey);
    res.json(result);
  });

  app.get('/api/v1/balance', async (_req, res) => {
    try {
      if (exchange && privateExchangeReady) {
        const bal = await getFuturesBalance();
        return res.json({
          live: true,
          authenticated: true,
          currencies: [{ currency: 'USDT', free: bal.free, used: bal.used, total: bal.total, est_stake: bal.free }],
          total: bal.total,
          symbol: 'USDT',
          value: bal.total,
          balance_usdt: bal.total,
          free_usdt: bal.free,
          used_usdt: bal.used
        });
      }
      res.json({
        live: false,
        authenticated: false,
        currencies: [],
        total: 0,
        symbol: 'USDT',
        value: 0,
        balance_usdt: 0,
        free_usdt: 0,
        used_usdt: 0,
        message: 'Binance API anahtarları tanımlanmadı. Gerçek Futures cüzdan bakiyesini görmek için Ayarlar sekmesinden API Key ve Secret giriniz.'
      });
    } catch (e: any) {
      res.json({
        live: false,
        authenticated: false,
        currencies: [],
        total: 0,
        symbol: 'USDT',
        value: 0,
        balance_usdt: 0,
        free_usdt: 0,
        used_usdt: 0,
        error: e.message
      });
    }
  });

  app.get('/api/v1/trades', async (_req, res) => {
    await syncLivePosition();
    const formattedTrades = allTrades.map(tradeToApi);
    res.json({ trades: formattedTrades, trade_count: formattedTrades.length });
  });

  app.get('/api/v1/profit', (_req, res) => {
    const closed = allTrades.filter(t => !t.is_open);
    const open = allTrades.filter(t => t.is_open);
    const closedProfit = closed.reduce((sum, t) => sum + safeNum(t.profit_abs), 0);
    const openProfit = open.reduce((sum, t) => {
      const price = safeNum(latestMetrics?.currentPrice, t.open_rate);
      return sum + makeTradeStats(t, price).netPnl;
    }, 0);
    const totalPnl = closedProfit + openProfit;
    const winners = closed.filter(t => safeNum(t.profit_abs) > 0).length;
    const losers = closed.filter(t => safeNum(t.profit_abs) <= 0).length;
    const pnlPct = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;

    res.json({
      profit_closed_coin: closedProfit,
      profit_open_coin: openProfit,
      total_pnl_usdt: totalPnl,
      total_pnl_pct: pnlPct,
      profit_closed_percent_mean: closed.length ? closedProfit / closed.length : 0,
      profit_closed_ratio_mean: closed.length ? closed.reduce((s, t) => s + safeNum(t.profit_ratio), 0) / closed.length : 0,
      winning_trades: winners,
      losing_trades: losers,
      total_trades: closed.length,
      winrate: closed.length ? winners / closed.length : 0
    });
  });

  app.post('/api/v1/entry', requireApiToken, async (req, res) => {
    if (activePosition) return res.status(409).json({ error: 'Zaten açık bir Futures pozisyonu var.' });
    const pair = typeof req.body?.pair === 'string' ? req.body.pair.toUpperCase() : TRADING_PAIR;
    const side = req.body?.side === 'short' ? 'short' : req.body?.side === 'long' ? 'long' : null;
    if (!side) return res.status(400).json({ error: 'side long veya short olmalı.' });

    try {
      const manualTarget = latestMetrics?.pair === pair ? safeNum(latestMetrics?.adaptiveTargetPct, REFERENCE_TAKE_PROFIT_PCT * 100) / 100 : REFERENCE_TAKE_PROFIT_PCT;
      const manualReason = latestMetrics?.pair === pair ? String(latestMetrics?.adaptiveTargetReason || '1x referans hedefi (%10)') : '1x referans hedefi (%10)';
      const trade = await openPosition(side, pair, req.body?.margin !== undefined ? safeNum(req.body.margin) : undefined, manualTarget, manualReason);
      res.json({ status: 'success', trade: tradeToApi(trade), live: true });
    } catch (e: any) {
      res.status(400).json({ status: 'error', error: e.message });
    }
  });

  app.post('/api/v1/forceexit', requireApiToken, async (req, res) => {
    const id = String(req.body?.tradeid ?? '');
    if (!activePosition) return res.status(400).json({ error: 'Aktif açık Futures pozisyonu bulunamadı.' });
    if (id !== 'all' && id !== String(activePosition.trade_id)) {
      return res.status(400).json({ error: 'İşlem ID eşleşmedi.' });
    }

    const closed = await closeActivePosition('Kullanıcı tarafından manuel kapatıldı');
    if (!closed) return res.status(502).json({ error: 'Borsa kapatma emrini kabul etmedi; pozisyon güvenlik nedeniyle açık bırakıldı.' });
    res.json({ status: 'success', trade: tradeToApi(closed) });
  });

  app.post('/api/v1/start', requireApiToken, (_req, res) => {
    startTradingEngine();
    res.json({ status: 'success', message: 'Futures ticaret motoru başlatıldı.' });
  });

  app.post('/api/v1/stop', requireApiToken, async (_req, res) => {
    await stopTradingEngine();
    res.json({ status: 'success', message: 'Futures ticaret motoru durduruldu.' });
  });

  app.get('/api/v1/scanner', (_req, res) => {
    res.json({ running: scannerBusy, last_run: scannerLastRun, candidates: scannerSummary, note: 'Tarama; likidite + Deep Analysis + order-book + whale teyidi ile ilk adayları sıralar. Bu bir kâr garantisi değildir.' });
  });

  app.get('/api/v1/markets', async (_req, res) => {
    try {
      if (latestMarkets && latestMarkets.length > 0) {
        return res.json({ markets: latestMarkets });
      }

      const publicMarkets = await fetchBinancePublic24hrMarkets();
      if (publicMarkets && publicMarkets.length) {
        latestMarkets = publicMarkets;
        return res.json({ markets: publicMarkets });
      }

      await ensureExchange();
      const markets = Object.values(exchange?.markets || {})
        .filter((m: any) => m?.active !== false && m?.linear === true && m?.swap === true && m?.quote === 'USDT')
        .map((m: any) => ({
          symbol: `${m.base}/USDT`,
          base: m.base,
          quote: 'USDT',
          price: 0,
          change_24h_pct: 0,
          volume_24h_usdt: 0,
          high_24h: 0,
          low_24h: 0,
          in_whitelist: configuredTradingPairs().includes(`${m.base}/USDT`),
          in_blacklist: false,
          signal: 'NEUTRAL'
        }))
        .sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));
      res.json({ markets });
    } catch (e: any) {
      res.status(502).json({ markets: [], error: `Futures market listesi alınamadı: ${e.message}` });
    }
  });


  app.get('/api/v1/pairlists', (_req, res) => {
    const conf = readConfig();
    res.json({
      whitelist: conf?.exchange?.pair_whitelist || [TRADING_PAIR],
      blacklist: conf?.exchange?.pair_blacklist || []
    });
  });

  app.get('/api/v1/strategies', (_req, res) => {
    res.json({ strategies: ['OrderFlow_Quantitative'] });
  });

  app.get('/api/v1/logs', (_req, res) => {
    res.json({ logs: engineLogs });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Freqtrade sfeef Futures server running at http://0.0.0.0:${PORT}`);
  });
}

(async () => {
  const { apiKey, secret } = getConfiguredBinanceCredentials();

  // Always prepare the public Futures market connection first.
  await ensureExchange();

  // In Render production, prefer BINANCE_API_KEY / BINANCE_SECRET_KEY.
  // Fall back to config.json only for backwards compatibility with the UI.
  if (apiKey && secret) {
    const result = await initExchange(apiKey, secret);
    if (!result.success) {
      addEngineLog('ERROR', 'Binance LIVE Futures API bağlantısı kurulamadı. İşlem motoru güvenlik nedeniyle başlatılmadı.');
    }
  } else {
    addEngineLog('WARN', 'Binance özel API kimlik bilgileri bulunamadı. LIVE emir/pozisyon senkronizasyonu devre dışı; BINANCE_API_KEY ve BINANCE_SECRET_KEY tanımlayın.');
  }

  await startServer();
})();
