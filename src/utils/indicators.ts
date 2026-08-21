import { Candle } from '../types';

export function calculateIndicators(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];
  const result: Candle[] = candles.map(c => ({ ...c }));
  const closes = result.map(c => c.close);

  // SMA 20 & Bollinger Bands (20, 2)
  for (let i = 0; i < result.length; i++) {
    if (i >= 19) {
      const slice20 = closes.slice(i - 19, i + 1);
      const avg20 = slice20.reduce((a, b) => a + b, 0) / 20;
      result[i].sma20 = parseFloat(avg20.toFixed(2));

      const variance = slice20.reduce((sum, v) => sum + Math.pow(v - avg20, 2), 0) / 20;
      const stdDev = Math.sqrt(variance);
      result[i].bbUpper = parseFloat((avg20 + 2 * stdDev).toFixed(2));
      result[i].bbLower = parseFloat((avg20 - 2 * stdDev).toFixed(2));
    }
    if (i >= 49) {
      const slice50 = closes.slice(i - 49, i + 1);
      const avg50 = slice50.reduce((a, b) => a + b, 0) / 50;
      result[i].sma50 = parseFloat(avg50.toFixed(2));
    }
  }

  // RSI (14)
  const period = 14;
  if (result.length > period) {
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    result[period].rsi = avgLoss === 0 ? 100 : parseFloat((100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2));

    for (let i = period + 1; i < result.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      result[i].rsi = avgLoss === 0 ? 100 : parseFloat((100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2));
    }
  }

  return result;
}
