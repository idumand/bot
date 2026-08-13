import React from 'react';
import { BotState, BotMetrics } from '../types';
import { Play, Square, Pause, RefreshCw, Activity, Wallet, Settings } from 'lucide-react';

interface HeaderProps {
  botState: BotState;
  metrics: BotMetrics;
  selectedStrategy: string;
  onToggleBotState: (state: BotState) => void;
  onReloadStrategy: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  botState,
  metrics,
  selectedStrategy,
  onToggleBotState,
  onReloadStrategy,
  activeTab,
  setActiveTab,
  onOpenSettings,
}) => {
  const navTabs = [
    { id: 'dashboard', label: 'Gösterge Paneli' },
    { id: 'strategies', label: 'Stratejiler' },
    { id: 'pairlists', label: 'Pariteler ve Piyasalar' },
    { id: 'config', label: 'Yapılandırma' },
    { id: 'api', label: 'REST API' },
    { id: 'logs', label: 'Sistem Kayıtları' },
  ];

  return (
    <header className="bg-[#151921] border-b border-[#1e232f] sticky top-0 z-40">
      {/* Top Status & Controls Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 md:py-3 flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-4">
        {/* Row 1 on Mobile: Brand & Bot State */}
        <div className="flex items-center justify-between gap-2 w-full md:w-auto">
          <div className="flex items-center space-x-1.5 bg-emerald-500/10 border border-emerald-500/30 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shrink-0">
            <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 animate-pulse" />
            <span className="font-bold text-[15px] sm:text-lg tracking-wide text-white">freqtrade</span>
            <span className="text-[10px] sm:text-xs bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-semibold">
              sfeef
            </span>
          </div>

          {/* Bot State Indicator */}
          <div className="flex items-center space-x-1.5 bg-[#1e232f] px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-700/50 shrink-0 min-w-0">
            <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
              botState === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' :
              botState === 'paused' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' :
              'bg-rose-500'
            }`} />
            <span className="capitalize text-slate-200 hidden sm:inline">{botState}</span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="text-[11px] sm:text-xs text-slate-400 font-mono truncate">{selectedStrategy}</span>
          </div>
          
          {/* Desktop Trading Mode Toggle - REMOVED */}
        </div>

        {/* Row 2 on Mobile: Quick Action Buttons & Wallet */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          
          <div className="flex items-center gap-1.5 sm:gap-2">
            {botState === 'stopped' ? (
              <button
                onClick={() => onToggleBotState('running')}
                className="flex items-center space-x-1 sm:space-x-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-2 sm:px-3.5 py-1.5 rounded-lg font-semibold text-[11px] sm:text-xs transition shadow-lg shadow-emerald-500/20"
              >
                <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-current" />
                <span className="hidden sm:inline">Botu Başlat</span>
                <span className="sm:hidden">Başlat</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => onToggleBotState(botState === 'paused' ? 'running' : 'paused')}
                  className="flex items-center space-x-1 sm:space-x-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-[11px] sm:text-xs transition shrink-0"
                >
                  {botState === 'paused' ? <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <Pause className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                  <span className="hidden sm:inline">{botState === 'paused' ? 'Devam Et' : 'Duraklat'}</span>
                </button>
                <button
                  onClick={() => onToggleBotState('stopped')}
                  className="flex items-center space-x-1 sm:space-x-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-[11px] sm:text-xs transition shrink-0"
                >
                  <Square className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Durdur</span>
                </button>
              </>
            )}

            <button
              onClick={onReloadStrategy}
              className="flex items-center justify-center bg-[#1e232f] hover:bg-slate-700 text-slate-300 border border-slate-700/60 w-7 h-7 sm:w-auto sm:px-3 sm:py-1.5 rounded-lg font-medium text-xs transition shrink-0"
              title="Reload current strategy config"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center bg-[#1e232f] hover:bg-slate-700 text-slate-300 border border-slate-700/60 w-7 h-7 sm:w-auto sm:px-3 sm:py-1.5 rounded-lg font-medium text-xs transition shrink-0"
              title="Borsa API Ayarları"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1.5">Borsa</span>
            </button>
          </div>

          {/* USDT Balance Badge */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 bg-[#0b0e14] border border-[#2a3142] px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shrink-0 min-w-0">
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 shrink-0" />
            <div className="text-right truncate">
              <div className="hidden sm:block text-[10px] text-slate-400 leading-none mb-1">Vadeli İşlem Cüzdanı</div>
              <div className="text-xs sm:text-sm font-mono font-bold text-white leading-none truncate">
                ${metrics.balance_usdt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 overflow-x-auto scrollbar-hide touch-pan-x border-t border-[#1e232f]/80">
        {navTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors border-b-2 ${
                isActive
                  ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
