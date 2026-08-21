import { BotMetrics, StrategyInfo, Trade, MarketPairInfo, LogEntry } from '../types';

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
  stake_amount: 1000,
  fiat_symbol: 'USD',
  fiat_ratio: 1.0,
};

export const INITIAL_TRADES: Trade[] = [];

export const INITIAL_MARKETS: MarketPairInfo[] = [];

export const STRATEGIES: Record<string, StrategyInfo> = {
  OrderFlow_Quantitative: {
    name: 'OrderFlow_Quantitative_V1',
    description: 'Yüksek frekanslı (HFT) mikroyapı analizi yapan nicel motor. Order Book Imbalance (OBI), Micro-Price ve Hacim Deltasını kullanarak pozisyon yönetir.',
    timeframe: 'tick',
    minimal_roi: {
      '0': 0.10
    },
    stoploss: -0.015,
    trailing_stop: true,
    trailing_stop_positive: 0.012,
    process_only_new_candles: false,
    use_exit_signal: true,
    code_python: `# --- OrderFlow Quantitative Engine (Node.js Ported) ---
# Bu strateji matematiksel emir defteri okuması (Order Book Imbalance) yapar.
# Python kod blokları sadece görsel temsildir. Gerçek algoritmik yürütme 
# server.ts içindeki 'executeRealTradeLogic' üzerinden yapılmaktadır.

# 1. Spot merkezli çok katmanlı Order Book analizi
# 500 Spot kademe içinden yakın seviyelere daha yüksek ağırlık verilir.
# OBI, Micro-Price, gerçek agresif trade delta, likidite baskısı, OBI hızı/ivmesi ve derinlik değişimi birleştirilir.
# Futures Order Book yalnızca teyit filtresidir; ana yön Spot emir defterinden çıkarılır.

# 2. Micro-Price Hesaplaması
# MicroPrice = (V_bid * P_ask + V_ask * P_bid) / (V_bid + V_ask)
# MicroPrice - MidPrice farkı normalize edilerek skora eklenir.

# 3. Gerçekleşen işlem deltası
# Binance Spot aggTrades üzerinden Delta = agresif alış hacmi - agresif satış hacmi.
# OBI ve Delta aynı yönde değilse giriş filtresi sıkılaşır.

# 4. Matematiksel yön olasılığı
# Composite Score sigmoid fonksiyonu ile yukarı/aşağı yön olasılığına çevrilir.
# LONG/SHORT yalnızca >= %70 model olasılığı, spread ve çoklu teyit şartları sağlanırsa açılır.

# 5. 1x referans hedefi
# Hedef kaldıraçtan bağımsız olarak %10 piyasa hareketidir.
# 15x pozisyonda da motor %10 fiyat hareketini hedefler; ROI yaklaşık 150% olur (ücretler hariç).

# 6. Sürekli pozisyon analizi
# Pozisyon açıkken order book her motor turunda yeniden analiz edilir.
# Kâr oluşmuşken karşı yön DeepScore iki tur doğrulanırsa hedef beklenmeden çıkılır.

# 7. Zarar koruması
# Üç risk profili vardır: Muhafazakar, Dengeli, Agresif. Seçim hard stop, başabaş, trailing ve derin analiz eşiklerini birlikte değiştirir.
# Pozisyon kâra geçtiğinde derin analiz ters dönüşü doğrularsa hedef beklenmeden kâr korunur; zarar oluştuğunda da derin analiz ters baskıyı doğrularsa hard stop beklenmeden çıkılır.
# Canlı Futures'ta STOP_MARKET koruması borsada tutulur.
`
  }
};
export const INITIAL_CONFIG_JSON = JSON.stringify({
  max_open_trades: 1,
  stake_currency: "USDT",
  stake_amount: 1000,
  tradable_balance_ratio: 0.99,
  fiat_display_currency: "USD",
  timeframe: "5m",
  cancel_open_orders_on_exit: false,
  trading_mode: "futures",
  engine_mode: "professional",
  coin_selection: {
    mode: "manual",
    max_open_trades: 1,
    min_opportunity_score: 0.62,
    min_liquidity_usdt: 250000,
    max_spread_pct: 0.12
  },
  simple_mode: {
    enabled: false,
    orderbook_history_minutes: 5,
    target_market_move_pct: 0.10,
    obi_projection_multiplier_pct: 0.15,
    min_obi: 0.45,
    snapshot_seconds: 5
  },
  margin_mode: "isolated",
  leverage: 5,
  risk_protection: {
    mode: "balanced",
    description: "Dengeli: %1.5 hard stop, %2 başabaş, %3 trailing; derin analiz kâr/zarar koruması aktif"
  },
  deep_analysis: {
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
