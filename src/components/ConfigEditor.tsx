import React, { useState } from 'react';
import { Settings, Save, Download, CheckCircle2, AlertCircle, RefreshCw, Key, LogOut, Sliders } from 'lucide-react';

interface ConfigEditorProps {
  initialConfigJson: string;
  onSaveConfig: (jsonString: string) => Promise<void>;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  initialConfigJson,
  onSaveConfig,
}) => {
  const [configJson, setConfigJson] = useState(initialConfigJson);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pairInput, setPairInput] = useState<string | null>(null);

  let parsedConfig: any = null;
  try {
    parsedConfig = JSON.parse(configJson);
  } catch (e) {}

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

      setSuccess('Yapılandırma güncellendi ve API kontrol edildi!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(`Geçersiz JSON Söz Dizimi: ${err.message}`);
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
            <span>Freqtrade Configuration Editor (config.json)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Edit bot settings, API keys, stake amounts, exchanges, pairlists, and dry-run balances.
          </p>
        </div>

        <div className="flex items-center space-x-2">
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
            <span>Save Configuration</span>
          </button>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              İşlem Başına Miktar (USD)
            </label>
            <input
              type="text"
              value={parsedConfig?.stake_amount !== undefined ? parsedConfig.stake_amount : ''}
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
              value={parsedConfig?.leverage !== undefined ? parsedConfig.leverage : ''}
              onChange={(e) => handleTradingParamsUpdate('leverage', e.target.value)}
              disabled={!parsedConfig}
              placeholder="e.g. 5"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Bota Eklenecek Coinler (Örn: BTC, ETH)
            </label>
            <input
              type="text"
              value={pairInput !== null ? pairInput : (parsedConfig?.exchange?.pair_whitelist || []).map((p: string) => p.replace('/USDT', '')).join(', ')}
              onChange={(e) => setPairInput(e.target.value)}
              onBlur={() => {
                if (pairInput !== null) {
                  handleTradingParamsUpdate('pair_whitelist', pairInput);
                  setPairInput(null);
                }
              }}
              disabled={!parsedConfig}
              placeholder="BTC, ETH, XRP"
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50 placeholder-slate-600"
            />
          </div>
        </div>
      </div>

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
              value={parsedConfig?.exchange?.name || 'binance'}
              onChange={(e) => handleExchangeUpdate('name', e.target.value)}
              disabled={!parsedConfig}
              className="w-full bg-[#0b0e14] border border-slate-700 text-white font-mono text-sm rounded-lg p-3 focus:border-emerald-500 disabled:opacity-50"
            >
              <option value="binance">Binance</option>
              <option value="kraken">Kraken</option>
              <option value="kucoin">KuCoin</option>
              <option value="okx">OKX</option>
              <option value="bybit">Bybit</option>
              <option value="coinbasepro">Coinbase Pro</option>
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
            <strong className="text-emerald-400 font-semibold">Binance USDT-M Vadeli İşlemler:</strong> API anahtarlarınızı girip kaydettiğinizde bot vadeli cüzdan bakiyenizi okur ve canlı işlem motorunu başlatır. (Eğer Render.com üzerinde çalıştırıyorsanız, Binance ABD IP'lerini kısıtladığı için Render servisinizi <strong>Frankfurt</strong> bölgesinde kurunuz).
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
