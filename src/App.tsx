import React, { useState, useEffect, useRef } from 'react';
import {
  BotState,
  BotMetrics,
  Trade,
  MarketPairInfo,
  Candle,
  LogEntry,
  Timeframe,
} from './types';
import {
  INITIAL_METRICS,
  INITIAL_TRADES,
  INITIAL_MARKETS,
  INITIAL_CONFIG_JSON,
  INITIAL_LOGS,
} from './data/initialData';
import { calculateIndicators } from './utils/indicators';
import { Header } from './components/Header';
import { TradingDashboard } from './components/TradingDashboard';
import { PairlistsManager } from './components/PairlistsManager';
import { ConfigEditor } from './components/ConfigEditor';
import { ApiDocumentation } from './components/ApiDocumentation';
import { LogsViewer } from './components/LogsViewer';

const API_TOKEN = String(import.meta.env.VITE_API_TOKEN || '');
const authHeaders: Record<string, string> = API_TOKEN ? { 'X-API-Token': API_TOKEN } : {};

export function App() {
  const [botState, setBotState] = useState<BotState>('stopped');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [serverIp, setServerIp] = useState<string>('Tespit ediliyor...');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const [metrics, setMetrics] = useState<BotMetrics>(INITIAL_METRICS);
  const [trades, setTrades] = useState<Trade[]>(INITIAL_TRADES);
  const [markets, setMarkets] = useState<MarketPairInfo[]>(INITIAL_MARKETS);
  const [selectedPair, setSelectedPair] = useState('BTC/USDT');
  const [isExchangeConnected, setIsExchangeConnected] = useState<boolean>(false);
  const selectedPairRef = useRef(selectedPair);

  useEffect(() => {
    selectedPairRef.current = selectedPair;
  }, [selectedPair]);

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [configJson, setConfigJson] = useState(INITIAL_CONFIG_JSON);
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);

  // Fetch Initial Config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/v1/config', { headers: authHeaders });
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          setConfigJson(JSON.stringify(data, null, 2));
          if (data.stake_amount) {
            setMetrics(prev => ({ 
              ...prev, 
              stake_amount: data.stake_amount === 'unlimited' ? ('unlimited' as any) : Number(data.stake_amount) 
            }));
          }
        }
      } catch (e) {}
    };
    fetchConfig();
  }, []);

  // Poll Backend Engine State & Logs
  useEffect(() => {
    const fetchEngineStatus = async () => {
      try {
        const [statusRes, logsRes, tradesRes, profitRes] = await Promise.all([
          fetch('/api/v1/status', { headers: authHeaders }),
          fetch('/api/v1/logs', { headers: authHeaders }),
          fetch('/api/v1/trades', { headers: authHeaders }),
          fetch('/api/v1/profit', { headers: authHeaders })
        ]);
        const statusData = await statusRes.json();
        const logsData = await logsRes.json();
        const tradesData = await tradesRes.json();
        const profitData = await profitRes.json();
        if (tradesData.trades) {
          // Backend is the single source of truth for positions and P/L.
          // Never overwrite it with stale client-side WebSocket calculations.
          setTrades(tradesData.trades);
        }
        if (profitData) {
          setMetrics(prev => ({
            ...prev,
            total_pnl_usdt: Number(profitData.total_pnl_usdt ?? profitData.profit_closed_coin ?? 0),
            total_pnl_pct: Number(profitData.total_pnl_pct ?? 0),
            total_trades: Number(profitData.total_trades ?? 0),
            winning_trades: Number(profitData.winning_trades ?? 0),
            losing_trades: Number(profitData.losing_trades ?? 0),
            win_rate: Number(profitData.winrate ?? 0) * 100,
          }));
        }
        
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

  // Load and continuously refresh the real Binance USDT-M Futures symbol universe.
  useEffect(() => {
    let isMounted = true;
    const fetchMarkets = async () => {
      try {
        const res = await fetch('/api/v1/markets', { headers: authHeaders });
        const data = await res.json();
        if (isMounted && Array.isArray(data.markets) && data.markets.length > 0) {
          setMarkets(data.markets);
          if (!data.markets.some((m: MarketPairInfo) => m.symbol === selectedPairRef.current)) {
            setSelectedPair(data.markets[0].symbol);
          }
        }
      } catch {
        // Keep current state on transient failure
      }
    };
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Binance Live Market Data WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      ws = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');

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
              if (!prevMarkets.length) return prevMarkets;
              let changed = false;
              const newMarkets = prevMarkets.map((m) => {
                const binanceSymbol = m.symbol.replace('/', '');
                const item = data.find((x: any) => x.s === binanceSymbol);
                if (item) {
                  const newPrice = Number(item.c);
                  if (Number.isFinite(newPrice) && newPrice !== m.price) {
                    changed = true;
                    return {
                      ...m,
                      price: newPrice,
                      change_24h_pct: Number(item.o) > 0 ? ((newPrice - Number(item.o)) / Number(item.o)) * 100 : m.change_24h_pct,
                      volume_24h_usdt: Number(item.q || 0) || m.volume_24h_usdt,
                      high_24h: Number(item.h || m.high_24h),
                      low_24h: Number(item.l || m.low_24h),
                    };
                  }
                }
                return m;
              });
              return changed ? newMarkets : prevMarkets;
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
        } catch {}
      };

      ws.onerror = () => {
        try { ws?.close(); } catch {}
      };

      ws.onclose = () => {
        reconnectTimeout = setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  // Live API Balance Fetcher
  useEffect(() => {
    let isMounted = true;
    const fetchLiveBalance = async () => {
      try {
        const res = await fetch('/api/v1/balance', { headers: authHeaders });
        const data = await res.json();
        if (isMounted) {
          setIsExchangeConnected(Boolean(data.authenticated && data.live));
          if (typeof data.balance_usdt === 'number') {
            setMetrics((prev) => ({ ...prev, balance_usdt: data.balance_usdt }));
          }
        }
      } catch (e) {
        // Ignore fetch errors silently
      }
    };
    
    // Fetch immediately
    fetchLiveBalance();
    
    // Poll every 3 seconds for immediate balance updates
    const interval = setInterval(fetchLiveBalance, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Real-Time Live Binance Futures Kline WebSocket & Data Fetcher
  useEffect(() => {
    let isMounted = true;
    let klineWs: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const binanceSymbol = selectedPair.replace('/', '').toLowerCase();

    // 1. Initial and periodic Kline sync
    const fetchKlines = async () => {
      try {
        let formattedCandles: Candle[] = [];

        // Direct Binance Futures public klines API
        try {
          const res = await fetch(`/api/v1/klines?symbol=${encodeURIComponent(selectedPair)}&interval=${timeframe}&limit=80`, { headers: authHeaders });
          if (res.ok) {
            const data = await res.json();
            // Backend returns { symbol, interval, candles }, while older builds
            // returned the raw Binance array. Accept both shapes so chart loading
            // cannot silently fail after an API response-shape change.
            const rows = Array.isArray(data) ? data : (Array.isArray(data?.candles) ? data.candles : []);
            if (rows.length) {
              formattedCandles = rows.map((d: any) => ({
                time: d.time ? String(d.time).slice(11, 19) : new Date(Number(d.timestamp ?? d[0])).toISOString().slice(11, 19),
                timestamp: Number(d.timestamp ?? d[0]),
                open: Number(d.open ?? d[1]),
                high: Number(d.high ?? d[2]),
                low: Number(d.low ?? d[3]),
                close: Number(d.close ?? d[4]),
                volume: Number(d.volume ?? d[5]),
              })).filter((c: Candle) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite));
            }
          }
        } catch {}

        if (isMounted && formattedCandles.length > 0) {
          setCandles(calculateIndicators(formattedCandles));
        }
      } catch (e) {
        // Keep current candles on network error
      }
    };

    fetchKlines();

    // 2. Connect Dedicated Real-Time Binance Futures Kline WebSocket
    const connectKlineWs = () => {
      try {
        const streamName = `${binanceSymbol}@kline_${timeframe}`;
        klineWs = new WebSocket(`wss://fstream.binance.com/ws/${streamName}`);

        klineWs.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.e === 'kline' && msg.k) {
              const k = msg.k;
              const candleStart = Number(k.t);
              const open = parseFloat(k.o);
              const high = parseFloat(k.h);
              const low = parseFloat(k.l);
              const close = parseFloat(k.c);
              const volume = parseFloat(k.v);
              const timeStr = new Date(candleStart).toISOString().slice(11, 19);

              if (isMounted && Number.isFinite(close)) {
                setCandles((prev) => {
                  if (!prev || prev.length === 0) {
                    return calculateIndicators([{
                      time: timeStr,
                      timestamp: candleStart,
                      open,
                      high,
                      low,
                      close,
                      volume,
                    }]);
                  }

                  const lastIndex = prev.length - 1;
                  const last = prev[lastIndex];

                  if (last.timestamp === candleStart) {
                    // Update current in-flight candle
                    const updated: Candle = {
                      ...last,
                      high: Math.max(last.high, high),
                      low: Math.min(last.low, low),
                      close,
                      volume,
                    };
                    const nextList = [...prev.slice(0, lastIndex), updated];
                    return calculateIndicators(nextList);
                  } else if (candleStart > (last.timestamp || 0)) {
                    // New candle opened
                    const newCandle: Candle = {
                      time: timeStr,
                      timestamp: candleStart,
                      open,
                      high,
                      low,
                      close,
                      volume,
                    };
                    const nextList = [...prev.slice(-79), newCandle];
                    return calculateIndicators(nextList);
                  }
                  return prev;
                });
              }
            }
          } catch {}
        };

        klineWs.onerror = () => {
          try { klineWs?.close(); } catch {}
        };

        klineWs.onclose = () => {
          if (isMounted) {
            reconnectTimer = setTimeout(connectKlineWs, 3000);
          }
        };
      } catch {}
    };

    connectKlineWs();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (klineWs) {
        klineWs.onclose = null;
        klineWs.close();
      }
    };
  }, [selectedPair, timeframe]);

  // Handlers
  
  const handleForceCloseTrade = async (tradeId: string) => {
    try {
      const res = await fetch('/api/v1/forceexit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ tradeid: tradeId })
      });
      const data = await res.json();
      if (data.status === 'success') {
         addLog('SYSTEM', 'İşlem başarıyla Binance üzerinden zorla kapatıldı.');
         // Update UI locally just to be fast, it will be overwritten by fetchTrades next tick
         setTrades((prev) =>
          prev.map((t) => {
            if (t.id === tradeId) {
              return {
                ...t,
                is_open: false,
                close_rate: t.current_rate,
                close_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
                close_reason: 'Kullanıcı Manuel',
              };
            }
            return t;
          })
        );
      } else {
         addLog('ERROR', data.error || 'İşlem kapatılırken bir hata oluştu.');
      }
    } catch (e) {
      addLog('ERROR', 'Sunucuya bağlanılamadı. İşlem kapatılamadı.');
    }
  };

  const handleForceEntry = async (pair: string, side: 'long' | 'short') => {
    try {
      const res = await fetch('/api/v1/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ pair, side }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        addLog('ERROR', data.error || 'Futures giriş emri reddedildi.');
        return;
      }
      addLog('TRADE', `${side === 'long' ? 'LONG' : 'SHORT'} ${pair} açıldı. LIVE Futures emri gönderildi.`);
    } catch (e) {
      addLog('ERROR', 'Sunucuya bağlanılamadı. Futures giriş emri gönderilemedi.');
    }
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
      id: Date.now().toString() + Math.random().toString(36).substring(2),
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 50)]);
  };

  const handleToggleBotState = async (newState: BotState) => {
    try {
      if (newState === 'running') {
        await fetch('/api/v1/start', { method: 'POST', headers: authHeaders });
        setBotState('running');
      } else {
        await fetch('/api/v1/stop', { method: 'POST', headers: authHeaders });
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
        serverIp={serverIp}
        isExchangeConnected={isExchangeConnected}
        onToggleBotState={handleToggleBotState}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={() => setShowLogoutModal(true)}
      />

      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#151921] border border-[#1e232f] rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-2">Çıkış Yap</h3>
            <p className="text-slate-400 text-sm mb-6">
              Binance API anahtarlarınızı silerek cüzdandan çıkış yapmak istediğinize emin misiniz? (Bakiye 0$ olarak görünecektir).
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-[#1e232f] transition"
              >
                İptal
              </button>
              <button
                onClick={async () => {
                  try {
                    let parsed: any = { exchange: { key: '', secret: '' } };
                    try { parsed = JSON.parse(configJson); } catch (e) {}
                    if (!parsed.exchange) parsed.exchange = {};
                    parsed.exchange.key = '';
                    parsed.exchange.secret = '';
                    const newJson = JSON.stringify(parsed, null, 2);
                    setConfigJson(newJson);
                    await fetch('/api/v1/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify(parsed)
                    });
                    await fetch('/api/v1/exchange-keys', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({ apiKey: '', secretKey: '' })
                    });
                    addLog('SYSTEM', 'Cüzdandan çıkış yapıldı.');
                  } catch (e) {}
                  setShowLogoutModal(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-500 hover:bg-rose-600 text-white transition shadow-lg shadow-rose-500/20"
              >
                Evet, Çıkış Yap
              </button>
            </div>
          </div>
        </div>
      )}

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
            onForceEntry={handleForceEntry}
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
            markets={markets}
            onSaveConfig={async (jsonStr) => {
              setConfigJson(jsonStr);
              addLog('INFO', 'Node.js ayarları güncellendi');
              try {
                // First save the config
                await fetch('/api/v1/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: jsonStr
                });

                // Then try to validate exchange keys if they exist in the config
                const parsed = JSON.parse(jsonStr);
                
                if (parsed.stake_amount) {
                   setMetrics(prev => ({ 
                     ...prev, 
                     stake_amount: parsed.stake_amount === 'unlimited' ? ('unlimited' as any) : Number(parsed.stake_amount) 
                   }));
                }

                const apiKey = parsed?.exchange?.key || '';
                const secretKey = parsed?.exchange?.secret || '';

                const res = await fetch('/api/v1/exchange-keys', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: JSON.stringify({ apiKey, secretKey })
                });
                const data = await res.json();
                
                if (apiKey && secretKey) {
                  if (data.success) {
                    if (typeof data.balance_usdt === 'number') {
                      setMetrics(prev => ({ ...prev, balance_usdt: data.balance_usdt }));
                    }
                    addLog('SYSTEM', `Binance Vadeli İşlemler API bağlandı! Güncel Bakiye: $${data.balance_usdt !== undefined ? Number(data.balance_usdt).toFixed(2) : '---'} USDT`);
                    alert(`Başarılı! Binance Vadeli İşlemler API bağlandı.\n\nVadeli Cüzdan Bakiyeniz: $${data.balance_usdt !== undefined ? Number(data.balance_usdt).toFixed(2) : '0.00'} USDT`);
                    
                    // Fetch live balance right away
                    try {
                      const bRes = await fetch('/api/v1/balance', { headers: authHeaders });
                      const bData = await bRes.json();
                      if (typeof bData.balance_usdt === 'number') {
                        setMetrics(prev => ({ ...prev, balance_usdt: bData.balance_usdt }));
                      }
                    } catch(e) {}
                  } else {
                    const errMsg = data.message || 'Bilinmeyen Hata';
                    addLog('ERROR', `Binance API hatası: ${errMsg}${data.server_ip ? ` | Sunucu çıkış IP: ${data.server_ip}` : ''}`);
                    const diagnostic = data.server_ip ? `\n\nSunucu çıkış IP: ${data.server_ip}` : '';
                    alert(`HATA: Binance API doğrulanamadı!\n\nSebep: ${errMsg}${diagnostic}\n\n💡 Not: Render'da Frankfurt bölgesini seçmek servis bölgesini belirler; Binance'in gördüğü gerçek outbound IP ayrıca kontrol edilmelidir.`);
                  }
                } else if (!apiKey && !secretKey) {
                  addLog('SYSTEM', 'Binance API bağlantısı kesildi.');
                  setMetrics(prev => ({ ...prev, balance_usdt: 0 }));
                }

              } catch (e) {
                addLog('ERROR', 'Sunucuya bağlanılamadı veya işlem başarısız oldu.');
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
