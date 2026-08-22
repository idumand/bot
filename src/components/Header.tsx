import React, { useState } from 'react';
import { BotState, BotMetrics } from '../types';
import { Play, Square, Activity, Wallet, Globe, Copy, Check } from 'lucide-react';

interface HeaderProps {
  botState: BotState;
  metrics: BotMetrics;
  serverIp?: string;
  isExchangeConnected?: boolean;
  onToggleBotState: (state: BotState) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  botState,
  metrics,
  serverIp = 'Tespit ediliyor...',
  isExchangeConnected = false,
  onToggleBotState,
  activeTab,
  setActiveTab,
  onLogout,
}) => {
  const [copiedIp, setCopiedIp] = useState(false);

  const handleCopyIp = () => {
    if (serverIp && serverIp !== 'Tespit ediliyor...') {
      navigator.clipboard.writeText(serverIp);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 2000);
    }
  };

  const navTabs = [
    { id: 'dashboard', label: 'Gösterge Paneli' },
    { id: 'pairlists', label: 'Pariteler ve Piyasalar' },
    { id: 'config', label: 'Ayarlar' },
    { id: 'api', label: 'REST API' },
    { id: 'logs', label: 'Sistem Kayıtları' },
  ];

  return (
    <header className="bg-[#151921] border-b border-[#1e232f] sticky top-0 z-40 shadow-xl">
      {/* Top Status & Controls Bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 md:py-3 space-y-2 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4">
        
        {/* Row 1: Brand, Bot Status & IP */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center space-x-1.5 bg-emerald-500/10 border border-emerald-500/30 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shrink-0">
            <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 animate-pulse" />
            <span className="font-bold text-sm sm:text-lg tracking-wide text-white">freqtrade</span>
            <span className="text-[10px] sm:text-xs bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-semibold">
              sfeef
            </span>
          </div>

          {/* Bot State Indicator */}
          <div className="flex items-center space-x-1.5 bg-[#1e232f] px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-700/50 shrink-0 max-w-[140px] sm:max-w-none">
            <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
              botState === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' :
              'bg-rose-500'
            }`} />
            <span className="capitalize text-slate-200 hidden xs:inline">{botState}</span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-mono truncate">Canlı Futures</span>
          </div>

          {/* Render Server IP Badge */}
          <div 
            onClick={handleCopyIp}
            className="flex items-center space-x-1.5 bg-[#1a3852]/20 border border-[#1e4a75]/40 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium text-[#7ab2e6] cursor-pointer hover:bg-[#1a3852]/40 transition shrink-0"
            title="IP Adresini Kopyala"
          >
             {copiedIp ? <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-emerald-400" /> : <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
             <span className="font-mono tracking-wide">{copiedIp ? 'Kopyalandı' : serverIp}</span>
             <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 opacity-70" />
          </div>

          <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
            {botState === 'stopped' ? (
              <button
                onClick={() => onToggleBotState('running')}
                className="flex items-center space-x-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Başlat</span>
              </button>
            ) : (
                <button
                  onClick={() => onToggleBotState('stopped')}
                  className="flex items-center space-x-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
                >
                  <Square className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] sm:text-xs">Durdur</span>
                </button>
            )}

          </div>

          {/* Binance Futures Real Balance Badge */}
          {isExchangeConnected ? (
            <div 
              className="flex items-center space-x-2 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-lg shrink-0 cursor-pointer hover:bg-emerald-900/40 transition"
              onClick={onLogout}
              title="Binance LIVE Bağlı - API Anahtarlarını Sıfırla"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold font-mono">Binance LIVE</div>
                <div className="text-xs sm:text-sm font-mono font-bold text-white leading-none">
                  ${metrics.balance_usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ) : (
            <div 
              className="flex items-center space-x-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg shrink-0 cursor-pointer hover:bg-amber-500/20 transition"
              onClick={() => setActiveTab('config')}
              title="Gerçek Binance cüzdanı için API Anahtarlarını Girin"
            >
              <Wallet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div className="text-left">
                <div className="text-[10px] text-amber-400 font-semibold font-mono uppercase">Binance API</div>
                <div className="text-xs font-mono font-medium text-slate-200">
                  Anahtar Tanımla
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs - Touch Optimized Horizontal Scroll */}
      <nav className="w-full bg-[#11141b] border-t border-[#1e232f]">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center overflow-x-auto scrollbar-hide touch-pan-x py-0.5">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-[13px] font-semibold whitespace-nowrap transition-all border-b-2 shrink-0 ${
                  isActive
                    ? 'border-emerald-400 text-emerald-400 bg-emerald-500/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
};
