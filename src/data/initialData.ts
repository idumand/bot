import { BotMetrics, Trade, MarketPairInfo, LogEntry } from '../types';

export const INITIAL_METRICS: BotMetrics = {
  total_trades: 0,
  winning_trades: 0,
  losing_trades: 0,
  win_rate: 0,
  total_pnl_usdt: 0,
  total_pnl_pct: 0,
  daily_pnl_usdt: 0,
  balance_usdt: 0,
  starting_balance: 0,
  max_drawdown_pct: 0,
  sharpe_ratio: 0,
  profit_factor: 0,
  open_trades_count: 0,
  max_open_trades: 1,
  stake_amount: 6,
  fiat_symbol: 'USD',
  fiat_ratio: 1.0,
};

export const INITIAL_TRADES: Trade[] = [];

export const INITIAL_MARKETS: MarketPairInfo[] = [];

export const INITIAL_CONFIG_JSON = JSON.stringify({
  max_open_trades: 1,
  stake_currency: "USDT",
  stake_amount: 6,
  tradable_balance_ratio: 0.99,
  fiat_display_currency: "USD",
  timeframe: "5m",
  cancel_open_orders_on_exit: false,
  trading_mode: "futures",
  engine_mode: "eight_exchange_arbitrage",
  eight_exchange: {
    min_gap_pct: 3
  },
  coin_selection: {
    mode: "manual",
    professional_manual_pairs: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "SUI/USDT"],
    algorithm_scan_assets: 30,
    max_open_trades: 1,
    min_opportunity_score: 0.40,
    min_liquidity_usdt: 200000,
    max_spread_pct: 0.20
  },
  simple_mode: {
    enabled: false,
    orderbook_history_minutes: 5,
    target_market_move_pct: 0.10,
    obi_projection_multiplier_pct: 0.15,
    min_obi: 0.20,
    snapshot_seconds: 5
  },
  margin_mode: "isolated",
  leverage: 15,
  risk_protection: {
    mode: "balanced",
    description: "Dengeli: %1.5 hard stop, %2 başabaş, %3 trailing; derin analiz kâr/zarar koruması aktif"
  },
  deep_analysis: {
    enabled: true,
    history_minutes: 10,
    snapshot_seconds: 5,
    min_long_probability: 0.58,
    min_short_probability: 0.58,
    whale_detection: true,
    whale_window_seconds: 60,
    whale_min_trade_usdt: 500000,
    whale_net_flow_usdt: 1000000,
    whale_position_multiplier: 1.5,
    whale_max_multiplier: 2.5,
    whale_requires_directional_confirmation: true,
  },
  unfilledtimeout: {
    entry: 10,
    exit: 10,
    exit_timeout_count: 0,
    unit: "minutes"
  },
  entry_pricing: {
    price_side: "same",
    use_order_book: true,
    order_book_top: 1
  },
  exit_pricing: {
    price_side: "same",
    use_order_book: true
  },
  exchange: {
    name: "binanceusdm",
    key: "",
    secret: "",
    ccxt_config: { "enableRateLimit": true },
    ccxt_async_config: { "enableRateLimit": true },
    pair_whitelist: [
      "BTC/USDT",
      "ETH/USDT",
      "SOL/USDT",
      "BNB/USDT",
      "XRP/USDT",
      "ADA/USDT"
    ],
    pair_blacklist: [
      "DOGE/USDT"
    ]
  },
  pairlists: [
    { "method": "StaticPairList" },
    { "method": "VolumePairList", "number_assets": 20, "sort_key": "quoteVolume" }
  ],
  api_server: {
    enabled: true,
    listen_ip_address: "0.0.0.0",
    listen_port: 3000,
    verbosity: "info"
  },
  bot_name: "freqtrade_sfeef_bot",
  initial_state: "running"
}, null, 2);

export const INITIAL_LOGS: LogEntry[] = [];
