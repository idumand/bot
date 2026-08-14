import React, { useState } from 'react';
import { BotState, BotMetrics } from '../types';
import { Play, Square, Pause, RefreshCw, Activity, Wallet, Settings, Globe, Copy, Check } from 'lucide-react';

interface HeaderProps {
  botState: BotState;
  metrics: BotMetrics;
  selectedStrategy: string;
  serverIp?: string;
  onToggleBotState: (state: BotState) => void;
  onReloadStrategy: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  botState,
  metrics,
  selectedStrategy,
  serverIp = 'Tespit ediliyor...',
  onToggleBotState,
  onReloadStrategy,
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
    { id: 'strategies', label: 'Stratejiler' },
    { id: 'pairlists', label: 'Pariteler ve Piyasalar' },
    { id: 'config', label: 'Yapılandırma' },
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
              botState === 'paused' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' :
              'bg-rose-500'
            }`} />
            <span className="capitalize text-slate-200 hidden xs:inline">{botState}</span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-mono truncate">{selectedStrategy}</span>
          </div>

          {/* Render Server IP Badge */}
          <button
            onClick={handleCopyIp}
            className="flex items-center space-x-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-2 py-1 sm:py-1.5 rounded-lg text-xs font-mono shrink-0 transition group ml-auto sm:ml-0"
            title="Render Sunucu IP Adresi - Kopyalamak için tıklayın"
          >
            <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-blue-300 font-semibold text-[10px] sm:text-xs">{serverIp}</span>
            {copiedIp ? (
              <Check className="w-3 h-3 text-emerald-400 ml-0.5 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 text-slate-400 group-hover:text-blue-300 ml-0.5 shrink-0" />
            )}
          </button>
        </div>

        {/* Row 2: Action Buttons & Wallet */}
        <div className="flex items-center justify-between md:justify-end gap-2 pt-1 md:pt-0 border-t md:border-t-0 border-[#1e232f]/60">
          
          <div className="flex items-center gap-1.5 sm:gap-2">
            {botState === 'stopped' ? (
              <button
                onClick={() => onToggleBotState('running')}
                className="flex items-center space-x-1 sm:space-x-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-2.5 sm:px-3.5 py-1.5 rounded-lg font-semibold text-xs transition shadow-lg shadow-emerald-500/20"
              >
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Başlat</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => onToggleBotState(botState === 'paused' ? 'running' : 'paused')}
                  className="flex items-center space-x-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
                >
                  {botState === 'paused' ? <Play className="w-3.5 h-3.5 shrink-0" /> : <Pause className="w-3.5 h-3.5 shrink-0" />}
                  <span className="text-[11px] sm:text-xs">{botState === 'paused' ? 'Devam' : 'Duraklat'}</span>
                </button>
                <button
                  onClick={() => onToggleBotState('stopped')}
                  className="flex items-center space-x-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
                >
                  <Square className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] sm:text-xs">Durdur</span>
                </button>
              </>
            )}

            <button
              onClick={onReloadStrategy}
              className="flex items-center justify-center bg-[#1e232f] hover:bg-slate-700 text-slate-300 border border-slate-700/60 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg font-medium text-xs transition shrink-0"
              title="Reload current strategy config"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* USDT Balance Badge */}
          <div 
            className="flex items-center space-x-1.5 bg-[#0b0e14] border border-[#2a3142] px-2.5 py-1.5 rounded-lg shrink-0 cursor-pointer hover:bg-slate-800 transition"
            onClick={onLogout}
            title="Cüzdandan Çıkış Yap (API Temizle)"
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="text-right">
              <div className="text-xs sm:text-sm font-mono font-bold text-white leading-none">
                ${metrics.balance_usdt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
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
