import React, { useEffect, useState } from 'react';
import { Activity, ArrowDown, ArrowUp } from 'lucide-react';

interface OrderBookVisualizerProps {}

export const OrderBookVisualizer: React.FC<OrderBookVisualizerProps> = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const fetchOrderBook = async () => {
      try {
        const res = await fetch('/api/v1/orderbook');
        if (!res.ok) return; // Silent return on HTTP error
        const json = await res.json();
        if (json && json.orderBook && json.metrics) {
          setData(json);
        }
      } catch (e) {
        // Silently ignore network errors to avoid console spam during restart
      }
    };

    fetchOrderBook();
    const interval = setInterval(fetchOrderBook, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return (
      <div className="bg-[#151921] border border-[#1e232f] rounded-xl p-6 h-64 flex flex-col items-center justify-center space-y-4">
        <Activity className="w-8 h-8 text-slate-500 animate-pulse" />
        <span className="text-sm font-medium text-slate-400">Canlı Emir Defteri Bekleniyor...</span>
      </div>
    );
  }

  const { orderBook, metrics } = data;
  const { OBI, MicroPrice, MidPrice, deltaV, currentPrice, VWAP, stdDev, SpreadPct } = metrics;
  
  const asks = (orderBook.asks || []).slice(0, 10).reverse(); // En düşük satış fiyatı aşağıda olsun diye reverse()
  const bids = (orderBook.bids || []).slice(0, 10);
  
  // Calculate max volume for visual depth bars
  let maxVol = 0;
  asks.forEach((a: any) => { if (a[1] > maxVol) maxVol = a[1]; });
  bids.forEach((b: any) => { if (b[1] > maxVol) maxVol = b[1]; });

  const getWidth = (vol: number) => Math.min(100, (vol / maxVol) * 100) + '%';

  return (
    <div className="bg-[#151921] border border-[#1e232f] rounded-xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e232f] bg-[#0f1218] flex items-center justify-between">
        <h3 className="font-semibold text-sm text-slate-200 flex items-center space-x-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <span>Derin Analiz (HFT Order Book)</span>
        </h3>
      </div>
      
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Metrikler */}
        <div className="space-y-4">
          <div className="bg-[#0b0e14] p-3 border border-[#2a3142] rounded-lg">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Order Book Imbalance (OBI)</span>
            <div className="flex items-end justify-between">
              <span className={`text-xl font-bold font-mono ${OBI > 0.35 ? 'text-emerald-400' : OBI < -0.35 ? 'text-rose-400' : 'text-slate-300'}`}>
                {OBI.toFixed(3)}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {OBI > 0.35 ? 'Güçlü Alış' : OBI < -0.35 ? 'Güçlü Satış' : 'Nötr'}
              </span>
            </div>
            {/* OBI Bar */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-2 flex">
              <div className="h-full bg-rose-500 rounded-l-full" style={{ width: `${Math.max(0, ((-OBI) / 1) * 100)}%` }} />
              <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${Math.max(0, (OBI / 1) * 100)}%` }} />
            </div>
          </div>

          <div className="bg-[#0b0e14] p-3 border border-[#2a3142] rounded-lg">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Micro-Price vs Mid-Price</span>
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-500">Micro-Price:</span>
                <span className={MicroPrice > MidPrice ? 'text-emerald-400' : 'text-rose-400'}>${MicroPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-500">Mid-Price:</span>
                <span className="text-slate-300">${MidPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="bg-[#0b0e14] p-3 border border-[#2a3142] rounded-lg">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Hacim Deltası (Delta V)</span>
            <div className="flex items-center space-x-2">
              {deltaV > 0 ? <ArrowUp className="w-4 h-4 text-emerald-400" /> : <ArrowDown className="w-4 h-4 text-rose-400" />}
              <span className={`text-lg font-bold font-mono ${deltaV > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {deltaV > 0 ? '+' : ''}{deltaV.toFixed(3)}
              </span>
            </div>
          </div>
          
          {/* Yeni Matematiksel Metrikler */}
          <div className="bg-[#0b0e14] p-3 border border-[#2a3142] rounded-lg grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1" title="Hacim Ağırlıklı Ortalama Fiyat">VWAP</span>
              <span className="text-sm font-bold font-mono text-blue-400">
                ${VWAP ? VWAP.toFixed(2) : MidPrice.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1" title="Spread (Sürtünme Maliyeti)">SPREAD</span>
              <span className={`text-sm font-bold font-mono ${SpreadPct && SpreadPct > 0.001 ? 'text-rose-400' : 'text-slate-300'}`}>
                {SpreadPct ? (SpreadPct * 100).toFixed(4) : 0}%
              </span>
            </div>
            <div className="col-span-2 border-t border-[#2a3142] pt-2 mt-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1" title="Kısa Vadeli Fiyat Standart Sapması">VOLATİLİTE (StdDev)</span>
              <span className="text-xs font-mono text-slate-300">
                {stdDev ? stdDev.toFixed(3) : 0} (Piyasa {stdDev > 10 ? 'Çok Hızlı' : 'Sakin'})
              </span>
            </div>
          </div>
        </div>

        {/* Emir Defteri (Bids & Asks) */}
        <div className="bg-[#0b0e14] border border-[#2a3142] rounded-lg overflow-hidden flex flex-col font-mono text-[10px]">
          <div className="grid grid-cols-3 px-3 py-1.5 border-b border-[#2a3142] bg-[#151921] text-slate-400 uppercase font-semibold">
            <span>Fiyat</span>
            <span className="text-right">Miktar</span>
            <span className="text-right">Derinlik</span>
          </div>
          
          <div className="flex flex-col">
            {/* Asks (Sells) */}
            <div className="flex flex-col-reverse">
              {asks.map((ask: any, i: number) => (
                <div key={`ask-${i}`} className="grid grid-cols-3 px-3 py-1 hover:bg-slate-800/50 relative group">
                  <div className="absolute top-0 right-0 h-full bg-rose-500/10 z-0" style={{ width: getWidth(ask[1]) }} />
                  <span className="text-rose-400 z-10">${Number(ask[0]).toFixed(2)}</span>
                  <span className="text-right text-slate-300 z-10">{Number(ask[1]).toFixed(4)}</span>
                  <span className="text-right text-slate-500 z-10">{(ask[0] * ask[1]).toFixed(0)}</span>
                </div>
              ))}
            </div>

            {/* Spread / Current Price */}
            <div className="py-2 px-3 border-y border-[#2a3142] bg-[#151921]/50 flex items-center justify-between">
              <span className="text-slate-400 font-semibold uppercase text-[9px]">Son İşlem Fiyatı</span>
              <span className="text-lg font-bold text-white flex items-center">
                ${currentPrice.toFixed(2)}
              </span>
            </div>

            {/* Bids (Buys) */}
            <div>
              {bids.map((bid: any, i: number) => (
                <div key={`bid-${i}`} className="grid grid-cols-3 px-3 py-1 hover:bg-slate-800/50 relative group">
                  <div className="absolute top-0 right-0 h-full bg-emerald-500/10 z-0" style={{ width: getWidth(bid[1]) }} />
                  <span className="text-emerald-400 z-10">${Number(bid[0]).toFixed(2)}</span>
                  <span className="text-right text-slate-300 z-10">{Number(bid[1]).toFixed(4)}</span>
                  <span className="text-right text-slate-500 z-10">{(bid[0] * bid[1]).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
