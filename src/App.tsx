import React, { useState, useEffect, useRef } from 'react';
import {
  BotState,
  BotMetrics,
  Trade,
  MarketPairInfo,
  Candle,
  StrategyInfo,
  LogEntry,
  Timeframe,
} from './types';
import {
  INITIAL_METRICS,
  INITIAL_TRADES,
  INITIAL_MARKETS,
  STRATEGIES,
  INITIAL_CONFIG_JSON,
  INITIAL_LOGS,
  generateCandles,
} from './data/initialData';
import { Header } from './components/Header';
import { BinanceSettingsModal } from './components/BinanceSettingsModal';
import { TradingDashboard } from './components/TradingDashboard';
import { StrategyStudio } from './components/StrategyStudio';
import { PairlistsManager } from './components/PairlistsManager';
import { ConfigEditor } from './components/ConfigEditor';
import { ApiDocumentation } from './components/ApiDocumentation';
import { LogsViewer } from './components/LogsViewer';

export function App() {
  const [botState, setBotState] = useState<BotState>('stopped');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [serverIp, setServerIp] = useState<string>('Tespit ediliyor...');

  const [metrics, setMetrics] = useState<BotMetrics>(INITIAL_METRICS);
  const [trades, setTrades] = useState<Trade[]>(INITIAL_TRADES);
  const [markets, setMarkets] = useState<MarketPairInfo[]>(INITIAL_MARKETS);
  const [selectedPair, setSelectedPair] = useState('BTC/USDT');
  const selectedPairRef = useRef(selectedPair);

  useEffect(() => {
    selectedPairRef.current = selectedPair;
  }, [selectedPair]);

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [strategies, setStrategies] = useState<Record<string, StrategyInfo>>(STRATEGIES);
  const [selectedStrategy, setSelectedStrategy] = useState('OrderFlow_Quantitative');
  const [configJson, setConfigJson] = useState(INITIAL_CONFIG_JSON);
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);

  // Poll Backend Engine State & Logs
  useEffect(() => {
    const fetchEngineStatus = async () => {
      try {
        const [statusRes, logsRes] = await Promise.all([
          fetch('/api/v1/status'),
          fetch('/api/v1/logs')
        ]);
        const statusData = await statusRes.json();
        const logsData = await logsRes.json();
        
        if (statusData.state) setBotState(statusData.state);
        if (statusData.server_ip) setServerIp(statusData.server_ip);
        
        if (logsData.logs && Array.isArray(logsData.logs)) {
          // Merge logs, preferring backend logs for new entries
          setLogs(prev => {
             const newLogs = [...logsData.logs];
             const oldLogs = prev.filter(p => !newLogs.find(n => n.id === p.id));
             return [...newLogs, ...oldLogs].slice(0, 50);
          });
        }
      } catch (e) {
         // Silently ignore fetch errors
      }
    };
    fetchEngineStatus();
    const interval = setInterval(fetchEngineStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Binance Live Market Data WebSocket
  useEffect(() => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          const priceMap = new Map<string, number>();
          data.forEach((item: any) => {
            if (item.s && item.c) {
              priceMap.set(item.s, parseFloat(item.c));
            }
          });

          setMarkets((prevMarkets) => {
            let changed = false;
            const newMarkets = prevMarkets.map((m) => {
              const binanceSymbol = m.symbol.replace('/', '');
              if (priceMap.has(binanceSymbol)) {
                const newPrice = priceMap.get(binanceSymbol);
                if (newPrice && newPrice !== m.price) {
                  changed = true;
                  return { ...m, price: newPrice };
                }
              }
              return m;
            });
            return changed ? newMarkets : prevMarkets;
          });

          setTrades((prevTrades) => {
            let changed = false;
            const newTrades = prevTrades.map((t) => {
              if (!t.is_open) return t;
              const binanceSymbol = t.pair.replace('/', '');
              if (priceMap.has(binanceSymbol)) {
                const newRate = priceMap.get(binanceSymbol) || t.current_rate;
                if (newRate !== t.current_rate) {
                  changed = true;
                  const profitPct = t.type === 'short' 
                    ? Number((((t.open_rate - newRate) / t.open_rate) * 100 * t.leverage).toFixed(2))
                    : Number((((newRate - t.open_rate) / t.open_rate) * 100 * t.leverage).toFixed(2));
                  const profitAbs = t.type === 'short'
                    ? Number(((t.open_rate - newRate) * t.amount).toFixed(2))
                    : Number(((newRate - t.open_rate) * t.amount).toFixed(2));
                  return {
                    ...t,
                    current_rate: newRate,
                    profit_pct: profitPct,
                    profit_abs: profitAbs,
                    profit_ratio: profitPct / 100,
                  };
                }
              }
              return t;
            });
            return changed ? newTrades : prevTrades;
          });

          // Update chart candles for live flow
          const currentPair = selectedPairRef.current;
          const binanceSymbolForCandle = currentPair.replace('/', '');
          if (priceMap.has(binanceSymbolForCandle)) {
            const newPrice = priceMap.get(binanceSymbolForCandle)!;
            setCandles((prevCandles) => {
              if (prevCandles.length === 0) return prevCandles;
              const lastCandle = prevCandles[prevCandles.length - 1];
              if (lastCandle.close !== newPrice) {
                const updatedCandle = { ...lastCandle };
                updatedCandle.close = newPrice;
                if (newPrice > updatedCandle.high) updatedCandle.high = newPrice;
                if (newPrice < updatedCandle.low) updatedCandle.low = newPrice;
                return [
                  ...prevCandles.slice(0, prevCandles.length - 1),
                  updatedCandle
                ];
              }
              return prevCandles;
            });
          }
        }
      } catch (err) {
        // Ignore WS errors
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Live API Balance Fetcher
  useEffect(() => {
    const fetchLiveBalance = async () => {
      try {
        const res = await fetch('/api/v1/balance');
        const data = await res.json();
        if (data.live && typeof data.balance_usdt === 'number') {
          setMetrics((prev) => ({ ...prev, balance_usdt: data.balance_usdt }));
        }
      } catch (e) {
        // Ignore fetch errors silently
      }
    };
    
    // Fetch immediately
    fetchLiveBalance();
    
    // Poll every 10 seconds
    const interval = setInterval(fetchLiveBalance, 10000);
    return () => clearInterval(interval);
  }, []);

  // Update candles when selected pair or timeframe changes
  useEffect(() => {
    let isMounted = true;
    const fetchKlines = async () => {
      try {
        const binanceSymbol = selectedPair.replace('/', '');
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${timeframe}&limit=80`);
        const data = await res.json();
        if (Array.isArray(data) && isMounted) {
          const formattedCandles = data.map((d: any) => ({
            time: new Date(d[0]).toISOString(),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
          }));
          setCandles(formattedCandles);
        }
      } catch (e) {
        if (isMounted) {
          // fallback to mock if fetch fails
          setCandles(generateCandles(selectedPair, timeframe, 80));
        }
      }
    };
    fetchKlines();
    return () => { isMounted = false; };
  }, [selectedPair, timeframe]);

  // Handlers
  const handleForceCloseTrade = (tradeId: string) => {
    setTrades((prev) =>
      prev.map((t) => {
        if (t.id === tradeId) {
          addLog('TRADE', `Force exit executed for ${t.pair} at ${t.current_rate} USDT (PnL: ${t.profit_pct}%)`);
          return {
            ...t,
            is_open: false,
            close_rate: t.current_rate,
            close_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
            close_reason: 'force_sell',
          };
        }
        return t;
      })
    );
  };

  const handleForceBuy = (pair: string) => {
    const market = markets.find((m) => m.symbol === pair);
    const rate = market ? market.price : 62000;
    const amount = Number((1000 / rate).toFixed(4));
    const newTrade: Trade = {
      id: `FT-${Math.floor(1000 + Math.random() * 9000)}`,
      pair,
      is_open: true,
      amount,
      open_rate: rate,
      current_rate: rate,
      open_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
      profit_ratio: 0,
      profit_pct: 0,
      profit_abs: 0,
      stop_loss_abs: Number((rate * 0.97).toFixed(2)),
      stop_loss_pct: -3.0,
      initial_stop_loss_pct: -3.0,
      take_profit_pct: 5.0,
      leverage: 1,
      type: 'long',
      fee_open: 0.0005,
      fee_close: 0.0005,
    };

    setTrades((prev) => [newTrade, ...prev]);
    addLog('TRADE', `Manuel hızlı satın alma uygulandı: ${pair} @ ${rate} USDT`);
  };

  const handleReloadStrategy = () => {
    addLog('INFO', `Strateji ve yapılandırma JSON dosyası yeniden yüklendi: ${selectedStrategy}`);
  };

  const handleToggleWhitelist = (symbol: string) => {
    setMarkets((prev) =>
      prev.map((m) => (m.symbol === symbol ? { ...m, in_whitelist: !m.in_whitelist } : m))
    );
  };

  const handleToggleBlacklist = (symbol: string) => {
    setMarkets((prev) =>
      prev.map((m) => (m.symbol === symbol ? { ...m, in_blacklist: !m.in_blacklist } : m))
    );
  };

  const handleAddPair = (symbol: string) => {
    if (markets.some((m) => m.symbol === symbol)) return;
    const newMarket: MarketPairInfo = {
      symbol,
      base: symbol.split('/')[0] || 'CRYPTO',
      quote: 'USDT',
      price: 100.0,
      change_24h_pct: 1.5,
      volume_24h_usdt: 50000000,
      high_24h: 105.0,
      low_24h: 98.0,
      in_whitelist: true,
      in_blacklist: false,
      signal: 'BUY',
    };
    setMarkets((prev) => [...prev, newMarket]);
    addLog('INFO', `Beyaz listeye yeni parite eklendi: ${symbol}`);
  };

  const addLog = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 50)]);
  };

  const handleToggleBotState = async (newState: BotState) => {
    try {
      if (newState === 'running') {
        await fetch('/api/v1/start', { method: 'POST' });
        setBotState('running');
      } else {
        await fetch('/api/v1/stop', { method: 'POST' });
        setBotState('stopped');
      }
    } catch (e) {
      addLog('ERROR', 'Sunucuya bağlanılamadı. Motor durumu değiştirilemedi.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col">
      <Header
        botState={botState}
        metrics={metrics}
        selectedStrategy={selectedStrategy}
        serverIp={serverIp}
        onToggleBotState={handleToggleBotState}
        onReloadStrategy={handleReloadStrategy}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenSettings={() => setIsApiModalOpen(true)}
      />

      <BinanceSettingsModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        serverIp={serverIp}
        onSave={async (apiKey, secretKey) => {
          try {
            const res = await fetch('/api/v1/exchange-keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey, secretKey })
            });
            const data = await res.json();
            if (data.success) {
              addLog('SYSTEM', 'Binance API anahtarları kaydedildi ve motor aktif.');
            } else {
              addLog('ERROR', 'Binance API anahtarları hatalı veya doğrulanamadı.');
            }
          } catch (e) {
            addLog('ERROR', 'Sunucuya bağlanılamadı.');
          }
        }}
      />

      <main className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-4 sm:py-6 flex-1 w-full overflow-x-hidden">
        {activeTab === 'dashboard' && (
          <TradingDashboard
            metrics={metrics}
            trades={trades}
            markets={markets}
            candles={candles}
            selectedPair={selectedPair}
            setSelectedPair={setSelectedPair}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            onForceCloseTrade={handleForceCloseTrade}
            logs={logs}
            onForceBuy={handleForceBuy}
          />
        )}

        {activeTab === 'strategies' && (
          <StrategyStudio
            strategies={strategies}
            selectedStrategy={selectedStrategy}
            onSelectStrategy={setSelectedStrategy}
            onSaveStrategy={(name, updated) => setStrategies((prev) => ({ ...prev, [name]: updated }))}
          />
        )}

        {activeTab === 'pairlists' && (
          <PairlistsManager
            markets={markets}
            onToggleWhitelist={handleToggleWhitelist}
            onToggleBlacklist={handleToggleBlacklist}
            onAddPair={handleAddPair}
          />
        )}

        {activeTab === 'config' && (
          <ConfigEditor
            initialConfigJson={configJson}
            onSaveConfig={async (jsonStr) => {
              setConfigJson(jsonStr);
              addLog('INFO', 'Node.js config.json parametreleri güncellendi');
              try {
                await fetch('/api/v1/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: jsonStr
                });
              } catch (e) {
                // ignore
              }
            }}
          />
        )}

        {activeTab === 'api' && <ApiDocumentation />}

        {activeTab === 'logs' && (
          <LogsViewer logs={logs} onClearLogs={() => setLogs([])} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1e232f] bg-[#151921] py-4 text-center text-xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap justify-between items-center gap-2">
          <span>freqtrade sfeef v2024.8 — Açık Kaynaklı Kripto Algoritmik Ticaret Aracı</span>
          <span>Node.js / Express / React Fullstack Web Uygulaması</span>
        </div>
      </footer>
    </div>
  );
}
