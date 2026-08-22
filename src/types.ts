export type BotState = 'running' | 'stopped';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface BotMetrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl_usdt: number;
  total_pnl_pct: number;
  daily_pnl_usdt: number;
  balance_usdt: number;
  starting_balance: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  profit_factor: number;
  open_trades_count: number;
  max_open_trades: number;
  stake_amount: number | 'unlimited';
  fiat_symbol: string;
  fiat_ratio: number;
}

export interface Trade {
  id: string;
  pair: string;
  is_open: boolean;
  type: 'long' | 'short';
  amount: number;
  leverage: number;
  open_rate: number;
  current_rate: number;
  close_rate?: number;
  open_date: string;
  close_date?: string;
  close_reason?: string;
  profit_ratio: number;
  profit_pct: number;
  profit_abs: number;
  stop_loss_abs: number;
  stop_loss_pct: number;
  fee_open: number;
  fee_close?: number;
  take_profit_abs?: number;
  take_profit_pct?: number;
  exchange_order_id?: string;
  reference_target_pct?: number;
  reference_price_move_pct?: number;
  adaptive_target_pct?: number;
  adaptive_target_price?: number;
  adaptive_target_reason?: string;
  position_mode?: 'one-way' | 'hedge';
  high_conviction?: boolean;
  tp1_fraction?: number;
  runner_target_price?: number;
  optimizer_tp1_fraction?: number;
  optimizer_runner_trail_pct?: number;
  optimizer_runner_target_pct?: number;
  optimizer_bucket?: string;
  short_horizon?: {
    direction?: 'long'|'short'|null; score?: number; longScore?: number; shortScore?: number;
    frontImbalance?: number; microBias?: number;
    liquidityVacuum?: { long?: number; short?: number };
    pathResistance?: { long?: number; short?: number };
    priceImpact?: { long?: number; short?: number };
    flow?: { f100?: number; f250?: number; f500?: number; f1000?: number; acceleration?: number; speed?: number };
    absorption?: { strength?: number; direction?: number; response?: number };
    freshness?: number; ageMs?: number; expectedMovePct?: number; expectedAdversePct?: number;
    timeToTargetMs?: number; targetBps?: number; qualifies?: boolean;
  };
  execution_plan?: {
    expectedFill?: number; fairPrice?: number; stopPrice?: number; tp1Price?: number; runnerTargetPrice?: number;
    expectedMovePct?: number; estimatedRoundTripCostPct?: number; expectedNetPct?: number;
    winProbability?: number; lossProbability?: number; expectedValuePct?: number; riskReward?: number;
    fillProbability?: number; leverage?: number; reason?: string;
  };
}

export interface MarketPairInfo {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  change_24h_pct: number;
  volume_24h_usdt: number;
  high_24h: number;
  low_24h: number;
  in_whitelist: boolean;
  in_blacklist: boolean;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'WARNING' | 'ERROR' | 'TRADE' | 'SYSTEM';
  message: string;
}

export interface Candle {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20?: number;
  sma50?: number;
  bbUpper?: number;
  bbLower?: number;
  rsi?: number;
}
