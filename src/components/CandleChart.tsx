import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Candle, Trade } from '../types';
import { BarChart2, Activity, TrendingUp, TrendingDown, Eye, Maximize2 } from 'lucide-react';

interface CandleChartProps {
  pair: string;
  timeframe: string;
  candles: Candle[];
  trades: Trade[];
}

export const CandleChart: React.FC<CandleChartProps> = ({
  pair,
  timeframe,
  candles,
  trades,
}) => {
  const [showSMA, setShowSMA] = useState(true);
  const [showBB, setShowBB] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 380 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setDimensions({
            width: entry.contentRect.width,
            height: 380,
          });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const width = dimensions.width;
  const mainChartHeight = showRSI ? 270 : 360;
  const rsiHeight = 85;
  const paddingRight = 65;
  const paddingLeft = 10;
  const paddingTop = 15;
  const paddingBottom = 25;
  const plotWidth = Math.max(100, width - paddingLeft - paddingRight);
  const plotHeight = Math.max(50, mainChartHeight - paddingTop - paddingBottom);

  const validCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    return candles.filter(c => Number.isFinite(c.open) && Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low));
  }, [candles]);

  const latestCandle = validCandles.length > 0 ? validCandles[validCandles.length - 1] : null;
  const isLatestBullish = latestCandle ? latestCandle.close >= latestCandle.open : true;

  // Compute price min/max with padding
  const { minPrice, maxPrice, priceRange, maxVol } = useMemo(() => {
    if (validCandles.length === 0) {
      return { minPrice: 0, maxPrice: 100, priceRange: 100, maxVol: 100 };
    }
    let min = Infinity;
    let max = -Infinity;
    let volMax = 0;

    validCandles.forEach((c) => {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (showSMA) {
        if (c.sma20 && c.sma20 < min) min = c.sma20;
        if (c.sma20 && c.sma20 > max) max = c.sma20;
        if (c.sma50 && c.sma50 < min) min = c.sma50;
        if (c.sma50 && c.sma50 > max) max = c.sma50;
      }
      if (showBB) {
        if (c.bbLower && c.bbLower < min) min = c.bbLower;
        if (c.bbUpper && c.bbUpper > max) max = c.bbUpper;
      }
      if (c.volume > volMax) volMax = c.volume;
    });

    const pad = (max - min) * 0.06 || max * 0.01 || 1;
    return {
      minPrice: min - pad,
      maxPrice: max + pad,
      priceRange: (max + pad) - (min - pad) || 1,
      maxVol: volMax || 1,
    };
  }, [validCandles, showSMA, showBB]);

  // Coordinate conversion helpers
  const getY = (price: number) => {
    return paddingTop + plotHeight - ((price - minPrice) / priceRange) * plotHeight;
  };

  const getPriceFromY = (y: number) => {
    const clampedY = Math.max(paddingTop, Math.min(paddingTop + plotHeight, y));
    const ratio = (paddingTop + plotHeight - clampedY) / plotHeight;
    return minPrice + ratio * priceRange;
  };

  const candleCount = validCandles.length;
  const candleSlotWidth = plotWidth / Math.max(1, candleCount);
  const candleWidth = Math.max(2, Math.min(16, candleSlotWidth * 0.72));

  const getX = (index: number) => {
    return paddingLeft + (index + 0.5) * candleSlotWidth;
  };

  // Generate SVG path for indicators
  const sma20Path = useMemo(() => {
    if (!showSMA || validCandles.length === 0) return '';
    let path = '';
    validCandles.forEach((c, i) => {
      if (c.sma20) {
        const x = getX(i);
        const y = getY(c.sma20);
        path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    return path;
  }, [validCandles, showSMA, plotWidth, priceRange, minPrice]);

  const sma50Path = useMemo(() => {
    if (!showSMA || validCandles.length === 0) return '';
    let path = '';
    validCandles.forEach((c, i) => {
      if (c.sma50) {
        const x = getX(i);
        const y = getY(c.sma50);
        path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    return path;
  }, [validCandles, showSMA, plotWidth, priceRange, minPrice]);

  const bbUpperPath = useMemo(() => {
    if (!showBB || validCandles.length === 0) return '';
    let path = '';
    validCandles.forEach((c, i) => {
      if (c.bbUpper) {
        const x = getX(i);
        const y = getY(c.bbUpper);
        path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    return path;
  }, [validCandles, showBB, plotWidth, priceRange, minPrice]);

  const bbLowerPath = useMemo(() => {
    if (!showBB || validCandles.length === 0) return '';
    let path = '';
    validCandles.forEach((c, i) => {
      if (c.bbLower) {
        const x = getX(i);
        const y = getY(c.bbLower);
        path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    return path;
  }, [validCandles, showBB, plotWidth, priceRange, minPrice]);

  // RSI path
  const rsiPath = useMemo(() => {
    if (!showRSI || validCandles.length === 0) return '';
    let path = '';
    validCandles.forEach((c, i) => {
      if (typeof c.rsi === 'number') {
        const x = getX(i);
        const rsiVal = Math.max(0, Math.min(100, c.rsi));
        const y = (1 - rsiVal / 100) * (rsiHeight - 20) + 10;
        path += path === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    });
    return path;
  }, [validCandles, showRSI, plotWidth]);

  // Horizontal Grid Lines & Price Labels
  const gridTicks = useMemo(() => {
    const count = 5;
    const ticks = [];
    for (let i = 0; i <= count; i++) {
      const p = minPrice + (priceRange * i) / count;
      const y = getY(p);
      ticks.push({ price: p, y });
    }
    return ticks;
  }, [minPrice, priceRange, plotHeight]);

  // Handle Mouse Move for Interactive Crosshair
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (x >= paddingLeft && x <= paddingLeft + plotWidth) {
      const idx = Math.floor((x - paddingLeft) / candleSlotWidth);
      if (idx >= 0 && idx < validCandles.length) {
        setHoverIndex(idx);
      }
    } else {
      setHoverIndex(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    setMousePos(null);
  };

  const activeCandle = hoverIndex !== null && validCandles[hoverIndex] ? validCandles[hoverIndex] : latestCandle;
  const activePrice = activeCandle ? activeCandle.close : 0;
  const activeChange = activeCandle ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100 : 0;

  // Format Price String helper
  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(3);
    return p.toFixed(5);
  };

  return (
    <div className="bg-[#151921] border border-[#1e232f] rounded-xl p-3 sm:p-4 flex flex-col space-y-3 shadow-xl">
      {/* Top Header & Ticker Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1e232f]">
        <div className="flex items-center space-x-2 sm:space-x-3 flex-wrap">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold text-base sm:text-lg text-white font-mono">{pair}</span>
            <span className="text-xs bg-emerald-500/10 text-emerald-300 font-mono px-2 py-0.5 rounded border border-emerald-500/30">
              {timeframe}
            </span>
          </div>

          {activeCandle && (
            <div className="flex items-center space-x-2 sm:space-x-3 text-[11px] sm:text-xs font-mono">
              <span className="text-slate-400">
                Açılış: <span className="text-slate-200">${formatPrice(activeCandle.open)}</span>
              </span>
              <span className="text-slate-400">
                Yüksek: <span className="text-emerald-400">${formatPrice(activeCandle.high)}</span>
              </span>
              <span className="text-slate-400">
                Düşük: <span className="text-rose-400">${formatPrice(activeCandle.low)}</span>
              </span>
              <span className="text-slate-400">
                Kapanış: <span className={activeCandle.close >= activeCandle.open ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  ${formatPrice(activeCandle.close)}
                </span>
              </span>
              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                activeChange >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {activeChange >= 0 ? '+' : ''}{activeChange.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* Indicator Switchers */}
        <div className="flex items-center space-x-1.5 text-xs">
          <button
            onClick={() => setShowSMA(!showSMA)}
            className={`px-2.5 py-1 rounded font-medium transition border ${
              showSMA
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                : 'bg-[#1e232f] border-slate-700 text-slate-400'
            }`}
          >
            SMA (20/50)
          </button>
          <button
            onClick={() => setShowBB(!showBB)}
            className={`px-2.5 py-1 rounded font-medium transition border ${
              showBB
                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300'
                : 'bg-[#1e232f] border-slate-700 text-slate-400'
            }`}
          >
            Bollinger
          </button>
          <button
            onClick={() => setShowRSI(!showRSI)}
            className={`px-2.5 py-1 rounded font-medium transition border ${
              showRSI
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : 'bg-[#1e232f] border-slate-700 text-slate-400'
            }`}
          >
            RSI (14)
          </button>
        </div>
      </div>

      {/* Candlestick SVG Stage */}
      <div ref={containerRef} className="w-full relative select-none">
        {validCandles.length === 0 ? (
          <div className="h-[360px] flex flex-col items-center justify-center space-y-3 text-slate-400">
            <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">Binance Vadeli Mum Verileri Yükleniyor...</span>
          </div>
        ) : (
          <svg
            width={width}
            height={mainChartHeight}
            className="cursor-crosshair block overflow-visible"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Background & Grid Lines */}
            <rect x={0} y={0} width={width} height={mainChartHeight} fill="#0d1117" rx={8} />

            {gridTicks.map((t, idx) => (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={t.y}
                  x2={paddingLeft + plotWidth}
                  y2={t.y}
                  stroke="#1c2333"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <text
                  x={paddingLeft + plotWidth + 6}
                  y={t.y + 4}
                  fill="#64748b"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {formatPrice(t.price)}
                </text>
              </g>
            ))}

            {/* Time ticks along bottom */}
            {validCandles.map((c, i) => {
              if (i % Math.ceil(validCandles.length / 7) === 0) {
                const x = getX(i);
                return (
                  <g key={`time-${i}`}>
                    <line x1={x} y1={paddingTop + plotHeight} x2={x} y2={paddingTop + plotHeight + 4} stroke="#334155" />
                    <text
                      x={x}
                      y={paddingTop + plotHeight + 16}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize={9}
                      fontFamily="monospace"
                    >
                      {c.time.slice(0, 5)}
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {/* Volume Bars at the bottom of chart */}
            {validCandles.map((c, i) => {
              const x = getX(i);
              const isBull = c.close >= c.open;
              const barH = (c.volume / maxVol) * 45;
              const y = paddingTop + plotHeight - barH;
              return (
                <rect
                  key={`vol-${i}`}
                  x={x - candleWidth / 2}
                  y={y}
                  width={candleWidth}
                  height={barH}
                  fill={isBull ? '#10b981' : '#ef4444'}
                  opacity={0.22}
                  rx={1}
                />
              );
            })}

            {/* Bollinger Bands Paths */}
            {showBB && (
              <>
                <path d={bbUpperPath} fill="none" stroke="#818cf8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
                <path d={bbLowerPath} fill="none" stroke="#818cf8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
              </>
            )}

            {/* SMA Lines */}
            {showSMA && (
              <>
                <path d={sma20Path} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.9} />
                <path d={sma50Path} fill="none" stroke="#3b82f6" strokeWidth={1.5} opacity={0.9} />
              </>
            )}

            {/* Real Candlesticks */}
            {validCandles.map((c, i) => {
              const x = getX(i);
              const isBull = c.close >= c.open;
              const color = isBull ? '#10b981' : '#ef4444';
              const yHigh = getY(c.high);
              const yLow = getY(c.low);
              const yOpen = getY(c.open);
              const yClose = getY(c.close);
              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1.5, Math.abs(yOpen - yClose));

              return (
                <g key={`candle-${i}`}>
                  {/* Upper & Lower Shadow / Wick */}
                  <line
                    x1={x}
                    y1={yHigh}
                    x2={x}
                    y2={yLow}
                    stroke={color}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                  {/* Real Candlestick Body */}
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    stroke={color}
                    strokeWidth={0.5}
                    rx={1}
                  />
                </g>
              );
            })}

            {/* Live Real-time Price Line across chart */}
            {latestCandle && (
              <g>
                <line
                  x1={paddingLeft}
                  y1={getY(latestCandle.close)}
                  x2={paddingLeft + plotWidth}
                  y2={getY(latestCandle.close)}
                  stroke={isLatestBullish ? '#10b981' : '#ef4444'}
                  strokeDasharray="4 4"
                  strokeWidth={1.2}
                />
                {/* Right Y-Axis Badge */}
                <rect
                  x={paddingLeft + plotWidth + 2}
                  y={getY(latestCandle.close) - 9}
                  width={paddingRight - 4}
                  height={18}
                  fill={isLatestBullish ? '#065f46' : '#991b1b'}
                  rx={3}
                />
                <text
                  x={paddingLeft + plotWidth + 6}
                  y={getY(latestCandle.close) + 3.5}
                  fill="#ffffff"
                  fontSize={10}
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {formatPrice(latestCandle.close)}
                </text>
              </g>
            )}

            {/* Interactive Mouse Crosshair */}
            {mousePos && hoverIndex !== null && (
              <g>
                {/* Vertical cursor line */}
                <line
                  x1={getX(hoverIndex)}
                  y1={paddingTop}
                  x2={getX(hoverIndex)}
                  y2={paddingTop + plotHeight}
                  stroke="#94a3b8"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                {/* Horizontal cursor line */}
                <line
                  x1={paddingLeft}
                  y1={mousePos.y}
                  x2={paddingLeft + plotWidth}
                  y2={mousePos.y}
                  stroke="#94a3b8"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                {/* Crosshair price badge on right */}
                <rect
                  x={paddingLeft + plotWidth + 2}
                  y={mousePos.y - 8}
                  width={paddingRight - 4}
                  height={16}
                  fill="#334155"
                  rx={2}
                />
                <text
                  x={paddingLeft + plotWidth + 6}
                  y={mousePos.y + 3.5}
                  fill="#f8fafc"
                  fontSize={9.5}
                  fontFamily="monospace"
                >
                  {formatPrice(getPriceFromY(mousePos.y))}
                </text>
              </g>
            )}
          </svg>
        )}

        {/* RSI Subchart */}
        {showRSI && validCandles.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#1e232f]">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-2 mb-1">
              <span>GÖRECELİ GÜÇ ENDEKSİ (RSI 14)</span>
              <span className={`font-bold ${
                (activeCandle?.rsi ?? 50) >= 70 ? 'text-rose-400' :
                (activeCandle?.rsi ?? 50) <= 30 ? 'text-emerald-400' : 'text-slate-300'
              }`}>
                RSI: {activeCandle?.rsi ?? 50}
              </span>
            </div>
            <svg width={width} height={rsiHeight} className="block">
              <rect x={0} y={0} width={width} height={rsiHeight} fill="#0d1117" rx={6} />
              {/* Overbought 70 line */}
              <line x1={paddingLeft} y1={25} x2={paddingLeft + plotWidth} y2={25} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />
              <text x={paddingLeft + plotWidth + 6} y={28} fill="#ef4444" fontSize={9} fontFamily="monospace">70</text>

              {/* Middle 50 line */}
              <line x1={paddingLeft} y1={rsiHeight / 2} x2={paddingLeft + plotWidth} y2={rsiHeight / 2} stroke="#334155" strokeDasharray="2 2" strokeWidth={1} />

              {/* Oversold 30 line */}
              <line x1={paddingLeft} y1={rsiHeight - 25} x2={paddingLeft + plotWidth} y2={rsiHeight - 25} stroke="#10b981" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />
              <text x={paddingLeft + plotWidth + 6} y={rsiHeight - 22} fill="#10b981" fontSize={9} fontFamily="monospace">30</text>

              {/* RSI Polyline */}
              <path d={rsiPath} fill="none" stroke="#10b981" strokeWidth={1.5} />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
