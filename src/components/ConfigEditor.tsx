import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Save, Download, CheckCircle2, AlertCircle, RefreshCw, Key, LogOut, Sliders, Search, X, RotateCcw } from 'lucide-react';

interface ConfigEditorProps {
  initialConfigJson: string;
  onSaveConfig: (jsonString: string) => Promise<void>;
  markets?: Array<{ symbol: string; base: string; quote: string }>;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  initialConfigJson,
  onSaveConfig,
  markets = [],
}) => {
  const [configJson, setConfigJson] = useState(initialConfigJson);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pairInput, setPairInput] = useState<string | null>(null);
  const [pairSearch, setPairSearch] = useState('');
  const [pairSuggestions, setPairSuggestions] = useState<string[]>([]);
  const [showPairSuggestions, setShowPairSuggestions] = useState(false);
  const [activeMode, setActiveMode] = useState<'professional' | 'simple' | 'intelligent'>(
    initialConfigJson && (() => { try { const m = JSON.parse(initialConfigJson)?.engine_mode; return m === 'simple' ? 'simple' : m === 'intelligent' ? 'intelligent' : 'professional'; } catch { return 'professional'; } })()
  );
  const pairBoxRef = useRef<HTMLDivElement>(null);

  let parsedConfig: any = null;
  try {
    parsedConfig = JSON.parse(configJson);
  } catch (e) {}

  const configuredPairs = useMemo(() => {
    const raw = parsedConfig?.exchange?.pair_whitelist;
    return Array.isArray(raw) ? raw.filter((p: any) => typeof p === 'string' && p.trim()) : [];
  }, [configJson]);

  const normalizePair = (value: string) => {
    let pair = value.trim().toUpperCase().replace(/\s+/g, '');
    if (!pair) return '';
    if (pair.includes(':')) pair = pair.split(':')[0];
    if (!pair.includes('/')) pair = `${pair}/USDT`;
    return pair;
  };

  const updatePairWhitelist = (pairs: string[]) => {
    if (!parsedConfig) return;
    const updated = { ...parsedConfig, exchange: { ...(parsedConfig.exchange || {}) } };
    updated.exchange.pair_whitelist = Array.from(new Set(pairs.map(normalizePair).filter(Boolean)));
    setConfigJson(JSON.stringify(updated, null, 2));
    setPairInput(null);
    setError(null);
  };

  const addPair = (pair: string) => {
    const normalized = normalizePair(pair);
    if (!normalized) return;
    updatePairWhitelist([...configuredPairs, normalized]);
    setPairSearch('');
    setShowPairSuggestions(false);
  };

  const removePair = (pair: string) => {
    updatePairWhitelist(configuredPairs.filter((p: string) => normalizePair(p) !== normalizePair(pair)));
  };

  useEffect(() => {
    let cancelled = false;
    const loadFuturesPairs = async () => {
      try {
        // Use the backend market universe instead of calling Binance Futures
        // directly from the browser. This avoids browser/geo/CORS differences
        // and keeps Render's egress path as the single source of truth.
        const res = await fetch('/api/v1/markets');
        if (!res.ok) throw new Error('Backend market listesi alınamadı');
        const data = await res.json();
        const symbols = Array.isArray(data.markets) ? data.markets
          .map((x: any) => normalizePair(String(x.symbol || '')))
          .filter(Boolean) : [];
        if (!cancelled) setPairSuggestions(symbols);
      } catch {
        if (!cancelled) setPairSuggestions(markets.map(m => normalizePair(m.symbol)));
      }
    };
    loadFuturesPairs();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (pairBoxRef.current && !pairBoxRef.current.contains(event.target as Node)) setShowPairSuggestions(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const visiblePairSuggestions = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    const source = Array.from(new Set([...pairSuggestions, ...markets.map(m => normalizePair(m.symbol))]));
    return source
      .filter(p => !configuredPairs.includes(p))
      .filter(p => !q || p.startsWith(q) || p.includes(q))
      .slice(0, 8);
  }, [pairSearch, pairSuggestions, markets, configuredPairs]);

  const handleExchangeUpdate = (field: 'name' | 'key' | 'secret', value: string) => {
    if (!parsedConfig) {
      setError('JSON geçersizken borsa ayarları güncellenemez.');
      return;
    }
    const updated = { ...parsedConfig };
    if (!updated.exchange) updated.exchange = {};
    updated.exchange[field] = value;
    setConfigJson(JSON.stringify(updated, null, 2));
    setError(null);
  };

  const handleClearAPI = async () => {
    if (!parsedConfig) return;
    const updated = { ...parsedConfig };
    if (!updated.exchange) updated.exchange = {};
    updated.exchange.key = '';
    updated.exchange.secret = '';
    const newJson = JSON.stringify(updated, null, 2);
    setConfigJson(newJson);
    setError(null);
    
    try {
      await onSaveConfig(newJson);
      setSuccess('API anahtarları başarıyla temizlendi.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {}
  };

  const handleEngineMode = (mode: 'professional' | 'simple' | 'intelligent') => {
    if (!parsedConfig) return;
    const updated = { ...parsedConfig, engine_mode: mode };
    if (mode === 'simple') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true };
    } else if (updated.simple_mode) {
      updated.simple_mode = { ...updated.simple_mode, enabled: false };
    }
    setActiveMode(mode);
    setConfigJson(JSON.stringify(updated, null, 2));
    setError(null);
  };

  const handleCoinSelectionUpdate = (field: string, value: string | number | boolean) => {
    if (!parsedConfig) return;
    const updated = { ...parsedConfig, coin_selection: { ...(parsedConfig.coin_selection || {}) } };
    if (field === 'mode') updated.coin_selection.mode = value;
    if (field === 'max_open_trades') updated.coin_selection.max_open_trades = Number(value);
    if (field === 'min_opportunity_score') updated.coin_selection.min_opportunity_score = Number(value);
    if (field === 'min_liquidity_usdt') updated.coin_selection.min_liquidity_usdt = Number(value);
    if (field === 'max_spread_pct') updated.coin_selection.max_spread_pct = Number(value);
    setConfigJson(JSON.stringify(updated, null, 2));
    setError(null);
  };

  const handleTradingParamsUpdate = (field: string, value: string) => {
    if (!parsedConfig) {
      setError('JSON geçersizken işlem ayarları güncellenemez.');
      return;
    }
    const updated = { ...parsedConfig };
    
    if (field === 'stake_amount') {
      if (value === 'unlimited' || value === '') {
        updated.stake_amount = value;
      } else {
        const val = value.replace(',', '.');
        if (val.endsWith('.') || (val.includes('.') && val.endsWith('0'))) {
          updated.stake_amount = val;
        } else {
          const num = Number(val);
          updated.stake_amount = isNaN(num) ? val : num;
        }
      }
    } else if (field === 'leverage') {
      updated.leverage = value === '' ? '' : Number(value);
    } else if (field === 'margin_mode') {
      updated.margin_mode = value === 'cross' ? 'cross' : 'isolated';
    } else if (field === 'risk_protection') {
      updated.risk_protection = { ...(updated.risk_protection || {}), mode: value };
    } else if (field === 'deep_history_minutes') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), history_minutes: Number(value) };
    } else if (field === 'deep_snapshot_seconds') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), snapshot_seconds: Number(value) };
    } else if (field === 'deep_min_long_probability') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), min_long_probability: Number(value) / 100 };
    } else if (field === 'deep_min_short_probability') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), min_short_probability: Number(value) / 100 };
    } else if (field === 'whale_detection') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_detection: value === 'on' };
    } else if (field === 'whale_window_seconds') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_window_seconds: Number(value) };
    } else if (field === 'whale_min_trade_usdt') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_min_trade_usdt: Number(value) };
    } else if (field === 'whale_net_flow_usdt') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_net_flow_usdt: Number(value) };
    } else if (field === 'whale_position_multiplier') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_position_multiplier: Number(value) };
    } else if (field === 'whale_max_multiplier') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_max_multiplier: Number(value) };
    } else if (field === 'whale_direction_confirmation') {
      updated.deep_analysis = { ...(updated.deep_analysis || {}), whale_requires_directional_confirmation: value === 'on' };
    } else if (field === 'simple_history_minutes') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, orderbook_history_minutes: Number(value) };
    } else if (field === 'simple_target_pct') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, target_market_move_pct: Number(value) / 100 };
    } else if (field === 'simple_min_obi') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, min_obi: Number(value) / 100 };
    } else if (field === 'simple_snapshot_seconds') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, snapshot_seconds: Number(value) };
    } else if (field === 'simple_projection_multiplier') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, obi_projection_multiplier_pct: Number(value) / 100 };
    } else if (field === 'simple_min_liquidity') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, min_liquidity_usdt: Number(value) };
    } else if (field === 'simple_max_spread') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, max_spread_pct: Number(value) };
    } else if (field === 'simple_min_velocity') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, min_obi_velocity: Number(value) / 100 };
    } else if (field === 'simple_wall_weakening') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, wall_weakening_pct: Number(value) / 100 };
    } else if (field === 'simple_timeout') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, timeout_minutes: Number(value) };
    } else if (field === 'simple_cooldown') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, cooldown_seconds: Number(value) };
    } else if (field === 'simple_reversal_obi') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, reversal_obi: Number(value) / 100 };
    } else if (field === 'simple_profit_lock_trigger') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, profit_lock_trigger_pct: Number(value) / 100 };
    } else if (field === 'simple_profit_lock') {
      updated.simple_mode = { ...(updated.simple_mode || {}), enabled: true, profit_lock_pct: Number(value) / 100 };
    } else if (field.startsWith('intelligent_')) {
      updated.intelligent_mode = { ...(updated.intelligent_mode || {}), enabled: true };
      const map: Record<string,string> = {
        intelligent_min_edge: 'min_edge', intelligent_min_regime: 'min_regime_quality', intelligent_liquidity: 'min_liquidity_usdt',
        intelligent_spread: 'max_spread_pct', intelligent_lookback: 'lookback_minutes', intelligent_target: 'target_market_move_pct',
        intelligent_max_target: 'max_target_market_move_pct', intelligent_stop: 'stop_market_move_pct', intelligent_hold: 'max_hold_minutes', intelligent_cooldown: 'cooldown_seconds'
      };
      const key = map[field];
      if (key) updated.intelligent_mode[key] = Number(value) / ((key.includes('edge') || key.includes('regime') || key.includes('target') || key.includes('stop')) ? 100 : 1);
    } else if (field === 'pair_whitelist') {
      if (!updated.exchange) updated.exchange = {};
      updated.exchange.pair_whitelist = value.split(',').map((s: string) => {
        let coin = s.trim().toUpperCase();
        if (coin && !coin.includes('/')) {
           coin += '/USDT';
        }
        return coin;
      }).filter((s: string) => s.length > 0);
    }
    
    setConfigJson(JSON.stringify(updated, null, 2));
    setError(null);
  };

    const handleSave = async () => {
    try {
      let currentJson = configJson;
      if (pairInput !== null && parsedConfig) {
        const updated = { ...parsedConfig };
        if (!updated.exchange) updated.exchange = {};
        updated.exchange.pair_whitelist = pairInput.split(',').map((s: string) => {
          let coin = s.trim().toUpperCase();
          if (coin && !coin.includes('/')) {
             coin += '/USDT';
          }
          return coin;
        }).filter((s: string) => s.length > 0);
        currentJson = JSON.stringify(updated, null, 2);
        setConfigJson(currentJson);
        setPairInput(null);
      }
      const parsed = JSON.parse(currentJson);
      setError(null);
      await onSaveConfig(JSON.stringify(parsed, null, 2));

      setSuccess('Ayarlar güncellendi ve API kontrol edildi!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(`Geçersiz JSON Söz Dizimi: ${err.message}`);
    }
  };

  const handleResetToDefaults = async () => {
    try {
      const defaults = JSON.parse(initialConfigJson);
      const current = parsedConfig || {};
      // Reset trading/algorithm settings without accidentally disconnecting Binance.
      defaults.exchange = {
        ...(defaults.exchange || {}),
        ...(current.exchange || {}),
        pair_whitelist: Array.isArray(current.exchange?.pair_whitelist) && current.exchange.pair_whitelist.length
          ? current.exchange.pair_whitelist
          : (defaults.exchange?.pair_whitelist || ['BTC/USDT'])
      };
      const newJson = JSON.stringify(defaults, null, 2);
      setConfigJson(newJson);
      setActiveMode(defaults.engine_mode === 'simple' ? 'simple' : defaults.engine_mode === 'intelligent' ? 'intelligent' : 'professional');
      setError(null);
      await onSaveConfig(newJson);
      setSuccess('Varsayılan ayarlar geri yüklendi. Binance API bağlantısı ve coin listeniz korundu.');
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: any) {
      setError(`Varsayılan ayarlar yüklenemedi: ${err.message}`);
    }
  };

  const handleDownload = () => {
    try {
      JSON.parse(configJson);
      const blob = new Blob([configJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'config.json';
      a.click();
    } catch (err: any) {
      setError(`Geçersiz JSON dışa aktarılamaz: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#151921] border border-[#1e232f] p-5 rounded-xl shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Settings className="w-5 h-5 text-emerald-400" />
            <span>Ayarlar</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            İşlem modu, API, bakiye, pariteler ve risk ayarlarını yönetin.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleResetToDefaults}
            className="flex items-center space-x-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3.5 py-2 rounded-lg text-xs font-semibold transition"
            title="İşlem ayarlarını uygulamanın güvenli varsayılanlarına döndür"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Varsayılan</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center space-x-1.5 bg-[#0b0e14] hover:bg-slate-800 text-slate-300 border border-slate-700 px-3.5 py-2 rounded-lg text-xs font-semibold transition"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Download config.json</span>
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs transition shadow-lg shadow-emerald-500/20"
          >
            <Save className="w-4 h-4" />
            <span>Ayarları Kaydet</span>
          </button>
        </div>
      </div>

      {/* Engine Mode */}
      <div className="bg-[#151921] border border-[#1e232f] p-3 rounded-xl shadow-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => handleEngineMode('professional')} className={`rounded-lg border px-4 py-3 text-left transition ${activeMode === 'professional' ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-slate-700 bg-[#0b0e14] hover:bg-slate-800/60'}`}>
            <div className="text-sm font-bold text-white">Profesyonel Mod</div>
            <div className="text-[10px] text-slate-400 mt-1">Derin analiz, çok katmanlı order book, Futures teyidi ve profesyonel risk motoru.</div>
          </button>
          <button type="button" onClick={() => handleEngineMode('simple')} className={`rounded-lg border px-4 py-3 text-left transition ${activeMode === 'simple' ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-700 bg-[#0b0e14] hover:bg-slate-800/60'}`}>
            <div className="text-sm font-bold text-white">Basit Mod</div>
            <div className="text-[10px] text-slate-400 mt-1">Yalnızca emir defteri. Hızlı matematiksel 1x hedef hesabı; kaldıraç hedef hesabını değiştirmez.</div>
          </button>
          <button type="button" onClick={() => handleEngineMode('intelligent')} className={`rounded-lg border px-4 py-3 text-left transition ${activeMode === 'intelligent' ? 'border-violet-400/60 bg-violet-500/10' : 'border-slate-700 bg-[#0b0e14] hover:bg-slate-800/60'}`}>
            <div className="text-sm font-bold text-white">Zeki Mod</div>
            <div className="text-[10px] text-slate-400 mt-1">Uyarlanabilir ensemble, piyasa rejimi, sinyal uyumu ve belirsizlik filtresi. Kararsız piyasada işlem yapmaz.</div>
          </button>
        </div>
      </div>

      {/* Coin Selection */}
      <div className="bg-[#151921] border border-amber-500/25 p-5 rounded-xl shadow-xl space-y-4">
        <div>
          <h3 className="font-bold text-sm text-white">Coin Seçimi</h3>
          <p className="text-[10px] text-slate-500 mt-1">Coinleri manuel seçebilir veya Binance Futures içinden fırsatları algoritmaya bırakabilirsin.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button"
            onClick={() => handleCoinSelectionUpdate('mode','manual')}
            className={`rounded-lg border px-4 py-3 text-left ${parsedConfig?.coin_selection?.mode !== 'algorithmic' ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-700 bg-[#0b0e14]'}`}>
            <div className="text-sm font-bold text-white">Manuel Coinler</div>
            <div className="text-[10px] text-slate-400 mt-1">Aşağıda seçtiğin coinleri kullan.</div>
          </button>
          <button type="button"
            onClick={() => handleCoinSelectionUpdate('mode','algorithmic')}
            className={`rounded-lg border px-4 py-3 text-left ${parsedConfig?.coin_selection?.mode === 'algorithmic' ? 'border-amber-400/60 bg-amber-500/10' : 'border-slate-700 bg-[#0b0e14]'}`}>
            <div className="text-sm font-bold text-white">🤖 Algoritmaya Bırak</div>
            <div className="text-[10px] text-slate-400 mt-1">Vadeli piyasadaki uygun adayları sıralayıp en güçlü fırsatı seçer.</div>
          </button>
        </div>
        {parsedConfig?.coin_selection?.mode === 'algorithmic' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-[10px] text-slate-400">Maks. açık işlem
              <input type="number" min="1" max="10" value={parsedConfig?.coin_selection?.max_open_trades ?? 1}
                onChange={e => handleCoinSelectionUpdate('max_open_trades', e.target.value)}
                className="mt-1 w-full bg-[#0b0e14] border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </label>
            <label className="text-[10px] text-slate-400">Min. fırsat skoru
              <input type="number" min="0.4" max="0.95" step="0.01" value={parsedConfig?.coin_selection?.min_opportunity_score ?? 0.62}
                onChange={e => handleCoinSelectionUpdate('min_opportunity_score', e.target.value)}
                className="mt-1 w-full bg-[#0b0e14] border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </label>
            <label className="text-[10px] text-slate-400">Min. likidite USDT
              <input type="number" min="0" value={parsedConfig?.coin_selection?.min_liquidity_usdt ?? 250000}
                onChange={e => handleCoinSelectionUpdate('min_liquidity_usdt', e.target.value)}
                className="mt-1 w-full bg-[#0b0e14] border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </label>
            <label className="text-[10px] text-slate-400">Maks. spread %
              <input type="number" min="0.01" max="2" step="0.01" value={parsedConfig?.coin_selection?.max_spread_pct ?? 0.12}
                onChange={e => handleCoinSelectionUpdate('max_spread_pct', e.target.value)}
                className="mt-1 w-full bg-[#0b0e14] border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/40 text-rose-300 rounded-lg text-xs font-mono flex items-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs font-mono flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{success}</span>
        </div>
      )}

      {/* Trading Parameters Setup */}
      <div className="bg-[#151921] border border-[#1e232f] p-5 rounded-xl shadow-xl space-y-4">
        <div className="pb-3 border-b border-[#1e232f]">
          <h3 className="font-bold text-sm text-white flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Bot İşlem Ayarları (Trading Parameters)</span>
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              İşlem Başına Miktar (USD)
            </label>
            <input
              type="text"
              value={parsedConfig?.stake_amount !== undefined ? parsedConfig.stake_amount : 6}
              onChange={(e) => handleTradingParamsUpdate('stake_amount', e.target.value)}
              disabled={!parsedConfig}
              placeholder="e.g. 100 or unlimited"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Kaldıraç (X)
            </label>
            <input
              type="number"
              min="1"
              max="125"
              value={parsedConfig?.leverage !== undefined ? parsedConfig.leverage : 15}
              onChange={(e) => handleTradingParamsUpdate('leverage', e.target.value)}
              disabled={!parsedConfig}
              placeholder="e.g. 5"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Zarar Koruması / Risk</label>
            <select
              value={parsedConfig?.risk_protection?.mode || 'balanced'}
              onChange={(e) => handleTradingParamsUpdate('risk_protection', e.target.value)}
              disabled={!parsedConfig}
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50"
            >
              <option value="conservative">🛡 Muhafazakar — düşük risk</option>
              <option value="balanced">⚖ Dengeli — orta risk</option>
              <option value="aggressive">🚀 Agresif — yüksek risk</option>
            </select>
            <p className="mt-1.5 text-[10px] text-slate-500">
              Muhafazakar: %0,8 stop / %1,5 trailing • Dengeli: %1,5 stop / %3 trailing • Agresif: %2,5 stop / %5 trailing.
              Kârda derin analiz ters dönüşü, zararda ise doğrulanmış karşı baskıyı erken çıkış için kullanır.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Marjin Modu</label>
            <select
              value={parsedConfig?.margin_mode || 'isolated'}
              onChange={(e) => handleTradingParamsUpdate('margin_mode', e.target.value)}
              disabled={!parsedConfig}
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50"
            >
              <option value="isolated">ISOLATED</option>
              <option value="cross">CROSS</option>
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-2" ref={pairBoxRef}>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Bota Eklenecek Vadeli Coinler
            </label>
            <div className="relative">
              <div className="min-h-[48px] w-full bg-[#0b0e14] border border-slate-700 rounded-lg p-2 focus-within:border-emerald-500 transition">
                <div className="flex flex-wrap gap-2">
                  {configuredPairs.map((pair: string) => (
                    <span key={pair} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/50 bg-emerald-500/20 px-2.5 py-1.5 text-xs font-bold text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.08)]">
                      <span>{pair.replace('/USDT', '')}</span>
                      <button type="button" onClick={() => removePair(pair)} className="rounded p-0.5 text-emerald-300 hover:bg-emerald-400/20 hover:text-white" title={`${pair} kaldır`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex min-w-[120px] flex-1 items-center gap-2">
                    <Search className="h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={pairSearch}
                      onChange={(e) => { setPairSearch(e.target.value.toUpperCase()); setShowPairSuggestions(true); }}
                      onFocus={() => setShowPairSuggestions(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && visiblePairSuggestions[0]) { e.preventDefault(); addPair(visiblePairSuggestions[0]); }
                      }}
                      disabled={!parsedConfig}
                      placeholder={configuredPairs.length ? "Coin ara (örn. SOL)" : "Coin ara (örn. BTC, SOL, SUI)"}
                      className="w-full bg-transparent text-white font-mono text-sm outline-none placeholder-slate-600 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              {showPairSuggestions && pairSearch.trim() && visiblePairSuggestions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-[#0f131b] shadow-2xl">
                  <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Vadeli İşlem Pariteleri</div>
                  <div className="max-h-64 overflow-y-auto p-1">
                    {visiblePairSuggestions.map((pair) => (
                      <button
                        key={pair}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addPair(pair)}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-mono text-slate-200 hover:bg-emerald-500/15 hover:text-emerald-300 transition"
                      >
                        <span>{pair.replace('/USDT', '')} <span className="text-slate-500">/ USDT</span></span>
                        <span className="text-[10px] text-slate-500">PERPETUAL</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">
              Baş harfi yazınca Binance USDT-M perpetual pariteleri gelir. Bir pariteye dokunduğunda yeşil etiket olarak eklenir ve <span className="text-emerald-400">exchange.pair_whitelist</span> içine yazılır. Kaydettiğinde algoritma bunu kullanır.
            </p>
          </div>
        </div>
      </div>

      {activeMode === 'simple' && (
        <div className="bg-[#151921] border border-emerald-500/30 p-5 rounded-xl shadow-xl space-y-4">
          <div className="pb-3 border-b border-[#1e232f]">
            <h3 className="font-bold text-sm text-white">Basit Mod — Sadece Emir Defteri</h3>
            <p className="text-[11px] text-slate-400 mt-1">Pozisyon açma kararı yalnızca order-book likiditesi/OBI geçmişinden çıkarılır. Mum, whale, trade delta ve profesyonel Deep Score girişte kullanılmaz.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Emir Defteri Geçmişi (dakika)</label>
              <input type="number" min="1" max="120" value={parsedConfig?.simple_mode?.orderbook_history_minutes ?? 5} onChange={(e) => handleTradingParamsUpdate('simple_history_minutes', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500" />
              <p className="text-[10px] text-slate-500 mt-1">Son X dakikadaki OBI davranışı kullanılır.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">1x Kâr Hedefi (%)</label>
              <input type="number" min="1" max="100" step="0.5" value={((parsedConfig?.simple_mode?.target_market_move_pct ?? 0.10) * 100).toFixed(1)} onChange={(e) => handleTradingParamsUpdate('simple_target_pct', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500" />
              <p className="text-[10px] text-slate-500 mt-1">Örn. %10 girilirse fiyatın 1x bazda %10 hareketi öngörülmeden giriş yapılmaz.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Minimum OBI Gücü</label>
              <input type="number" min="5" max="95" step="1" value={((parsedConfig?.simple_mode?.min_obi ?? 0.45) * 100).toFixed(0)} onChange={(e) => handleTradingParamsUpdate('simple_min_obi', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500" />
              <p className="text-[10px] text-slate-500 mt-1">Alış/satış likidite dengesinin minimum yön gücü.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Snapshot Aralığı (saniye)</label>
              <select value={parsedConfig?.simple_mode?.snapshot_seconds ?? 5} onChange={(e) => handleTradingParamsUpdate('simple_snapshot_seconds', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500">
                {[2,5,10,15,30,60].map(v => <option key={v} value={v}>{v} saniye</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">OBI → 1x Hareket Hassasiyeti (%)</label>
            <input type="number" min="1" max="100" step="0.5" value={((parsedConfig?.simple_mode?.obi_projection_multiplier_pct ?? 0.15) * 100).toFixed(1)} onChange={(e) => handleTradingParamsUpdate('simple_projection_multiplier', e.target.value)} className="w-full sm:max-w-xs bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500" />
            <p className="text-[10px] text-slate-500 mt-1">Matematiksel model: OBI gücü × bu hassasiyet + mikro-fiyat baskısı. Kaldıraç bu hesabı değiştirmez; 15x kullanılsa bile hedef 1x fiyat hareketi olarak kalır.</p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-slate-400">
            <strong className="text-emerald-300">Örnek:</strong> 1x hedef %10 ve hassasiyet %15 ise, güçlü pozitif OBI yaklaşık %67 seviyesine ulaştığında modelin 1x öngörüsü %10'a yaklaşır. 15x kaldıraç yalnızca pozisyon büyüklüğünü etkiler; hedef hesabı 15 ile çarpılmaz.
          </div>
          <div className="pt-3 border-t border-[#1e232f]">
            <h4 className="text-xs font-bold text-emerald-300 mb-3">Vur-Kaç Filtreleri</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">Min. Likidite (USDT)</label><input type="number" min="0" step="10000" value={parsedConfig?.simple_mode?.min_liquidity_usdt ?? 250000} onChange={(e) => handleTradingParamsUpdate('simple_min_liquidity', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">Maks. Spread (%)</label><input type="number" min="0.01" max="2" step="0.01" value={parsedConfig?.simple_mode?.max_spread_pct ?? 0.10} onChange={(e) => handleTradingParamsUpdate('simple_max_spread', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">Min. OBI İvmesi (%)</label><input type="number" min="0" max="50" step="0.5" value={((parsedConfig?.simple_mode?.min_obi_velocity ?? 0.03) * 100).toFixed(1)} onChange={(e) => handleTradingParamsUpdate('simple_min_velocity', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">Satış Duvarı Zayıflaması (%)</label><input type="number" min="0" max="100" step="1" value={((parsedConfig?.simple_mode?.wall_weakening_pct ?? 0.10) * 100).toFixed(0)} onChange={(e) => handleTradingParamsUpdate('simple_wall_weakening', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">İşlem Zaman Aşımı (dk)</label><input type="number" min="1" max="60" value={parsedConfig?.simple_mode?.timeout_minutes ?? 5} onChange={(e) => handleTradingParamsUpdate('simple_timeout', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">İşlem Sonrası Cooldown (sn)</label><input type="number" min="0" max="3600" value={parsedConfig?.simple_mode?.cooldown_seconds ?? 60} onChange={(e) => handleTradingParamsUpdate('simple_cooldown', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">OBI Ters Dönüş Eşiği</label><input type="number" min="2" max="80" step="1" value={((parsedConfig?.simple_mode?.reversal_obi ?? 0.12) * 100).toFixed(0)} onChange={(e) => handleTradingParamsUpdate('simple_reversal_obi', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
              <div><label className="block text-xs font-semibold text-slate-400 mb-1">Kâr Kilidi Başlangıcı (%)</label><input type="number" min="0.5" max="50" step="0.5" value={((parsedConfig?.simple_mode?.profit_lock_trigger_pct ?? 0.04) * 100).toFixed(1)} onChange={(e) => handleTradingParamsUpdate('simple_profit_lock_trigger', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            </div>
            <p className="text-[10px] text-slate-500 mt-3">Girişte OBI ivmesi, spread, görünür likidite ve satış/alış duvarının zayıflaması birlikte kontrol edilir. Pozisyonda OBI ters dönüşü, zaman aşımı, hedef ve kâr koruması kullanılır.</p>
          </div>
        </div>
      )}

      {activeMode === 'intelligent' && (
        <div className="bg-[#151921] border border-violet-500/25 p-5 rounded-xl shadow-xl space-y-4">
          <div className="pb-3 border-b border-[#1e232f]">
            <h3 className="font-bold text-sm text-white">Zeki Mod — Adaptif Ensemble Motoru</h3>
            <p className="text-[11px] text-slate-500 mt-1">Tek bir göstergeye bağlı kalmaz. Order book, mikro-fiyat, agresif akış, derinlik, momentum, Futures teyidi ve balina akışını bağımsız kanıtlar olarak birleştirir; kanıtlar çelişirse işlemden kaçınır.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Minimum Edge (%)</label><input type="number" min="50" max="95" step="1" value={Math.round((parsedConfig?.intelligent_mode?.min_edge ?? 0.62)*100)} onChange={(e)=>handleTradingParamsUpdate('intelligent_min_edge',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Minimum Rejim Kalitesi (%)</label><input type="number" min="40" max="95" value={Math.round((parsedConfig?.intelligent_mode?.min_regime_quality ?? 0.58)*100)} onChange={(e)=>handleTradingParamsUpdate('intelligent_min_regime',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Min. Likidite (USDT)</label><input type="number" min="0" step="50000" value={parsedConfig?.intelligent_mode?.min_liquidity_usdt ?? 500000} onChange={(e)=>handleTradingParamsUpdate('intelligent_liquidity',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Maks. Spread (%)</label><input type="number" min="0.01" max="2" step="0.01" value={parsedConfig?.intelligent_mode?.max_spread_pct ?? 0.12} onChange={(e)=>handleTradingParamsUpdate('intelligent_spread',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Analiz Geçmişi (dk)</label><input type="number" min="2" max="60" value={parsedConfig?.intelligent_mode?.lookback_minutes ?? 8} onChange={(e)=>handleTradingParamsUpdate('intelligent_lookback',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">1x Hedef (%)</label><input type="number" min="1" max="20" step="0.5" value={((parsedConfig?.intelligent_mode?.target_market_move_pct ?? 0.06)*100).toFixed(1)} onChange={(e)=>handleTradingParamsUpdate('intelligent_target',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Maks. 1x Hedef (%)</label><input type="number" min="2" max="30" step="0.5" value={((parsedConfig?.intelligent_mode?.max_target_market_move_pct ?? 0.12)*100).toFixed(1)} onChange={(e)=>handleTradingParamsUpdate('intelligent_max_target',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Adaptif Stop (%)</label><input type="number" min="0.3" max="5" step="0.1" value={((parsedConfig?.intelligent_mode?.stop_market_move_pct ?? 0.012)*100).toFixed(2)} onChange={(e)=>handleTradingParamsUpdate('intelligent_stop',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Maksimum Pozisyon Süresi (dk)</label><input type="number" min="1" max="120" value={parsedConfig?.intelligent_mode?.max_hold_minutes ?? 8} onChange={(e)=>handleTradingParamsUpdate('intelligent_hold',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Cooldown (sn)</label><input type="number" min="0" max="3600" value={parsedConfig?.intelligent_mode?.cooldown_seconds ?? 90} onChange={(e)=>handleTradingParamsUpdate('intelligent_cooldown',e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3" /></div>
          </div>
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-[11px] text-slate-400"><strong className="text-violet-300">Zeki Mod mantığı:</strong> farklı veri kaynaklarının yönünü ve birbirleriyle uyumunu ölçer, piyasa rejiminin kalitesini puanlar, spread/likidite/volatilite riskini cezalandırır ve kanıtlar çelişiyorsa bilinçli olarak işlem açmaz. Bu bir garanti sistemi değildir; yüksek doğruluk hedefi yerine seçici ve risk kontrollü karar vermek üzere tasarlanmıştır.</div>
        </div>
      )}

      {activeMode === 'professional' && (
      <div className="bg-[#151921] border border-emerald-500/20 p-5 rounded-xl shadow-xl space-y-4">
        <div className="pb-3 border-b border-[#1e232f]">
          <h3 className="font-bold text-sm text-white flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Derin Analiz — Matematiksel Order Flow</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-1">Spot emir defteri ana yön kaynağıdır. Geçmiş pencere, gerçek agresif işlemler ve balina akışı birlikte değerlendirilir; Futures yalnızca teyittir.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Derin Analiz Geçmişi (dakika)</label>
            <input type="number" min="1" max="120" value={parsedConfig?.deep_analysis?.history_minutes ?? 10} onChange={(e) => handleTradingParamsUpdate('deep_history_minutes', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
            <p className="text-[10px] text-slate-500 mt-1">Son X dakikadaki OBI, skor ve likidite davranışı hesaba katılır.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Snapshot Aralığı (saniye)</label>
            <select value={parsedConfig?.deep_analysis?.snapshot_seconds ?? 5} onChange={(e) => handleTradingParamsUpdate('deep_snapshot_seconds', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500">
              {[2,5,10,15,30,60].map(v => <option key={v} value={v}>{v} saniye</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Minimum Long Güveni</label>
            <input type="number" min="50" max="99" step="1" value={Math.round((parsedConfig?.deep_analysis?.min_long_probability ?? 0.70) * 100)} onChange={(e) => handleTradingParamsUpdate('deep_min_long_probability', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Minimum Short Güveni</label>
            <input type="number" min="50" max="99" step="1" value={Math.round((parsedConfig?.deep_analysis?.min_short_probability ?? 0.70) * 100)} onChange={(e) => handleTradingParamsUpdate('deep_min_short_probability', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Balina Algılama</label>
            <select value={parsedConfig?.deep_analysis?.whale_detection === false ? 'off' : 'on'} onChange={(e) => handleTradingParamsUpdate('whale_detection', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500">
              <option value="on">AÇIK</option><option value="off">KAPALI</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Balina Penceresi (saniye)</label>
            <input type="number" min="10" max="300" value={parsedConfig?.deep_analysis?.whale_window_seconds ?? 60} onChange={(e) => handleTradingParamsUpdate('whale_window_seconds', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Minimum Tek Balina İşlemi (USDT)</label>
            <input type="number" min="10000" step="10000" value={parsedConfig?.deep_analysis?.whale_min_trade_usdt ?? 1000000} onChange={(e) => handleTradingParamsUpdate('whale_min_trade_usdt', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Net Balina Akışı Eşiği (USDT)</label>
            <input type="number" min="10000" step="10000" value={parsedConfig?.deep_analysis?.whale_net_flow_usdt ?? 2000000} onChange={(e) => handleTradingParamsUpdate('whale_net_flow_usdt', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Balina Pozisyon Çarpanı (X)</label>
            <input type="number" min="1" max="5" step="0.1" value={parsedConfig?.deep_analysis?.whale_position_multiplier ?? 2} onChange={(e) => handleTradingParamsUpdate('whale_position_multiplier', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Maksimum Balina Çarpanı (X)</label>
            <input type="number" min="1" max="5" step="0.1" value={parsedConfig?.deep_analysis?.whale_max_multiplier ?? 3} onChange={(e) => handleTradingParamsUpdate('whale_max_multiplier', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Balina yön teyidi</label>
            <select value={parsedConfig?.deep_analysis?.whale_requires_directional_confirmation === false ? 'off' : 'on'} onChange={(e) => handleTradingParamsUpdate('whale_direction_confirmation', e.target.value)} className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-cyan-500">
              <option value="on">AÇIK — Balina tek başına sinyal değildir</option><option value="off">KAPALI</option>
            </select>
          </div>

        </div>

        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] text-slate-400">
          <strong className="text-cyan-300">Nasıl çalışır?</strong> Örneğin geçmişi 10 dakika ve balina çarpanı 2X ise motor son 10 dakikalık order-book davranışını izler. Son 60 saniyede net balina akışı eşiği aşar ve balina yönü Deep Analiz ile aynıysa, normal marjin 2X'e kadar büyütülür. Balina tek başına pozisyon açamaz.
        </div>
      </div>

      )}

      {/* Exchange API Key Manual Entry Form */}
      <div className="bg-[#151921] border border-[#1e232f] p-5 rounded-xl shadow-xl space-y-4">
        <div className="flex justify-between items-center pb-3 border-b border-[#1e232f]">
          <h3 className="font-bold text-sm text-white flex items-center space-x-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <span>Exchange API Settings</span>
          </h3>
          {(parsedConfig?.exchange?.key || parsedConfig?.exchange?.secret) && (
            <button 
              onClick={handleClearAPI}
              className="flex items-center space-x-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-3 py-1.5 rounded-lg text-xs transition"
              title="API anahtarlarını sil"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Temizle</span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Exchange Name</label>
            <select
              value="binanceusdm"
              disabled
              className="w-full bg-[#0b0e14] border border-emerald-500/30 text-emerald-300 font-mono text-sm rounded-lg p-3 opacity-100"
            >
              <option value="binanceusdm">Binance USDT-M Futures</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">API Key</label>
            <input
              type="password"
              value={parsedConfig?.exchange?.key || ''}
              onChange={(e) => handleExchangeUpdate('key', e.target.value)}
              disabled={!parsedConfig}
              placeholder="Enter your API Key"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">API Secret</label>
            <input
              type="password"
              value={parsedConfig?.exchange?.secret || ''}
              onChange={(e) => handleExchangeUpdate('secret', e.target.value)}
              disabled={!parsedConfig}
              placeholder="Enter your API Secret"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-400 flex items-center space-x-1.5 mt-2 bg-[#0b0e14] p-2 rounded border border-[#2a3142]">
          <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            <strong className="text-emerald-400 font-semibold">Binance USDT-M Vadeli İşlemler:</strong> Bu uygulama yalnızca gerçek LIVE Futures emirleri gönderir. API anahtarı, kullanılabilir Futures bakiyesi, kaldıraç, marjin ve borsa limitleri backend tarafından doğrulanır. (Eğer Render.com üzerinde çalıştırıyorsanız, Binance ABD IP'lerini kısıtladığı için Render servisinizi <strong>Frankfurt</strong> bölgesinde kurunuz).
          </span>
        </p>
      </div>

      {/* Editor */}
      <div className="bg-[#151921] border border-[#1e232f] rounded-xl shadow-xl flex flex-col">
        <div className="p-3 bg-[#11141a] border-b border-[#1e232f] text-xs font-mono text-slate-400 flex justify-between items-center rounded-t-xl">
          <span>/config_examples/config.json</span>
          <span>JSON Mode</span>
        </div>
        <textarea
          value={configJson}
          onChange={(e) => {
            setConfigJson(e.target.value);
            setError(null);
          }}
          className="w-full h-[400px] bg-[#0b0e14] text-emerald-300 font-mono text-xs p-5 focus:outline-none resize-none leading-relaxed rounded-b-xl border-t-0 border-slate-800 selection:bg-emerald-500/30"
          spellCheck={false}
        />
      </div>
    </div>
  );
};
