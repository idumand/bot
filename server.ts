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
let latestBinanceMarkPrice = 0;
let latestBinanceUnrealizedPnl = 0;
let latestBinanceInitialMargin = 0;
let latestBinanceRealizedPnl = 0;
let latestBinanceCommission = 0;
let latestBinanceFunding = 0;
let lastBinanceLedgerSync = 0;
let lastBinanceAccountSync = 0;
let latestBinanceWalletBalance = 0;
let latestBinanceMarginBalance = 0;
let latestBinanceAvailableBalance = 0;
let latestBinanceAccountCashFlow = 0;
let latestBinanceAccountPnl = 0;
let latestBinancePnlGap = 0;
let startingBalanceTimestamp = 0;
let exchange: any = null;
let hedgeMode = false;
let privateExchangeReady = false;
let privateSyncWarningLogged = false;
let dryRun = true;
let virtualBalance = 1000;

let serverIp = 'Tespit ediliyor...';
let lastIpFetchTime = 0;

let TRADING_PAIR = 'BTC/USDT';
let targetLeverage = 15;
let currentStakeAmount = 6;
let maxOpenTrades = 1;
let tradableBalanceRatio = 0.99;
let marginMode: 'isolated' | 'cross' = 'isolated';
let takerFeeRate = 0.0005;
let riskProtectionMode: 'conservative' | 'balanced' | 'aggressive' = 'conservative';

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
    confirmations: 2,
    maxLeverage: 4,
    maxMarginRatio: 0.05,
    maxAccountRiskPct: 0.0025,
    dailyLossLimitPct: 0.01,
    aiMinScore: 0.72
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
    confirmations: 2,
    maxLeverage: 8,
    maxMarginRatio: 0.10,
    maxAccountRiskPct: 0.005,
    dailyLossLimitPct: 0.02,
    aiMinScore: 0.66
  },
  aggressive: {
    label: 'Riskli',
    hardStopPct: 0.025,
    breakevenTriggerPct: 0.030,
    trailingActivationPct: 0.050,
    trailingStopPct: 0.020,
    deepProfitMinPct: 0.005,
    deepLossExitPct: 0.007,
    reversalScore: 0.65,
    confirmations: 3,
    maxLeverage: 12,
    maxMarginRatio: 0.15,
    maxAccountRiskPct: 0.01,
    dailyLossLimitPct: 0.04,
    aiMinScore: 0.60
  }
} as const;

function getRiskProfile() { return RISK_PROFILES[riskProtectionMode]; }

// Risk/target are defined from the underlying market move (the 1x reference),
// Pure price move reference target. The baseline is calculated from SPOT price movement,
// NOT from leveraged ROI. A 10% reference target therefore stays 10% at 1x, 5x or 15x.
// With 15x leverage, capturing a 1x 10% price move yields a net +150% ROE.
const REFERENCE_TAKE_PROFIT_PCT = 0.008; // 0.8% conservative scalp fallback; live plan normally overrides it
const HARD_STOP_PCT = 0.02;               // 2.0% adverse market move
const BREAKEVEN_TRIGGER_PCT = 0.025;      // after +2.5% market move, protect entry + fees
const TRAILING_ACTIVATION_PCT = 0.035;    // activate trailing after +3.5% market move
const TRAILING_STOP_PCT = 0.015;          // 1.5% retracement from peak
const DEEP_ENTRY_SCORE = 0.45;            // strong directional microstructure
const DEEP_REVERSAL_SCORE = 0.50;         // strong opposite pressure
const DEEP_REVERSAL_CONFIRMATIONS = 2;    // avoid one-tick exits
const ORDERBOOK_LEVELS = 500;

const DEFAULT_SIMPLE_MODE = {
  enabled: false,
  orderbook_history_minutes: 5,
  target_market_move_pct: 0.10,
  obi_projection_multiplier_pct: 0.15,
  min_obi: 0.20,
  snapshot_seconds: 5,
  min_liquidity_usdt: 150000,
  max_spread_pct: 0.25,
  min_obi_velocity: 0.005,
  require_obi_acceleration: false,
  wall_weakening_pct: 0.05,
  timeout_minutes: 30,
  cooldown_seconds: 45,
  reversal_obi: 0.25,
  profit_lock_trigger_pct: 0.035,
  profit_lock_pct: 0.015,
};

const DEFAULT_INTELLIGENT_MODE = {
  enabled: false,
  min_edge: 0.35,
  min_regime_quality: 0.35,
  min_liquidity_usdt: 200000,
  max_spread_pct: 0.25,
  lookback_minutes: 8,
  abstain_on_conflict: false,
  target_market_move_pct: 0.10,
  max_target_market_move_pct: 0.15,
  stop_market_move_pct: 0.02,
  max_hold_minutes: 60,
  cooldown_seconds: 45,
};

const DEFAULT_DEEP_ANALYSIS = {
  enabled: true,
  history_minutes: 10,
  snapshot_seconds: 5,
  min_long_probability: 0.56,
  min_short_probability: 0.56,
  whale_detection: true,
  whale_window_seconds: 60,
  whale_min_trade_usdt: 250000,
  whale_net_flow_usdt: 500000,
  whale_position_multiplier: 1.5,
  whale_max_multiplier: 2.5,
  whale_requires_directional_confirmation: true,
};

let deepAnalysisConfig = { ...DEFAULT_DEEP_ANALYSIS };
let simpleModeConfig = { ...DEFAULT_SIMPLE_MODE };
let intelligentModeConfig = { ...DEFAULT_INTELLIGENT_MODE };
let tradingMode: 'professional' | 'simple' | 'intelligent' = 'professional';
let coinSelectionMode: 'manual' | 'algorithmic' | 'ai' = 'manual';
let algorithmMaxOpenTrades = 1;
let professionalManualPairs: string[] = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT'];
let algorithmScanAssets = 30;
let algorithmMinOpportunityScore = 0.40;
let algorithmMinLiquidityUsdt = 200000;
let algorithmMaxSpreadPct = 0.20;

const whaleCache = new Map<string, { at: number; result: any }>();
const simpleCooldownUntil = new Map<string, number>();

// Live market-data caches. WebSocket feeds are the primary source; REST is only a
// short-lived fallback so the engine stays live without hammering Binance.
type LiveBook = { bids: number[][]; asks: number[][]; ts: number };
const liveBooks = new Map<string, LiveBook>();
const livePrices = new Map<string, { price: number; ts: number }>();
const liveTradeBuffers = new Map<string, Array<{ price: number; qty: number; ts: number; maker: boolean }>>();
const restCache = new Map<string, { at: number; value: any }>();
let marketStreamsStarted = false;
let activeStreamKey = '';
let streamRefreshTimer: NodeJS.Timeout | null = null;
const streamSockets: WebSocket[] = [];
let streamGeneration = 0;

// Single-mode execution: eight-exchange order-book arbitrage / microstructure engine.
// Public feeds are normalized into one book. Orders are executed only on the configured
// Binance Futures account; the other seven venues are market-data references.
const EIGHT_EXCHANGES = ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'bitget', 'gate', 'kucoin'] as const;
type EightExchange = typeof EIGHT_EXCHANGES[number];
const EIGHT_BOOK_LEVELS = 20;
let minCrossExchangeGap = 0.003; // Soft price-dislocation reference for fast scalp; v2 no longer requires a 3% gap.
const GAP_CLOSE_THRESHOLD = 0.0005;    // fast-scalp convergence threshold: 0.05%.
const MIN_BOOK_CONFIDENCE = 0.55;
const MIN_SCALP_SCORE = 0.62;
const SCALP_V2_MIN_SCORE = 0.66;
const SCALP_V2_MIN_CONSENSUS = 0.55;
const SCALP_V2_MIN_EXCHANGE_AGREEMENT = 0.625;
const SCALP_V2_MAX_DATA_AGE_MS = 1500;
const SCALP_V2_MAX_SPREAD_PCT = 0.0012;
const SCALP_V2_MIN_NET_EDGE = 0.00035;
// V2.7 High-Conviction / EV engine. Position size is capped by risk; it never
// increases simply because leverage is high.
const V27_A_PLUS_SCORE = 0.82;
const V27_A_PLUS_AGREEMENT = 0.75;
const V27_A_PLUS_NET_EDGE = 0.0010;
const V27_TP1_FRACTION = 0.35;
const V27_RUNNER_FRACTION = 1 - V27_TP1_FRACTION;
const V27_MIN_WINNERS_FOR_EV = 8;
const V27_MAX_SIZE_MULTIPLIER = 1.50;
const V27_MIN_SIZE_MULTIPLIER = 0.50;
const V27_RUNNER_TRAIL_PCT = 0.0025;
const V27_RUNNER_ACTIVATION_PCT = 0.0045;
// V2.8 adaptive optimizer: learns only from closed trades with MFE/MAE, and falls
// back to conservative defaults when the sample is too small. It never increases
// risk beyond V2.7 caps.

const SCALP_V2_MIN_FLOW = 0.12;
const SCALP_V2_MIN_CONSUMPTION = 0.08;
const SCALP_V2_ABSORPTION_BLOCK = -0.45;
const MIN_SCALP_AGREEMENT = 0.60;
const ENTRY_NEAR_LEVELS = 5;
const MIN_NEAR_BOOK_ALIGNMENT = 0.10; // The edge must be visible in the first 5 levels.
const MAX_DEEP_ONLY_RATIO = 0.35;
const MAX_ACCOUNT_RISK_PER_TRADE = 0.005; // 0.5% account-risk budget
const ENTRY_LIMIT_BUFFER_PCT = 0.00015; // aggressive IOC, but never chase a bad fill // Reject signals whose imbalance is mostly in deeper levels.
const eightBooks = new Map<EightExchange, { bids: number[][]; asks: number[][]; ts: number }>();
// Experimental layer: Liquidity Echo. It scores liquidity that repeatedly survives at
// the front of the book instead of trusting one large snapshot. This is deliberately
// heuristic/experimental; it is not claimed to be a proven or unique market signal.
const liquidityEchoHistory = new Map<string, { ts:number; bids:number[][]; asks:number[][] }[]>();
const LIQUIDITY_ECHO_WINDOW_MS = 5000;
const LIQUIDITY_ECHO_LEVELS = 5;
const MIN_LIQUIDITY_ECHO = 0.58;
const eightSockets: WebSocket[] = [];
let eightStreamGeneration = 0;
let latestEightExchangeAnalysis: any = null;

// Binance native diff-depth synchronizer. @depth events carry update IDs (U/u),
// allowing a sequence-consistent local order book instead of lossy snapshots.
type BinanceDiffState = { symbol:string; synced:boolean; syncing:boolean; lastUpdateId:number; buffer:any[]; bids:Map<string,number>; asks:Map<string,number>; gapCount:number; resyncCount:number; lastEventTs:number; retryAt:number; retryDelayMs:number; lastError:string };
const binanceDiffStates = new Map<string, BinanceDiffState>();
const BINANCE_DIFF_DEPTH_LIMIT = 500;
const BINANCE_DIFF_MAX_BUFFER = 10000;
// Spot depth snapshots are also subject to IP-level 418/429 limits. Keep a
// global cooldown so every websocket event cannot trigger another REST call.
let binanceSpotSnapshotBlockedUntil = 0;
// Binance Futures REST snapshots are rate-limited separately from the websocket.
// A 418 is an IP-level ban signal, so all symbols share one cooldown instead of
// independently hammering /fapi/v1/depth while the ban is active.
let binanceFuturesSnapshotBlockedUntil = 0;
function getBinanceDiffState(symbol:string): BinanceDiffState {
  let state=binanceDiffStates.get(symbol);
  if(!state){ state={symbol,synced:false,syncing:false,lastUpdateId:0,buffer:[],bids:new Map(),asks:new Map(),gapCount:0,resyncCount:0,lastEventTs:0,retryAt:0,retryDelayMs:5000,lastError:''}; binanceDiffStates.set(symbol,state); }
  return state;
}
function applyBinanceDiffEvent(state:BinanceDiffState,d:any){
  const U=Number(d?.U),u=Number(d?.u); if(!Number.isFinite(U)||!Number.isFinite(u)) return false;
  if(state.synced){
    if(u<=state.lastUpdateId) return true;
    const pu=Number(d?.pu);
    if(Number.isFinite(pu) && pu!==state.lastUpdateId){ state.synced=false; state.gapCount++; state.resyncCount++; state.buffer.length=0; return false; }
    if(U>state.lastUpdateId+1){ state.synced=false; state.gapCount++; state.resyncCount++; state.buffer.length=0; return false; }
  }
  for(const [p,q] of d?.b||[]){ const px=safeNum(p),qty=safeNum(q); if(px<=0) continue; if(qty<=0) state.bids.delete(String(px)); else state.bids.set(String(px),qty); }
  for(const [p,q] of d?.a||[]){ const px=safeNum(p),qty=safeNum(q); if(px<=0) continue; if(qty<=0) state.asks.delete(String(px)); else state.asks.set(String(px),qty); }
  state.lastUpdateId=u; state.lastEventTs=Date.now(); return true;
}
function binanceDiffBook(state:BinanceDiffState){
  const bids=Array.from(state.bids.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>b[0]-a[0]).slice(0,EIGHT_BOOK_LEVELS);
  const asks=Array.from(state.asks.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>a[0]-b[0]).slice(0,EIGHT_BOOK_LEVELS);
  return {bids,asks,ts:Date.now()};
}
async function syncBinanceDiffBook(symbol:string,generation:number){
  const state=getBinanceDiffState(symbol); if(state.syncing||generation!==eightStreamGeneration) return;
  if(Date.now()<binanceSpotSnapshotBlockedUntil){ state.retryAt=binanceSpotSnapshotBlockedUntil; return; }
  if(Date.now()<state.retryAt) return;
  state.syncing=true;
  try{
    const response=await fetch(`https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${BINANCE_DIFF_DEPTH_LIMIT}`, { headers:{'Accept':'application/json','Cache-Control':'no-cache'} });
    if(!response.ok){
      const status=response.status;
      const retryAfterHeader=Number(response.headers.get('retry-after')||0);
      const text=await response.text().catch(()=> '');
      const detail=text.slice(0,160).replace(/\s+/g,' ');
      if(status===418 || status===429){
        const cooldownMs=Math.min(120000, Math.max(15000, Number.isFinite(retryAfterHeader)&&retryAfterHeader>0 ? retryAfterHeader*1000 : state.retryDelayMs));
        binanceSpotSnapshotBlockedUntil=Math.max(binanceSpotSnapshotBlockedUntil,Date.now()+cooldownMs);
      }
      throw new Error(`snapshot ${status}${detail ? `: ${detail}` : ''}`);
    }
    const snapshot=await response.json(); if(generation!==eightStreamGeneration) return;
    const lastUpdateId=Number(snapshot?.lastUpdateId); if(!Number.isFinite(lastUpdateId)) throw new Error('snapshot lastUpdateId missing');
    state.bids.clear(); state.asks.clear(); for(const [p,q] of snapshot?.bids||[]) state.bids.set(String(p),safeNum(q)); for(const [p,q] of snapshot?.asks||[]) state.asks.set(String(p),safeNum(q)); state.lastUpdateId=lastUpdateId;
    const pending=state.buffer.filter(e=>Number(e?.u)>lastUpdateId).sort((a,b)=>Number(a.U)-Number(b.U)); state.buffer.length=0;
    const first=pending.find(e=>Number(e?.U)<=lastUpdateId+1&&Number(e?.u)>=lastUpdateId+1);
    if(!first){ state.synced=false; state.resyncCount++; state.retryAt=Date.now()+1000; return; }
    state.synced=true; state.lastUpdateId=lastUpdateId; applyBinanceDiffEvent(state,first);
    for(const e of pending){ if(e===first) continue; if(!state.synced) break; if(!applyBinanceDiffEvent(state,e)) break; }
    const book=binanceDiffBook(state); if(book.bids.length&&book.asks.length) recordEightBookUpdate('binance',book);
    state.retryAt=0; state.retryDelayMs=5000; state.lastError='';
  }catch(err:any){
    state.synced=false;
    const msg=String(err?.message||err); state.lastError=msg;
    const isRateLimited=/snapshot 418|\b418\b|snapshot 429|\b429\b|too many requests|ip banned|banned until/i.test(msg);
    state.retryDelayMs=Math.min(isRateLimited?120000:30000,Math.max(5000,state.retryDelayMs*2));
    state.retryAt=Math.max(Date.now()+state.retryDelayMs,binanceSpotSnapshotBlockedUntil);
    // Do not emit a warning for every websocket event. A rate-limit condition is
    // logged once per cooldown window; the synchronizer silently waits afterwards.
    if(isRateLimited) addEngineLog('WARN',`[8X BINANCE] diff-depth snapshot rate-limit (${msg}); tekrar deneme ${Math.ceil(state.retryDelayMs/1000)} sn sonra`);
    else addEngineLog('WARN',`[8X BINANCE] diff-depth sync başarısız: ${msg}; tekrar deneme ${Math.ceil(state.retryDelayMs/1000)} sn sonra`);
  } finally{ state.syncing=false; }
}
function handleBinanceDiff(symbol:string,d:any,generation:number){
  const state=getBinanceDiffState(symbol); if(generation!==eightStreamGeneration) return;
  if(!state.synced){
    state.buffer.push(d); if(state.buffer.length>BINANCE_DIFF_MAX_BUFFER) state.buffer.splice(0,state.buffer.length-BINANCE_DIFF_MAX_BUFFER);
    if(Date.now()>=state.retryAt && Date.now()>=binanceSpotSnapshotBlockedUntil) void syncBinanceDiffBook(symbol,generation);
    return;
  }
  if(!applyBinanceDiffEvent(state,d)){
    state.buffer.push(d); if(state.buffer.length>BINANCE_DIFF_MAX_BUFFER) state.buffer.splice(0,state.buffer.length-BINANCE_DIFF_MAX_BUFFER);
    if(Date.now()>=state.retryAt && Date.now()>=binanceSpotSnapshotBlockedUntil) void syncBinanceDiffBook(symbol,generation);
    return;
  }
  const book=binanceDiffBook(state); if(book.bids.length&&book.asks.length) recordEightBookUpdate('binance',book);
}


// Binance USDT-M Futures native diff-depth synchronizer. Futures has its own REST
// snapshot endpoint and sequence, so it is isolated from the Spot synchronizer above.
const binanceFuturesDiffStates = new Map<string, BinanceDiffState>();
function getBinanceFuturesDiffState(symbol:string): BinanceDiffState {
  let state=binanceFuturesDiffStates.get(symbol);
  if(!state){ state={symbol,synced:false,syncing:false,lastUpdateId:0,buffer:[],bids:new Map(),asks:new Map(),gapCount:0,resyncCount:0,lastEventTs:0,retryAt:0,retryDelayMs:5000,lastError:''}; binanceFuturesDiffStates.set(symbol,state); }
  return state;
}
function binanceFuturesDiffBook(state:BinanceDiffState){
  const bids=Array.from(state.bids.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>b[0]-a[0]).slice(0,100);
  const asks=Array.from(state.asks.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>a[0]-b[0]).slice(0,100);
  return {bids,asks,ts:Date.now()};
}
async function syncBinanceFuturesDiffBook(symbol:string,generation:number){
  const state=getBinanceFuturesDiffState(symbol);
  if(state.syncing||generation!==streamGeneration) return;
  if(Date.now() < state.retryAt) return;
  state.syncing=true;
  try{
    if(Date.now() < binanceFuturesSnapshotBlockedUntil){
      state.retryAt = Math.max(state.retryAt, binanceFuturesSnapshotBlockedUntil);
      return;
    }
    const response=await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${BINANCE_DIFF_DEPTH_LIMIT}`, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' } });
    if(!response.ok){
      const status=response.status;
      const retryAfterHeader=Number(response.headers.get('retry-after') || 0);
      const text=await response.text().catch(()=> '');
      const detail=text.slice(0,180).replace(/\s+/g,' ');
      if(status===418 || status===429){
        const cooldownMs=Math.min(120000, Math.max(15000, Number.isFinite(retryAfterHeader) && retryAfterHeader>0 ? retryAfterHeader*1000 : state.retryDelayMs));
        binanceFuturesSnapshotBlockedUntil=Math.max(binanceFuturesSnapshotBlockedUntil, Date.now()+cooldownMs);
      }
      throw new Error(`futures snapshot ${status}${detail ? `: ${detail}` : ''}`);
    }
    const snapshot=await response.json(); if(generation!==streamGeneration) return;
    const lastUpdateId=Number(snapshot?.lastUpdateId); if(!Number.isFinite(lastUpdateId)) throw new Error('futures snapshot lastUpdateId missing');
    state.bids.clear(); state.asks.clear();
    for(const [p,q] of snapshot?.bids||[]) state.bids.set(String(p),safeNum(q));
    for(const [p,q] of snapshot?.asks||[]) state.asks.set(String(p),safeNum(q));
    state.lastUpdateId=lastUpdateId;
    const pending=state.buffer.filter(e=>Number(e?.u)>lastUpdateId).sort((a,b)=>Number(a.U)-Number(b.U));
    state.buffer.length=0;
    const first=pending.find(e=>Number(e?.U)<=lastUpdateId+1&&Number(e?.u)>=lastUpdateId+1);
    if(!first){
      state.synced=false; state.resyncCount++; state.retryAt=Date.now()+1000;
      return;
    }
    state.synced=true; state.lastUpdateId=lastUpdateId;
    if(!applyBinanceDiffEvent(state,first)) { state.synced=false; state.resyncCount++; state.retryAt=Date.now()+1000; return; }
    for(const e of pending){ if(e===first) continue; if(!state.synced) break; if(!applyBinanceDiffEvent(state,e)) break; }
    const book=binanceFuturesDiffBook(state); if(book.bids.length&&book.asks.length) liveBooks.set(`futures:${symbol}`,book);
    state.retryAt=0; state.retryDelayMs=5000; state.lastError='';
  }catch(err:any){
    state.synced=false;
    const msg=String(err?.message||err);
    state.lastError=msg;
    const isRateLimited=/snapshot 418|\b418\b|too many requests|ip banned|banned until/i.test(msg);
    state.retryDelayMs=Math.min(isRateLimited ? 120000 : 30000, Math.max(5000, state.retryDelayMs*2));
    state.retryAt=Math.max(Date.now()+state.retryDelayMs, binanceFuturesSnapshotBlockedUntil);
    addEngineLog('WARN',`[FUTURES NATIVE] diff-depth sync başarısız: ${msg} | tekrar deneme ${Math.ceil(state.retryDelayMs/1000)} sn sonra`);
  } finally{ state.syncing=false; }
}
function handleBinanceFuturesDiff(symbol:string,d:any,generation:number){
  const state=getBinanceFuturesDiffState(symbol); if(generation!==streamGeneration) return;
  if(!state.synced){ state.buffer.push(d); if(state.buffer.length>BINANCE_DIFF_MAX_BUFFER) state.buffer.splice(0,state.buffer.length-BINANCE_DIFF_MAX_BUFFER); if(Date.now()>=state.retryAt) void syncBinanceFuturesDiffBook(symbol,generation); return; }
  if(!applyBinanceDiffEvent(state,d)){ state.buffer.push(d); void syncBinanceFuturesDiffBook(symbol,generation); return; }
  const book=binanceFuturesDiffBook(state); if(book.bids.length&&book.asks.length) liveBooks.set(`futures:${symbol}`,book);
}
function getBinanceFuturesNativeBook(symbol:string){
  const state=getBinanceFuturesDiffState(symbol);
  if(!state.synced || !state.bids.size || !state.asks.size) return null;
  return binanceFuturesDiffBook(state);
}
function getBinanceFuturesNativeHealth(symbol:string){
  const state=getBinanceFuturesDiffState(symbol);
  return { synced:state.synced, lastUpdateId:state.lastUpdateId, gapCount:state.gapCount, resyncCount:state.resyncCount, ageMs:state.lastEventTs ? Date.now()-state.lastEventTs : Infinity };
}


type MicrostructureLevel = { price:number; prevQty:number; qty:number; ts:number; side:'bid'|'ask'; added:number; cancelled:number; executed:number };
type MicrostructureState = {
  levels: Map<string, MicrostructureLevel>;
  events: Array<{ ts:number; side:'bid'|'ask'; price:number; type:'add'|'cancel'|'execute'; qty:number }>;
  lastBookTs:number;
};
const microstructureStates = new Map<EightExchange, MicrostructureState>();
const MICRO_EVENT_WINDOW_MS = 8000;
const MICRO_MATCH_TOLERANCE = 0.00008;
const MICRO_SPOOF_CANCEL_RATIO = 0.72;
const MICRO_REPLENISH_RATIO = 0.55;
const MICRO_QUEUE_DEPLETION_RATIO = 0.18;

function getMicroState(exchange: EightExchange) {
  let state = microstructureStates.get(exchange);
  if (!state) {
    state = { levels:new Map(), events:[], lastBookTs:0 };
    microstructureStates.set(exchange, state);
  }
  return state;
}

function nearestTradeNotionalAtPrice(exchange: EightExchange, price:number, since:number, side:'bid'|'ask') {
  if (exchange !== 'binance' || price <= 0) return 0;
  const symbol = cleanSymbol(TRADING_PAIR).toUpperCase();
  const buf = liveTradeBuffers.get(`spot:${symbol}`) || [];
  let total = 0;
  for (const t of buf) {
    if (t.ts < since || t.ts > Date.now()) continue;
    const diff = Math.abs(t.price - price) / Math.max(price, 1e-9);
    if (diff > MICRO_MATCH_TOLERANCE) continue;
    const isAggBuy = !t.maker;
    if ((side === 'ask' && isAggBuy) || (side === 'bid' && !isAggBuy)) total += t.price * t.qty;
  }
  return total;
}

function recordEightBookUpdate(exchange: EightExchange, book: {bids:number[][]; asks:number[][]; ts:number}) {
  const state = getMicroState(exchange);
  const now = book.ts || Date.now();
  const prev = eightBooks.get(exchange);
  const previousLevels = new Map<string, number>();
  if (prev) {
    for (const [px,qty] of prev.bids || []) previousLevels.set(`b:${px}`, safeNum(qty));
    for (const [px,qty] of prev.asks || []) previousLevels.set(`a:${px}`, safeNum(qty));
  }
  const currentLevels = new Map<string, {side:'bid'|'ask'; price:number; qty:number}>();
  for (const [px,qty] of book.bids || []) currentLevels.set(`b:${px}`, {side:'bid',price:safeNum(px),qty:safeNum(qty)});
  for (const [px,qty] of book.asks || []) currentLevels.set(`a:${px}`, {side:'ask',price:safeNum(px),qty:safeNum(qty)});

  if (prev) {
    const keys = new Set([...previousLevels.keys(), ...currentLevels.keys()]);
    for (const key of keys) {
      const oldQty = safeNum(previousLevels.get(key));
      const cur = currentLevels.get(key);
      const newQty = cur ? safeNum(cur.qty) : 0;
      if (oldQty <= 0 && newQty <= 0) continue;
      const side = cur?.side || (key.startsWith('b:') ? 'bid' : 'ask') as 'bid'|'ask';
      const price = cur?.price || safeNum(key.slice(2));
      const delta = newQty - oldQty;
      if (delta > 0) {
        state.events.push({ts:now,side,price,type:'add',qty:delta});
      } else if (delta < 0) {
        const removed = -delta;
        const tradeNotional = nearestTradeNotionalAtPrice(exchange, price, Math.max(0, now-130), side);
        const tradeQty = price > 0 ? tradeNotional / price : 0;
        const executed = Math.min(removed, Math.max(0, tradeQty));
        if (executed > 0) state.events.push({ts:now,side,price,type:'execute',qty:executed});
        if (removed-executed > 0) state.events.push({ts:now,side,price,type:'cancel',qty:removed-executed});
      }
      state.levels.set(key, {price,prevQty:oldQty,qty:newQty,ts:now,side,added:Math.max(0,delta),cancelled:Math.max(0,-delta),executed:0});
    }
  }
  while (state.events.length && now-state.events[0].ts > MICRO_EVENT_WINDOW_MS) state.events.shift();
  state.lastBookTs=now;
  microstructureStates.set(exchange,state);
  eightBooks.set(exchange, book as any);
}

function analyzeMicrostructure(exchange: EightExchange, book:any) {
  const state=getMicroState(exchange);
  const now=Date.now();
  const events=state.events.filter(e=>e.ts>=now-MICRO_EVENT_WINDOW_MS);
  const summarize=(side:'bid'|'ask', type:'add'|'cancel'|'execute') => events.filter(e=>e.side===side && e.type===type).reduce((s,e)=>s+e.qty*e.price,0);
  const bidAdd=summarize('bid','add'), askAdd=summarize('ask','add');
  const bidCancel=summarize('bid','cancel'), askCancel=summarize('ask','cancel');
  const bidExec=summarize('bid','execute'), askExec=summarize('ask','execute');
  const bidRemoved=bidCancel+bidExec, askRemoved=askCancel+askExec;
  const bidCancelRatio=bidRemoved>0?bidCancel/bidRemoved:0, askCancelRatio=askRemoved>0?askCancel/askRemoved:0;
  const bidExecRatio=bidRemoved>0?bidExec/bidRemoved:0, askExecRatio=askRemoved>0?askExec/askRemoved:0;
  const spoofBid=clamp(bidCancelRatio*(1-bidExecRatio),0,1), spoofAsk=clamp(askCancelRatio*(1-askExecRatio),0,1);
  const consumptionLong=askExec/(askExec+askCancel+1e-9);
  const consumptionShort=bidExec/(bidExec+bidCancel+1e-9);
  const addVsRemoveBid=bidAdd/(bidRemoved+1e-9), addVsRemoveAsk=askAdd/(askRemoved+1e-9);
  const queueBid=clamp((bidExec-bidCancel)/(bidAdd+bidRemoved+1e-9),-1,1);
  const queueAsk=clamp((askExec-askCancel)/(askAdd+askRemoved+1e-9),-1,1);
  return {
    bidAdd,askAdd,bidCancel,askCancel,bidExec,askExec,bidCancelRatio,askCancelRatio,bidExecRatio,askExecRatio,
    spoofBid,spoofAsk,consumptionLong,consumptionShort,queueBid,queueAsk,
    spoofScore:clamp(spoofAsk-spoofBid,-1,1),
    executionImbalance:clamp((askExec-bidExec)/(askExec+bidExec+1e-9),-1,1),
    addImbalance:clamp((bidAdd-askAdd)/(bidAdd+askAdd+1e-9),-1,1),
    queueDepletion:clamp(queueAsk-queueBid,-1,1),
    eventCount:events.length,
    replenishment:0
  };
}


function normalizeBook(bids: any[], asks: any[]) {
  return {
    bids: (bids || []).map((x: any) => [safeNum(x?.[0]), safeNum(x?.[1])])
      .filter((x: number[]) => x[0] > 0 && x[1] > 0).slice(0, EIGHT_BOOK_LEVELS),
    asks: (asks || []).map((x: any) => [safeNum(x?.[0]), safeNum(x?.[1])])
      .filter((x: number[]) => x[0] > 0 && x[1] > 0).slice(0, EIGHT_BOOK_LEVELS)
  };
}

function closeEightExchangeSockets() {
  while (eightSockets.length) {
    try { eightSockets.pop()!.close(); } catch {}
  }
}

function eightExchangeSymbol(exchange: EightExchange, pair: string) {
  const [base, quote] = pair.toUpperCase().split('/');
  if (!base || !quote) return '';
  if (exchange === 'okx') return `${base}-${quote}-SWAP`;
  return `${base}${quote}`;
}

function startEightExchangeStreams(forceReconnect = false) {
  if (!TRADING_PAIR) return;
  if (!forceReconnect && eightStreamGeneration > 0) return;
  closeEightExchangeSockets();
  const generation = ++eightStreamGeneration;

  const connect = (url: string, onOpen: (ws: WebSocket) => void, onMessage: (d: any) => void) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { return; }
    eightSockets.push(ws);
    ws.on('open', () => { try { onOpen(ws); } catch {} });
    ws.on('message', raw => {
      try { onMessage(JSON.parse(raw.toString())); } catch {}
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (generation === eightStreamGeneration) setTimeout(() => startEightExchangeStreams(true), 5000);
    });
  };

  const pair = TRADING_PAIR;
  const sym = eightExchangeSymbol('binance', pair);

  // Binance Spot — native diff-depth + REST snapshot bootstrap.
  connect(`wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@depth@100ms`,
    () => { addEngineLog('INFO', '[8X WS] Binance native diff-depth bağlantısı açıldı'); const state=getBinanceDiffState(cleanSymbol(TRADING_PAIR).toUpperCase()); state.synced=false; state.buffer.length=0; void syncBinanceDiffBook(sym.toUpperCase(),generation); },
    d => handleBinanceDiff(sym.toUpperCase(),d,generation));

  // Coinbase Advanced Trade
  connect('wss://advanced-trade-ws.coinbase.com',
    ws => {
      ws.send(JSON.stringify({
        type: 'subscribe', product_ids: [`${pair.split('/')[0]}-${pair.split('/')[1]}`],
        channel: 'level2'
      }));
      addEngineLog('INFO', '[8X WS] Coinbase bağlantısı açıldı');
    },
    d => {
      const events = Array.isArray(d?.events) ? d.events : [];
      for (const ev of events) {
        const updates = Array.isArray(ev?.updates) ? ev.updates : [];
        const current = eightBooks.get('coinbase') || { bids: [], asks: [], ts: 0 };
        const bids = new Map(current.bids.map(x => [String(x[0]), x[1]]));
        const asks = new Map(current.asks.map(x => [String(x[0]), x[1]]));
        for (const u of updates) {
          const px = safeNum(u?.price_level), qty = safeNum(u?.new_quantity);
          if (px <= 0) continue;
          const side = String(u?.side || '').toLowerCase();
          const target = side === 'bid' ? bids : asks;
          if (qty <= 0) target.delete(String(px)); else target.set(String(px), qty);
        }
        const b = Array.from(bids.entries()).map(([p,q]) => [Number(p),q] as number[]).sort((a,b)=>b[0]-a[0]).slice(0,EIGHT_BOOK_LEVELS);
        const a = Array.from(asks.entries()).map(([p,q]) => [Number(p),q] as number[]).sort((a,b)=>a[0]-b[0]).slice(0,EIGHT_BOOK_LEVELS);
        if (b.length && a.length) recordEightBookUpdate('coinbase', { bids:b, asks:a, ts:Date.now() });
      }
    });

  // Kraken Spot
  connect('wss://ws.kraken.com/v2',
    ws => {
      ws.send(JSON.stringify({ method:'subscribe', params:{ channel:'book', symbol:[pair.replace('/','/')], depth:20 } }));
      addEngineLog('INFO', '[8X WS] Kraken bağlantısı açıldı');
    },
    d => {
      if (d?.channel !== 'book' || !Array.isArray(d?.data)) return;
      const x = d.data[0]; const b = normalizeBook(x?.bids || [], x?.asks || []);
      if (b.bids.length && b.asks.length) recordEightBookUpdate('kraken', { ...b, ts:Date.now() });
    });

  // OKX Spot
  connect('wss://ws.okx.com:8443/ws/v5/public',
    ws => {
      ws.send(JSON.stringify({ op:'subscribe', args:[{ channel:'books5', instId:`${pair.split('/')[0]}-${pair.split('/')[1]}` }] }));
      addEngineLog('INFO', '[8X WS] OKX bağlantısı açıldı');
    },
    d => {
      const x = d?.data?.[0]; if (!x) return;
      const b = normalizeBook(x?.bids || [], x?.asks || []);
      if (b.bids.length && b.asks.length) recordEightBookUpdate('okx', { ...b, ts:Date.now() });
    });

  // Bybit Spot
  connect('wss://stream.bybit.com/v5/public/spot',
    ws => {
      ws.send(JSON.stringify({ op:'subscribe', args:[`orderbook.50.${sym}`] }));
      addEngineLog('INFO', '[8X WS] Bybit bağlantısı açıldı');
    },
    d => {
      const x=d?.data; if (!x) return;
      const b=normalizeBook(x?.b || [], x?.a || []);
      if (b.bids.length && b.asks.length) recordEightBookUpdate('bybit',{...b,ts:Date.now()});
    });

  // Bitget Spot
  connect('wss://ws.bitget.com/v2/ws/public',
    ws => {
      ws.send(JSON.stringify({ op:'subscribe', args:[{ instType:'SPOT', channel:'books', instId:sym }] }));
      addEngineLog('INFO', '[8X WS] Bitget bağlantısı açıldı');
    },
    d => {
      const x=d?.data?.[0]; if (!x) return;
      const b=normalizeBook(x?.bids || [], x?.asks || []);
      if (b.bids.length && b.asks.length) recordEightBookUpdate('bitget',{...b,ts:Date.now()});
    });

  // Gate.io Spot
  connect('wss://api.gateio.ws/ws/v4/',
    ws => {
      ws.send(JSON.stringify({ time:Math.floor(Date.now()/1000), channel:'spot.order_book_update', event:'subscribe',
        payload:[sym.toLowerCase(), '20', '100ms'] }));
      addEngineLog('INFO', '[8X WS] Gate bağlantısı açıldı');
    },
    d => {
      const r=d?.result; if (!r) return;
      const b=normalizeBook(r?.bids || r?.b || [], r?.asks || r?.a || []);
      if (b.bids.length && b.asks.length) recordEightBookUpdate('gate',{...b,ts:Date.now()});
    });

  // KuCoin Spot
  (async () => {
    try {
      const tokenRes = await fetch('https://api.kucoin.com/api/v1/bullet-public');
      if (!tokenRes.ok) return;
      const tokenData = await tokenRes.json();
      const server = tokenData?.data?.instanceServers?.[0];
      const token = tokenData?.data?.token;
      if (!server || !token || generation !== eightStreamGeneration) return;
      const endpoint = `${server.endpoint}?token=${encodeURIComponent(token)}&connectId=${Date.now()}`;
      connect(endpoint,
        ws => {
          ws.send(JSON.stringify({ id:Date.now(), type:'subscribe', topic:`/market/level2:${pair.replace('/','-')}`, response:true }));
          addEngineLog('INFO', '[8X WS] KuCoin bağlantısı açıldı');
        },
        d => {
          const x=d?.data; if (!x) return;
          // KuCoin level2 deltas are [price, qty] and can be applied to a local book.
          const cur=eightBooks.get('kucoin') || { bids:[], asks:[], ts:0 };
          const bids=new Map(cur.bids.map(v=>[String(v[0]),v[1]]));
          const asks=new Map(cur.asks.map(v=>[String(v[0]),v[1]]));
          for (const u of [...(x.changes?.bids || []), ...(x.changes?.asks || [])]) {
            const px=safeNum(u?.[0]), qty=safeNum(u?.[1]); if (px<=0) continue;
            const isBid=(x.changes?.bids || []).includes(u);
            const target=isBid?bids:asks;
            if (qty<=0) target.delete(String(px)); else target.set(String(px),qty);
          }
          const b=Array.from(bids.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>b[0]-a[0]).slice(0,EIGHT_BOOK_LEVELS);
          const a=Array.from(asks.entries()).map(([p,q])=>[+p,q] as number[]).sort((a,b)=>a[0]-b[0]).slice(0,EIGHT_BOOK_LEVELS);
          if (b.length && a.length) recordEightBookUpdate('kucoin',{bids:b,asks:a,ts:Date.now()});
        });
    } catch {}
  })();
}

function bookMid(book: { bids:number[][]; asks:number[][] }) {
  const bid=safeNum(book.bids[0]?.[0]), ask=safeNum(book.asks[0]?.[0]);
  return bid>0 && ask>0 ? (bid+ask)/2 : 0;
}

function bookOBI(book: { bids:number[][]; asks:number[][] }) {
  const bid=book.bids.slice(0,10).reduce((s,x)=>s+safeNum(x[1]),0);
  const ask=book.asks.slice(0,10).reduce((s,x)=>s+safeNum(x[1]),0);
  return bid+ask>0 ? (bid-ask)/(bid+ask) : 0;
}

function percentile(values:number[], p:number) {
  if (!values.length) return 0;
  const a=[...values].sort((x,y)=>x-y), i=(a.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
  return lo===hi ? a[lo] : a[lo]+(a[hi]-a[lo])*(i-lo);
}


/**
 * Live-only 0-5s microstructure engines.
 * No persistence and no historical learning: only the current book and a tiny
 * rolling trade window already required by the live websocket feed are used.
 */
function computeShortHorizonEngines(book:any, flowBuf:any[], now:number, sideHint:Side|null, executionNotional:number) {
  const bids=(book?.bids||[]).slice(0,50);
  const asks=(book?.asks||[]).slice(0,50);
  if (!bids.length || !asks.length) return null;
  const bid=safeNum(bids[0]?.[0]), ask=safeNum(asks[0]?.[0]);
  const mid=(bid+ask)/2;
  if (mid<=0) return null;

  const sideQty=(levels:any[])=>levels.reduce((n,x)=>n+Math.max(0,safeNum(x?.[1])),0);
  const sideNotional=(levels:any[])=>levels.reduce((n,x)=>n+Math.max(0,safeNum(x?.[0])*safeNum(x?.[1])),0);
  const front=(levels:any[], bps:number)=>{
    const sign=levels===asks ? 1 : -1;
    return levels.filter(x=>{
      const px=safeNum(x?.[0]);
      return px>0 && sign*(px-mid)/mid <= bps/10000;
    });
  };

  const bidFront=front(bids,5), askFront=front(asks,5);
  const bidLiq=sideNotional(bidFront), askLiq=sideNotional(askFront);
  const totalFront=bidLiq+askLiq;
  const frontImbalance=totalFront>0 ? (bidLiq-askLiq)/totalFront : 0;

  // MicroPrice: pressure at the best quotes, normalized into a directional bias.
  const bq=Math.max(0,safeNum(bids[0]?.[1])), aq=Math.max(0,safeNum(asks[0]?.[1]));
  const microPrice=bq+aq>0 ? (bq*ask+aq*bid)/(bq+aq) : mid;
  const microBias=clamp(((microPrice-mid)/mid)*10000,-1,1);

  // Liquidity vacuum/path resistance: how much opposing liquidity must be crossed
  // before price reaches +1/+2/+5 bps. Lower resistance = easier short-term path.
  const pathFor=(side:'long'|'short', bps:number)=>{
    const levels=side==='long'?asks:bids;
    const sign=side==='long'?1:-1;
    const maxPx=mid*(1+sign*bps/10000);
    return side==='long'
      ? sideNotional(levels.filter(x=>safeNum(x?.[0])>0 && safeNum(x?.[0])<=maxPx))
      : sideNotional(levels.filter(x=>safeNum(x?.[0])>0 && safeNum(x?.[0])>=maxPx));
  };
  const longPath=[1,2,5].map(b=>pathFor('long',b));
  const shortPath=[1,2,5].map(b=>pathFor('short',b));
  const normPath=(v:number)=>clamp(v/Math.max(executionNotional,1000),0,5);
  const longResistance=clamp((normPath(longPath[0])*0.50+normPath(longPath[1])*0.30+normPath(longPath[2])*0.20)/5,0,1);
  const shortResistance=clamp((normPath(shortPath[0])*0.50+normPath(shortPath[1])*0.30+normPath(shortPath[2])*0.20)/5,0,1);
  const longVacuum=1-longResistance, shortVacuum=1-shortResistance;

  // Price impact curve for the actual intended notional.
  const impactFor=(side:'long'|'short')=>{
    const levels=side==='long'?asks:bids;
    let remaining=Math.max(100,executionNotional), quote=0, base=0;
    for(const [pxRaw,qtyRaw] of levels){
      const px=safeNum(pxRaw), qty=safeNum(qtyRaw);
      if(px<=0||qty<=0) continue;
      const take=Math.min(remaining,px*qty);
      quote+=take; base+=take/px; remaining-=take;
      if(remaining<=1e-9) break;
    }
    const vwap=base>0?quote/base:0;
    const top=side==='long'?ask:bid;
    return {complete:remaining<=1e-9, impact:top>0&&vwap>0?Math.abs(vwap-top)/top:1, vwap};
  };
  const longImpact=impactFor('long'), shortImpact=impactFor('short');

  const window=(ms:number)=>{
    const items=(flowBuf||[]).filter((t:any)=>t.ts>=now-ms && safeNum(t.price)>0 && safeNum(t.qty)>0);
    let buy=0,sell=0;
    for(const t of items){ const n=safeNum(t.price)*safeNum(t.qty); if(t.maker) sell+=n; else buy+=n; }
    const total=buy+sell;
    return {bias:total>0?(buy-sell)/total:0,total,count:items.length};
  };
  const f100=window(100), f250=window(250), f500=window(500), f1000=window(1000);
  const flowAcceleration=clamp((f100.bias-f1000.bias)*0.55+(f250.bias-f500.bias)*0.45,-1,1);
  const flowSpeed=clamp(Math.abs(f100.bias)*0.35+Math.abs(f250.bias)*0.30+Math.abs(flowAcceleration)*0.35,0,1);

  // Absorption/rejection: aggressive flow is large but price response is small.
  const recent500=(flowBuf||[]).filter((t:any)=>t.ts>=now-500&&safeNum(t.price)>0);
  const firstPrice=recent500.length ? safeNum(recent500[0]?.price) : mid;
  const lastPrice=recent500.length ? safeNum(recent500[recent500.length-1]?.price) : mid;
  const priceResponse=firstPrice>0?clamp(((lastPrice-firstPrice)/firstPrice)*10000,-1,1):0;
  const aggression=f500.total>0?clamp(Math.abs(f500.bias),0,1):0;
  const absorptionStrength=clamp(aggression*(1-Math.min(1,Math.abs(priceResponse)/0.35)),0,1);
  const absorptionDirection=priceResponse>0?1:priceResponse<0?-1:Math.sign(f500.bias||0);

  // Freshness/latency gate. A stale book cannot qualify for a 0-5s scalp.
  const ageMs=Math.max(0,now-safeNum((book as any)?.ts,now));
  const freshness=clamp(1-ageMs/800,0,1);

  const longRaw=clamp(0.24*Math.max(0,frontImbalance)+0.18*Math.max(0,microBias)+0.20*Math.max(0,f250.bias)+0.14*Math.max(0,flowAcceleration)+0.14*longVacuum+0.10*(1-longImpact.impact*100),0,1);
  const shortRaw=clamp(0.24*Math.max(0,-frontImbalance)+0.18*Math.max(0,-microBias)+0.20*Math.max(0,-f250.bias)+0.14*Math.max(0,-flowAcceleration)+0.14*shortVacuum+0.10*(1-shortImpact.impact*100),0,1);
  const longScore=clamp(longRaw*freshness-(absorptionDirection<0?absorptionStrength*0.16:0),0,1);
  const shortScore=clamp(shortRaw*freshness-(absorptionDirection>0?absorptionStrength*0.16:0),0,1);
  const direction=longScore>shortScore?'long':shortScore>longScore?'short':null;
  const dominant=Math.max(longScore,shortScore);
  const runnerTargetBps=clamp(1.5+dominant*8,1.5,9.5);
  const targetNotionalFlow=Math.max(1000,executionNotional);
  const dominantFlow=direction==='long'?f250.bias:direction==='short'?-f250.bias:0;
  const pathResistance=direction==='long'?longResistance:direction==='short'?shortResistance:1;
  const impact=direction==='long'?longImpact.impact:direction==='short'?shortImpact.impact:1;
  // Conservative live-only estimate; not a statistical guarantee.
  const expectedMovePct=runnerTargetBps/10000;
  const expectedAdversePct=clamp(0.0008+pathResistance*0.0025+(1-Math.abs(dominantFlow))*0.0015,0.0008,0.006);
  const timeToTargetMs=Math.round(250+1800*pathResistance+1200*(1-flowSpeed));
  const shortHorizonScore=clamp(Math.max(longScore,shortScore),0,1);

  return {
    direction, longScore, shortScore, score:shortHorizonScore,
    frontImbalance, microPrice, microBias,
    liquidityVacuum:{long:longVacuum,short:shortVacuum},
    pathResistance:{long:longResistance,short:shortResistance},
    priceImpact:{long:longImpact.impact,short:shortImpact.impact},
    flow:{f100:f100.bias,f250:f250.bias,f500:f500.bias,f1000:f1000.bias,acceleration:flowAcceleration,speed:flowSpeed},
    absorption:{strength:absorptionStrength,direction:absorptionDirection,response:priceResponse},
    freshness, ageMs, expectedMovePct, expectedAdversePct, timeToTargetMs,
    targetBps:runnerTargetBps, executionNotional:targetNotionalFlow, impact,
    qualifies: Boolean(direction && shortHorizonScore>=0.64 && freshness>=0.35 && Math.abs(dominantFlow)>=0.08 && pathResistance<=0.72 && impact<=0.0015 && !(absorptionStrength>=0.55 && absorptionDirection!== (direction==='long'?1:-1)))
  };
}

function analyzeEightExchangeOrderBooks(pair:string) {
  const now=Date.now();
  const rows:any[]=[];
  for (const name of EIGHT_EXCHANGES) {
    const b=eightBooks.get(name);
    if (!b || now-b.ts>5000) continue;
    const mid=bookMid(b);
    if (mid<=0) continue;
    rows.push({ exchange:name, mid, bestBid:b.bids[0]?.[0]||0, bestAsk:b.asks[0]?.[0]||0, obi:bookOBI(b), ageMs:now-b.ts, bids:b.bids, asks:b.asks });
  }
  if (!rows.length) return null;
  const mids=rows.map(r=>r.mid);
  const median=percentile(mids,0.5);
  const minRow=rows.reduce((a,b)=>a.mid<b.mid?a:b);
  const maxRow=rows.reduce((a,b)=>a.mid>b.mid?a:b);
  const lowGap=(median-minRow.mid)/median;
  const highGap=(maxRow.mid-median)/median;
  const crossGap=(maxRow.mid-minRow.mid)/minRow.mid;
  const binanceRow=rows.find(r=>r.exchange==='binance') || rows[0];
  const binanceVsMedian=(binanceRow.mid-median)/median;
  const consensusObi=rows.reduce((s,r)=>s+r.obi,0)/rows.length;
  const dispersion=median>0 ? Math.sqrt(rows.reduce((s,r)=>s+Math.pow(r.mid-median,2),0)/rows.length)/median : 0;

  // Entry must be supported by the FRONT of the book, not by a wall sitting deep in
  // the last levels. This is deliberately strict to reduce spoofing / fake-wall traps.
  const nearObiForRow = (r:any) => {
    const bids = r.bids.slice(0, ENTRY_NEAR_LEVELS);
    const asks = r.asks.slice(0, ENTRY_NEAR_LEVELS);
    const bv = bids.reduce((sum:number,x:any[]) => sum + safeNum(x?.[1]), 0);
    const av = asks.reduce((sum:number,x:any[]) => sum + safeNum(x?.[1]), 0);
    return bv + av > 0 ? (bv-av)/(bv+av) : 0;
  };
  const nearConsensusObi = rows.reduce((s,r)=>s+nearObiForRow(r),0)/rows.length;
  const deepConsensusObi = rows.reduce((s,r)=>s+(r.obi-nearObiForRow(r)),0)/rows.length;
  const preliminaryDirection = binanceVsMedian <= -minCrossExchangeGap ? 1
    : binanceVsMedian >= minCrossExchangeGap ? -1 : 0;
  const nearAlignment = preliminaryDirection === 0 ? 0 : preliminaryDirection * nearConsensusObi;
  const deepOnlyRatio = Math.abs(deepConsensusObi) / Math.max(Math.abs(consensusObi), 1e-9);

  // Mathematical score: price dislocation + cross-venue order-book imbalance + robust dispersion.
  const direction = preliminaryDirection;
  const gapMagnitude = Math.abs(binanceVsMedian);
  const obiAligned = direction===0 ? 0 : direction*consensusObi;
  const topBookConfirmed = direction!==0 && nearAlignment >= MIN_NEAR_BOOK_ALIGNMENT && deepOnlyRatio <= MAX_DEEP_ONLY_RATIO;

  const spotSymbol = cleanSymbol(pair).toUpperCase();
  const flowBuf = liveTradeBuffers.get(`spot:${spotSymbol}`) || [];
  const recentFlow = flowBuf.filter((t:any) => t.ts >= now - 5000 && t.price > 0 && t.qty > 0);
  let buyNotional = 0, sellNotional = 0;
  for (const t of recentFlow) {
    const notional = safeNum(t.price) * safeNum(t.qty);
    if (t.maker) sellNotional += notional; else buyNotional += notional;
  }
  const flowTotal = buyNotional + sellNotional;
  const tradeFlowBias = flowTotal > 0 ? clamp((buyNotional - sellNotional) / flowTotal, -1, 1) : 0;

  // Scalp Engine v2: measure *what is actually happening to the book*, not just
  // what is currently visible. We use 250ms/1s/3s/5s trade windows, freshness
  // weighted exchange consensus, liquidity consumption and an execution-cost gate.
  const flowWindow = (ms:number) => {
    const items = flowBuf.filter((t:any) => t.ts >= now - ms && t.price > 0 && t.qty > 0);
    let buy=0, sell=0, count=0, large=0;
    for (const t of items) {
      const n=safeNum(t.price)*safeNum(t.qty); count++;
      if (t.maker) sell += n; else buy += n;
      if (n >= 100000) large += n;
    }
    const total=buy+sell;
    return { bias: total>0 ? clamp((buy-sell)/total,-1,1) : 0, total, count, largeRatio: total>0 ? clamp(large/total,0,1) : 0 };
  };
  const flow250=flowWindow(250), flow1s=flowWindow(1000), flow3s=flowWindow(3000), flow5s=flowWindow(5000);
  const flowVelocity = clamp((flow250.bias-flow3s.bias)*1.4 + (flow1s.bias-flow5s.bias)*0.6, -1, 1);

  const binanceBook = eightBooks.get('binance');
  const bb = binanceBook?.bids?.[0]; const ba = binanceBook?.asks?.[0];
  const bestBidQty = safeNum(bb?.[1]); const bestAskQty = safeNum(ba?.[1]);
  const topQty = bestBidQty + bestAskQty;
  const microPrice = bb && ba && topQty > 0 ? (bestBidQty * safeNum(ba[0]) + bestAskQty * safeNum(bb[0])) / topQty : binanceRow.mid;
  const microBias = binanceRow.mid > 0 ? clamp(((microPrice - binanceRow.mid) / binanceRow.mid) * 10000, -1, 1) : 0;

  const priorPrice = recentFlow.length >= 2 ? safeNum(recentFlow[0].price) : binanceRow.mid;
  const lastPrice = recentFlow.length ? safeNum(recentFlow[recentFlow.length - 1].price) : binanceRow.mid;
  const shortMomentum = priorPrice > 0 ? clamp(((lastPrice - priorPrice) / priorPrice) * 500, -1, 1) : 0;
  const spread = binanceRow.mid > 0 ? (binanceRow.bestAsk - binanceRow.bestBid) / binanceRow.mid : 1;
  const spreadQuality = 1 - clamp(spread / 0.0015, 0, 1);

  // Freshness-weighted 8-venue consensus. A stale venue must not have the same
  // influence as a 40ms venue during a fast move.
  const freshnessWeight = (age:number) => Math.exp(-Math.max(0,age) / 900);
  const weightedNearConsensus = rows.reduce((sum,r) => sum + nearObiForRow(r)*freshnessWeight(r.ageMs), 0) / Math.max(rows.reduce((sum,r)=>sum+freshnessWeight(r.ageMs),0),1e-9);
  const freshRows = rows.filter(r=>r.ageMs <= SCALP_V2_MAX_DATA_AGE_MS);
  const bullishFresh = freshRows.filter(r=>nearObiForRow(r) > 0.05).length;
  const bearishFresh = freshRows.filter(r=>nearObiForRow(r) < -0.05).length;
  const exchangeAgreement = freshRows.length ? Math.max(bullishFresh,bearishFresh)/freshRows.length : 0;
  const consensusDirection = weightedNearConsensus >= 0 ? 1 : -1;
  const consensusStrength = clamp(Math.abs(weightedNearConsensus),0,1);

  // Estimate how much of the visible first-5-level liquidity is being consumed.
  // This is deliberately conservative: repeated book depletion + aggressive flow
  // is required before the engine treats a breakout as real.
  // Liquidity Echo: reward front-of-book liquidity that repeatedly survives at
  // approximately the same price across consecutive snapshots. A one-shot wall gets
  // little score; persistent/replenished liquidity gets more.
  const echoKey = `binance:${spotSymbol}`;
  const echoHistory = liquidityEchoHistory.get(echoKey) || [];
  echoHistory.push({
    ts: now,
    bids: (binanceBook?.bids || []).slice(0, LIQUIDITY_ECHO_LEVELS).map((x:any[])=>[safeNum(x[0]),safeNum(x[1])]),
    asks: (binanceBook?.asks || []).slice(0, LIQUIDITY_ECHO_LEVELS).map((x:any[])=>[safeNum(x[0]),safeNum(x[1])])
  });
  while (echoHistory.length && now - echoHistory[0].ts > LIQUIDITY_ECHO_WINDOW_MS) echoHistory.shift();
  liquidityEchoHistory.set(echoKey, echoHistory.slice(-12));
  const echoSide = (side: 'bid'|'ask') => {
    if (echoHistory.length < 3) return 0;
    let persistence = 0, replenishment = 0, samples = 0;
    for (let i=1;i<echoHistory.length;i++) {
      const prev = side==='bid' ? echoHistory[i-1].bids : echoHistory[i-1].asks;
      const cur = side==='bid' ? echoHistory[i].bids : echoHistory[i].asks;
      for (let level=0; level<Math.min(prev.length,cur.length,LIQUIDITY_ECHO_LEVELS); level++) {
        const pp=safeNum(prev[level]?.[0]), cp=safeNum(cur[level]?.[0]);
        const pq=safeNum(prev[level]?.[1]), cq=safeNum(cur[level]?.[1]);
        if (pp<=0 || cp<=0) continue;
        const priceStable=Math.abs(cp-pp)/Math.max(cp,pp) < 0.00025;
        if (priceStable) {
          samples++;
          if (cq >= pq*0.75) persistence += 1;
          if (cq >= pq*0.95 && pq > 0) replenishment += 1;
        }
      }
    }
    return samples ? clamp((0.65*persistence + 0.35*replenishment)/samples,0,1) : 0;
  };
  const echoBid = echoSide('bid');
  const echoAsk = echoSide('ask');
  const previousBook = echoHistory.length >= 2 ? echoHistory[echoHistory.length-2] : null;
  const sideLiquidity = (side:'bid'|'ask', book:any) => (side==='bid' ? (book?.bids || []) : (book?.asks || [])).slice(0,ENTRY_NEAR_LEVELS).reduce((sum:number,x:any[])=>sum+safeNum(x?.[0])*safeNum(x?.[1]),0);
  const currentBidLiq = sideLiquidity('bid', binanceBook), currentAskLiq = sideLiquidity('ask', binanceBook);
  const previousBidLiq = previousBook ? sideLiquidity('bid', previousBook) : currentBidLiq;
  const previousAskLiq = previousBook ? sideLiquidity('ask', previousBook) : currentAskLiq;
  const bidDepletion = previousBidLiq>0 ? clamp((previousBidLiq-currentBidLiq)/previousBidLiq,-1,1) : 0;
  const askDepletion = previousAskLiq>0 ? clamp((previousAskLiq-currentAskLiq)/previousAskLiq,-1,1) : 0;
  const v2ProbeDirection = direction !== 0 ? direction : (weightedNearConsensus >= 0 ? 1 : -1);
  const microByExchange = Object.fromEntries(rows.map(r => [r.exchange, analyzeMicrostructure(r.exchange, r)]));
  const binanceMicro = microByExchange.binance || analyzeMicrostructure('binance', binanceBook || {});
  const spoofPenalty = clamp(Math.abs(v2ProbeDirection) * (v2ProbeDirection > 0 ? safeNum(binanceMicro.spoofAsk) : safeNum(binanceMicro.spoofBid)), 0, 1);
  const executionImbalance = safeNum(binanceMicro.executionImbalance);
  const addImbalance = safeNum(binanceMicro.addImbalance);
  const queueDepletion = safeNum(binanceMicro.queueDepletion);
  const replenishmentEvents = (binanceMicro.eventCount || 0) > 0 ? clamp((safeNum(binanceMicro.askExec) > 0 && safeNum(binanceMicro.askAdd) > safeNum(binanceMicro.askExec) * MICRO_REPLENISH_RATIO ? 1 : 0) - (safeNum(binanceMicro.bidExec) > 0 && safeNum(binanceMicro.bidAdd) > safeNum(binanceMicro.bidExec) * MICRO_REPLENISH_RATIO ? 1 : 0), -1, 1) : 0;

  const directionalConsumption = v2ProbeDirection > 0 ? askDepletion : bidDepletion;
  const alignedFlow = v2ProbeDirection * flow1s.bias;
  const consumptionScore = clamp(v2ProbeDirection * (0.55*directionalConsumption + 0.45*alignedFlow), -1, 1);
  const absorptionScore = clamp((v2ProbeDirection > 0 ? -askDepletion : -bidDepletion) + 0.8*(v2ProbeDirection > 0 ? flow1s.bias : -flow1s.bias), -1, 1);

  // Execution edge: expected spread + fee + depth slippage must leave a positive
  // edge. This prevents a statistically attractive signal from becoming a bad fill.
  const estimatedNotional = Math.max(25, currentStakeAmount * Math.max(1,targetLeverage));
  const estimateSlippage = (side:'buy'|'sell') => {
    const book = binanceBook || {bids:[],asks:[]};
    const levels = side==='buy' ? book.asks.slice(0,5) : book.bids.slice(0,5);
    let remaining=estimatedNotional, cost=0, qty=0;
    for (const [px,q] of levels) {
      const price=safeNum(px), amount=safeNum(q); if(price<=0||amount<=0) continue;
      const take=Math.min(amount, remaining/price); cost += take*price; qty += take; remaining -= take*price;
      if(remaining<=0) break;
    }
    const vwap=qty>0?cost/qty:binanceRow.mid;
    return binanceRow.mid>0 ? Math.abs(vwap-binanceRow.mid)/binanceRow.mid : 1;
  };
  const slippagePct = v2ProbeDirection>0 ? estimateSlippage('buy') : estimateSlippage('sell');
  const roundTripCost = spread + 2*slippagePct + 2*takerFeeRate;
  const dislocationEdge = Math.abs(binanceVsMedian);
  const netEdge = dislocationEdge + Math.max(0,consensusStrength*0.001) - roundTripCost;

  const liquidityEchoBias = clamp(echoBid - echoAsk, -1, 1);
  const directionalEcho = direction === 0 ? 0 : direction * liquidityEchoBias;
  const liquidityEchoScore = clamp(Math.abs(directionalEcho),0,1);
  const bookComponent = clamp(0.65 * nearConsensusObi + 0.35 * consensusObi, -1, 1);
  const directionalComponents = direction === 0 ? [bookComponent, microBias, tradeFlowBias, shortMomentum] : [direction * bookComponent, direction * microBias, direction * tradeFlowBias, direction * shortMomentum];
  const scalpMean = directionalComponents.reduce((a,b)=>a+b,0) / directionalComponents.length;
  const scalpDispersion = Math.sqrt(directionalComponents.reduce((a,b)=>a+Math.pow(b-scalpMean,2),0)/directionalComponents.length);
  const scalpAgreement = clamp(1 - scalpDispersion / 0.8, 0, 1);
  const gapQuality = clamp(gapMagnitude / Math.max(minCrossExchangeGap, 1e-9), 0, 1);
  const scalpScore = direction === 0 ? 0 : clamp(0.25*gapQuality + 0.25*Math.max(0,directionalComponents[0]) + 0.15*Math.max(0,directionalComponents[1]) + 0.15*Math.max(0,directionalComponents[2]) + 0.10*Math.max(0,directionalComponents[3]) + 0.05*spreadQuality + 0.10*Math.max(0,directionalEcho), 0, 1);
  const v2Direction = consensusStrength >= SCALP_V2_MIN_CONSENSUS ? consensusDirection : direction;
  const v2DirectionalFlow = clamp(v2Direction * (0.45*flow1s.bias + 0.30*flow3s.bias + 0.15*flowVelocity + 0.10*tradeFlowBias), -1, 1);
  const v2Book = clamp(v2Direction * weightedNearConsensus, -1, 1);
  const v2Consumption = clamp(v2Direction * consumptionScore, 0, 1);
  const v2ExecutionFlow = clamp(v2Direction * executionImbalance, 0, 1);
  const v2Queue = clamp(v2Direction * queueDepletion, 0, 1);
  const v2SpoofRisk = clamp(spoofPenalty, 0, 1);
  const v2Replenishment = clamp(v2Direction * replenishmentEvents, -1, 1);
  const v2Echo = clamp(v2Direction * liquidityEchoBias, -1, 1);
  const v2Momentum = clamp(v2Direction * shortMomentum, -1, 1);
  const v2Freshness = rows.length ? clamp(rows.reduce((sum,r)=>sum+freshnessWeight(r.ageMs),0)/rows.length,0,1) : 0;
  const v2Score = clamp(0.18*Math.max(0,v2Book) + 0.20*Math.max(0,v2DirectionalFlow) + 0.13*Math.max(0,v2Consumption) + 0.10*Math.max(0,v2ExecutionFlow) + 0.08*Math.max(0,v2Queue) + 0.08*Math.max(0,v2Echo) + 0.06*Math.max(0,v2Momentum) + 0.08*exchangeAgreement + 0.09*spreadQuality - 0.10*v2SpoofRisk,0,1) * v2Freshness;
  const v2AbsorptionBlock = absorptionScore < SCALP_V2_ABSORPTION_BLOCK && Math.abs(v2DirectionalFlow) >= 0.20;
  const nativeFuturesBook = getLiveBook(pair, 'futures');
  const futuresNearObi = nativeFuturesBook?.bids?.length && nativeFuturesBook?.asks?.length
    ? bookOBI({ bids: nativeFuturesBook.bids.slice(0, 50), asks: nativeFuturesBook.asks.slice(0, 50) })
    : 0;
  const spotFuturesDivergence = clamp(binanceRow.obi - futuresNearObi, -1, 1);
  const divergenceMagnitude = Math.abs(spotFuturesDivergence);
  const divergenceConflict = divergenceMagnitude >= 0.45 && (binanceRow.obi * futuresNearObi < 0 || Math.abs(futuresNearObi) >= 0.25);
  const divergenceVeto = (v2Direction > 0 && futuresNearObi <= -0.25) || (v2Direction < 0 && futuresNearObi >= 0.25);
  const v2ExecutionOkay = spread <= SCALP_V2_MAX_SPREAD_PCT && netEdge >= SCALP_V2_MIN_NET_EDGE;
  const shortHorizon = computeShortHorizonEngines(binanceBook, flowBuf, now, v2Direction ? (v2Direction>0?'long':'short') : null, estimatedNotional);
  const shortHorizonSignal = shortHorizon?.qualifies ? shortHorizon.direction : null;
  const shortHorizonAligned = !shortHorizonSignal || shortHorizonSignal === (v2Direction>0?'long':'short');
  const v2Confirmed = v2Direction !== 0 && freshRows.length >= Math.max(4,Math.ceil(rows.length*0.75)) && exchangeAgreement >= SCALP_V2_MIN_EXCHANGE_AGREEMENT && v2Score >= SCALP_V2_MIN_SCORE && Math.abs(v2DirectionalFlow) >= SCALP_V2_MIN_FLOW && Math.abs(v2Consumption) >= SCALP_V2_MIN_CONSUMPTION && Math.abs(v2ExecutionFlow) >= 0.08 && Math.abs(v2Queue) >= 0.05 && v2SpoofRisk < MICRO_SPOOF_CANCEL_RATIO && !v2AbsorptionBlock && !divergenceVeto && v2ExecutionOkay && Boolean(shortHorizon?.qualifies) && shortHorizonAligned;
  const v2Signal: Side | null = v2Confirmed ? (v2Direction>0?'long':'short') : null;
  const componentStrength = clamp(Math.abs(scalpMean), 0, 1);
  const confidence = Math.min(1, 0.35*Math.min(1,gapMagnitude/minCrossExchangeGap) + 0.25*Math.max(0,obiAligned) + 0.15*Math.max(0,nearAlignment) + 0.15*componentStrength + 0.10*scalpAgreement);
  const scalpConfirmed = v2Confirmed || (direction !== 0 && topBookConfirmed && liquidityEchoScore >= MIN_LIQUIDITY_ECHO && scalpScore >= MIN_SCALP_SCORE && scalpAgreement >= MIN_SCALP_AGREEMENT && Math.max(...directionalComponents) >= 0.20);
  const signal = v2Signal || (scalpConfirmed && confidence>=MIN_BOOK_CONFIDENCE && Math.abs(obiAligned)>=0.05 ? (direction>0?'long':'short') : null);
  const provisionalAnalysis = { scalpV2: { score: v2Score, exchangeAgreement, flow1s: flow1s.bias, consumptionScore, spotFuturesDivergence, spreadPct: spread*100, netEdgePct: netEdge*100, direction: v2Direction } };
  const v27Sizing = getV27Sizing(provisionalAnalysis);
  const v27TargetPct = v27TargetFor(provisionalAnalysis, v27Sizing.aPlus);
  const v28Optimizer = getV28Optimizer(provisionalAnalysis);
  const v27HighConviction = Boolean(v2Signal && v27Sizing.aPlus && !divergenceVeto && v2ExecutionOkay);

  return {
    pair, exchanges: rows.map(r=>({exchange:r.exchange,mid:r.mid,bestBid:r.bestBid,bestAsk:r.bestAsk,obi:r.obi,ageMs:r.ageMs})),
    books: Object.fromEntries(rows.map(r=>[r.exchange,{bids:r.bids,asks:r.asks}])),
    medianPrice:median, minExchange:minRow.exchange, maxExchange:maxRow.exchange,
    minPrice:minRow.mid, maxPrice:maxRow.mid, crossGapPct:crossGap*100,
    binanceVsMedianPct:binanceVsMedian*100, consensusObi, dispersionPct:dispersion*100,
    mathematicalScore: direction * confidence, confidence:confidence*100, signal,
    nearConsensusObi, deepConsensusObi, nearAlignment, deepOnlyRatio, topBookConfirmed,
    tradeFlowBias, microBias, shortMomentum, spreadQuality, scalpScore, scalpAgreement, scalpConfirmed,
    scalpComponents: { book: directionalComponents[0], micro: directionalComponents[1], flow: directionalComponents[2], momentum: directionalComponents[3], spread: spreadQuality, liquidityEcho: directionalEcho },
    spotFuturesDivergence, divergenceMagnitude, divergenceConflict,
    liquidityEchoBias, liquidityEchoScore, liquidityEchoBid: echoBid, liquidityEchoAsk: echoAsk,
    v27: { highConviction: v27HighConviction, regime: v27Sizing.regime.regime, regimeQuality: v27Sizing.regime.quality, sizeMultiplier: v27Sizing.multiplier, targetPct: v27TargetPct, tp1Fraction: V27_TP1_FRACTION, ev: v27Sizing.ev },
    v28: v28Optimizer,
    shortHorizon,
    scalpV2: { direction: v2Direction, signal: v2Signal, score: v2Score, exchangeAgreement, freshExchangeCount: freshRows.length, weightedNearConsensus, flow250: flow250.bias, flow1s: flow1s.bias, flow3s: flow3s.bias, flow5s: flow5s.bias, flowVelocity, consumptionScore, absorptionScore, v2ExecutionOkay, spreadPct: spread*100, slippagePct: slippagePct*100, roundTripCostPct: roundTripCost*100, netEdgePct: netEdge*100, spotFuturesDivergence, divergenceMagnitude, divergenceConflict, freshness: v2Freshness, blockedByAbsorption: v2AbsorptionBlock, binanceNativeDiff: (() => { const s=getBinanceDiffState(cleanSymbol(TRADING_PAIR).toUpperCase()); return { synced:s.synced, lastUpdateId:s.lastUpdateId, gapCount:s.gapCount, resyncCount:s.resyncCount, ageMs:s.lastEventTs ? Date.now()-s.lastEventTs : Infinity }; })() },
    entryReason: signal ? `Short-Horizon ${shortHorizon ? (shortHorizon.targetBps).toFixed(1) : '-'}bps | ${v2Signal ? 'order-flow + liquidity path + flow acceleration' : 'legacy teyit'} | EV edge ${(netEdge*100).toFixed(3)}%` : (divergenceVeto ? 'Scalp v2 engellendi: Spot/Futures divergence' : (v2SpoofRisk >= MICRO_SPOOF_CANCEL_RATIO ? 'Scalp v2 engellendi: spoof/cancel riski' : 'Scalp v2 teyitleri oluşmadı'))
  };
}

function cleanSymbol(pair: string) { return pair.replace('/', '').toLowerCase(); }
function cachedFresh<T>(key: string, ttlMs: number): T | null {
  const c = restCache.get(key);
  return c && Date.now() - c.at <= ttlMs ? c.value as T : null;
}
function setCached(key: string, value: any) { restCache.set(key, { at: Date.now(), value }); }
function getLiveBook(pair: string, market: 'spot' | 'futures') {
  const symbol = pair.replace('/', '').toUpperCase();
  if (market === 'futures') {
    const native = getBinanceFuturesNativeBook(symbol);
    if (native?.bids?.length && native?.asks?.length) return { bids: native.bids, asks: native.asks };
  }
  const key = `${market}:${symbol}`;
  const b = liveBooks.get(key);
  return b && Date.now() - b.ts <= 2500 ? { bids: b.bids, asks: b.asks } : null;
}
function getLivePrice(pair: string) {
  const p = livePrices.get(pair.replace('/', '').toUpperCase());
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
  const futuresStreams = symbols.flatMap(s => [`${s}@aggTrade`]);

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

  // Futures order book: sequence-consistent native diff-depth for the active trading pair.
  // Other Futures symbols remain on aggTrade only to keep the socket lightweight.
  const futuresSym = cleanSymbol(TRADING_PAIR).toUpperCase();
  try {
    const nativeGeneration = generation;
    const ws = new WebSocket(`wss://fstream.binance.com/ws/${futuresSym.toLowerCase()}@depth@100ms`);
    streamSockets.push(ws);
    ws.on('open', () => {
      const state=getBinanceFuturesDiffState(futuresSym);
      state.synced=false; state.buffer.length=0;
      addEngineLog('INFO', `[FUTURES WS] Native diff-depth bağlantısı açıldı (${futuresSym})`);
      void syncBinanceFuturesDiffBook(futuresSym,nativeGeneration);
    });
    ws.on('message', raw => {
      try { handleBinanceFuturesDiff(futuresSym, JSON.parse(raw.toString()), nativeGeneration); } catch {}
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (marketStreamsStarted && nativeGeneration === streamGeneration) {
        setTimeout(() => {
          if (marketStreamsStarted && nativeGeneration === streamGeneration) startMarketDataStreams(true);
        }, 3000);
      }
    });
  } catch {}

  connect('wss://fstream.binance.com', futuresStreams, 'futures');
  marketStreamsStarted = true;
}

function getHardStopPct(leverage: number) {
  // At extreme leverage the hard stop must tighten so liquidation is not reached first.
  return Math.min(getRiskProfile().hardStopPct, 0.60 / Math.max(1, leverage));
}

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
  entry_order_id?: string;
  entry_order_ids?: string[];
  exit_order_id?: string;
  realized_pnl_binance?: number;
  commission_binance?: number;
  funding_binance?: number;
  reconciled_at?: number;
  protective_order_id?: string;
  position_mode?: 'one-way' | 'hedge';
  reference_target_pct?: number;
  reference_price_move_pct?: number;
  adaptive_target_pct?: number;
  adaptive_target_price?: number;
  adaptive_target_reason?: string;
  high_conviction?: boolean;
  tp1_fraction?: number;
  tp1_price?: number;
  runner_target_price?: number;
  runner_exit_reason?: string;
  entry_score?: number;
  entry_regime_quality?: number;
  entry_size_multiplier?: number;
  mfe_pct?: number;
  mae_pct?: number;
  optimizer_tp1_fraction?: number;
  optimizer_runner_trail_pct?: number;
  optimizer_runner_target_pct?: number;
  optimizer_bucket?: string;
}

interface PositionMap {
  entryPrice: number;
  side: Side;
  holdFloorPrice: number;
  holdCeilingPrice: number;
  profitProtectPrice: number;
  targetPrice: number;
  invalidationPrice: number;
  hardStopPrice: number;
  expectedMovePct: number;
  expectedAdversePct: number;
  entryThesis: number;
  entryHorizonScore: number;
  entryTargetBps: number;
  createdAt: number;
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
  tp1Done?: boolean;
  tp1Price?: number;
  runnerTargetPrice?: number;
  runnerFraction?: number;
  highConviction?: boolean;
  entryScore?: number;
  regimeQuality?: number;
  sizeMultiplier?: number;
  peakMfePct?: number;
  optimizerTp1Fraction?: number;
  optimizerRunnerTrailPct?: number;
  optimizerRunnerTargetPct?: number;
  optimizerBucket?: string;
  executionPlan?: ExecutionPlan;
  ladderStep?: number;
  ladderFractions?: number[];
  ladderTargetMargin?: number;
  ladderLastAddAt?: number;
  ladderLastAddPrice?: number;
  ladderLocked?: boolean;
  entryOrderIds?: string[];
  positionMap?: PositionMap;
  lastGuardianAt?: number;
  guardianState?: 'GREEN' | 'YELLOW' | 'RED';
  lastGuardianScore?: number;
  lastGuardianReason?: string;
}

let allTrades: TradeRecord[] = [];
let tradeCounter = 1;
let activePosition: ActivePosition | null = null;
let isProcessingTrade = false;
let startingBalance = 0;

function saveTradingState() {
  try {
    // Privacy/discipline mode: never persist historical trades, optimizer samples,
    // or market history. Only the currently open position is recoverable after restart.
    const payload = { version: 4, savedAt: Date.now(), tradeCounter, activePosition, startingBalance, startingBalanceTimestamp, virtualBalance, dryRun, botState, riskProtectionMode, TRADING_PAIR, targetLeverage };
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  } catch (e: any) { addEngineLog('WARN', `[STATE] Kalıcı durum kaydedilemedi: ${e?.message || e}`); }
}

function loadTradingState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Deliberately ignore legacy allTrades/history from older state files.
    // Only an open position may be restored.
    allTrades = [];
    if (state.activePosition) activePosition = state.activePosition;
    tradeCounter = Math.max(1, safeNum(state.tradeCounter, tradeCounter));
    startingBalance = safeNum(state.startingBalance, startingBalance);
    startingBalanceTimestamp = safeNum(state.startingBalanceTimestamp, startingBalanceTimestamp);
    if (state.virtualBalance !== undefined) virtualBalance = safeNum(state.virtualBalance, virtualBalance);
    if (typeof state.dryRun === 'boolean') dryRun = state.dryRun;
    if (state.botState === 'running' || state.botState === 'stopped') botState = state.botState;
    addEngineLog('INFO', `[STATE] Kalıcı işlem durumu yüklendi | ${allTrades.length} kayıt | ${activePosition ? 'açık pozisyon mevcut' : 'açık pozisyon yok'} | ${dryRun ? 'Paper Trading' : 'Live'}`);
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

  if (!total) total = safeNum(balance?.total?.USDT);
  if (!free) free = safeNum(balance?.free?.USDT);
  if (!used) used = safeNum(balance?.used?.USDT);

  const info = balance?.info;
  if (info) {
    if (Array.isArray(info.assets)) {
      const usdt = info.assets.find((a: any) => a.asset === 'USDT' || a.asset === 'usdt');
      if (usdt) {
        const t = safeNum(usdt.marginBalance) || safeNum(usdt.walletBalance);
        const f = safeNum(usdt.availableBalance) || safeNum(usdt.maxWithdrawAmount);
        if (t > 0) total = t;
        if (f > 0) free = f;
      }
    }
    if (!total) {
      total = safeNum(info.totalMarginBalance) || safeNum(info.totalWalletBalance) || safeNum(info.totalCrossWalletBalance) || safeNum(info.availableBalance);
    }
    if (!free) {
      free = safeNum(info.availableBalance) || safeNum(info.maxWithdrawAmount);
    }
  }

  if (!used && total > free) used = parseFloat((total - free).toFixed(4));
  return { total: safeNum(total), free: safeNum(free), used: Math.max(0, safeNum(used)) };
}

function applyConfig(conf: any) {
  const next = conf || {};
  minCrossExchangeGap = clamp(safeNum(next.eight_exchange?.min_gap_pct, 0.3), 0.05, 50) / 100;
  if (next.dry_run !== undefined) {
    dryRun = Boolean(next.dry_run);
  } else if (!hasPrivateBinanceCredentials()) {
    dryRun = true;
  } else {
    dryRun = false;
  }
  currentStakeAmount = next.stake_amount === 'unlimited'
    ? 0
    : Math.max(0, safeNum(next.stake_amount, 6));
  targetLeverage = Math.max(1, Math.floor(safeNum(next.leverage, 15)));
  algorithmMaxOpenTrades = Math.floor(clamp(safeNum(next.coin_selection?.max_open_trades, 1), 1, 10));
  professionalManualPairs = Array.from(new Set((Array.isArray(next.coin_selection?.professional_manual_pairs) ? next.coin_selection.professional_manual_pairs : []).filter((p:any) => typeof p === 'string' && p.includes('/')).map((p:string) => p.toUpperCase()))).slice(0, 10) as string[];
  if (!professionalManualPairs.length) professionalManualPairs = ['BTC/USDT'];
  algorithmScanAssets = Math.floor(clamp(safeNum(next.coin_selection?.algorithm_scan_assets, 30), 5, 50));
  maxOpenTrades = algorithmMaxOpenTrades;
  coinSelectionMode = next.coin_selection?.mode === 'ai' ? 'ai' : (next.coin_selection?.mode === 'algorithmic' ? 'algorithmic' : 'manual');
  algorithmMinOpportunityScore = clamp(safeNum(next.coin_selection?.min_opportunity_score, 0.40), 0.20, 0.95);
  algorithmMinLiquidityUsdt = Math.max(0, safeNum(next.coin_selection?.min_liquidity_usdt, 200000));
  algorithmMaxSpreadPct = clamp(safeNum(next.coin_selection?.max_spread_pct, 0.20), 0.01, 2);
  tradableBalanceRatio = Math.min(1, Math.max(0.01, safeNum(next.tradable_balance_ratio, 0.99)));
  marginMode = next.margin_mode === 'cross' ? 'cross' : 'isolated';
  takerFeeRate = Math.max(0, safeNum(next.fee_rate, 0.0005));
  const requestedRisk = String(next.risk_protection?.mode || next.risk_protection_mode || 'conservative').toLowerCase();
  riskProtectionMode = (requestedRisk === 'balanced' || requestedRisk === 'aggressive') ? requestedRisk : 'conservative';

  // Single engine only: all legacy modes are ignored and never exposed to the UI.
  tradingMode = 'professional';

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
  simpleModeConfig.enabled = false;

  const im = next.intelligent_mode || {};
  intelligentModeConfig = {
    ...DEFAULT_INTELLIGENT_MODE,
    ...im,
    enabled: false,
    min_edge: clamp(safeNum(im.min_edge, DEFAULT_INTELLIGENT_MODE.min_edge), 0.20, 0.95),
    min_regime_quality: clamp(safeNum(im.min_regime_quality, DEFAULT_INTELLIGENT_MODE.min_regime_quality), 0.20, 0.95),
    min_liquidity_usdt: Math.max(0, safeNum(im.min_liquidity_usdt, DEFAULT_INTELLIGENT_MODE.min_liquidity_usdt)),
    max_spread_pct: clamp(safeNum(im.max_spread_pct, DEFAULT_INTELLIGENT_MODE.max_spread_pct), 0.01, 2),
    lookback_minutes: clamp(safeNum(im.lookback_minutes, DEFAULT_INTELLIGENT_MODE.lookback_minutes), 2, 60),
    abstain_on_conflict: im.abstain_on_conflict === true,
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
    min_long_probability: clamp(safeNum(da.min_long_probability, DEFAULT_DEEP_ANALYSIS.min_long_probability), 0.45, 0.99),
    min_short_probability: clamp(safeNum(da.min_short_probability, DEFAULT_DEEP_ANALYSIS.min_short_probability), 0.45, 0.99),
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

function classifyBinanceAuthError(error: any): string {
  const httpCode = Number(error?.httpCode ?? error?.status ?? error?.response?.status ?? 0);
  const raw = String(error?.message || error?.body || error?.response?.data?.msg || error || 'Bilinmeyen hata');
  let payload: any = null;
  try { payload = typeof error?.body === 'string' ? JSON.parse(error.body) : error?.body; } catch {}
  const code = Number(payload?.code ?? error?.response?.data?.code ?? error?.code);
  const lower = raw.toLowerCase();

  if (httpCode === 451 || /restricted location|restricted location according|unavailable for legal reasons|451/.test(lower)) {
    return "Binance Futures bu sunucunun çıkış IP adresini kısıtlı konum olarak reddetti (HTTP 451). Render'da Frankfurt seçilmiş olsa bile kullanılan gerçek outbound IP ayrıca kontrol edilmelidir.";
  }
  if (httpCode === 403 || /forbidden|waf|security block/.test(lower)) {
    return 'Binance isteği 403 ile reddetti. WAF/IP güvenlik kısıtlaması veya geçici erişim engeli olabilir.';
  }
  if (code === -2015 || /invalid api[- ]?key|rejected_mbx_key|ip|permissions/.test(lower)) {
    return 'API Key geçersiz, IP kısıtlamasıyla eşleşmiyor veya Futures işlem/USER_DATA yetkisi eksik.';
  }
  if (code === -1022 || /invalid signature|signature.*not valid/.test(lower)) {
    return 'API Secret ile imza doğrulanamadı. API Secret yanlış/kesilmiş olabilir.';
  }
  if (code === -1021 || /timestamp.*outside|ahead of server time|recvwindow/.test(lower)) {
    return 'Sunucu saati Binance ile uyuşmuyor. Zaman senkronizasyonu başarısız.';
  }
  if (/testnet|wrong environment/.test(lower)) {
    return 'Testnet API anahtarı ana Binance Futures ortamında kullanılamaz.';
  }
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

async function initExchange(apiKey: string, secret: string): Promise<{ success: boolean; balance_usdt?: number; message?: string; server_ip?: string; diagnostic?: any }> {
  privateExchangeReady = false;
  privateSyncWarningLogged = false;
  if (!apiKey?.trim() || !secret?.trim()) {
    dryRun = true;
    return { success: false, message: 'API Key veya Secret Key eksik.', server_ip: await getOrFetchServerIp() };
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
      dryRun = false;
      if (total > 0 && startingBalance <= 0) { startingBalance = total; startingBalanceTimestamp = Date.now(); }

      addEngineLog('INFO', `Binance USDT-M bağlandı. Futures gerçek cüzdan bakiyesi: ${total.toFixed(2)} USDT | Mod: CANLI (LIVE FUTURES)`);
      return { success: true, balance_usdt: total, server_ip: await getOrFetchServerIp() };
    } catch (e: any) {
      lastError = classifyBinanceAuthError(e);
    }
  }

  const ip = await getOrFetchServerIp();
  addEngineLog('ERROR', `Binance API bağlantı hatası: ${lastError} | Sunucu çıkış IP: ${ip}`);
  return {
    success: false,
    message: lastError,
    server_ip: ip,
    diagnostic: {
      endpoint: 'https://fapi.binance.com',
      server_ip: ip,
      hint: 'Render bölgesi ile outbound IP coğrafi konumu aynı olmak zorunda değildir.'
    }
  };
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
  if (exchange && privateExchangeReady) {
    try {
      const balance = await exchange.fetchBalance({ type: 'future' });
      return await parseUsdtFromBalance(balance);
    } catch (e: any) {
      addEngineLog('WARN', `Binance Futures bakiye sorgusu hatası: ${e?.message || e}`);
    }
  }

  const used = activePosition ? safeNum(activePosition.margin, 0) : 0;
  const total = Math.max(virtualBalance, used);
  const free = Math.max(0, total - used);
  return { total, free, used };
}


function parseBinanceAccountSnapshot(balance: any): { wallet: number; margin: number; available: number; unrealized: number } {
  const info = balance?.info || {};
  const assets = Array.isArray(info?.assets) ? info.assets : [];
  const usdt = assets.find((a: any) => String(a?.asset || '').toUpperCase() === 'USDT') || {};
  const wallet = safeNum(usdt?.walletBalance, safeNum(info?.totalWalletBalance, safeNum(balance?.USDT?.total, safeNum(balance?.total?.USDT))));
  const margin = safeNum(usdt?.marginBalance, safeNum(info?.totalMarginBalance, wallet));
  const available = safeNum(usdt?.availableBalance, safeNum(info?.availableBalance, safeNum(balance?.USDT?.free, safeNum(balance?.free?.USDT))));
  const unrealized = safeNum(usdt?.unrealizedProfit, safeNum(info?.totalUnrealizedProfit, latestBinanceUnrealizedPnl));
  return { wallet, margin, available, unrealized };
}

async function fetchBinanceAccountCashFlowSince(since: number): Promise<number> {
  if (!exchange || typeof (exchange as any).fapiPrivateGetIncome !== 'function' || since <= 0) return 0;
  try {
    const rows = await (exchange as any).fapiPrivateGetIncome({ startTime: since, endTime: Date.now(), limit: 1000 });
    let flow = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const type = ledgerIncomeType(row);
      const amount = ledgerAmount(row);
      if (!Number.isFinite(amount)) continue;
      // Binance income history uses TRANSFER for balance transfers. Do not treat trading income as external cash flow.
      if (type === 'transfer' || type === 'internal_transfer') flow += amount;
    }
    return flow;
  } catch (e: any) {
    addEngineLog('WARN', `[BINANCE RECON] Hesap transfer akışı alınamadı: ${e?.message || e}`);
    return 0;
  }
}

async function syncBinanceAccountReconciliation(force = false) {
  if (dryRun || !exchange || !privateExchangeReady) return;
  const now = Date.now();
  if (!force && now - lastBinanceAccountSync < 10_000) return;
  try {
    const balance = await exchange.fetchBalance({ type: 'future' });
    const snap = parseBinanceAccountSnapshot(balance);
    if (snap.wallet > 0) latestBinanceWalletBalance = snap.wallet;
    if (snap.margin > 0) latestBinanceMarginBalance = snap.margin;
    if (snap.available >= 0) latestBinanceAvailableBalance = snap.available;
    if (snap.unrealized !== 0 || latestBinanceUnrealizedPnl === 0) latestBinanceUnrealizedPnl = snap.unrealized;
    if (startingBalance <= 0 && snap.margin > 0) {
      startingBalance = snap.margin;
      startingBalanceTimestamp = now;
    }
    latestBinanceAccountCashFlow = await fetchBinanceAccountCashFlowSince(startingBalanceTimestamp);
    latestBinanceAccountPnl = (latestBinanceMarginBalance - startingBalance) - latestBinanceAccountCashFlow;
    const components = latestBinanceRealizedPnl - latestBinanceCommission + latestBinanceFunding + latestBinanceUnrealizedPnl;
    latestBinancePnlGap = latestBinanceAccountPnl - components;
    lastBinanceAccountSync = now;
    saveTradingState();
  } catch (e: any) {
    addEngineLog('WARN', `[BINANCE RECON] Hesap özsermaye senkronizasyonu başarısız: ${e?.message || e}`);
  }
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

async function resolveOrderFee(order: any, symbol: string, fallback: number): Promise<number> {
  const direct = safeNum(order?.fee?.cost);
  if (direct > 0) return direct;
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  const feeSum = fees.reduce((sum: number, f: any) => sum + Math.max(0, safeNum(f?.cost)), 0);
  if (feeSum > 0) return feeSum;
  if (order?.id && exchange && typeof exchange.fetchOrder === 'function') {
    try {
      const filled = await exchange.fetchOrder(order.id, symbol);
      const d = safeNum(filled?.fee?.cost);
      if (d > 0) return d;
      const fs = Array.isArray(filled?.fees) ? filled.fees : [];
      const total = fs.reduce((sum: number, f: any) => sum + Math.max(0, safeNum(f?.cost)), 0);
      if (total > 0) return total;
    } catch {}
  }
  return fallback;
}

function makeTradeStats(trade: TradeRecord, currentPrice: number) {
  const priceMove = trade.type === 'long'
    ? (currentPrice - trade.open_rate) / trade.open_rate
    : (trade.open_rate - currentPrice) / trade.open_rate;

  const grossPnl = trade.type === 'long'
    ? (currentPrice - trade.open_rate) * trade.amount
    : (trade.open_rate - currentPrice) * trade.amount;

  const margin = activePosition?.trade_id === trade.trade_id
    ? Math.max(1e-9, safeNum(activePosition.margin))
    : (trade.open_rate * trade.amount) / Math.max(1, trade.leverage);
  const estimatedCloseFee = currentPrice * trade.amount * takerFeeRate;
  // For V2.7 partial exits, trade.profit_abs already contains entry fee and
  // realized partial PNL. Add only the unrealized remainder here.
  const netPnl = safeNum(trade.profit_abs) + grossPnl - estimatedCloseFee;
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
  if (dryRun || !exchange || !privateExchangeReady) {
    return `sim_stop_${Date.now()}`;
  }
  const stopPrice = safeNum(trade.stop_loss_abs);
  if (stopPrice <= 0) return undefined;

  let roundedStop = stopPrice;
  if (typeof exchange.priceToPrecision === 'function') {
    try {
      roundedStop = safeNum(exchange.priceToPrecision(trade.pair, stopPrice), stopPrice);
    } catch {}
  }

  const closeSide = trade.type === 'long' ? 'sell' : 'buy';
  const params = {
    ...orderParams(trade.type, true),
    stopPrice: roundedStop,
    workingType: 'MARK_PRICE'
  };

  try {
    const order = await exchange.createOrder(
      trade.pair,
      'STOP_MARKET',
      closeSide,
      trade.amount,
      undefined,
      params
    );
    return order?.id;
  } catch (err: any) {
    addEngineLog('ERROR', `[RİSK] Koruyucu stop borsa kaydı başarısız: ${err?.message || err}`);
    return undefined;
  }
}

async function updateProtectiveStop(trade: TradeRecord, stopPrice: number) {
  if (!activePosition) return;
  const rounded = exchange && typeof exchange.priceToPrecision === 'function'
    ? safeNum(exchange.priceToPrecision(trade.pair, stopPrice), stopPrice)
    : stopPrice;
  if (rounded <= 0) return;

  const previous = safeNum(trade.stop_loss_abs);
  const improves = trade.type === 'long' ? rounded > previous : rounded < previous;
  if (!improves) return;

  const oldId = activePosition.protectiveOrderId;
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
  if (!dryRun && exchange && privateExchangeReady && oldId && typeof exchange.cancelOrder === 'function' && !oldId.startsWith('sim_') && !oldId.startsWith('fallback_')) {
    try { await exchange.cancelOrder(oldId, trade.pair); }
    catch (e: any) {
      addEngineLog('WARN', `[RİSK] Eski stop iptal edilemedi: ${e?.message || e}`);
    }
  }
  trade.stop_loss_abs = rounded;
  trade.protective_order_id = newId;
  activePosition.protectiveOrderId = newId;
  activePosition.currentStopPrice = rounded;
  addEngineLog('INFO', `[RİSK] ${trade.pair} koruyucu stop güncellendi: ${rounded}`);
  return newId;
}


type ExecutionPlan = {
  side: Side;
  entryPrice: number;
  expectedFill: number;
  fairPrice: number;
  stopPrice: number;
  tp1Price: number;
  runnerTargetPrice: number;
  expectedMovePct: number;
  stopMovePct: number;
  expectedGrossPct: number;
  estimatedRoundTripCostPct: number;
  expectedNetPct: number;
  winProbability: number;
  lossProbability: number;
  expectedValuePct: number;
  riskReward: number;
  fillProbability: number;
  leverage: number;
  reason: string;
  orderBookPnl?: OrderBookPnlAnalysis;
};

type OrderBookPnlAnalysis = {
  notionalUsdt: number;
  quantity: number;
  entryVwap: number;
  currentExitVwap: number;
  immediateNetPnlUsdt: number;
  targetPrice: number;
  targetExitVwap: number;
  targetGrossPnlUsdt: number;
  targetNetPnlUsdt: number;
  stopPrice: number;
  stopExitVwap: number;
  stopNetPnlUsdt: number;
  targetExitDepthPct: number;
  stopExitDepthPct: number;
  pathLiquidityUsdt: number;
  pathLiquidityRatio: number;
  pnlQualityScore: number;
  scenario: { optimisticNetPnlUsdt: number; baseNetPnlUsdt: number; adverseNetPnlUsdt: number; weightedNetPnlUsdt: number; executionProbability: number; whaleImpact: number; absorptionImpact: number; replenishmentImpact: number; queueImpact: number; flowImpact: number; };
  levels: Array<{ movePct: number; price: number; exitVwap: number; netPnlUsdt: number; depthPct: number }>;
};

function simulateBookFill(side: Side, bids: number[][], asks: number[][], notionalUsdt: number) {
  const levels = side === 'long' ? asks : bids;
  let remaining = Math.max(0, notionalUsdt);
  let quote = 0;
  let base = 0;
  for (const [priceRaw, qtyRaw] of levels.slice(0, 80)) {
    const price = safeNum(priceRaw);
    const qty = safeNum(qtyRaw);
    if (price <= 0 || qty <= 0) continue;
    const levelQuote = price * qty;
    const takeQuote = Math.min(remaining, levelQuote);
    const takeQty = takeQuote / price;
    quote += takeQuote;
    base += takeQty;
    remaining -= takeQuote;
    if (remaining <= 1e-9) break;
  }
  if (base <= 0 || quote <= 0) return { filled: false, vwap: 0, slippagePct: 1, depthFilledPct: 0 };
  const top = side === 'long' ? safeNum(asks[0]?.[0]) : safeNum(bids[0]?.[0]);
  const vwap = quote / base;
  const slippagePct = top > 0 ? Math.abs(vwap - top) / top : 1;
  return { filled: remaining <= 1e-9, vwap, slippagePct, depthFilledPct: remaining <= 1e-9 ? 1 : clamp(1 - remaining / Math.max(notionalUsdt, 1), 0, 1) };
}

function simulateBookExit(side: Side, bids: number[][], asks: number[][], quantity: number, referencePrice: number, targetPrice: number) {
  const source = side === 'long' ? bids : asks;
  if (quantity <= 0 || referencePrice <= 0 || targetPrice <= 0) return { filled: false, vwap: 0, depthFilledPct: 0 };
  const scale = targetPrice / referencePrice;
  let remaining = quantity;
  let quote = 0;
  let base = 0;
  for (const [priceRaw, qtyRaw] of source.slice(0, 80)) {
    const price = safeNum(priceRaw) * scale;
    const qty = safeNum(qtyRaw);
    if (price <= 0 || qty <= 0) continue;
    const takeQty = Math.min(remaining, qty);
    quote += takeQty * price;
    base += takeQty;
    remaining -= takeQty;
    if (remaining <= 1e-12) break;
  }
  return { filled: remaining <= 1e-12, vwap: base > 0 ? quote / base : 0, depthFilledPct: clamp(base / quantity, 0, 1) };
}

function bookPathLiquidity(side: Side, bids: number[][], asks: number[][], fromPrice: number, toPrice: number) {
  const source = side === 'long' ? asks : bids;
  const lo = Math.min(fromPrice, toPrice);
  const hi = Math.max(fromPrice, toPrice);
  return source.slice(0, 80).reduce((sum, [pRaw, qRaw]) => {
    const p = safeNum(pRaw), q = safeNum(qRaw);
    if (p <= 0 || q <= 0) return sum;
    const onPath = side === 'long' ? (p >= fromPrice && p <= toPrice) : (p <= fromPrice && p >= toPrice);
    return sum + (onPath ? p * q : 0);
  }, 0);
}

function buildOrderBookPnlAnalysis(side: Side, book: any, entryFill: any, targetPrice: number, stopPrice: number, notionalUsdt: number, executionCostPct: number, analysis: any = {}): OrderBookPnlAnalysis {
  const bids = book.bids || [], asks = book.asks || [];
  const mid = (safeNum(bids[0]?.[0]) + safeNum(asks[0]?.[0])) / 2;
  const qty = safeNum(entryFill?.base);
  const immediate = simulateBookExit(side, bids, asks, qty, mid, mid);
  const target = simulateBookExit(side, bids, asks, qty, mid, targetPrice);
  const stop = simulateBookExit(side, bids, asks, qty, mid, stopPrice);
  const feePct = 2 * takerFeeRate;
  const entry = safeNum(entryFill?.vwap);
  const targetGross = side === 'long' ? (target.vwap-entry)*qty : (entry-target.vwap)*qty;
  const targetNet = targetGross - notionalUsdt*feePct;
  const stopGross = side === 'long' ? (stop.vwap-entry)*qty : (entry-stop.vwap)*qty;
  const stopNet = stopGross - notionalUsdt*feePct;
  const immediateGross = side === 'long' ? (immediate.vwap-entry)*qty : (entry-immediate.vwap)*qty;
  const immediateNet = immediateGross - notionalUsdt*executionCostPct;
  const pathLiquidity = bookPathLiquidity(side, bids, asks, entry, targetPrice);
  const levels = [0.001,0.002,0.003,0.005,0.0075,0.01].map(movePct => {
    const price = side === 'long' ? entry*(1+movePct) : entry*(1-movePct);
    const ex = simulateBookExit(side, bids, asks, qty, mid, price);
    const gross = side === 'long' ? (ex.vwap-entry)*qty : (entry-ex.vwap)*qty;
    return { movePct, price, exitVwap: ex.vwap, netPnlUsdt: gross-notionalUsdt*feePct, depthPct: ex.depthFilledPct };
  });
  const targetEdge = Math.max(0, targetNet);
  const stopRisk = Math.max(0.01, Math.abs(Math.min(0, stopNet)));

  // Microstructure-aware execution realism. These are modifiers of the book simulation,
  // not future-book predictions: they only estimate how likely the displayed liquidity
  // is to remain executable as price travels toward the target.
  const dir = side === 'long' ? 1 : -1;
  const scalp = analysis?.scalpV2 || {};
  const horizon = analysis?.shortHorizon || {};
  const whale = clamp(dir * safeNum(analysis?.whaleScore), -1, 1);
  const absorption = clamp(dir * safeNum(horizon?.absorption?.direction) * safeNum(horizon?.absorption?.strength), -1, 1);
  const replenishment = clamp(dir * safeNum(scalp?.replenishment), -1, 1);
  const queue = clamp(dir * safeNum(scalp?.queueDepletion), -1, 1);
  const flow = clamp(dir * safeNum(scalp?.flow1s), -1, 1);
  const consumption = clamp(dir * safeNum(scalp?.consumptionScore), -1, 1);
  const executionProbability = clamp(
    0.50 + 0.14*whale + 0.14*absorption + 0.12*replenishment + 0.12*queue + 0.18*flow + 0.10*consumption,
    0.05, 0.95
  );
  // Scenario haircut/boost is deliberately bounded. It cannot create PnL that is not
  // present in the book simulation; it only changes the probability-weighted usability.
  const adverseFactor = clamp(0.58 + 0.22*(1-executionProbability), 0.55, 0.82);
  const optimisticFactor = clamp(1.02 + 0.10*executionProbability, 1.02, 1.12);
  const optimisticNetPnlUsdt = targetNet * optimisticFactor;
  const baseNetPnlUsdt = targetNet;
  const adverseNetPnlUsdt = targetNet * adverseFactor;
  const weightedNetPnlUsdt = executionProbability * baseNetPnlUsdt + (1-executionProbability) * adverseNetPnlUsdt;
  const depthQuality = target.depthFilledPct * 0.40 + stop.depthFilledPct * 0.10 + clamp(pathLiquidity / Math.max(notionalUsdt,1),0,3)/3 * 0.30 + executionProbability * 0.20;
  const rrQuality = clamp(targetEdge / stopRisk, 0, 3) / 3;
  const pnlQualityScore = Math.round(clamp(100*(0.50*rrQuality + 0.30*depthQuality + 0.20*executionProbability),0,1));
  return {
    notionalUsdt, quantity: qty, entryVwap: entry, currentExitVwap: immediate.vwap,
    immediateNetPnlUsdt: immediateNet, targetPrice, targetExitVwap: target.vwap,
    targetGrossPnlUsdt: targetGross, targetNetPnlUsdt: targetNet, stopPrice, stopExitVwap: stop.vwap,
    stopNetPnlUsdt: stopNet, targetExitDepthPct: target.depthFilledPct, stopExitDepthPct: stop.depthFilledPct,
    pathLiquidityUsdt: pathLiquidity, pathLiquidityRatio: pathLiquidity/Math.max(notionalUsdt,1), pnlQualityScore,
    scenario: { optimisticNetPnlUsdt, baseNetPnlUsdt, adverseNetPnlUsdt, weightedNetPnlUsdt, executionProbability, whaleImpact: whale, absorptionImpact: absorption, replenishmentImpact: replenishment, queueImpact: queue, flowImpact: flow },
    levels
  };
}

function buildLiveExecutionPlan(side: Side, analysis: any, margin: number, leverage: number): ExecutionPlan | null {
  const book = getLiveBook(side === 'long' || side === 'short' ? TRADING_PAIR : TRADING_PAIR, 'futures');
  if (!book?.bids?.length || !book?.asks?.length) return null;
  const bid = safeNum(book.bids[0]?.[0]);
  const ask = safeNum(book.asks[0]?.[0]);
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  const notional = Math.max(50, margin * Math.max(1, leverage));
  const fill = simulateBookFill(side, book.bids, book.asks, notional);
  if (!fill.filled) return null;

  const score = clamp(safeNum(analysis?.scalpV2?.score), 0, 1);
  const agreement = clamp(safeNum(analysis?.scalpV2?.exchangeAgreement), 0, 1);
  const flow = clamp(Math.abs(safeNum(analysis?.scalpV2?.flow1s)), 0, 1);
  const consumption = clamp(Math.abs(safeNum(analysis?.scalpV2?.consumptionScore)), 0, 1);
  const crossGap = clamp(Math.abs(safeNum(analysis?.binanceVsMedianPct)) / 100, 0, 0.02);
  const spread = clamp((ask - bid) / mid, 0, 0.01);
  const executionCost = 2 * takerFeeRate + spread + fill.slippagePct;

  // Live-only fair-value projection: derived from current microstructure, never trained on history.
  const horizon = analysis?.shortHorizon;
  const horizonAligned = horizon && horizon.direction === side && horizon.qualifies;
  const edgeStrength = clamp(
    0.30 * score + 0.14 * agreement + 0.12 * flow + 0.10 * consumption + 0.34 * safeNum(horizon?.score) ,
    0, 1
  );
  if (!horizonAligned) return null;
  const expectedMovePct = clamp(Math.min(0.010, Math.max(0.0015, safeNum(horizon.expectedMovePct, 0.0025))), 0.0015, 0.010);
  const direction = side === 'long' ? 1 : -1;
  const fairPrice = mid * (1 + direction * expectedMovePct);
  const expectedFill = fill.vwap;
  const expectedGrossPct = side === 'long'
    ? (fairPrice - expectedFill) / expectedFill
    : (expectedFill - fairPrice) / expectedFill;

  const stopMovePct = clamp(
    0.0018 + (1 - score) * 0.0040 + spread * 1.5,
    0.0018,
    Math.min(0.008, getHardStopPct(leverage))
  );
  const stopPrice = side === 'long' ? expectedFill * (1 - stopMovePct) : expectedFill * (1 + stopMovePct);
  const tp1MovePct = clamp(expectedMovePct * 0.48, 0.0018, 0.009);
  const tp1Price = side === 'long' ? expectedFill * (1 + tp1MovePct) : expectedFill * (1 - tp1MovePct);
  const runnerTargetPrice = side === 'long' ? expectedFill * (1 + expectedMovePct) : expectedFill * (1 - expectedMovePct);

  // Analytical confidence is intentionally conservative: it is a model confidence score,
  // not a claim of statistically calibrated historical win probability.
  const agreementFactor = 0.50 + 0.50 * agreement;
  const qualityFactor = 0.55 + 0.45 * clamp(edgeStrength, 0, 1);
  const costFactor = clamp(1 - executionCost / Math.max(expectedGrossPct, 0.0001), 0, 1);
  const winProbability = clamp(0.50 + 0.46 * edgeStrength * agreementFactor * qualityFactor * (0.65 + 0.35 * costFactor), 0.50, 0.94);
  const lossProbability = 1 - winProbability;
  const expectedLossPct = stopMovePct + executionCost;
  const expectedNetPct = expectedGrossPct - executionCost;
  const orderBookPnl = buildOrderBookPnlAnalysis(side, book, fill, runnerTargetPrice, stopPrice, notional, executionCost, analysis);
  const bookExecutableNetPct = orderBookPnl.scenario.weightedNetPnlUsdt / Math.max(notional, 1);
  const expectedNetPctAdjusted = 0.55 * expectedNetPct + 0.45 * bookExecutableNetPct;
  const expectedValuePct = winProbability * expectedNetPctAdjusted - lossProbability * expectedLossPct;
  const riskReward = expectedLossPct > 0 ? expectedNetPctAdjusted / expectedLossPct : 0;

  const minimumEdge = Math.max(0.0008, executionCost * 1.8);
  if (expectedNetPct <= minimumEdge || expectedValuePct <= Math.max(0.0003, executionCost * 0.35)) return null;
  if (winProbability < 0.62 || agreement < 0.62 || score < SCALP_V2_MIN_SCORE) return null;

  return {
    side, entryPrice: expectedFill, expectedFill, fairPrice, stopPrice, tp1Price, runnerTargetPrice,
    expectedMovePct, stopMovePct, expectedGrossPct, estimatedRoundTripCostPct: executionCost,
    expectedNetPct: expectedNetPctAdjusted, winProbability, lossProbability, expectedValuePct, riskReward,
    fillProbability: fill.depthFilledPct, leverage, orderBookPnl,
    reason: `Canlı EV + 0-5s Path | ~${safeNum(horizon?.timeToTargetMs,0)}ms | P ${(winProbability*100).toFixed(1)}% | net ${(expectedNetPctAdjusted*100).toFixed(3)}% | EV ${(expectedValuePct*100).toFixed(3)}% | maliyet ${(executionCost*100).toFixed(3)}%`
  };
}

async function openPosition(side: Side, symbol: string, requestedMargin?: number, adaptiveTargetPct?: number, adaptiveTargetReason?: string, requestedLeverage?: number) {
  const price = await getCurrentPrice(symbol);
  if (price <= 0) throw new Error('Geçerli Futures fiyatı alınamadı.');

  const targetPct = clamp(safeNum(adaptiveTargetPct, 0.008), 0.0025, 0.02);
  const targetReason = adaptiveTargetReason || 'Canlı matematiksel hedef';
  const leverage = Math.max(1, Math.floor(safeNum(requestedLeverage, targetLeverage || 1)));

  const isLive = !dryRun && exchange && privateExchangeReady;
  const { free } = await getFuturesBalance();
  const availableMargin = free > 0 ? free : 100;
  const configuredMargin = requestedMargin !== undefined ? Math.max(0, requestedMargin) : currentStakeAmount;
  const marginCap = availableMargin * tradableBalanceRatio;
  let margin = configuredMargin > 0 ? Math.min(configuredMargin, marginCap) : marginCap;

  if (margin <= 0) throw new Error(`Yeterli kullanılabilir USDT yok. Bakiye: ${free.toFixed(2)} USDT.`);

  const prePlan = buildLiveExecutionPlan(side, { ...latestMetrics }, margin, leverage);
  if (prePlan) {
    adaptiveTargetPct = prePlan.expectedMovePct;
    // Keep the requested leverage, but shrink margin so the maximum planned stop
    // loss is capped at 0.5% of available account equity.
    const riskMarginCap = availableMargin * MAX_ACCOUNT_RISK_PER_TRADE / Math.max(prePlan.stopMovePct * leverage, 0.0001);
    margin = Math.min(margin, riskMarginCap);
  }

  let activeLev = leverage;
  if (isLive) {
    activeLev = await setRiskParameters(symbol, leverage);
  }

  const livePlan = buildLiveExecutionPlan(side, latestMetrics || {}, margin, activeLev);
  if (!livePlan) throw new Error('Matematiksel giriş kapısı reddetti: net edge / EV / likidite / maliyet eşiği karşılanmadı.');
  const finalTargetPct = livePlan?.expectedMovePct || targetPct;
  const rawAmount = (margin * activeLev) / price;
  let amount = 0;
  if (exchange && typeof exchange.amountToPrecision === 'function') {
    try {
      amount = safeNum(exchange.amountToPrecision(symbol, rawAmount));
    } catch {}
  }
  if (amount <= 0) {
    amount = parseFloat(rawAmount.toFixed(symbol.includes('BTC') ? 3 : symbol.includes('ETH') ? 2 : 1));
  }
  if (amount <= 0) {
    amount = rawAmount > 0.0001 ? parseFloat(rawAmount.toFixed(6)) : 0.001;
  }

  let order: any = null;
  let fillPrice = price;

  if (isLive) {
    const liveBook = getLiveBook(symbol, 'futures');
    const bestBid = safeNum(liveBook?.bids?.[0]?.[0], price);
    const bestAsk = safeNum(liveBook?.asks?.[0]?.[0], price);
    const planPrice = livePlan?.fairPrice || price;
    // IOC limit: execute immediately only if the price remains inside the
    // mathematically approved zone. If it cannot fill, cancel and do not chase.
    let limitPrice = side === 'long'
      ? Math.min(planPrice * (1 - Math.max(livePlan?.estimatedRoundTripCostPct || 0, 0)), bestAsk * (1 + ENTRY_LIMIT_BUFFER_PCT))
      : Math.max(planPrice * (1 + Math.max(livePlan?.estimatedRoundTripCostPct || 0, 0)), bestBid * (1 - ENTRY_LIMIT_BUFFER_PCT));
    if (typeof exchange.priceToPrecision === 'function') {
      try { limitPrice = safeNum(exchange.priceToPrecision(symbol, limitPrice), limitPrice); } catch {}
    }
    order = side === 'long'
      ? await exchange.createOrder(symbol, 'limit', 'buy', amount, limitPrice, { ...orderParams(side), timeInForce: 'IOC' })
      : await exchange.createOrder(symbol, 'limit', 'sell', amount, limitPrice, { ...orderParams(side), timeInForce: 'IOC' });
    const filledAmount = safeNum(order?.filled);
    if (filledAmount <= 0) throw new Error('IOC giriş emri dolmadı; matematiksel giriş avantajı korunarak işlem iptal edildi.');
    amount = filledAmount;
    fillPrice = await resolveOrderPrice(order, symbol, price);
  } else {
    order = { id: `paper_${Date.now()}` };
    fillPrice = price;
  }

  const actualMargin = (fillPrice * amount) / Math.max(1, activeLev);
  const feeOpen = isLive ? await resolveOrderFee(order, symbol, fillPrice * amount * takerFeeRate) : fillPrice * amount * takerFeeRate;

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
    stop_loss_abs: livePlan ? livePlan.stopPrice : (side === 'long'
      ? fillPrice * (1 - getHardStopPct(activeLev))
      : fillPrice * (1 + getHardStopPct(activeLev))),
    stop_loss_pct: -getHardStopPct(activeLev) * activeLev * 100,
    take_profit_abs: livePlan?.runnerTargetPrice || (side === 'long' ? fillPrice * (1 + finalTargetPct) : fillPrice * (1 - finalTargetPct)),
    take_profit_pct: finalTargetPct * 100,
    reference_target_pct: finalTargetPct * 100,
    adaptive_target_pct: finalTargetPct,
    adaptive_target_price: livePlan?.runnerTargetPrice || (side === 'long' ? fillPrice * (1 + finalTargetPct) : fillPrice * (1 - finalTargetPct)),
    adaptive_target_reason: targetReason,
    fee_open: feeOpen,
    fee_close: 0,
    exchange_order_id: order?.id,
    entry_order_id: order?.id,
    position_mode: hedgeMode ? 'hedge' : 'one-way'
  };

  trade.protective_order_id = await placeProtectiveStop(trade);
  if (isLive && !trade.protective_order_id) {
    // Never leave a live Futures position without an exchange-side protective order.
    try {
      const emergency = side === 'long'
        ? await exchange.createMarketSellOrder(symbol, amount, undefined, orderParams(side, true))
        : await exchange.createMarketBuyOrder(symbol, amount, undefined, orderParams(side, true));
      addEngineLog('ERROR', `[GÜVENLİK] Stop kurulamadı; yeni pozisyon acil olarak kapatıldı (${emergency?.id || 'unknown'}).`);
    } catch (closeErr: any) {
      addEngineLog('ERROR', `[KRİTİK GÜVENLİK] Stop kurulamadı ve acil kapatma başarısız: ${closeErr?.message || closeErr}`);
    }
    throw new Error('Borsa üzerinde koruyucu stop oluşturulamadığı için canlı işlem açılmadı.');
  }
  if (!trade.protective_order_id) trade.protective_order_id = `local_stop_${Date.now()}`;

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
    adaptiveTargetPct: finalTargetPct,
    executionPlan: livePlan || undefined,
    ladderStep: coinSelectionMode === 'ai' ? 1 : 3,
    ladderFractions: coinSelectionMode === 'ai' ? [0.40, 0.30, 0.30] : undefined,
    ladderTargetMargin: coinSelectionMode === 'ai' ? margin : undefined,
    ladderLastAddAt: 0,
    ladderLastAddPrice: fillPrice,
    ladderLocked: false,
    entryOrderIds: order?.id ? [String(order.id)] : []
  };
  activePosition.positionMap = buildPositionMap(trade, activePosition, latestMetrics || {});

  saveTradingState();
  const modeTag = isLive ? '[LIVE BINANCE]' : '[PAPER TRADING]';
  addEngineLog('TRADE', `${modeTag} ${side.toUpperCase()} ${symbol} açıldı | ${amount} adet @ $${fillPrice.toFixed(2)} | ${activeLev}x | Hedef ${(finalTargetPct * 100).toFixed(3)}% | ${livePlan?.reason || 'paper'} | Order ID: ${order?.id || '-'}`);
  return trade;
}

async function addAiLadderPosition(side: Side, symbol: string, analysis: any): Promise<boolean> {
  if (coinSelectionMode !== 'ai' || !activePosition) return false;
  if (activePosition.type !== side || activePosition.ladderLocked) return false;
  const trade = allTrades.find(t => t.trade_id === activePosition?.trade_id && t.is_open);
  if (!trade) return false;
  const step = Math.max(1, Math.floor(safeNum(activePosition.ladderStep, 1)));
  const fractions = Array.isArray(activePosition.ladderFractions) && activePosition.ladderFractions.length === 3 ? activePosition.ladderFractions : [0.40,0.30,0.30];
  if (step >= fractions.length) return false;

  const ai = buildAiDecision(analysis);
  if (!ai.eligible || ai.side !== side) return false;
  // Never average down. A new ladder leg is allowed only after the market confirms
  // the existing thesis in the profitable direction.
  const price = safeNum(analysis?.currentPrice) || await getCurrentPrice(symbol);
  if (price <= 0) return false;
  const favorableMove = side === 'long' ? (price - trade.open_rate) / trade.open_rate : (trade.open_rate - price) / trade.open_rate;
  const minConfirmMove = step === 1 ? 0.0015 : 0.0025;
  const whaleSupport = safeNum(ai.whaleSupport);
  const minWhale = step === 1 ? 0.60 : 0.68;
  if (favorableMove < minConfirmMove || whaleSupport < minWhale) return false;
  if (safeNum(activePosition.ladderLastAddAt) > 0 && Date.now() - safeNum(activePosition.ladderLastAddAt) < 12000) return false;

  const plan = await buildAiPositionPlan(analysis, side);
  if (!plan) return false;
  const targetMargin = Math.max(1, safeNum(plan.targetMargin, plan.margin));
  const desiredCumulative = targetMargin * fractions.slice(0, step + 1).reduce((a,b)=>a+b,0);
  const currentMargin = Math.max(0, safeNum(activePosition.margin));
  const addMargin = Math.max(0, desiredCumulative - currentMargin);
  if (addMargin < 1 || desiredCumulative <= currentMargin + 0.01) return false;

  const profile = getRiskProfile();
  const { free } = await getFuturesBalance();
  const available = Math.max(0, safeNum(free, latestBinanceAvailableBalance || virtualBalance || 0));
  const cappedAddMargin = Math.min(addMargin, available * profile.maxMarginRatio, Math.max(0, targetMargin - currentMargin));
  if (cappedAddMargin < 1) return false;

  const isLive = !dryRun && exchange && privateExchangeReady;
  const leverage = Math.max(1, Math.min(profile.maxLeverage, Math.floor(safeNum(activePosition.leverage, plan.leverage))));
  const rawAmount = (cappedAddMargin * leverage) / price;
  let amount = 0;
  try { amount = exchange && typeof exchange.amountToPrecision === 'function' ? safeNum(exchange.amountToPrecision(symbol, rawAmount)) : rawAmount; } catch { amount = rawAmount; }
  if (amount <= 0) return false;

  let order:any = null;
  let fillPrice = price;
  if (isLive) {
    const liveBook = getLiveBook(symbol, 'futures');
    const bestBid = safeNum(liveBook?.bids?.[0]?.[0], price);
    const bestAsk = safeNum(liveBook?.asks?.[0]?.[0], price);
    const fair = safeNum(plan?.margin) > 0 ? safeNum(analysis?.currentPrice, price) : price;
    let limitPrice = side === 'long' ? Math.min(fair, bestAsk * (1 + ENTRY_LIMIT_BUFFER_PCT)) : Math.max(fair, bestBid * (1 - ENTRY_LIMIT_BUFFER_PCT));
    try { if (typeof exchange.priceToPrecision === 'function') limitPrice = safeNum(exchange.priceToPrecision(symbol, limitPrice), limitPrice); } catch {}
    order = side === 'long'
      ? await exchange.createOrder(symbol, 'limit', 'buy', amount, limitPrice, { ...orderParams(side), timeInForce: 'IOC' })
      : await exchange.createOrder(symbol, 'limit', 'sell', amount, limitPrice, { ...orderParams(side), timeInForce: 'IOC' });
    if (safeNum(order?.filled) <= 0) return false;
    amount = safeNum(order.filled, amount);
    fillPrice = await resolveOrderPrice(order, symbol, price);
  } else {
    order = { id: `paper_ladder_${Date.now()}` };
  }

  const fee = isLive ? await resolveOrderFee(order, symbol, fillPrice * amount * takerFeeRate) : fillPrice * amount * takerFeeRate;
  const oldAmount = safeNum(trade.amount);
  const newAmount = oldAmount + amount;
  const oldNotional = safeNum(trade.open_rate) * oldAmount;
  trade.open_rate = newAmount > 0 ? (oldNotional + fillPrice * amount) / newAmount : fillPrice;
  trade.amount = newAmount;
  trade.profit_abs = safeNum(trade.profit_abs) - fee;
  trade.fee_open = safeNum(trade.fee_open) + fee;
  trade.leverage = leverage;
  if (!trade.entry_order_ids) trade.entry_order_ids = [];
  if (order?.id) trade.entry_order_ids.push(String(order.id));
  trade.entry_order_id = trade.entry_order_ids[0] || trade.entry_order_id;

  activePosition.amount = newAmount;
  activePosition.entryPrice = trade.open_rate;
  activePosition.margin = currentMargin + (fillPrice * amount) / Math.max(1, leverage);
  activePosition.leverage = leverage;
  activePosition.feeOpen = safeNum(activePosition.feeOpen) + fee;
  activePosition.ladderStep = step + 1;
  activePosition.ladderLastAddAt = Date.now();
  activePosition.ladderLastAddPrice = fillPrice;
  activePosition.ladderTargetMargin = targetMargin;
  activePosition.executionPlan = buildLiveExecutionPlan(side, analysis, activePosition.margin, leverage) || activePosition.executionPlan;

  // Re-anchor protection to the new weighted average. The stop may only tighten;
  // if exchange replacement fails, the previous protective stop remains active.
  const newPlan = activePosition.executionPlan;
  if (newPlan?.stopPrice) {
    const oldStop = safeNum(activePosition.currentStopPrice, trade.stop_loss_abs || newPlan.stopPrice);
    const candidate = newPlan.stopPrice;
    const tighter = side === 'long' ? candidate > oldStop : candidate < oldStop;
    if (tighter) {
      try {
        if (activePosition.protectiveOrderId && isLive && typeof exchange.cancelOrder === 'function' && !String(activePosition.protectiveOrderId).startsWith('local_')) {
          try { await exchange.cancelOrder(activePosition.protectiveOrderId, symbol); } catch {}
        }
        trade.stop_loss_abs = candidate;
        activePosition.currentStopPrice = candidate;
        const stopId = await placeProtectiveStop(trade);
        if (stopId) activePosition.protectiveOrderId = stopId;
      } catch (e:any) {
        addEngineLog('WARN', `[AI KADEME] Yeni stop kurulamadı; mevcut koruma korunuyor | ${e?.message || e}`);
      }
    }
  }
  saveTradingState();
  addEngineLog('TRADE', `[AI KADEME ${step + 1}/3] ${side.toUpperCase()} ${symbol} | +${amount.toFixed(6)} adet @ $${fillPrice.toFixed(2)} | toplam marjin ${activePosition.margin.toFixed(2)} USDT | whale ${(whaleSupport*100).toFixed(0)}% | teyit ${(favorableMove*100).toFixed(2)}%`);
  return true;
}

async function closeActivePosition(reason: string) {
  if (!activePosition) return null;

  const position = activePosition;
  const trade = allTrades.find(t => t.trade_id === position.trade_id);
  if (!trade) {
    activePosition = null;
    return null;
  }

  let currentPrice = await getCurrentPrice(trade.pair);
  let closeOrder: any = null;
  const isLive = !dryRun && exchange && privateExchangeReady;

  if (isLive) {
    try {
      if (position.protectiveOrderId && typeof exchange.cancelOrder === 'function' && !position.protectiveOrderId.startsWith('sim_') && !position.protectiveOrderId.startsWith('local_')) {
        try { await exchange.cancelOrder(position.protectiveOrderId, trade.pair); } catch {}
      }
      closeOrder = trade.type === 'long'
        ? await exchange.createMarketSellOrder(trade.pair, trade.amount, undefined, orderParams(trade.type, true))
        : await exchange.createMarketBuyOrder(trade.pair, trade.amount, undefined, orderParams(trade.type, true));
      let closeFilled = safeNum(closeOrder?.filled);
      if (closeFilled <= 0 && closeOrder?.id && typeof exchange.fetchOrder === 'function') {
        try {
          const confirmed = await exchange.fetchOrder(closeOrder.id, trade.pair);
          closeOrder = confirmed || closeOrder;
          closeFilled = safeNum(closeOrder?.filled);
        } catch {}
      }
      if (closeFilled <= 0) {
        addEngineLog('ERROR', `[GÜVENLİK] Kapatma emri gönderildi ancak dolum doğrulanamadı: ${closeOrder?.id || 'unknown'}`);
        saveTradingState();
        return null;
      }
      currentPrice = await resolveOrderPrice(closeOrder, trade.pair, currentPrice);
    } catch (err: any) {
      addEngineLog('ERROR', `[GÜVENLİK] Borsa kapatma emri başarısız: ${err?.message}.`);
      saveTradingState();
      return null;
    }
  } else {
    closeOrder = { id: `paper_close_${Date.now()}` };
  }

  const grossPnl = trade.type === 'long'
    ? (currentPrice - trade.open_rate) * trade.amount
    : (trade.open_rate - currentPrice) * trade.amount;
  const feeClose = isLive ? await resolveOrderFee(closeOrder, trade.pair, currentPrice * trade.amount * takerFeeRate) : currentPrice * trade.amount * takerFeeRate;
  // profit_abs already contains the entry fee and any prior partial exits.
  // Only add the remaining leg's gross PNL and its closing fee here, otherwise
  // a TP1 partial would be double-counted.
  const cumulativePnl = safeNum(trade.profit_abs) + grossPnl - feeClose;
  const margin = activePosition ? Math.max(1e-9, safeNum(activePosition.margin)) : (trade.open_rate * trade.amount) / Math.max(1, trade.leverage);
  const roi = margin > 0 ? cumulativePnl / margin : 0;

  trade.is_open = false;
  trade.close_rate = currentPrice;
  trade.close_date = Date.now();
  trade.profit_abs = cumulativePnl;
  trade.profit_ratio = roi;
  trade.fee_close = feeClose;
  trade.exit_reason = reason;
  trade.exit_order_id = closeOrder?.id || trade.exit_order_id;
  trade.exchange_order_id = closeOrder?.id || trade.exchange_order_id;

  if (dryRun) {
    virtualBalance = Math.max(10, virtualBalance + cumulativePnl);
  }

  activePosition = null;
  const finalPnl = safeNum(trade.profit_abs, cumulativePnl);
  const finalRoi = safeNum(trade.profit_ratio, roi);
  const modeTag = isLive ? '[LIVE ÇIKIŞ]' : '[PAPER ÇIKIŞ]';
  addEngineLog('TRADE', `${modeTag} ${trade.pair} ${trade.type.toUpperCase()} kapandı @ $${currentPrice.toFixed(2)} | net K/Z: ${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(2)} USDT (${(finalRoi * 100).toFixed(2)}%) | ${reason}`);
  // Closed trade data is discarded immediately; only the live position is retained.
  allTrades = allTrades.filter(t => t.trade_id !== trade.trade_id);
  saveTradingState();
  return trade;
}


function ledgerIncomeType(row: any): string {
  return String(row?.type || row?.incomeType || row?.info?.incomeType || row?.info?.type || '').toLowerCase();
}

function ledgerAmount(row: any): number {
  return safeNum(row?.amount, safeNum(row?.info?.income, safeNum(row?.info?.amount)));
}

async function fetchBinanceUserTradesForWindow(symbol: string, since: number, until: number): Promise<any[]> {
  if (!exchange || typeof exchange.fetchMyTrades !== 'function') return [];
  try {
    const rows = await exchange.fetchMyTrades(symbol, Math.max(0, since - 60_000), 1000);
    return (Array.isArray(rows) ? rows : []).filter((r: any) => {
      const ts = safeNum(r?.timestamp, safeNum(r?.info?.time));
      return !ts || (ts >= since - 60_000 && ts <= until + 60_000);
    });
  } catch (e: any) {
    addEngineLog('WARN', `[BINANCE RECON] userTrades alınamadı (${symbol}): ${e?.message || e}`);
    return [];
  }
}

async function fetchBinanceIncomeForWindow(symbol: string, since: number, until: number): Promise<any[]> {
  if (!exchange) return [];
  const startTime = Math.max(0, since - 60_000);
  const endTime = Math.min(Date.now(), until + 60_000);
  const symbolClean = symbol.replace('/', '').toUpperCase();

  try {
    if (typeof exchange.fetchLedger === 'function') {
      const rows = await exchange.fetchLedger('USDT', startTime, 1000, { symbol });
      const filtered = (Array.isArray(rows) ? rows : []).filter((r: any) => {
        const ts = safeNum(r?.timestamp, safeNum(r?.info?.time));
        const rowSymbol = String(r?.symbol || r?.info?.symbol || '');
        return (!ts || (ts >= startTime && ts <= endTime)) && (!rowSymbol || rowSymbol === symbol || rowSymbol === symbolClean);
      });
      if (filtered.length) return filtered;
    }
  } catch (e: any) {
    addEngineLog('WARN', `[BINANCE RECON] CCXT ledger alınamadı (${symbol}): ${e?.message || e}`);
  }

  // CCXT Binance USDM exposes the signed income endpoint as fapiPrivateGetIncome.
  // Keep this as a fallback because some CCXT versions do not map fetchLedger for Futures income.
  try {
    const rawMethod = (exchange as any).fapiPrivateGetIncome;
    if (typeof rawMethod === 'function') {
      const rows = await rawMethod.call(exchange, {
        symbol: symbolClean,
        incomeType: undefined,
        startTime,
        endTime,
        limit: 1000
      });
      return Array.isArray(rows) ? rows : [];
    }
  } catch (e: any) {
    addEngineLog('WARN', `[BINANCE RECON] Futures income endpoint alınamadı (${symbol}): ${e?.message || e}`);
  }
  return [];
}

async function reconcileBinanceTrade(trade: TradeRecord): Promise<boolean> {
  if (!exchange || !privateExchangeReady || trade.is_open || !trade.open_date || !trade.close_date) return false;
  const until = Math.max(trade.close_date, trade.open_date);
  const userTrades = await fetchBinanceUserTradesForWindow(trade.pair, trade.open_date, until);
  const income = await fetchBinanceIncomeForWindow(trade.pair, trade.open_date, until);

  let realized = 0;
  let commission = 0;
  let funding = 0;
  let matched = 0;
  const entryId = String(trade.entry_order_id || '');
  const exitId = String(trade.exit_order_id || trade.exchange_order_id || '');

  for (const row of userTrades) {
    const orderId = String(row?.order || row?.info?.orderId || '');
    const ts = safeNum(row?.timestamp, safeNum(row?.info?.time));
    if (ts && (ts < trade.open_date - 60_000 || ts > until + 60_000)) continue;
    if (entryId && orderId && orderId === entryId) {
      // Entry commission is retained separately below; realized PnL is normally zero.
    }
    const rp = safeNum(row?.info?.realizedPnl, safeNum(row?.realizedPnl));
    const fee = Math.abs(safeNum(row?.fee?.cost, safeNum(row?.info?.commission)));
    if (Number.isFinite(rp)) realized += rp;
    if (fee > 0) commission += fee;
    if ((exitId && orderId === exitId) || rp !== 0) matched++;
  }

  for (const row of income) {
    const type = ledgerIncomeType(row);
    const amount = ledgerAmount(row);
    if (!Number.isFinite(amount)) continue;
    if (type.includes('funding')) funding += amount;
    else if (type.includes('commission')) {
      // Commission income rows are usually negative on Binance. Store cost as positive.
      commission += Math.abs(amount);
    } else if (type.includes('realized')) {
      // If userTrades omitted realizedPnl, income history supplies the authoritative value.
      if (Math.abs(realized) < 1e-12) realized += amount;
    }
  }

  if (!matched && Math.abs(realized) < 1e-12 && commission <= 0 && Math.abs(funding) < 1e-12) return false;

  // Avoid double-counting entry commission when userTrades contains it and income history also contains it.
  // Binance userTrades commission is authoritative for fills; income commission is only used when no fill fee exists.
  const fillCommission = userTrades.reduce((sum: number, row: any) => sum + Math.abs(safeNum(row?.fee?.cost, safeNum(row?.info?.commission))), 0);
  if (fillCommission > 0) commission = fillCommission;

  const net = realized - commission + funding;
  trade.realized_pnl_binance = realized;
  trade.commission_binance = commission;
  trade.funding_binance = funding;
  trade.profit_abs = net;
  const margin = (trade.open_rate * trade.amount) / Math.max(1, trade.leverage);
  trade.profit_ratio = margin > 0 ? net / margin : 0;
  trade.fee_open = trade.fee_open || 0;
  trade.fee_close = Math.max(0, commission - safeNum(trade.fee_open));
  trade.reconciled_at = Date.now();
  return true;
}

async function reconcileBinanceTradeHistory(force = false) {
  if (dryRun || !exchange || !privateExchangeReady) return;
  const now = Date.now();
  if (!force && now - lastBinanceLedgerSync < 15_000) return;
  lastBinanceLedgerSync = now;

  const candidates = allTrades.filter(t => !t.is_open && t.close_date && (now - t.close_date) < 7 * 24 * 60 * 60 * 1000);
  for (const trade of candidates.slice(0, 20)) {
    try { await reconcileBinanceTrade(trade); } catch (e: any) {
      addEngineLog('WARN', `[BINANCE RECON] ${trade.pair} #${trade.trade_id}: ${e?.message || e}`);
    }
  }
  latestBinanceRealizedPnl = allTrades.filter(t => !t.is_open).reduce((sum, t) => sum + safeNum(t.realized_pnl_binance), 0);
  latestBinanceCommission = allTrades.filter(t => !t.is_open).reduce((sum, t) => sum + safeNum(t.commission_binance), 0);
  latestBinanceFunding = allTrades.filter(t => !t.is_open).reduce((sum, t) => sum + safeNum(t.funding_binance), 0);
  saveTradingState();
}

function buildPositionMap(trade: TradeRecord, position: ActivePosition, analysis: any): PositionMap {
  const side = trade.type;
  const dir = side === 'long' ? 1 : -1;
  const horizon = analysis?.shortHorizon || {};
  const sideScore = clamp(safeNum(side === 'long' ? horizon.longScore : horizon.shortScore, safeNum(analysis?.scalpV2?.score, 0.5)), 0, 1);
  const horizonScore = clamp(safeNum(horizon.score, sideScore), 0, 1);
  const expectedMovePct = clamp(safeNum(position.executionPlan?.expectedMovePct, safeNum(horizon.expectedMovePct, 0.0025)), 0.0008, 0.02);
  const expectedAdversePct = clamp(safeNum(position.executionPlan?.stopMovePct, safeNum(horizon.expectedAdversePct, 0.002)), 0.0005, Math.min(0.02, getHardStopPct(trade.leverage)));
  const holdFloorPct = clamp(Math.max(0.00035, expectedAdversePct * 0.55), 0.00035, 0.004);
  const protectTriggerPct = clamp(Math.max(0.0006, Math.min(expectedMovePct * 0.42, expectedMovePct - 0.00025)), 0.0006, 0.006);
  const targetPrice = position.executionPlan?.runnerTargetPrice || (side === 'long' ? trade.open_rate * (1 + expectedMovePct) : trade.open_rate * (1 - expectedMovePct));
  const hardStopPrice = position.executionPlan?.stopPrice || (side === 'long' ? trade.open_rate * (1 - expectedAdversePct) : trade.open_rate * (1 + expectedAdversePct));
  const invalidationPct = clamp(expectedAdversePct * 0.82, holdFloorPct * 1.05, expectedAdversePct);
  const invalidationPrice = side === 'long' ? trade.open_rate * (1 - invalidationPct) : trade.open_rate * (1 + invalidationPct);
  const profitProtectPrice = side === 'long' ? trade.open_rate * (1 + protectTriggerPct) : trade.open_rate * (1 - protectTriggerPct);
  const holdFloorPrice = side === 'long' ? trade.open_rate * (1 - holdFloorPct) : trade.open_rate * (1 + holdFloorPct);
  const holdCeilingPrice = side === 'long' ? trade.open_rate * (1 + Math.max(protectTriggerPct * 0.85, expectedMovePct * 0.35)) : trade.open_rate * (1 - Math.max(protectTriggerPct * 0.85, expectedMovePct * 0.35));
  return {
    entryPrice: trade.open_rate, side, holdFloorPrice, holdCeilingPrice, profitProtectPrice,
    targetPrice, invalidationPrice, hardStopPrice, expectedMovePct, expectedAdversePct,
    entryThesis: clamp(0.62 * sideScore + 0.38 * horizonScore, 0, 1),
    entryHorizonScore: horizonScore,
    entryTargetBps: safeNum(horizon.targetBps, expectedMovePct * 10000),
    createdAt: Date.now()
  };
}

function evaluatePositionGuardian(trade: TradeRecord, position: ActivePosition, currentPrice: number, analysis: any) {
  if (!currentPrice || currentPrice <= 0) return { action: 'hold' as const, state: 'GREEN' as const, score: 1, reason: 'Fiyat yok' };
  const map = position.positionMap || buildPositionMap(trade, position, analysis);
  position.positionMap = map;
  const side = trade.type;
  const dir = side === 'long' ? 1 : -1;
  const move = dir * ((currentPrice - trade.open_rate) / trade.open_rate);
  const horizon = analysis?.shortHorizon || {};
  const sideScore = clamp(safeNum(side === 'long' ? horizon.longScore : horizon.shortScore, 0), 0, 1);
  const oppositeScore = clamp(safeNum(side === 'long' ? horizon.shortScore : horizon.longScore, 0), 0, 1);
  const flowBias = safeNum(horizon?.flow?.f250, 0) * dir;
  const flowAcceleration = safeNum(horizon?.flow?.acceleration, 0) * dir;
  const vacuum = safeNum(horizon?.liquidityVacuum?.[side], 0);
  const resistance = safeNum(horizon?.pathResistance?.[side], 1);
  const impact = safeNum(horizon?.priceImpact?.[side], 1);
  const freshness = clamp(safeNum(horizon?.freshness, 0), 0, 1);
  const absorptionStrength = clamp(safeNum(horizon?.absorption?.strength, 0), 0, 1);
  const absorptionDirection = safeNum(horizon?.absorption?.direction, 0);
  const alignedAbsorption = absorptionDirection === dir;
  const thesis = clamp(0.28*sideScore + 0.18*Math.max(0,flowBias) + 0.12*Math.max(0,flowAcceleration) + 0.16*vacuum + 0.10*(1-resistance) + 0.08*(1-Math.min(1,impact*100)) + 0.08*freshness, 0, 1);
  const reversal = clamp(0.34*oppositeScore + 0.22*Math.max(0,-flowBias) + 0.16*Math.max(0,-flowAcceleration) + 0.12*resistance + 0.10*Math.min(1,impact*100) + 0.06*(absorptionStrength > 0.5 && !alignedAbsorption ? 1 : 0), 0, 1);
  const thesisDecay = clamp(map.entryThesis - thesis, -1, 1);
  const targetPct = Math.abs(map.targetPrice - map.entryPrice) / map.entryPrice;
  const remainingToTarget = Math.max(0, targetPct - Math.max(0, move));
  const costPct = 2*takerFeeRate + safeNum(analysis?.scalpV2?.spreadPct, 0)/100 + safeNum(analysis?.scalpV2?.slippagePct, 0)/100;
  const expectedContinuation = clamp(0.55*thesis + 0.25*Math.max(0, flowBias) + 0.20*vacuum - 0.35*reversal, 0, 1);
  const predictedAdversePct = (1 - expectedContinuation) * map.expectedAdversePct + costPct;
  const expectedValueToTarget = expectedContinuation * remainingToTarget - predictedAdversePct;
  const inHoldNoise = move > -Math.abs((map.entryPrice-map.holdFloorPrice)/map.entryPrice) && move < Math.abs((map.holdCeilingPrice-map.entryPrice)/map.entryPrice);
  const profitable = move > costPct + 0.00015;
  // Professional-style profit-preservation rule: if the live math now predicts
  // that the remaining path has a negative expectancy, or the likely adverse
  // move can consume the profit already earned, exit while the position is
  // still profitable. This is deliberately evaluated before TP/trailing logic.
  // Shared Professional-style profit guard: this is intentionally independent
  // of selector mode. Manual/Professional, Algorithm and AI all use the same
  // live math before TP/runner logic. If the remaining expectancy turns negative
  // OR the projected adverse move can consume a material part of the profit,
  // close while the position is still green instead of waiting for TP/SL.
  const predictedProfitErosion = profitable && (
    expectedValueToTarget < 0 ||
    predictedAdversePct >= Math.max(0.00025, move * 0.70) ||
    (expectedContinuation < 0.50 && predictedAdversePct >= Math.max(0.00025, move * 0.50))
  );
  const hardInvalidated = side === 'long' ? currentPrice <= map.hardStopPrice : currentPrice >= map.hardStopPrice;
  const thesisInvalidated = side === 'long' ? currentPrice <= map.invalidationPrice : currentPrice >= map.invalidationPrice;

  let action: 'hold'|'exit' = 'hold';
  let state: 'GREEN'|'YELLOW'|'RED' = 'GREEN';
  let reason = 'Pozisyon tezi korunuyor';

  if (hardInvalidated) {
    action='exit'; state='RED'; reason='Hard risk sınırı aşıldı';
  } else if (profitable && predictedProfitErosion) {
    action='exit'; state='RED'; reason=`Profesyonel kâr koruması: matematik kârın eriyeceğini öngörüyor | mevcut +${(move*100).toFixed(3)}% | tahmini ters risk ${(predictedAdversePct*100).toFixed(3)}% | devam olasılığı ${(expectedContinuation*100).toFixed(0)}%`;
  } else if (profitable && (reversal >= 0.62 || (thesisDecay >= 0.28 && expectedValueToTarget <= 0) || (oppositeScore >= 0.72 && flowBias < 0))) {
    action='exit'; state='RED'; reason=`Kâr koruma: analiz tersine döndü | reversal ${(reversal*100).toFixed(0)}% | thesis ${(thesis*100).toFixed(0)}%`;
  } else if (thesisInvalidated && reversal >= 0.52) {
    action='exit'; state='RED'; reason=`Tez invalidation: karşı baskı ${(reversal*100).toFixed(0)}%`;
  } else if (!profitable && !inHoldNoise && (reversal >= 0.76 || (thesis < 0.38 && expectedValueToTarget < 0))) {
    action='exit'; state='RED'; reason=`Zarar koruması: toparlanma matematiği bozuldu | thesis ${(thesis*100).toFixed(0)}%`;
  } else if (profitable && (reversal >= 0.45 || thesis < 0.55 || expectedValueToTarget < 0.0001)) {
    state='YELLOW'; reason='Kâr var; hedefe kadar devam avantajı zayıflıyor';
  } else if (thesis < 0.45) {
    state='YELLOW'; reason='Tez zayıfladı fakat hard invalidation yok';
  }

  // Lock profit mathematically; never loosen a stop.
  if (profitable && move >= Math.max(0.0006, targetPct*0.28)) {
    const lockPct = clamp(move - Math.max(costPct*1.25, 0.00025), 0.00025, move*0.72);
    const lockPrice = side === 'long' ? trade.open_rate*(1+lockPct) : trade.open_rate*(1-lockPct);
    const oldStop = safeNum(position.currentStopPrice, trade.stop_loss_abs || map.hardStopPrice);
    const tighter = side === 'long' ? lockPrice > oldStop : lockPrice < oldStop;
    if (tighter) {
      position.currentStopPrice = lockPrice;
      trade.stop_loss_abs = lockPrice;
    }
  }

  return { action, state, score: thesis, reversal, thesisDecay, expectedValueToTarget, predictedAdversePct, predictedProfitErosion, expectedContinuation, move, profitable, inHoldNoise, reason };
}

async function runPositionGuardian(trade: TradeRecord, currentPrice: number) {
  if (!activePosition || activePosition.trade_id !== trade.trade_id) return false;
  const now = Date.now();
  if (activePosition.lastGuardianAt && now - activePosition.lastGuardianAt < 120) return false;
  activePosition.lastGuardianAt = now;
  const analysis = latestMetrics || {};
  const result = evaluatePositionGuardian(trade, activePosition, currentPrice, analysis);
  activePosition.guardianState = result.state;
  activePosition.lastGuardianScore = result.score;
  activePosition.lastGuardianReason = result.reason;
  if (activePosition.currentStopPrice && activePosition.currentStopPrice !== trade.stop_loss_abs) {
    try {
      const newId = await updateProtectiveStop(trade, activePosition.currentStopPrice);
      if (newId) activePosition.protectiveOrderId = newId;
    } catch {}
  }
  if (result.action === 'exit') {
    const modeLabel = coinSelectionMode === 'ai' ? 'YAPAY ZEKÂ' : coinSelectionMode === 'algorithmic' ? 'ALGORİTMA' : 'PROFESYONEL';
    addEngineLog('TRADE', `[GUARDIAN/${modeLabel}] ${trade.pair} ${trade.type.toUpperCase()} EXIT | ${result.reason} | P/L hareket ${(result.move*100).toFixed(3)}%`);
    await closeActivePosition(`Dynamic Position Guardian: ${result.reason}`);
    return true;
  }
  if (result.state !== 'GREEN') {
    addEngineLog('INFO', `[GUARDIAN] ${trade.pair} ${result.state} | thesis ${(result.score*100).toFixed(0)}% | reversal ${(result.reversal*100).toFixed(0)}% | ${result.reason}`);
  }
  return false;
}

async function syncLivePosition() {
  if (dryRun || !exchange || !privateExchangeReady) {
    if (activePosition) {
      const trade = allTrades.find(t => t.trade_id === activePosition?.trade_id && t.is_open);
      if (trade) {
        const current = await getCurrentPrice(trade.pair);
        if (current > 0) {
          if (await runPositionGuardian(trade, current)) return;
          if (trade.type === 'long') {
            activePosition.peakPrice = Math.max(activePosition.peakPrice || current, current);
            if (trade.stop_loss_abs && current <= trade.stop_loss_abs) {
              await closeActivePosition('Zarar Kes (Stop-Loss) tetiklendi');
              return;
            }
            if (trade.take_profit_abs && current >= trade.take_profit_abs) {
              await closeActivePosition('Kâr Al (Take-Profit) tetiklendi');
              return;
            }
          } else {
            activePosition.peakPrice = Math.min(activePosition.peakPrice || current, current);
            if (trade.stop_loss_abs && current >= trade.stop_loss_abs) {
              await closeActivePosition('Zarar Kes (Stop-Loss) tetiklendi');
              return;
            }
            if (trade.take_profit_abs && current <= trade.take_profit_abs) {
              await closeActivePosition('Kâr Al (Take-Profit) tetiklendi');
              return;
            }
          }
        }
      }
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
      latestBinanceUnrealizedPnl = 0;
      latestBinanceInitialMargin = 0;
      latestBinanceMarkPrice = 0;
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
    const mark = safeNum(open?.markPrice) || safeNum(open?.info?.markPrice);
    if (mark > 0) latestBinanceMarkPrice = mark;
    const unrealized = safeNum(open?.unrealizedPnl) || safeNum(open?.info?.unRealizedProfit);
    const positionNotional = Math.abs(safeNum(open?.notional) || safeNum(open?.info?.notional) || entry * contracts);
    const lev = safeNum(open?.leverage, targetLeverage) || targetLeverage;
    const exchangeInitialMargin = safeNum(open?.initialMargin) || safeNum(open?.info?.initialMargin);
    latestBinanceUnrealizedPnl = Number.isFinite(unrealized) ? unrealized : 0;
    latestBinanceInitialMargin = exchangeInitialMargin > 0 ? exchangeInitialMargin : positionNotional / Math.max(1, lev);

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
      let matchingStopId: string | undefined;
      try {
        if (typeof exchange.fetchOpenOrders === 'function') {
          const orders = await exchange.fetchOpenOrders(syncPair);
          const expectedSide = side === 'long' ? 'SELL' : 'BUY';
          const expectedPositionSide = side === 'long' ? 'LONG' : 'SHORT';
          
          for (const o of orders) {
            const oId = String(o?.id || o?.info?.orderId || '');
            const type = String(o?.type || o?.info?.type || o?.info?.origType || '').toUpperCase();
            const orderSide = String(o?.side || o?.info?.side || '').toUpperCase();
            const positionSide = String(o?.positionSide || o?.info?.positionSide || '').toUpperCase();
            const isStopType = type.includes('STOP') || type === 'STOP_MARKET' || type === 'STOP_LOSS';
            const sideOk = orderSide === expectedSide;
            const positionOk = !hedgeMode || positionSide === expectedPositionSide || positionSide === 'BOTH';

            if (oId && (oId === String(currentTrade.protective_order_id) || oId === String(activePosition.protectiveOrderId))) {
              stopPresent = true;
              matchingStopId = oId;
              break;
            }

            if (isStopType && sideOk && positionOk) {
              stopPresent = true;
              matchingStopId = oId;
              break;
            }
          }
        }
      } catch (e: any) {
        addEngineLog('WARN', `[RİSK] Açık stop emirleri doğrulanamadı: ${e?.message || e}`);
      }

      if (stopPresent && matchingStopId) {
        currentTrade.protective_order_id = matchingStopId;
        activePosition.protectiveOrderId = matchingStopId;
      } else if (!stopPresent) {
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
          addEngineLog('INFO', `[GÜVENLİK] Eksik koruyucu stop emri oluşturuldu: ${newStop}`);
        } catch (stopErr: any) {
          addEngineLog('WARN', `[GÜVENLİK] Stop oluşturulamadı: ${stopErr?.message || stopErr}`);
        }
      }
      const guardianPrice = mark > 0 ? mark : await getCurrentPrice(syncPair);
      if (guardianPrice > 0 && currentTrade.is_open) {
        await runPositionGuardian(currentTrade, guardianPrice);
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
    const pairs = coinSelectionMode === 'manual'
      ? professionalManualPairs
      : (Array.isArray(conf?.exchange?.pair_whitelist) ? conf.exchange.pair_whitelist : []);
    return Array.from(new Set([...(pairs.length ? pairs : [TRADING_PAIR]), TRADING_PAIR]));
  } catch { return [TRADING_PAIR]; }
}

function selectorUniverse(): string[] {
  const conf = readConfig();
  if (coinSelectionMode === 'manual') return professionalManualPairs.slice(0, 10);
  const blacklist = new Set((conf?.exchange?.pair_blacklist || []).map((p:any) => String(p).toUpperCase()));
  return (latestMarkets || []).filter((m:any) => m?.symbol && String(m.symbol).endsWith('/USDT') && !blacklist.has(String(m.symbol).toUpperCase()) && !String(m.symbol).includes('_'))
    .sort((a:any,b:any) => safeNum(b.volume_24h_usdt)-safeNum(a.volume_24h_usdt)).slice(0, coinSelectionMode === 'ai' ? Math.min(50, Math.max(15, algorithmScanAssets)) : algorithmScanAssets).map((m:any)=>String(m.symbol).toUpperCase());
}

function buildAiDecision(a: any) {
  const profile = getRiskProfile();
  const side = a.scalpV2?.signal || (a.longSignal ? 'long' : a.shortSignal ? 'short' : null);
  const whale = safeNum(a.whaleScore);
  const flow = safeNum(a.scalpV2?.score);
  const agreement = safeNum(a.scalpV2?.exchangeAgreement);
  const horizon = safeNum(a.shortHorizon?.score);
  const confidence = clamp(safeNum(a.confidence) / 100, 0, 1);
  const edge = clamp(Math.max(0, safeNum(a.scalpV2?.netEdgePct)) / 0.15, 0, 1);
  const liquidity = safeNum(a.visibleLiquidityUsdt);
  const spread = safeNum(a.SpreadPct) * 100;
  const dirWhale = side === 'long' ? whale : side === 'short' ? -whale : 0;
  const whaleSupport = clamp(0.5 + dirWhale * 0.5, 0, 1);
  const score = clamp(0.24*flow + 0.18*agreement + 0.14*horizon + 0.12*confidence + 0.12*edge + 0.12*whaleSupport + 0.08*clamp(liquidity/500000,0,1), 0, 1);
  const directionalWhaleOk = !deepAnalysisConfig.whale_requires_directional_confirmation || !a.whaleDetected || dirWhale > -0.30;
  const eligible = Boolean(side) && score >= profile.aiMinScore && spread <= algorithmMaxSpreadPct && liquidity >= algorithmMinLiquidityUsdt && Boolean(a.scalpV2?.v2ExecutionOkay) && directionalWhaleOk && a.shortHorizon?.qualifies !== false && a.v27?.regime !== 'CHAOS';
  return { side, score, eligible, whaleSupport, liquidity, spreadPct: spread, confidence, edge, reason: eligible ? 'AI: mikro-yapı + order-flow + whale + likidite + EV uyumlu' : 'AI: güvenlik/risk kapılarından biri karşılanmadı' };
}

async function buildAiPositionPlan(analysis: any, side: Side) {
  const profile = getRiskProfile();
  const { free } = await getFuturesBalance();
  const balance = Math.max(0, safeNum(free, latestBinanceAvailableBalance || virtualBalance || 100));
  const ai = buildAiDecision(analysis);
  if (!ai.eligible || ai.side !== side) return null;
  const conviction = clamp(ai.score, 0, 1);
  const leverage = Math.max(1, Math.min(profile.maxLeverage, Math.floor(1 + conviction * (profile.maxLeverage - 1))));
  const riskBudget = balance * profile.maxAccountRiskPct * (0.70 + 0.30 * conviction);
  const plan = buildLiveExecutionPlan(side, analysis, Math.max(1, balance * profile.maxMarginRatio), leverage);
  if (!plan || plan.stopMovePct <= 0) return null;
  const riskMarginCap = riskBudget / Math.max(plan.stopMovePct * leverage, 0.0001);
  const margin = Math.max(1, Math.min(balance * profile.maxMarginRatio, riskMarginCap, balance * tradableBalanceRatio));
  return { margin, targetMargin: margin, leverage, score: ai.score, whaleSupport: ai.whaleSupport, reason: `AI ${profile.label}: güven ${(ai.score*100).toFixed(0)}% | whale ${(ai.whaleSupport*100).toFixed(0)}% | risk ${(profile.maxAccountRiskPct*100).toFixed(2)}%` };
}

async function selectBestTradingPair(): Promise<{ pair:string|null; candidates:any[] }> {
  if (scannerBusy) return { pair: TRADING_PAIR, candidates: scannerSummary };
  scannerBusy = true; scannerLastRun = Date.now();
  try {
    if (!latestMarkets?.length) { try { latestMarkets = (await fetchBinancePublic24hrMarkets()) || []; } catch {} }
    const universe = selectorUniverse();
    const candidates:any[] = [];
    for (let i=0; i<universe.length; i+=3) {
      const batch = universe.slice(i, i+3);
      const rows = await Promise.all(batch.map(async (pair) => {
        try {
          const a:any = await analyzeFuturesPair(pair);
          const dir = a.scalpV2?.signal || (a.longSignal ? 'long' : a.shortSignal ? 'short' : null);
          const spread = safeNum(a.SpreadPct) * 100;
          const liquidity = safeNum(a.visibleLiquidityUsdt);
          const edge = Math.max(0, safeNum(a.scalpV2?.netEdgePct)) / 0.15;
          const whale = clamp(Math.abs(safeNum(a.whaleNetUsdt)) / Math.max(deepAnalysisConfig.whale_net_flow_usdt,1),0,1);
          const ai = coinSelectionMode === 'ai' ? buildAiDecision(a) : null;
          const score = ai ? ai.score : clamp(0.35*safeNum(a.scalpV2?.score) + 0.18*safeNum(a.scalpV2?.exchangeAgreement) + 0.15*safeNum(a.shortHorizon?.score) + 0.12*edge + 0.10*whale + 0.10*clamp(safeNum(a.confidence)/100,0,1),0,1);
          const eligible = ai ? ai.eligible : Boolean(dir) && score >= algorithmMinOpportunityScore && liquidity >= algorithmMinLiquidityUsdt && spread <= algorithmMaxSpreadPct && Boolean(a.scalpV2?.v2ExecutionOkay) && !Boolean(a.shortHorizon?.qualifies === false);
          return { pair, signal: ai?.side || dir, score, eligible, liquidity, spreadPct: spread, scalpScore: safeNum(a.scalpV2?.score), agreement: safeNum(a.scalpV2?.exchangeAgreement), whaleNetUsdt: safeNum(a.whaleNetUsdt), expectedEdgePct: safeNum(a.scalpV2?.netEdgePct), aiDecision: ai, reason: ai?.reason || (eligible ? 'Tüm Professional mikro-yapı kapıları uyumlu' : 'Minimum eşikler karşılanmadı') };
        } catch (e:any) { return { pair, signal:null, score:0, eligible:false, reason:e?.message || 'Analiz alınamadı' }; }
      }));
      candidates.push(...rows);
    }
    candidates.sort((a,b)=>b.score-a.score); scannerSummary = candidates.slice(0,10);
    const best = candidates.find(c=>c.eligible);
    if (!best) { addEngineLog('INFO', `[SELECTOR] Uygun coin bulunamadı → BEKLEMEDE | ${coinSelectionMode==='manual'?'manuel 10 coin':(coinSelectionMode==='ai'?'AI taraması':'algoritmik tarama')}`); return { pair:null, candidates }; }
    if (best.pair !== TRADING_PAIR) { TRADING_PAIR = best.pair; addEngineLog('INFO', `[SELECTOR] En iyi aday seçildi: ${best.pair} ${String(best.signal).toUpperCase()} | skor ${(best.score*100).toFixed(1)}%`); startMarketDataStreams(true); startEightExchangeStreams(true); }
    return { pair: best.pair, candidates };
  } finally { scannerBusy = false; }
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
  // 1x reference remains the baseline (%10.0 minimum pure price movement).
  // The engine calculates the pure spot/futures market movement target.
  // When user uses leverage (e.g. 15x), reaching this 10% move produces +150% ROE.
  let target = 0.10;
  let reason = 'Derin Analiz: 1x üzerinden %10.0 net kâr hedefi';

  if (spreadPct > 0.0035) {
    target = 0.08;
    reason = 'Yüksek spread: dinamik 1x hedef %8.0';
  } else if (volatilityPct >= 6.0 && Math.abs(deepScore) >= 0.70) {
    target = 0.15;
    reason = 'Yüksek volatilite + güçlü derin analiz: 1x %15.0 hedef';
  } else if (volatilityPct >= 4.0 && Math.abs(deepScore) >= 0.55) {
    target = 0.12;
    reason = 'Volatilite + teyitli derin analiz: 1x %12.0 hedef';
  } else {
    target = 0.10;
    reason = 'Matematiksel 1x bazında %10.0 net kâr hedefi';
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

  // Simple mode is also stateless: no order-book snapshots are retained.
  const historicalObi = obi;
  const historyTrend = 0;
  const obiVelocity = 0;
  const obiAcceleration = 0;
  const previousAskWall = maxAskWallUsdt;
  const wallWeakening = 0;
  const projectedMove = clamp(Math.abs(nearObi) * simpleModeConfig.obi_projection_multiplier_pct + Math.abs(microBias) * 0.002, 0, 1);
  const directionScore = clamp(obi * 0.65 + nearObi * 0.25 + microBias * 0.05, -1, 1);
  const directionLong = directionScore >= simpleModeConfig.min_obi;
  const directionShort = directionScore <= -simpleModeConfig.min_obi;
  const accelerationLong = !simpleModeConfig.require_obi_acceleration || obiAcceleration > 0;
  const accelerationShort = !simpleModeConfig.require_obi_acceleration || obiAcceleration < 0;
  // Simple mode is intentionally stateless: without a previous snapshot there is
  // no defensible wall-weakening measurement. Treat the current top wall as valid
  // rather than referencing an undefined historical snapshot.
  const wallLong = true;
  const wallShort = true;
  const commonFilters = visibleLiquidityUsdt >= simpleModeConfig.min_liquidity_usdt
    && spreadPct <= simpleModeConfig.max_spread_pct
    && Math.abs(obiVelocity) >= simpleModeConfig.min_obi_velocity;
  const signal = projectedMove >= simpleModeConfig.target_market_move_pct && commonFilters &&
    ((directionLong && accelerationLong && wallLong) || (directionShort && accelerationShort && wallShort))
    ? (directionLong ? 'long' : 'short') : null;

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

  // No persistent/history window is used. Instantaneous order-book geometry is the source of truth.
  const previous = undefined;
  const historicalObi = OBI;
  const historicalScore = 0;
  const historyTrend = 0;
  const obiVelocity = 0;
  const previousObiVelocity = 0;
  const obiAcceleration = 0;

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

  // Volatility is estimated only from the current live book.
  const volatilityPct = clamp(
    0.20 + SpreadPct * 100 * 8 + Math.abs(microBias) * 0.60 + Math.abs(depthPressure) * 0.90,
    0.20, 6.0
  );

  // Detect whether the book is becoming thinner/thicker in the same direction.
  const depthChangeScore = clamp((depthPressure - OBI) * 1.5, -1, 1);

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
  // Spot/Futures native-book divergence. Positive means Spot is more bullish than Futures.
  // Large opposite readings are treated as a veto rather than as a directional override.
  const spotFuturesDivergence = clamp(OBI - futuresOBI, -1, 1);
  const divergenceMagnitude = Math.abs(spotFuturesDivergence);
  const divergenceConflict = divergenceMagnitude >= 0.45 && (OBI * futuresOBI < 0 || Math.abs(futuresOBI) >= 0.25);

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
    (-spotFuturesDivergence) * 0.04 +
    whaleScore * 0.10;

  const spreadPenalty = clamp((SpreadPct - 0.0005) / 0.0025, 0, 1) * 0.10;
  const deepScore = clamp(rawScore * (1 - spreadPenalty), -1, 1);

  // Convert directional score to a calibrated-looking probability, while keeping the
  // neutral zone wide enough to avoid over-trading noise.
  const probabilityLong = 1 / (1 + Math.exp(-5 * deepScore));
  const probabilityShort = 1 - probabilityLong;
  const probabilityEdge = Math.max(probabilityLong, probabilityShort);
  const confidence = Math.round(clamp((probabilityEdge - 0.5) * 200, 0, 100));

  const adaptive = chooseAdaptiveTargetPct({ volatilityPct, deepScore, spreadPct: SpreadPct });
  const confirmationOkLong = OBI > 0.03 && deltaBias >= -0.12 && futuresOBI >= -0.20 && obiVelocity >= -0.25;
  const confirmationOkShort = OBI < -0.03 && deltaBias <= 0.12 && futuresOBI <= 0.20 && obiVelocity <= 0.25;
  const whaleLongOk = !deepAnalysisConfig.whale_requires_directional_confirmation || !whaleDetected || whaleScore > -0.30;
  const whaleShortOk = !deepAnalysisConfig.whale_requires_directional_confirmation || !whaleDetected || whaleScore < 0.30;
  const longSignal = probabilityLong >= deepAnalysisConfig.min_long_probability && deepScore >= 0.18 && confirmationOkLong && whaleLongOk && SpreadPct <= 0.005 && !(divergenceConflict && futuresOBI < 0);
  const shortSignal = probabilityShort >= deepAnalysisConfig.min_short_probability && deepScore <= -0.18 && confirmationOkShort && whaleShortOk && SpreadPct <= 0.005 && !(divergenceConflict && futuresOBI > 0);
  const signal: Side | null = longSignal ? 'long' : shortSignal ? 'short' : null;

  // Intentionally no market-history storage here.


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
    spotFuturesDivergence,
    divergenceMagnitude,
    divergenceConflict,
    volatilityPct,
    adaptiveTargetPct: adaptive.targetPct,
    adaptiveTargetReason: adaptive.reason,
    longSignal,
    shortSignal,
    signal,
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
  const history: any[] = [];
  const visibleLiquidity = [...base.bids.slice(0, 30), ...base.asks.slice(0, 30)]
    .reduce((sum: number, x: any[]) => sum + safeNum(x?.[0]) * safeNum(x?.[1]), 0);
  const spreadPct = base.SpreadPct * 100;
  const liquidityQuality = clamp(visibleLiquidity / Math.max(intelligentModeConfig.min_liquidity_usdt, 1), 0, 2) / 2;
  const spreadQuality = 1 - clamp(spreadPct / intelligentModeConfig.max_spread_pct, 0, 1);
  const volatility = safeNum(base.volatilityPct);
  const volatilityQuality = volatility <= 0 ? 0.5 : clamp(1 - Math.abs(Math.log(Math.max(volatility, 0.1) / 3.0)) / 3, 0, 1);
  const trendPersistence = 0.5 + 0.5 * Math.abs(safeNum(base.deepScore));

  const book = clamp(base.weightedOBI * 0.65 + base.OBI * 0.35, -1, 1);
  const micro = clamp(base.microBias || 0, -1, 1);
  const flow = clamp(base.deltaBias || 0, -1, 1);
  const depth = clamp(base.depthPressure * 0.65 + base.depthChangeScore * 0.35, -1, 1);
  const momentum = clamp(base.obiVelocity * 0.45 + base.obiAcceleration * 0.25 + base.historyTrend * 0.30, -1, 1);
  const futures = clamp(base.futuresOBI, -1, 1);
  const whale = clamp(base.whaleScore, -1, 1);

  const components = [book, micro, flow, depth, momentum, futures, whale];
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
    book * 0.24 + micro * 0.10 + flow * 0.18 + depth * 0.14 + momentum * 0.14 + futures * 0.10 + whale * 0.10,
    -1, 1
  );
  const qualityMultiplier = 0.55 + 0.45 * regimeQuality;
  const intelligentScore = clamp(consensus * (0.55 + 0.45 * agreement) * qualityMultiplier, -1, 1);
  const edge = Math.abs(intelligentScore);
  const conflict = agreement < 0.45 || base.divergenceConflict || (base.futuresOBI * intelligentScore < -0.10 && Math.abs(base.futuresOBI) > 0.25);
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
    intelligentComponents: { book, micro, flow, depth, momentum, futures, whale },
    longSignal,
    shortSignal,
    adaptiveTargetPct: target,
    adaptiveTargetReason: reason,
  };
}

function getV27PerformanceStats() {
  // No historical performance sample is kept. EV is computed from the live trade plan.
  return { count: 0, winRate: 0.5, avgWin: 0, avgLoss: 0, expectancy: 0, profitFactor: 0 };
}

function getV27Regime(analysis:any) {
  const a = analysis?.scalpV2 || {};
  const score = safeNum(a.score);
  const agreement = safeNum(a.exchangeAgreement);
  const flow = Math.abs(safeNum(a.flow1s));
  const consumption = Math.abs(safeNum(a.consumptionScore));
  const divergence = Math.abs(safeNum(a.spotFuturesDivergence));
  const spread = safeNum(a.spreadPct);
  const edge = safeNum(a.netEdgePct) / 100;
  const quality = clamp(
    0.30*score + 0.20*agreement + 0.15*clamp(flow*1.5,0,1) +
    0.15*clamp(consumption*1.5,0,1) + 0.10*(1-clamp(divergence/0.65,0,1)) +
    0.10*(1-clamp(spread/0.12,0,1)), 0, 1);
  const direction = safeNum(a.direction);
  let regime = 'RANGE';
  if (quality >= 0.80 && score >= 0.82 && agreement >= 0.75) regime = 'BREAKOUT';
  else if (quality >= 0.70 && flow >= 0.18) regime = 'TREND';
  else if (divergence >= 0.55 || spread >= 0.10) regime = 'CHAOS';
  else if (Math.abs(flow) >= 0.25 && consumption < 0.10) regime = 'REVERSAL';
  return { regime, quality, edge, direction };
}

function getV27Sizing(analysis:any) {
  const score = safeNum(analysis?.scalpV2?.score);
  const agreement = safeNum(analysis?.scalpV2?.exchangeAgreement);
  const netEdge = safeNum(analysis?.scalpV2?.netEdgePct) / 100;
  const regime = getV27Regime(analysis);
  const aPlus = score >= V27_A_PLUS_SCORE && agreement >= V27_A_PLUS_AGREEMENT && netEdge >= V27_A_PLUS_NET_EDGE && regime.quality >= 0.72 && regime.regime !== 'CHAOS';
  let multiplier = V27_MIN_SIZE_MULTIPLIER + clamp((score-0.66)/0.34,0,1) * (1.0);
  multiplier *= 0.70 + 0.30*regime.quality;
  if (aPlus) multiplier = Math.max(multiplier, 1.10);
  if (regime.regime === 'CHAOS') multiplier = 0.25;
  return { multiplier: clamp(multiplier, 0.25, V27_MAX_SIZE_MULTIPLIER), aPlus, regime, ev: getV27PerformanceStats() };
}

function v27TargetFor(analysis:any, aPlus:boolean) {
  const score = clamp(safeNum(analysis?.scalpV2?.score),0,1);
  // Scalp targets are underlying price moves, not arbitrary leveraged ROI targets.
  return clamp(0.0035 + score*0.012 + (aPlus ? 0.002 : 0), 0.0035, 0.020);
}

function getV28Optimizer(analysis:any) {
  const score = clamp(safeNum(analysis?.scalpV2?.score), 0, 1);
  const regime = getV27Regime(analysis);
  const runnerTargetPct = v27TargetFor(analysis, score >= V27_A_PLUS_SCORE);
  return {
    tp1Fraction: 0.35,
    runnerTrailPct: 0.0025,
    runnerTargetPct,
    bucket: `${score >= 0.82 ? 'A+' : score >= 0.66 ? 'A' : 'B'}:${regime.regime}`,
    sampleSize: 0,
    confidence: regime.quality,
    source: 'live-math-only'
  };
}

async function closePartialPosition(fraction:number, reason:string) {
  if (!activePosition) return null;
  const position = activePosition;
  const trade = allTrades.find(t=>t.trade_id===position.trade_id && t.is_open);
  if (!trade) return null;
  const closeFraction = clamp(fraction, 0.05, 0.95);
  const closeAmountRaw = position.amount * closeFraction;
  if (closeAmountRaw <= 0) return null;
  const isLive = !dryRun && exchange && privateExchangeReady;
  let amount = closeAmountRaw;
  if (isLive && exchange && typeof exchange.amountToPrecision === 'function') {
    try { amount = safeNum(exchange.amountToPrecision(trade.pair, closeAmountRaw)); } catch {}
  }
  if (amount <= 0 || amount >= position.amount) return closeActivePosition(reason);

  if (isLive && position.protectiveOrderId && typeof exchange.cancelOrder === 'function' && !String(position.protectiveOrderId).startsWith('sim_') && !String(position.protectiveOrderId).startsWith('local_')) {
    try { await exchange.cancelOrder(position.protectiveOrderId, trade.pair); } catch {}
  }
  const current = await getCurrentPrice(trade.pair);
  let order:any = null;
  let fillPrice=current;
  if (isLive) {
    order = trade.type === 'long'
      ? await exchange.createMarketSellOrder(trade.pair, amount, undefined, orderParams(trade.type,true))
      : await exchange.createMarketBuyOrder(trade.pair, amount, undefined, orderParams(trade.type,true));
    fillPrice = await resolveOrderPrice(order, trade.pair, current);
  } else order = { id:`paper_partial_${Date.now()}` };
  const fee = isLive ? await resolveOrderFee(order, trade.pair, fillPrice*amount*takerFeeRate) : fillPrice*amount*takerFeeRate;
  const gross = trade.type==='long' ? (fillPrice-trade.open_rate)*amount : (trade.open_rate-fillPrice)*amount;
  const net = gross-fee;
  const originalAmount = trade.amount;
  const remaining = Math.max(0, position.amount-amount);
  trade.amount = remaining;
  trade.fee_close = safeNum(trade.fee_close)+fee;
  trade.profit_abs = safeNum(trade.profit_abs)+net;
  trade.runner_exit_reason = reason;
  trade.mfe_pct = Math.max(safeNum(trade.mfe_pct), Math.abs((position.peakPrice-trade.open_rate)/trade.open_rate));
  if (dryRun) virtualBalance = Math.max(10, virtualBalance+net);
  position.amount = remaining;
  if (remaining > 0) {
    const replacement = { ...trade, amount: remaining, stop_loss_abs: position.currentStopPrice || trade.stop_loss_abs } as TradeRecord;
    try {
      replacement.protective_order_id = await placeProtectiveStop(replacement);
      position.protectiveOrderId = replacement.protective_order_id;
      trade.protective_order_id = replacement.protective_order_id;
    } catch {}
    addEngineLog('TRADE', `V2.7 TP1: ${(closeFraction*100).toFixed(0)}% kapandı | ${fillPrice.toFixed(2)} | net ${net>=0?'+':''}${net.toFixed(2)} USDT | kalan ${(remaining/originalAmount*100).toFixed(0)}%`);
  }
  saveTradingState();
  return { trade, net, remaining, fillPrice };
}

async function executeRealTradeLogic() {
  if (botState !== 'running' || isProcessingTrade) return;
  isProcessingTrade = true;
  try {
    await ensureExchange();
    if (!exchange) throw new Error('Binance Futures bağlantısı yok.');
    await syncLivePosition();
    await syncBinanceAccountReconciliation();

    if (!activePosition) {
      const selected = await selectBestTradingPair();
      if (!selected.pair) { latestEightExchangeAnalysis = null; latestMetrics = { ...(latestMetrics || {}), selectorState: 'WAITING_FOR_MATCH', selectorMode: coinSelectionMode, selectorCandidates: scannerSummary.slice(0,10) }; return; }
    }
    const analysis = analyzeEightExchangeOrderBooks(TRADING_PAIR);
    if (!analysis) {
      addEngineLog('WARN', `[8X] ${TRADING_PAIR}: henüz yeterli borsa order book verisi yok.`);
      return;
    }
    latestEightExchangeAnalysis = analysis;

    const binanceBook = analysis.books.binance;
    latestOrderBook = binanceBook
      ? { bids: binanceBook.bids, asks: binanceBook.asks, timestamp: Date.now() }
      : latestOrderBook;
    const currentPrice = bookMid(binanceBook || {bids:[],asks:[]}) || getLivePrice(TRADING_PAIR) || await getCurrentPrice(TRADING_PAIR);
    const localObi = binanceBook ? bookOBI(binanceBook) : 0;
    latestMetrics = {
      pair: TRADING_PAIR,
      currentPrice,
      OBI: localObi,
      crossGapPct: analysis.crossGapPct,
      binanceVsMedianPct: analysis.binanceVsMedianPct,
      medianPrice: analysis.medianPrice,
      minPrice: analysis.minPrice,
      maxPrice: analysis.maxPrice,
      minExchange: analysis.minExchange,
      maxExchange: analysis.maxExchange,
      consensusObi: analysis.consensusObi,
      dispersionPct: analysis.dispersionPct,
      mathematicalScore: analysis.mathematicalScore,
      confidence: analysis.confidence,
      signal: analysis.signal,
      nearConsensusObi: analysis.nearConsensusObi,
      deepConsensusObi: analysis.deepConsensusObi,
      nearAlignment: analysis.nearAlignment,
      deepOnlyRatio: analysis.deepOnlyRatio,
      topBookConfirmed: analysis.topBookConfirmed,
      tradeFlowBias: analysis.tradeFlowBias,
      microBias: analysis.microBias,
      shortMomentum: analysis.shortMomentum,
      scalpScore: analysis.scalpScore,
      scalpAgreement: analysis.scalpAgreement,
      scalpConfirmed: analysis.scalpConfirmed,
      scalpComponents: analysis.scalpComponents,
      scalpV2: analysis.scalpV2,
      shortHorizon: analysis.shortHorizon,
      v27: analysis.v27,
      v28: getV28Optimizer(analysis),
      executionPlan: analysis.signal ? buildLiveExecutionPlan(analysis.signal, analysis, currentStakeAmount || 6, targetLeverage) : null,
      exchanges: analysis.exchanges,
      referenceTargetPct: minCrossExchangeGap * 100,
      adaptiveTargetPct: analysis.scalpV2 ? clamp(0.003 + analysis.scalpV2.score * 0.005, 0.003, 0.008) * 100 : GAP_CLOSE_THRESHOLD * 100,
      adaptiveTargetReason: '8-borsa fiyat farkı kapanışı',
      longSignal: analysis.signal === 'long',
      shortSignal: analysis.signal === 'short',
      futuresNativeDepth: getBinanceFuturesNativeHealth(cleanSymbol(TRADING_PAIR).toUpperCase()),
      spotFuturesDivergence: analysis.spotFuturesDivergence,
      divergenceMagnitude: analysis.divergenceMagnitude,
      divergenceConflict: analysis.divergenceConflict,
      binanceMarkPrice: latestBinanceMarkPrice,
      binanceUnrealizedPnl: latestBinanceUnrealizedPnl,
      binanceInitialMargin: latestBinanceInitialMargin
    };

    if (activePosition) {
      const position = activePosition;
      const trade = allTrades.find(t => t.trade_id === position.trade_id);
      if (!trade) { activePosition = null; return; }
      const entry = trade.open_rate;
      const favorableMove = trade.type === 'long' ? (currentPrice-entry)/entry : (entry-currentPrice)/entry;
      const adverseMove = trade.type === 'long' ? (entry-currentPrice)/entry : (currentPrice-entry)/entry;

      // Dynamic Position Guardian decides whether the position still deserves to stay open.
      // It protects profit on thesis reversal and distinguishes normal noise from true invalidation.
      if (await runPositionGuardian(trade, currentPrice)) return;

      // AI only: scale in 40% + 30% + 30%, but only after fresh confirmation.
      // It never averages down; if whale/order-flow confirmation disappears, no new leg is added.
      if (coinSelectionMode === 'ai' && activePosition.ladderStep && activePosition.ladderStep < 3) {
        await addAiLadderPosition(trade.type, trade.pair, latestMetrics || {});
      }

      // TP1/runner are secondary to the Guardian; a thesis reversal can exit before the target.
      activePosition.peakMfePct = Math.max(safeNum(activePosition.peakMfePct), favorableMove);
      trade.mfe_pct = Math.max(safeNum(trade.mfe_pct), favorableMove);
      trade.mae_pct = Math.max(safeNum(trade.mae_pct), adverseMove);
      const highConviction = Boolean(activePosition.highConviction || trade.high_conviction);
      const tp1Price = safeNum(activePosition.tp1Price);
      const runnerTargetPrice = safeNum(activePosition.runnerTargetPrice);
      const tp1Hit = !activePosition.tp1Done && tp1Price > 0 && (trade.type==='long' ? currentPrice >= tp1Price : currentPrice <= tp1Price);
      if (tp1Hit) {
        const tp1Fraction = clamp(safeNum(activePosition.optimizerTp1Fraction, V27_TP1_FRACTION), 0.20, 0.50);
        await closePartialPosition(tp1Fraction, 'V2.8 Auto-Optimizer TP1');
        activePosition.tp1Done = true;
        trade.tp1_fraction = tp1Fraction;
        saveTradingState();
      }
      const runnerActive = Boolean(activePosition.tp1Done && highConviction);
      if (runnerActive && favorableMove >= V27_RUNNER_ACTIVATION_PCT) {
        const trailPct = clamp(safeNum(activePosition.optimizerRunnerTrailPct, V27_RUNNER_TRAIL_PCT), 0.001, 0.006);
        const trail = trade.type==='long' ? activePosition.peakPrice*(1-trailPct) : activePosition.peakPrice*(1+trailPct);
        if ((trade.type==='long' && currentPrice <= trail) || (trade.type==='short' && currentPrice >= trail)) {
          await closeActivePosition('V2.7 Microstructure Runner Trailing');
          return;
        }
      }
      const runnerTargetHit = runnerActive && runnerTargetPrice > 0 && (trade.type==='long' ? currentPrice >= runnerTargetPrice : currentPrice <= runnerTargetPrice);
      let reason = '';
      if (runnerTargetHit) reason = `Canlı matematiksel runner hedefi: ${(safeNum(trade.adaptive_target_pct)*100).toFixed(3)}%`;
      if (reason) await closeActivePosition(reason);
      return;
    }

    if (analysis.signal && analysis.scalpV2?.signal === analysis.signal && analysis.scalpV2.score >= SCALP_V2_MIN_SCORE) {
      const rawV27: any = analysis.v27 || getV27Sizing(analysis);
      const v27: any = analysis.v27
        ? { highConviction: Boolean(rawV27.highConviction), regime: rawV27.regime, regimeQuality: safeNum(rawV27.regimeQuality), sizeMultiplier: safeNum(rawV27.sizeMultiplier, 1), targetPct: safeNum(rawV27.targetPct), ev: rawV27.ev }
        : { highConviction: Boolean(rawV27.aPlus), regime: rawV27.regime.regime, regimeQuality: rawV27.regime.quality, sizeMultiplier: rawV27.multiplier, targetPct: 0, ev: rawV27.ev };
      if (v27.regime === 'CHAOS') return;
      let margin: number | undefined;
      let leverageForEntry = targetLeverage;
      if (coinSelectionMode === 'ai') {
        const aiPlan = await buildAiPositionPlan(analysis, analysis.signal);
        if (!aiPlan) return;
        margin = aiPlan.margin * 0.40;
        leverageForEntry = aiPlan.leverage;
        addEngineLog('INFO', `[AI KARAR] ${analysis.signal.toUpperCase()} | Güven ${(aiPlan.score*100).toFixed(0)}% | İlk kademe ${margin.toFixed(2)} USDT / toplam hedef ${aiPlan.targetMargin.toFixed(2)} USDT | ${leverageForEntry}x | ${aiPlan.reason}`);
      } else {
        const baseMargin = currentStakeAmount > 0 ? currentStakeAmount : undefined;
        margin = baseMargin !== undefined ? baseMargin * safeNum(v27.sizeMultiplier,1) : undefined;
      }
      const optimizer = getV28Optimizer(analysis);
      const plan = buildLiveExecutionPlan(analysis.signal, analysis, margin || currentStakeAmount, leverageForEntry);
      if (!plan) return;
      const target = plan.expectedMovePct;
      const tp1Fraction = 0.35;
      addEngineLog('INFO', `[LIVE MATH V3] ${analysis.signal.toUpperCase()} | ${v27.highConviction?'A+':'NORMAL'} | V2 ${(analysis.scalpV2.score*100).toFixed(0)}% | Rejim ${v27.regime} ${(v27.regimeQuality*100).toFixed(0)}% | Boyut ${v27.sizeMultiplier.toFixed(2)}x | TP1 ${(tp1Fraction*100).toFixed(0)}% | Runner ${(target*100).toFixed(2)}% | Trail ${(safeNum(optimizer.runnerTrailPct)*100).toFixed(2)}% | Path ${(safeNum(analysis.shortHorizon?.targetBps)).toFixed(1)}bps | ETA ${safeNum(analysis.shortHorizon?.timeToTargetMs)}ms | Net edge ${analysis.scalpV2.netEdgePct.toFixed(3)}%`);
      const trade = await openPosition(analysis.signal, TRADING_PAIR, margin, target, coinSelectionMode === 'ai' ? `AI karar | ${v27.regime}` : `Scalp v2.8 ${v27.highConviction?'A+ High Conviction':'normal'} | ${v27.regime}`, leverageForEntry);
      trade.high_conviction = Boolean(v27.highConviction);
      trade.tp1_fraction = tp1Fraction;
      trade.optimizer_tp1_fraction = tp1Fraction;
      trade.optimizer_runner_trail_pct = 0.0025;
      trade.optimizer_runner_target_pct = target;
      trade.optimizer_bucket = optimizer.bucket;
      trade.tp1_price = analysis.signal === 'long' ? trade.open_rate*(1+Math.max(0.0035,target*0.45)) : trade.open_rate*(1-Math.max(0.0035,target*0.45));
      trade.runner_target_price = trade.open_rate * (analysis.signal === 'long' ? (1+target) : (1-target));
      trade.entry_score = analysis.scalpV2.score;
      trade.entry_regime_quality = v27.regimeQuality;
      trade.entry_size_multiplier = v27.sizeMultiplier;
      const position = activePosition as ActivePosition | null;
      if (!position) {
        addEngineLog('ERROR', `[GİRİŞ] ${trade.pair} işlem kaydı açıldı ancak aktif pozisyon durumu oluşturulamadı; güvenlik için işlem kapatılıyor.`);
        await closeActivePosition('Aktif pozisyon durumu oluşturulamadı');
        return;
      }
      position.highConviction = Boolean(v27.highConviction);
      position.tp1Done = false;
      position.tp1Price = trade.tp1_price;
      position.runnerTargetPrice = trade.runner_target_price;
      position.runnerFraction = 1 - tp1Fraction;
      position.optimizerTp1Fraction = tp1Fraction;
      position.optimizerRunnerTrailPct = safeNum(optimizer.runnerTrailPct, V27_RUNNER_TRAIL_PCT);
      position.optimizerRunnerTargetPct = target;
      position.optimizerBucket = optimizer.bucket;
      position.entryScore = analysis.scalpV2.score;
      position.regimeQuality = v27.regimeQuality;
      position.sizeMultiplier = v27.sizeMultiplier;
      if (coinSelectionMode === 'ai') {
        const aiPlanForLadder = await buildAiPositionPlan(analysis, analysis.signal);
        position.ladderStep = 1;
        position.ladderFractions = [0.40, 0.30, 0.30];
        position.ladderTargetMargin = safeNum(aiPlanForLadder?.targetMargin, safeNum(margin, currentStakeAmount) / 0.40);
        position.ladderLastAddAt = 0;
        position.ladderLastAddPrice = trade.open_rate;
      }
      saveTradingState();
    }
  } catch (error:any) {
    addEngineLog('ERROR', `8-borsa matematik motoru hatası: ${error?.message || error}`);
  } finally {
    isProcessingTrade = false;
  }
}

function startTradingEngine() {
  if (botState === 'running') return;
  botState = 'running';
  addEngineLog('INFO', `Ticaret motoru başlatıldı | SCALP V2 / 8X MICROSTRUCTURE | ${TRADING_PAIR} | ${targetLeverage}x | Order-flow + tüketim + freshness + execution gate` );
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
    ? safeNum(latestBinanceMarkPrice, safeNum(latestMetrics?.currentPrice, t.open_rate))
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
    profit_ratio: t.is_open && activePosition?.trade_id === t.trade_id && latestBinanceInitialMargin > 0
      ? latestBinanceUnrealizedPnl / latestBinanceInitialMargin
      : (t.is_open ? stats.roi : safeNum(t.profit_ratio)),
    profit_pct: (t.is_open && activePosition?.trade_id === t.trade_id && latestBinanceInitialMargin > 0
      ? latestBinanceUnrealizedPnl / latestBinanceInitialMargin
      : (t.is_open ? stats.roi : safeNum(t.profit_ratio))) * 100,
    profit_abs: t.is_open && activePosition?.trade_id === t.trade_id && latestBinanceInitialMargin > 0
      ? latestBinanceUnrealizedPnl
      : (t.is_open ? stats.netPnl : safeNum(t.profit_abs)),
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
    execution_plan: activePosition?.trade_id === t.trade_id ? activePosition.executionPlan : undefined,
    position_map: activePosition?.trade_id === t.trade_id ? activePosition.positionMap : undefined,
    guardian: activePosition?.trade_id === t.trade_id ? { state: activePosition.guardianState, score: activePosition.lastGuardianScore, reason: activePosition.lastGuardianReason, current_stop: activePosition.currentStopPrice } : undefined,
    fee_open: safeNum(t.fee_open),
    fee_close: safeNum(t.fee_close),
    entry_order_id: t.entry_order_id,
    exit_order_id: t.exit_order_id,
    realized_pnl_binance: safeNum(t.realized_pnl_binance),
    commission_binance: safeNum(t.commission_binance),
    funding_binance: safeNum(t.funding_binance),
    reconciled_at: t.reconciled_at,
    exchange_order_id: t.exchange_order_id,
    optimizer_tp1_fraction: safeNum(t.optimizer_tp1_fraction),
    optimizer_runner_trail_pct: safeNum(t.optimizer_runner_trail_pct),
    optimizer_runner_target_pct: safeNum(t.optimizer_runner_target_pct),
    optimizer_bucket: t.optimizer_bucket
  };
}

let latestMarkets: any[] = [];
let scannerLastRun = 0;
let scannerBusy = false;
let scannerSummary: any[] = [];

async function updateMarketsTelemetry() {
  try {
    const markets = await fetchBinancePublic24hrMarkets();
    if (markets && markets.length) latestMarkets = markets;
  } catch {}
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.use(express.json({ limit: '1mb' }));

  const requireApiToken = (req: any, res: any, next: any) => {
    if (!APP_API_TOKEN) {
      return next();
    }
    const supplied = String(req.headers['x-api-token'] || '');
    if (!supplied || supplied !== APP_API_TOKEN) {
      return res.status(401).json({ error: 'API token gerekli veya geçersiz.' });
    }
    next();
  };

  if (!APP_API_TOKEN) {
    addEngineLog('INFO', 'APP_API_TOKEN yapılandırılmadı; dahili REST API erişimi aktif.');
  } else {
    addEngineLog('INFO', 'APP_API_TOKEN koruması devrede.');
  }

  // Read-only market/dashboard endpoints remain available to the dashboard.
  // Mutating and credential-bearing endpoints keep explicit token protection below.

  let liveAnalysisInterval: NodeJS.Timeout | null = null;
  let liveMarketsInterval: NodeJS.Timeout | null = null;

  const updateTelemetry = async () => {
    try {
      const analysis = analyzeEightExchangeOrderBooks(TRADING_PAIR);
      if (analysis) {
        latestEightExchangeAnalysis = analysis;
        const b = analysis.books.binance;
        latestOrderBook = b ? { bids:b.bids, asks:b.asks, timestamp:Date.now() } : latestOrderBook;
        latestMetrics = {
          pair: TRADING_PAIR,
          currentPrice: b ? bookMid(b) : 0,
          OBI: b ? bookOBI(b) : 0,
          crossGapPct: analysis.crossGapPct,
          binanceVsMedianPct: analysis.binanceVsMedianPct,
          medianPrice: analysis.medianPrice,
          minExchange: analysis.minExchange,
          maxExchange: analysis.maxExchange,
          minPrice: analysis.minPrice,
          maxPrice: analysis.maxPrice,
          consensusObi: analysis.consensusObi,
          dispersionPct: analysis.dispersionPct,
          mathematicalScore: analysis.mathematicalScore,
          confidence: analysis.confidence,
          signal: analysis.signal,
          exchanges: analysis.exchanges,
          referenceTargetPct: 0,
          adaptiveTargetPct: (() => { const p = analysis.signal ? buildLiveExecutionPlan(analysis.signal, analysis, currentStakeAmount || 6, targetLeverage) : null; return p ? p.expectedMovePct * 100 : 0; })(),
          adaptiveTargetReason: (() => { const p = analysis.signal ? buildLiveExecutionPlan(analysis.signal, analysis, currentStakeAmount || 6, targetLeverage) : null; return p?.reason || 'Canlı matematiksel hedef'; })(),
          longSignal: analysis.signal === 'long',
          shortSignal: analysis.signal === 'short',
          futuresNativeDepth: getBinanceFuturesNativeHealth(cleanSymbol(TRADING_PAIR).toUpperCase()),
          spotFuturesDivergence: analysis.spotFuturesDivergence,
          divergenceMagnitude: analysis.divergenceMagnitude,
          divergenceConflict: analysis.divergenceConflict,
          scalpV2: analysis.scalpV2,
          v27: analysis.v27,
          v28: getV28Optimizer(analysis),
          executionPlan: analysis.signal ? buildLiveExecutionPlan(analysis.signal, analysis, currentStakeAmount || 6, targetLeverage) : null,
          binanceMarkPrice: latestBinanceMarkPrice,
          binanceUnrealizedPnl: latestBinanceUnrealizedPnl,
          binanceInitialMargin: latestBinanceInitialMargin
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
  startEightExchangeStreams();
  addEngineLog('INFO', `Tek mod aktif: 8 borsa WebSocket + Scalp V2 microstructure motoru | Fiyat farkı artık yumuşak skor bileşeni | Referans %${(minCrossExchangeGap * 100).toFixed(2)}`);
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
        const executionPlan = analysis.signal ? buildLiveExecutionPlan(analysis.signal, analysis, currentStakeAmount || 6, targetLeverage) : null;
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
            futuresNativeDepth: getBinanceFuturesNativeHealth(cleanSymbol(pair).toUpperCase()),
            probabilityLong: analysis.probabilityLong,
            probabilityShort: analysis.probabilityShort,
            volatilityPct: analysis.volatilityPct,
            adaptiveTargetPct: analysis.adaptiveTargetPct * 100,
            adaptiveTargetReason: analysis.adaptiveTargetReason,
            referenceTargetPct: 0,
            longSignal: analysis.longSignal,
            shortSignal: analysis.shortSignal,
            whaleScore: analysis.whaleScore, whaleNetUsdt: analysis.whaleNetUsdt, whaleCount: analysis.whaleCount, whaleDetected: analysis.whaleDetected, executionPlan, historyMinutes: 0, historicalObi: analysis.OBI, historicalScore: 0
          }
        });
      } catch (e: any) {
        return res.status(502).json({ error: e?.message || 'Order Book alınamadı', orderBook: { bids: [], asks: [] }, metrics: null });
      }
    }
    if (!latestOrderBook || !latestMetrics) {
      return res.status(503).json({ error: 'Canlı Order Book henüz hazır değil', orderBook: { bids: [], asks: [] }, metrics: null });
    }
    res.json({ orderBook: latestOrderBook, metrics: latestMetrics, eightExchange: latestEightExchangeAnalysis });
  });


  app.get('/api/v1/optimizer', (_req, res) => {
    res.json({ enabled: false, optimizer: null, source: 'live-math-only', message: 'Geçmiş veri kullanan optimizer kapalıdır.' });
  });


  app.get('/api/v1/ip', async (_req, res) => {
    res.json({ ip: await getOrFetchServerIp(), timestamp: Date.now() });
  });

  app.get('/api/v1/status', async (_req, res) => {
    await syncLivePosition();
    await syncBinanceAccountReconciliation();
    res.json({
      state: botState,
      trading_mode: 'live_futures',
      strategy: 'Eight_Exchange_OrderBook_Arbitrage',
      engine_mode: 'eight_exchange_arbitrage',
      min_gap_pct: minCrossExchangeGap * 100,
      simple_mode_config: simpleModeConfig,
      timeframe: 'orderbook',
      pair: TRADING_PAIR,
      open_trades: allTrades.filter(t => t.is_open).length,
      max_open_trades: maxOpenTrades,
      selector: { mode: coinSelectionMode, professional_manual_pairs: professionalManualPairs, algorithm_scan_assets: algorithmScanAssets, min_opportunity_score: algorithmMinOpportunityScore, min_liquidity_usdt: algorithmMinLiquidityUsdt, max_spread_pct: algorithmMaxSpreadPct, state: scannerBusy ? 'SCANNING' : (scannerSummary.some((x:any)=>x.eligible) ? 'MATCH_FOUND' : 'WAITING_FOR_MATCH'), candidates: scannerSummary.slice(0,10) },
      leverage: targetLeverage,
      margin_mode: marginMode,
      hedge_mode: hedgeMode,
      reference_target_pct: latestMetrics?.adaptiveTargetPct || 0,
      hard_stop_pct: getHardStopPct(targetLeverage) * 100,
      trailing_stop_pct: getRiskProfile().trailingStopPct * 100,
      risk_protection_mode: riskProtectionMode,
      risk_protection_label: getRiskProfile().label,
      risk_protection_profile: getRiskProfile(),
      ai_decision: coinSelectionMode === 'ai' ? { enabled: true, default_risk: 'conservative', candidates: scannerSummary.filter((x:any)=>x.aiDecision).slice(0,5) } : { enabled: false },
      deep_entry_score: DEEP_ENTRY_SCORE,
      deep_reversal_score: DEEP_REVERSAL_SCORE,
      server_ip: await getOrFetchServerIp(),
      deep_analysis_config: deepAnalysisConfig,
      intelligent_mode: intelligentModeConfig,
      deep_analysis: latestMetrics || null,
      eight_exchange: latestEightExchangeAnalysis,
      binance_account: {
        wallet_balance: latestBinanceWalletBalance,
        margin_balance: latestBinanceMarginBalance,
        available_balance: latestBinanceAvailableBalance,
        unrealized_pnl: latestBinanceUnrealizedPnl,
        realized_pnl: latestBinanceRealizedPnl,
        commission: latestBinanceCommission,
        funding: latestBinanceFunding,
        cash_flow: latestBinanceAccountCashFlow,
        account_pnl: latestBinanceAccountPnl,
        account_pnl_pct: startingBalance > 0 ? (latestBinanceAccountPnl / startingBalance) * 100 : 0,
        component_pnl: latestBinanceRealizedPnl - latestBinanceCommission + latestBinanceFunding + latestBinanceUnrealizedPnl,
        reconciliation_gap: latestBinancePnlGap,
        starting_balance: startingBalance,
        starting_balance_timestamp: startingBalanceTimestamp,
        synchronized_at: lastBinanceAccountSync
      },
      scanner: { last_run: scannerLastRun, busy: scannerBusy, candidates: scannerSummary.slice(0, 10) },
      active_position: activePosition ? { trade_id: activePosition.trade_id, pair: TRADING_PAIR, side: activePosition.type, amount: activePosition.amount, margin: activePosition.margin, leverage: activePosition.leverage, entryPrice: activePosition.entryPrice, ladderStep: activePosition.ladderStep || 0, ladderFractions: activePosition.ladderFractions || [], ladderTargetMargin: activePosition.ladderTargetMargin || 0, ladderLastAddAt: activePosition.ladderLastAddAt || 0, ladderLastAddPrice: activePosition.ladderLastAddPrice || 0, ladderLocked: Boolean(activePosition.ladderLocked) } : null,
      persistence: { state_file: STATE_FILE, trade_records: allTrades.length, active_position: Boolean(activePosition) }
    });
  });

  app.get('/api/v1/backtest', (_req, res) => {
    res.status(410).json({ enabled: false, message: 'Backtest ve geçmiş veri motoru bu sürümde bilinçli olarak kapatılmıştır.' });
  });


  app.get('/api/v1/config', requireApiToken, (_req, res) => {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const conf = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        conf.trading_mode = 'futures';
        conf.engine_mode = 'eight_exchange_arbitrage';
        conf.eight_exchange = { ...(conf.eight_exchange || {}), min_gap_pct: minCrossExchangeGap * 100 };
        delete conf.simple_mode; delete conf.intelligent_mode;
        if (conf.exchange) { delete conf.exchange.key; delete conf.exchange.secret; }
        return res.json(conf);
      }
      const conf = { ...initialConfig };
      conf.trading_mode = 'futures';
      conf.engine_mode = 'eight_exchange_arbitrage';
      conf.eight_exchange = { ...(conf.eight_exchange || {}), min_gap_pct: minCrossExchangeGap * 100 };
      delete conf.simple_mode; delete conf.intelligent_mode;
      if (conf.exchange) { delete conf.exchange.key; delete conf.exchange.secret; }
      res.json(conf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/v1/config', requireApiToken, async (req, res) => {
    try {
      const previous = readConfig();
      const conf = { ...(previous || {}), ...(req.body || {}) };
      conf.exchange = { ...(previous?.exchange || {}), ...(req.body?.exchange || {}) };
      if (!conf.exchange.key && process.env.BINANCE_API_KEY) conf.exchange.key = process.env.BINANCE_API_KEY;
      if (!conf.exchange.secret && process.env.BINANCE_SECRET_KEY) conf.exchange.secret = process.env.BINANCE_SECRET_KEY;
      conf.trading_mode = 'futures';
      conf.engine_mode = 'eight_exchange_arbitrage';
      conf.eight_exchange = { ...(conf.eight_exchange || {}), min_gap_pct: minCrossExchangeGap * 100 };
      delete conf.simple_mode; delete conf.intelligent_mode;
      applyConfig(conf);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });

      const k = String(conf.exchange?.key || '').trim();
      const s = String(conf.exchange?.secret || '').trim();
      if (k && s) {
        await initExchange(k, s);
      } else {
        privateExchangeReady = false;
        dryRun = true;
      }

      res.json({
        success: true,
        leverage: targetLeverage,
        margin_mode: marginMode,
        pair: TRADING_PAIR,
        engine_mode: tradingMode,
        live: privateExchangeReady
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

  app.get('/api/v1/binance/wallet', requireApiToken, async (_req, res) => {
    try {
      requirePrivateExchange();
      await syncBinanceAccountReconciliation(true);
      const balance = await getFuturesBalance();
      const positions = typeof exchange.fetchPositions === 'function' ? await exchange.fetchPositions() : [];
      const openPositions = (Array.isArray(positions) ? positions : []).filter((p:any) => Math.abs(safeNum(p?.contracts) || safeNum(p?.info?.positionAmt)) > 0);
      res.json({
        success: true, authenticated: true, live: true,
        wallet_balance_usdt: latestBinanceWalletBalance || balance.total,
        margin_balance_usdt: latestBinanceMarginBalance || balance.total,
        available_balance_usdt: latestBinanceAvailableBalance || balance.free,
        used_margin_usdt: balance.used,
        unrealized_pnl_usdt: latestBinanceUnrealizedPnl,
        positions: openPositions.map((p:any) => ({ symbol:p.symbol, side:p.side, contracts:safeNum(p.contracts) || Math.abs(safeNum(p.info?.positionAmt)), entry_price:safeNum(p.entryPrice) || safeNum(p.info?.entryPrice), mark_price:safeNum(p.markPrice) || safeNum(p.info?.markPrice), unrealized_pnl:safeNum(p.unrealizedPnl) || safeNum(p.info?.unRealizedProfit), leverage:safeNum(p.leverage) }))
      });
    } catch (e:any) {
      res.status(502).json({ success:false, authenticated:privateExchangeReady, live:false, error:classifyBinanceAuthError(e) });
    }
  });

  app.get('/api/v1/binance/execution-health', requireApiToken, async (_req, res) => {
    const symbol=cleanSymbol(TRADING_PAIR).toUpperCase();
    const s=getBinanceFuturesDiffState(symbol);
    let positionCount=0;
    try {
      if(exchange && privateExchangeReady && typeof exchange.fetchPositions==='function'){
        const ps=await exchange.fetchPositions([TRADING_PAIR]);
        positionCount=(Array.isArray(ps)?ps:[]).filter((p:any)=>Math.abs(safeNum(p?.contracts)||safeNum(p?.info?.positionAmt))>0).length;
      }
    } catch {}
    res.json({ authenticated:privateExchangeReady, live:!dryRun&&privateExchangeReady, hedge_mode:hedgeMode, futures_diff:{synced:s.synced,last_update_id:s.lastUpdateId,gap_count:s.gapCount,resync_count:s.resyncCount,age_ms:s.lastEventTs?Date.now()-s.lastEventTs:null,retry_at:s.retryAt,last_error:s.lastError,snapshot_cooldown_ms:Math.max(0,binanceFuturesSnapshotBlockedUntil-Date.now())}, exchange_position_count:positionCount, active_position:Boolean(activePosition) });
  });

  app.get('/api/v1/trades', async (_req, res) => {
    await syncLivePosition();
    const formattedTrades = allTrades.map(tradeToApi);
    res.json({ trades: formattedTrades, trade_count: formattedTrades.length });
  });

  app.get('/api/v1/binance/reconciliation', async (_req, res) => {
    await syncBinanceAccountReconciliation(true);
    const closed = allTrades.filter(t => !t.is_open);
    const realized = closed.reduce((s, t) => s + safeNum(t.realized_pnl_binance), 0);
    const commission = closed.reduce((s, t) => s + safeNum(t.commission_binance), 0);
    const funding = closed.reduce((s, t) => s + safeNum(t.funding_binance), 0);
    const net = closed.reduce((s, t) => s + safeNum(t.profit_abs), 0);
    res.json({
      source: 'Binance userTrades + Futures income/ledger',
      synchronized_at: lastBinanceLedgerSync,
      closed_trades: closed.length,
      reconciled_trades: closed.filter(t => t.reconciled_at).length,
      realized_pnl_usdt: realized,
      commission_usdt: commission,
      funding_usdt: funding,
      net_realized_pnl_usdt: net,
      note: 'Net = realized PnL - commission + funding. Binance fill data is preferred for commission; income/ledger fills funding and any missing realized PnL.'
    });
  });

  app.get('/api/v1/binance/account-pnl', async (_req, res) => {
    await syncBinanceAccountReconciliation(true);
    res.json({
      source: 'Binance Futures wallet/margin balance + income transfers + fills',
      starting_balance_usdt: startingBalance,
      starting_balance_timestamp: startingBalanceTimestamp,
      wallet_balance_usdt: latestBinanceWalletBalance,
      margin_balance_usdt: latestBinanceMarginBalance,
      available_balance_usdt: latestBinanceAvailableBalance,
      cash_flow_usdt: latestBinanceAccountCashFlow,
      account_pnl_usdt: latestBinanceAccountPnl,
      account_pnl_pct: startingBalance > 0 ? (latestBinanceAccountPnl / startingBalance) * 100 : 0,
      component_pnl_usdt: latestBinanceRealizedPnl - latestBinanceCommission + latestBinanceFunding + latestBinanceUnrealizedPnl,
      reconciliation_gap_usdt: latestBinancePnlGap,
      realized_pnl_usdt: latestBinanceRealizedPnl,
      unrealized_pnl_usdt: latestBinanceUnrealizedPnl,
      commission_usdt: latestBinanceCommission,
      funding_usdt: latestBinanceFunding,
      synchronized_at: lastBinanceAccountSync,
      warning: 'Hesap PNL, başlangıçtan sonraki Binance margin balance değişiminden bilinen transfer akışları çıkarılarak hesaplanır. Binance dışı transfer türleri varsa reconciliation gap ayrıca gösterilir.'
    });
  });

  app.get('/api/v1/profit', async (_req, res) => {
    const closed = allTrades.filter(t => !t.is_open);
    const open = allTrades.filter(t => t.is_open);
    const closedProfit = closed.reduce((sum, t) => sum + safeNum(t.profit_abs), 0);
    const openProfit = open.reduce((sum, t) => {
      if (activePosition?.trade_id === t.trade_id && latestBinanceInitialMargin > 0) return sum + latestBinanceUnrealizedPnl;
      const price = safeNum(latestBinanceMarkPrice, safeNum(latestMetrics?.currentPrice, t.open_rate));
      return sum + makeTradeStats(t, price).netPnl;
    }, 0);
    const totalPnl = closedProfit + openProfit;
    const winners = closed.filter(t => safeNum(t.profit_abs) > 0).length;
    const losers = closed.filter(t => safeNum(t.profit_abs) <= 0).length;
    await syncBinanceAccountReconciliation(true);
    const pnlPct = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;
    const accountPnlPct = startingBalance > 0 ? (latestBinanceAccountPnl / startingBalance) * 100 : 0;

    res.json({
      profit_closed_coin: closedProfit,
      profit_open_coin: openProfit,
      total_pnl_usdt: totalPnl,
      total_pnl_pct: pnlPct,
      bot_pnl_usdt: totalPnl,
      binance_account_pnl_usdt: latestBinanceAccountPnl,
      binance_account_pnl_pct: accountPnlPct,
      binance_wallet_balance: latestBinanceWalletBalance,
      binance_margin_balance: latestBinanceMarginBalance,
      binance_available_balance: latestBinanceAvailableBalance,
      binance_cash_flow_usdt: latestBinanceAccountCashFlow,
      binance_pnl_components_usdt: latestBinanceRealizedPnl - latestBinanceCommission + latestBinanceFunding + latestBinanceUnrealizedPnl,
      binance_reconciliation_gap_usdt: latestBinancePnlGap,
      binance_reconciliation_at: lastBinanceAccountSync,
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
      const manualTarget = latestMetrics?.pair === pair ? safeNum(latestMetrics?.adaptiveTargetPct, 0.8) / 100 : REFERENCE_TAKE_PROFIT_PCT;
      const manualReason = latestMetrics?.pair === pair ? String(latestMetrics?.adaptiveTargetReason || 'Canlı matematiksel hedef') : 'Canlı matematiksel hedef';
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

  if (apiKey && secret) {
    const result = await initExchange(apiKey, secret);
    if (!result.success) {
      addEngineLog('WARN', 'Binance LIVE Futures API bağlantısı kurulamadı. Simülasyon (Paper Trading) modunda çalışacak.');
      dryRun = true;
    } else {
      addEngineLog('INFO', 'Binance LIVE Futures API bağlantısı başarılı. Canlı ticaret hazır.');
      dryRun = false;
    }
  } else {
    addEngineLog('INFO', 'Binance özel API kimlik bilgileri girilmedi. Simülasyon (Paper Trading) modu aktif.');
    dryRun = true;
  }

  loadTradingState();
  const initialConf = readConfig();
  if (initialConf) { initialConf.engine_mode = 'eight_exchange_arbitrage'; delete initialConf.simple_mode; delete initialConf.intelligent_mode; applyConfig(initialConf); }

  if (String(initialConf?.initial_state || '') === 'running' || String(botState) === 'running') {
    startTradingEngine();
  }

  await startServer();
})();
