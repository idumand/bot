import React, { useEffect, useState } from 'react';
import { Activity, Play, Square, RefreshCw, ShieldCheck, TrendingDown, TrendingUp, Zap, Settings, Save, LogOut, Globe, Copy, Check } from 'lucide-react';

const API_TOKEN = String(import.meta.env.VITE_API_TOKEN || '');
const authHeaders: Record<string, string> = API_TOKEN ? { 'X-API-Token': API_TOKEN } : {};

type ExchangeRow = {
  exchange: string; mid: number; bestBid: number; bestAsk: number; obi: number; ageMs: number;
};

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [minGapPct, setMinGapPct] = useState('3');
  const [gapSaved, setGapSaved] = useState(false);
  const [pnl, setPnl] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectorMode, setSelectorMode] = useState<'manual'|'algorithmic'|'ai'>('manual');
  const [riskMode, setRiskMode] = useState<'conservative'|'balanced'|'aggressive'>('conservative');
  const [manualPairs, setManualPairs] = useState('BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT');
  const [maxPositions, setMaxPositions] = useState(1);
  const [scanAssets, setScanAssets] = useState(30);
  const [minOpportunity, setMinOpportunity] = useState(0.40);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [secretKeyInput, setSecretKeyInput] = useState('');
  const [walletMessage, setWalletMessage] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [walletError, setWalletError] = useState('');
  const [serverIp, setServerIp] = useState('Tespit ediliyor...');
  const [ipCopied, setIpCopied] = useState(false);

  const load = async () => {
    try {
      const [s, o, t, l, p, ip] = await Promise.all([
        fetch('/api/v1/status', { headers: authHeaders }),
        fetch('/api/v1/orderbook?pair=BTC/USDT', { headers: authHeaders }),
        fetch('/api/v1/trades', { headers: authHeaders }),
        fetch('/api/v1/logs', { headers: authHeaders }),
        fetch('/api/v1/profit', { headers: authHeaders }),
        fetch('/api/v1/ip', { headers: authHeaders })
      ]);
      const statusJson = await s.json();
      setStatus(statusJson);
      setBook(await o.json());
      setTrades((await t.json()).trades || []);
      setLogs((await l.json()).logs || []);
      setPnl(await p.json());
      const ipJson = await ip.json();
      if (typeof ipJson?.ip === 'string' && ipJson.ip.trim()) setServerIp(ipJson.ip.trim());
      const gap = Number(statusJson?.min_gap_pct ?? 3);
      if (Number.isFinite(gap)) setMinGapPct(String(gap));
      const sel = statusJson?.selector || {};
      if (sel.mode) setSelectorMode(sel.mode === 'ai' ? 'ai' : (sel.mode === 'algorithmic' ? 'algorithmic' : 'manual'));
      if (statusJson?.risk_protection_mode) setRiskMode(statusJson.risk_protection_mode === 'balanced' ? 'balanced' : statusJson.risk_protection_mode === 'aggressive' ? 'aggressive' : 'conservative');
      if (Array.isArray(sel.professional_manual_pairs) && sel.professional_manual_pairs.length) setManualPairs(sel.professional_manual_pairs.join(', '));
      if (Number.isFinite(Number(sel.max_open_trades))) setMaxPositions(Math.max(1, Math.min(10, Number(sel.max_open_trades))));
      if (Number.isFinite(Number(sel.algorithm_scan_assets))) setScanAssets(Number(sel.algorithm_scan_assets));
      if (Number.isFinite(Number(sel.min_opportunity_score))) setMinOpportunity(Number(sel.min_opportunity_score));
    } catch {}
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, []);

  // Private Binance endpoints are intentionally polled much less frequently than public market data.
  // This prevents fetchBalance/fetchPositions from creating unnecessary REST pressure and 418 responses.
  useEffect(() => {
    let cancelled = false;
    const refreshWallet = async () => {
      try {
        const r = await fetch('/api/v1/binance/wallet', { headers: authHeaders });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && j?.success) {
          setWallet(j);
          setWalletError('');
        } else if (r.status !== 401) {
          setWallet(null);
          setWalletError(String(j?.message || j?.error || 'Cüzdan bilgisi alınamadı.'));
        }
      } catch {}
    };
    refreshWallet();
    const id = setInterval(refreshWallet, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const command = async (path: string, body?: any) => {
    setBusy(true);
    try {
      await fetch(path, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      await load();
    } finally { setBusy(false); }
  };

  const copyServerIp = async () => {
    if (!serverIp || serverIp === 'Tespit ediliyor...') return;
    try {
      await navigator.clipboard.writeText(serverIp);
      setIpCopied(true);
      window.setTimeout(() => setIpCopied(false), 1800);
    } catch {
      setIpCopied(false);
    }
  };

  const saveGap = async () => {
    const value = Number(minGapPct);
    if (!Number.isFinite(value) || value < 0.1 || value > 50) return;
    setBusy(true);
    setGapSaved(false);
    try {
      const current = await fetch('/api/v1/config', { headers: authHeaders }).then(r => r.json());
      current.eight_exchange = { ...(current.eight_exchange || {}), min_gap_pct: value };
      await fetch('/api/v1/config', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(current)
      });
      setGapSaved(true);
      await load();
    } finally { setBusy(false); }
  };


  const saveSelectorSettings = async () => {
    setBusy(true); setSettingsSaved(false);
    try {
      const current = await fetch('/api/v1/config', { headers: authHeaders }).then(r => r.json());
      const pairs = manualPairs.split(',').map(x => x.trim().toUpperCase()).filter(x => x.includes('/')).slice(0, 10);
      current.coin_selection = {
        ...(current.coin_selection || {}),
        mode: selectorMode,
        professional_manual_pairs: pairs,
        max_open_trades: Math.max(1, Math.min(10, Number(maxPositions) || 1)),
        algorithm_scan_assets: Math.max(5, Math.min(50, Number(scanAssets) || 30)),
        min_opportunity_score: Math.max(0.20, Math.min(0.95, Number(minOpportunity) || 0.40))
      };
      current.risk_protection = { ...(current.risk_protection || {}), mode: riskMode };
      current.risk_protection_mode = riskMode;
      await fetch('/api/v1/config', { method:'POST', headers:{...authHeaders,'Content-Type':'application/json'}, body:JSON.stringify(current) });
      setSettingsSaved(true); await load();
    } finally { setBusy(false); }
  };

  const saveBinanceKeys = async () => {
    const apiKey = apiKeyInput.trim();
    const secretKey = secretKeyInput.trim();
    if (!apiKey || !secretKey) {
      setWalletMessage('API Key ve Secret Key birlikte girilmeli.');
      return;
    }
    setWalletBusy(true); setWalletMessage('Binance Futures doğrulanıyor…'); setWalletError('');
    try {
      const r = await fetch('/api/v1/exchange-keys', {
        method:'POST',
        headers:{...authHeaders,'Content-Type':'application/json'},
        body:JSON.stringify({apiKey, secretKey})
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        const msg = j?.message || j?.error || `Sunucu hatası (${r.status})`;
        setWalletMessage(`Bağlantı başarısız: ${msg}`);
        if (j?.server_ip) setWalletMessage(prev => `${prev} | Sunucu IP: ${j.server_ip}`);
        return;
      }
      setWalletMessage(`✓ Binance Futures bağlı · ${Number(j.balance_usdt || 0).toFixed(2)} USDT`);
      setSecretKeyInput('');
      await load();
    } catch (e:any) {
      setWalletMessage(`Bağlantı hatası: ${e?.message || e}`);
    } finally { setWalletBusy(false); }
  };

  const disconnectBinance = async () => {
    if (walletBusy) return;
    setWalletBusy(true); setWalletMessage('Bağlantı kesiliyor…');
    try {
      const r = await fetch('/api/v1/exchange-keys', {
        method:'POST', headers:{...authHeaders,'Content-Type':'application/json'},
        body:JSON.stringify({apiKey:'', secretKey:''})
      });
      const j = await r.json().catch(() => ({}));
      setWalletMessage(j?.success ? 'Binance API bağlantısı kesildi.' : `İşlem başarısız: ${j?.message || j?.error || 'Bilinmeyen hata'}`);
      if (j?.success) { setApiKeyInput(''); setSecretKeyInput(''); await load(); }
    } catch (e:any) { setWalletMessage(`Bağlantı kesilemedi: ${e?.message || e}`); }
    finally { setWalletBusy(false); }
  };


  const analysis = book?.eightExchange || status?.eight_exchange;
  const liveMetrics = book?.metrics || status?.deep_analysis;
  const rows: ExchangeRow[] = analysis?.exchanges || [];
  const signal = analysis?.signal;
  const openTrade = trades.find(t => t.is_open);

  const fmt = (n: any, d = 2) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n: any) => `${Number(n || 0).toFixed(2)}%`;

  return (
    <div className="min-h-screen bg-[#090c12] text-slate-100">
      <header className="border-b border-[#202635] bg-[#0e121a] px-4 py-3">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-500/10 p-2"><Zap className="h-5 w-5 text-blue-400"/></div>
            <div>
              <div className="font-bold">8X Order Book Matematik Motoru</div>
              <div className="text-xs text-slate-500">Tek mod · 8 borsa WebSocket · mum grafiği yok</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={copyServerIp}
              disabled={serverIp === 'Tespit ediliyor...'}
              title="Sunucunun Binance/API bağlantılarında kullandığı dış IP adresini kopyala"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-mono text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60"
            >
              {ipCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Globe className="h-3.5 w-3.5" />}
              <span>Sunucu IP: {ipCopied ? 'Kopyalandı' : serverIp}</span>
              <Copy className="h-3 w-3 opacity-70" />
            </button>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.state === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/40 text-slate-400'}`}>
              {status?.state === 'running' ? 'ÇALIŞIYOR' : 'DURDU'}
            </span>
            <button disabled={busy} onClick={() => command('/api/v1/start')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm disabled:opacity-50"><Play className="inline h-4 w-4 mr-1"/>Başlat</button>
            <button disabled={busy} onClick={() => command('/api/v1/stop')} className="rounded-lg bg-slate-700 px-3 py-2 text-sm disabled:opacity-50"><Square className="inline h-4 w-4 mr-1"/>Durdur</button>
            <button onClick={load} className="rounded-lg border border-[#293142] p-2"><RefreshCw className="h-4 w-4"/></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            ['Parite', status?.pair || 'BTC/USDT'],
            ['8X Fark', pct(analysis?.crossGapPct)],
            ['Binance/Medyan', pct(analysis?.binanceVsMedianPct)],
            ['Scalp Skoru', fmt(analysis?.scalpScore, 2)],
            ['Scalp Uyum', pct(Number(analysis?.scalpAgreement || 0) * 100)],
            ['Liquidity Echo', fmt(analysis?.liquidityEchoScore, 2)],
            ['V2 Edge', pct(analysis?.scalpV2?.score * 100)],
            ['Flow 1s', pct(analysis?.scalpV2?.flow1s * 100)],
            ['8X Uyum', pct(analysis?.scalpV2?.exchangeAgreement * 100)],
            ['Delta Exec', pct(analysis?.scalpV2?.executionImbalance * 100)],
            ['Queue', fmt(analysis?.scalpV2?.queueDepletion, 2)],
            ['Spoof Risk', pct(analysis?.scalpV2?.spoofRisk * 100)],
            ['S/F Divergence', pct(analysis?.scalpV2?.divergenceMagnitude * 100)],
            ['Pozisyon', openTrade ? String(openTrade.type).toUpperCase() : 'YOK']
          ].map(([k,v]) => <div key={k} className="rounded-xl border border-[#202635] bg-[#10151e] p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
            <div className="mt-1 text-lg font-bold font-mono">{v}</div>
          </div>)}
        </div>


        <section className="rounded-xl border border-blue-500/20 bg-[#10151e] p-4">
          <button onClick={() => setSettingsOpen(v=>!v)} className="w-full flex items-center justify-between text-left">
            <div><div className="text-xs uppercase tracking-wider text-slate-500">Algoritma Ayarları</div><div className="mt-1 text-lg font-bold flex items-center gap-2"><Settings className="h-4 w-4 text-blue-400"/> Coin Seçim Motoru</div></div>
            <span className="text-xs text-slate-500">{settingsOpen ? 'Kapat' : 'Aç'}</span>
          </button>
          {settingsOpen && <div className="mt-4 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <button onClick={()=>setSelectorMode('manual')} className={`rounded-xl border p-4 text-left ${selectorMode==='manual'?'border-blue-500 bg-blue-500/10':'border-[#293142] bg-[#0b0f16]'}`}><b>Profesyonel</b><div className="text-xs text-slate-500 mt-1">Senin belirlediğin coin havuzunda mevcut profesyonel mikro-yapı algoritması en iyi adayı seçer.</div></button>
              <button onClick={()=>setSelectorMode('algorithmic')} className={`rounded-xl border p-4 text-left ${selectorMode==='algorithmic'?'border-emerald-500 bg-emerald-500/10':'border-[#293142] bg-[#0b0f16]'}`}><b>Algoritma</b><div className="text-xs text-slate-500 mt-1">USDT Futures piyasasını tarar ve kriterlere uyan en güçlü coin'i seçer.</div></button>
              <button onClick={()=>setSelectorMode('ai')} className={`rounded-xl border p-4 text-left ${selectorMode==='ai'?'border-violet-500 bg-violet-500/10':'border-[#293142] bg-[#0b0f16]'}`}><b>🤖 Yapay Zekâ</b><div className="text-xs text-slate-500 mt-1">Profesyonel sekmeyle aynı canlı kâr/zarar korumasını kullanır; ayrıca order-flow, whale, likidite, EV ve piyasa rejimini değerlendirip işlem, pozisyon ve kaldıraç kararını risk profili sınırlarında verir.</div></button>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-[#0b0f16] p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500">🛡️ Ortak Zarar Koruması</div>
              <div className="text-xs text-slate-400 mt-1 mb-3">Seçtiğin profil Profesyonel, Algoritma ve Yapay Zekâ modlarının tamamına uygulanır. Varsayılan: <b className="text-emerald-400">Muhafazakâr</b>.</div>
              <div className="grid grid-cols-3 gap-2">
                {([['conservative','🟢 Muhafazakâr','En düşük risk · AI max 4X'],['balanced','🟡 Orta','Dengeli risk · AI max 8X'],['aggressive','🔴 Riskli','Yüksek risk · AI max 12X']] as const).map(([key,label,desc]) => <button key={key} onClick={()=>setRiskMode(key)} className={`rounded-lg border p-3 text-left ${riskMode===key?'border-amber-400 bg-amber-400/10':'border-[#293142]'}`}><b>{label}</b><div className="text-[10px] text-slate-500 mt-1">{desc}</div></button>)}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="rounded-lg bg-[#0b0f16] p-3 text-xs">Profesyonel coinler (en fazla 10)<textarea value={manualPairs} onChange={e=>setManualPairs(e.target.value)} className="mt-2 w-full h-20 rounded-md border border-[#293142] bg-[#080b11] p-2 font-mono text-xs outline-none" placeholder="BTC/USDT, ETH/USDT, SOL/USDT"/></label>
              <label className="rounded-lg bg-[#0b0f16] p-3 text-xs">Maksimum açık pozisyon<input type="number" min="1" max="10" value={maxPositions} onChange={e=>setMaxPositions(Number(e.target.value))} className="mt-2 w-full rounded-md border border-[#293142] bg-[#080b11] p-2 font-mono"/><span className="text-[10px] text-amber-400 block mt-1">Not: mevcut işlem yöneticisi şu sürümde tek aktif net Futures pozisyonunu yönetiyor; 2–10 kapasite ayarı seçim/risk limiti olarak kaydedilir, çoklu pozisyon yöneticisi ayrı refaktördür.</span></label>
              <label className="rounded-lg bg-[#0b0f16] p-3 text-xs">Algoritmik tarama coin sayısı<input type="number" min="5" max="50" value={scanAssets} onChange={e=>setScanAssets(Number(e.target.value))} className="mt-2 w-full rounded-md border border-[#293142] bg-[#080b11] p-2 font-mono"/></label>
              <label className="rounded-lg bg-[#0b0f16] p-3 text-xs">Minimum fırsat skoru<input type="number" min="0.2" max="0.95" step="0.01" value={minOpportunity} onChange={e=>setMinOpportunity(Number(e.target.value))} className="mt-2 w-full rounded-md border border-[#293142] bg-[#080b11] p-2 font-mono"/></label>
            </div>
            <div className="flex items-center gap-3"><button disabled={busy} onClick={saveSelectorSettings} className="rounded-lg bg-blue-600 px-4 py-2 text-sm"><Save className="inline h-4 w-4 mr-1"/>Kaydet</button>{settingsSaved&&<span className="text-xs text-emerald-400">Kaydedildi</span>}<span className="text-xs text-slate-500">Uygun sinyal yoksa motor BEKLEMEDE kalır; uygun sinyal oluştuğu anda giriş kapısı tekrar değerlendirilir.</span></div>
          </div>}
        </section>

        <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
          <div className="flex items-center justify-between"><div><div className="text-xs uppercase tracking-wider text-slate-500">Coin Seçici</div><div className="text-lg font-bold">{status?.selector?.state === 'WAITING_FOR_MATCH' ? 'BEKLEMEDE' : status?.pair || 'BTC/USDT'}</div></div><div className="text-xs text-slate-500">{status?.selector?.mode === 'ai' ? '🤖 Yapay Zekâ kararı' : status?.selector?.mode === 'algorithmic' ? 'Algoritmik tarama' : 'Profesyonel manuel havuz'} · Zarar koruması: {status?.risk_protection_label || 'Muhafazakar'}</div></div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">{(status?.selector?.candidates || []).slice(0,6).map((c:any,i:number)=><div key={c.pair} className={`rounded-lg p-3 bg-[#0b0f16] border ${i===0&&c.eligible?'border-emerald-500/40':'border-[#202635]'}`}><div className="flex justify-between"><b>{c.pair}</b><span className={c.eligible?'text-emerald-400':'text-slate-500'}>{c.eligible?'UYGUN':'BEKLE'}</span></div><div className="text-xs text-slate-500 mt-1">Skor {fmt(Number(c.score)*100,1)}% · {c.signal||'-'} · Edge {fmt(c.expectedEdgePct,3)}%</div></div>)}</div>
        </section>
        {status?.selector?.mode === 'ai' && <section className="rounded-xl border border-violet-500/20 bg-[#10151e] p-4">
          <div className="flex items-center justify-between"><div><div className="text-xs uppercase tracking-wider text-slate-500">🤖 Yapay Zekâ Karar Motoru</div><div className="mt-1 text-lg font-bold">Analiz → Karar → Risk → Pozisyon</div></div><div className="text-xs text-emerald-400">Risk: {status?.risk_protection_label || 'Muhafazakar'}</div></div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="rounded-lg bg-[#0b0f16] p-3">Karar<br/><b>{status?.ai_decision?.candidates?.[0]?.eligible ? String(status?.ai_decision?.candidates?.[0]?.signal||'BEKLE').toUpperCase() : 'BEKLE'}</b></div>
            <div className="rounded-lg bg-[#0b0f16] p-3">AI Güveni<br/><b>{fmt(Number(status?.ai_decision?.candidates?.[0]?.score||0)*100,0)}%</b></div>
            <div className="rounded-lg bg-[#0b0f16] p-3">Whale Desteği<br/><b>{fmt(Number(status?.ai_decision?.candidates?.[0]?.aiDecision?.whaleSupport||0)*100,0)}%</b></div>
            <div className="rounded-lg bg-[#0b0f16] p-3">Risk Limiti<br/><b>{fmt(Number(status?.risk_protection_profile?.maxAccountRiskPct||0)*100,2)}%</b></div>
            <div className="rounded-lg bg-[#0b0f16] p-3">AI Max X<br/><b>{fmt(status?.risk_protection_profile?.maxLeverage,0)}X</b></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">Üç sekmede ortak Profesyonel Kâr/Zarar Koruması aktiftir: canlı matematik kârın belirgin biçimde eriyeceğini veya kalan beklentinin negatife döndüğünü öngörürse TP'yi beklemeden pozisyon kapatılır.</div>
        </section>}
        <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Kâr/Zarar Mutabakatı</div>
              <div className="mt-1 text-xs text-slate-500">Bot hesabı ile Binance Futures hesabı ayrı gösterilir; fark varsa doğrudan görünür.</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] px-3 py-2"><span className="text-slate-500">Bot PNL</span><br/><b className={Number(pnl?.bot_pnl_usdt)>=0?'text-emerald-400':'text-rose-400'}>{fmt(pnl?.bot_pnl_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] px-3 py-2"><span className="text-slate-500">Binance PNL</span><br/><b className={Number(pnl?.binance_account_pnl_usdt)>=0?'text-emerald-400':'text-rose-400'}>{fmt(pnl?.binance_account_pnl_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] px-3 py-2"><span className="text-slate-500">Binance Bakiye</span><br/><b>{fmt(pnl?.binance_margin_balance,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] px-3 py-2"><span className="text-slate-500">Reconcile Farkı</span><br/><b className={Math.abs(Number(pnl?.binance_reconciliation_gap_usdt||0))<0.01?'text-emerald-400':'text-amber-400'}>{fmt(pnl?.binance_reconciliation_gap_usdt,4)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] px-3 py-2"><span className="text-slate-500">Transfer Akışı</span><br/><b>{fmt(pnl?.binance_cash_flow_usdt,2)} USDT</b></div>
            </div>
          </div>
        </section>

        {liveMetrics?.executionPlan?.orderBookPnl && (() => {
          const plan = liveMetrics.executionPlan;
          const p = plan.orderBookPnl;
          const positive = Number(p.targetNetPnlUsdt) >= 0;
          return <section className="rounded-xl border border-blue-500/20 bg-[#10151e] p-4">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-xs uppercase tracking-wider text-slate-500">Emir Defteri PnL Haritası</div><div className="text-xs text-slate-500 mt-1">Mevcut defter likiditesi giriş ve hedef/stop çıkışını simüle ediyor.</div></div>
              <div className={`text-xl font-black font-mono ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>{positive ? '+' : ''}{fmt(p.targetNetPnlUsdt,2)} USDT</div>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] p-3">Giriş VWAP<br/><b>{fmt(p.entryVwap,2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Hedef Net<br/><b className={positive?'text-emerald-400':'text-rose-400'}>{fmt(p.targetNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Stop Net<br/><b className="text-rose-400">{fmt(p.stopNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Anlık Çıkış<br/><b>{fmt(p.immediateNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Hedef Derinlik<br/><b>{fmt(Number(p.targetExitDepthPct)*100,0)}%</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">PnL Kalitesi<br/><b>{fmt(p.pnlQualityScore,0)}/100</b></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono">
              {(p.levels || []).map((x:any) => <span key={x.movePct} className={`rounded-md px-2 py-1 bg-[#0b0f16] ${Number(x.netPnlUsdt)>=0?'text-emerald-300':'text-rose-300'}`}>{(Number(x.movePct)*100).toFixed(2)}% → {Number(x.netPnlUsdt)>=0?'+':''}{fmt(x.netPnlUsdt,2)} USDT</span>)}
            </div>
            {p.scenario && <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] p-3">İyimser<br/><b className="text-emerald-300">+{fmt(p.scenario.optimisticNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Baz<br/><b>{fmt(p.scenario.baseNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Adverse<br/><b className="text-amber-300">{fmt(p.scenario.adverseNetPnlUsdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Gerçekleşebilirlik<br/><b>{fmt(Number(p.scenario.executionProbability)*100,0)}%</b></div>
            </div>}
            <div className="mt-2 text-[10px] text-slate-500">Hedefe giden yol likiditesi: {fmt(p.pathLiquidityUsdt,0)} USDT · Giriş notional: {fmt(p.notionalUsdt,0)} USDT · Gerçekleşebilirlik; balina akışı, absorption, replenishment, queue depletion, trade-flow ve tüketim sinyallerini defter PnL'sine ağırlıklandırır. Gelecekteki defteri bildiğini iddia etmez.</div>
          </section>;
        })()}

        <section className="rounded-xl border border-[#202635] bg-[#10151e] p-3 sm:p-4">
          <button onClick={()=>setWalletOpen(v=>!v)} className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-left">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500">Binance Futures Cüzdan / İşlem API</div>
              <div className={`mt-1 text-base sm:text-lg font-bold ${wallet?.success ? 'text-emerald-400' : 'text-slate-200'}`}>
                {wallet?.success ? '● CANLI BINANCE BAĞLANTISI' : '○ API bağlantısı bekleniyor'}
              </div>
            </div>
            <span className="self-start sm:self-auto text-xs text-slate-500 rounded-md border border-[#293142] px-2 py-1">{walletOpen ? 'Kapat' : 'Aç / Bağla'}</span>
          </button>

          {wallet?.success && (
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] p-3"><span className="text-slate-500">Wallet</span><br/><b>{fmt(wallet.wallet_balance_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3"><span className="text-slate-500">Margin</span><br/><b>{fmt(wallet.margin_balance_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3"><span className="text-slate-500">Available</span><br/><b>{fmt(wallet.available_balance_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3"><span className="text-slate-500">Used Margin</span><br/><b>{fmt(wallet.used_margin_usdt,2)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3"><span className="text-slate-500">Unrealized PNL</span><br/><b className={Number(wallet.unrealized_pnl_usdt)>=0?'text-emerald-400':'text-rose-400'}>{fmt(wallet.unrealized_pnl_usdt,2)} USDT</b></div>
            </div>
          )}

          {walletOpen && <div className="mt-4 rounded-xl border border-[#293142] bg-[#0b0f16] p-3 sm:p-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto_auto] gap-2">
              <input value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)} placeholder="Binance API Key" className="min-w-0 rounded-md border border-[#293142] bg-[#080b11] p-3 font-mono text-xs outline-none focus:border-blue-500" autoComplete="off" inputMode="text"/>
              <input value={secretKeyInput} onChange={e=>setSecretKeyInput(e.target.value)} placeholder="Binance Secret Key" type="password" className="min-w-0 rounded-md border border-[#293142] bg-[#080b11] p-3 font-mono text-xs outline-none focus:border-blue-500" autoComplete="new-password"/>
              <button disabled={walletBusy} onClick={saveBinanceKeys} className="rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold disabled:opacity-50">{walletBusy ? 'İşleniyor…' : 'Bağla'}</button>
              <button disabled={walletBusy || !wallet?.success} onClick={disconnectBinance} className="rounded-md border border-rose-500/40 px-4 py-3 text-sm text-rose-300 disabled:opacity-40">Kes</button>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] sm:text-xs text-slate-500">
              <div>API anahtarını yalnızca <b className="text-slate-300">Futures + USER_DATA</b> için kullan. <b className="text-rose-300">Withdrawal/çekim yetkisini açma.</b></div>
              <div>Binance'in gördüğü outbound IP: <button type="button" onClick={copyServerIp} className="font-mono text-cyan-300 underline underline-offset-2">{serverIp}</button></div>
            </div>
            {walletMessage && <div className={`mt-3 rounded-md p-2 text-xs ${walletMessage.startsWith('✓') ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{walletMessage}</div>}
            {walletError && !wallet?.success && <div className="mt-2 rounded-md bg-rose-500/10 p-2 text-xs text-rose-300">{walletError}</div>}
            {Array.isArray(wallet?.positions) && wallet.positions.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Binance Açık Pozisyonlar</div>
                <table className="min-w-[620px] w-full text-xs"><thead className="text-slate-500"><tr><th className="p-2 text-left">Symbol</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Entry</th><th className="p-2 text-right">Mark</th><th className="p-2 text-right">PNL</th><th className="p-2 text-right">Lev.</th></tr></thead><tbody>{wallet.positions.map((pos:any)=><tr key={`${pos.symbol}-${pos.side}`} className="border-t border-[#1b2230]"><td className="p-2 font-semibold">{pos.symbol} · {String(pos.side||'').toUpperCase()}</td><td className="p-2 text-right font-mono">{fmt(pos.contracts,4)}</td><td className="p-2 text-right font-mono">{fmt(pos.entry_price,4)}</td><td className="p-2 text-right font-mono">{fmt(pos.mark_price,4)}</td><td className={`p-2 text-right font-mono ${Number(pos.unrealized_pnl)>=0?'text-emerald-400':'text-rose-400'}`}>{fmt(pos.unrealized_pnl,2)}</td><td className="p-2 text-right">{fmt(pos.leverage,0)}x</td></tr>)}</tbody></table>
              </div>
            )}
          </div>}
        </section>

        <section className="rounded-xl border border-[#202635] bg-[#10151e] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#202635] px-4 py-3">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-400"/><span className="font-semibold">8 Borsa Birleşik Emir Defteri</span></div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Referans fiyat farkı</span>
              <input value={minGapPct} onChange={e => { setMinGapPct(e.target.value); setGapSaved(false); }} type="number" min="0.1" max="50" step="0.1" className="w-20 rounded-md border border-[#293142] bg-[#0b0f16] px-2 py-1 text-right font-mono text-amber-400 outline-none" />
              <span className="text-amber-400">%</span>
              <button disabled={busy} onClick={saveGap} className="rounded-md bg-blue-600 px-2 py-1 text-white disabled:opacity-50">Kaydet</button>
              {gapSaved && <span className="text-emerald-400">Kaydedildi</span>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0b0f16] text-xs text-slate-500">
                <tr><th className="text-left p-3">Borsa</th><th className="text-right p-3">Orta Fiyat</th><th className="text-right p-3">Bid</th><th className="text-right p-3">Ask</th><th className="text-right p-3">OBI</th><th className="text-right p-3">Gecikme</th></tr>
              </thead>
              <tbody>
                {rows.map(r => <tr key={r.exchange} className="border-t border-[#1b2230]">
                  <td className="p-3 font-semibold uppercase">{r.exchange}</td>
                  <td className="p-3 text-right font-mono">{fmt(r.mid, 4)}</td>
                  <td className="p-3 text-right font-mono text-emerald-400">{fmt(r.bestBid, 4)}</td>
                  <td className="p-3 text-right font-mono text-rose-400">{fmt(r.bestAsk, 4)}</td>
                  <td className={`p-3 text-right font-mono ${r.obi >= 0 ? 'text-emerald-400':'text-rose-400'}`}>{r.obi.toFixed(3)}</td>
                  <td className="p-3 text-right text-slate-500">{Math.round(r.ageMs)} ms</td>
                </tr>)}
                {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">8 borsadan WebSocket verisi bekleniyor…</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-4">
          <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Matematiksel Karar</div>
            <div className="mt-3 flex items-center gap-3">
              {signal === 'long' ? <TrendingUp className="h-9 w-9 text-emerald-400"/> : signal === 'short' ? <TrendingDown className="h-9 w-9 text-rose-400"/> : <ShieldCheck className="h-9 w-9 text-slate-500"/>}
              <div>
                <div className="text-2xl font-black">{signal ? signal.toUpperCase() : 'BEKLE'}</div>
                <div className="text-xs text-slate-500">{analysis?.entryReason || 'Fark + üst kademe + kısa vadeli teknikler izleniyor.'}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] p-3">En ucuz: <b>{analysis?.minExchange || '-'}</b><br/>{fmt(analysis?.minPrice,4)}</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">En pahalı: <b>{analysis?.maxExchange || '-'}</b><br/>{fmt(analysis?.maxPrice,4)}</div>
            </div>
          </section>

          <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Kısa Vadeli Teknikler</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[#0b0f16] p-3">Order Book<br/><b>{fmt(analysis?.scalpComponents?.book, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Liquidity Echo<br/><b>{fmt(analysis?.scalpComponents?.liquidityEcho, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Microprice<br/><b>{fmt(analysis?.microBias, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Trade Flow<br/><b>{fmt(analysis?.tradeFlowBias, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">V2 Consumption<br/><b>{fmt(analysis?.scalpV2?.consumptionScore, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">V2 Net Edge<br/><b>{fmt(analysis?.scalpV2?.netEdgePct, 3)}%</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Absorption<br/><b>{fmt(analysis?.scalpV2?.absorptionScore, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Execute Delta<br/><b>{fmt(analysis?.scalpV2?.executionImbalance, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Queue Depletion<br/><b>{fmt(analysis?.scalpV2?.queueDepletion, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Spoof Risk<br/><b>{fmt(analysis?.scalpV2?.spoofRisk, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Spot/Futures Divergence<br/><b>{fmt(analysis?.scalpV2?.spotFuturesDivergence, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Momentum<br/><b>{fmt(analysis?.shortMomentum, 2)}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">V2.7 Setup<br/><b>{analysis?.v27?.highConviction ? 'A+ HIGH' : 'NORMAL'}</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Rejim<br/><b>{analysis?.v27?.regime || '-'}</b> · {fmt((analysis?.v27?.regimeQuality || 0)*100,0)}%</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Pozisyon Çarpanı<br/><b>{fmt(analysis?.v27?.sizeMultiplier,2)}x</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">EV<br/><b>{fmt((analysis?.v27?.ev?.expectancy || 0),4)} USDT</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Live Math Engine<br/><b>{analysis?.v28?.source || '-'}</b> · geçmiş veri yok</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Short-Horizon<br/><b>{fmt((analysis?.shortHorizon?.score || 0)*100,0)}%</b> · {analysis?.shortHorizon?.qualifies ? 'GİRİŞ UYGUN' : 'BEKLE'}</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Liquidity Vacuum L/S<br/><b>{fmt((analysis?.shortHorizon?.liquidityVacuum?.long || 0)*100,0)}%</b> / {fmt((analysis?.shortHorizon?.liquidityVacuum?.short || 0)*100,0)}%</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Path Resistance L/S<br/><b>{fmt((analysis?.shortHorizon?.pathResistance?.long || 0)*100,0)}%</b> / {fmt((analysis?.shortHorizon?.pathResistance?.short || 0)*100,0)}%</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Price Impact L/S<br/><b>{fmt((analysis?.shortHorizon?.priceImpact?.long || 0)*100,3)}%</b> / {fmt((analysis?.shortHorizon?.priceImpact?.short || 0)*100,3)}%</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Flow Acceleration<br/><b>{fmt((analysis?.shortHorizon?.flow?.acceleration || 0)*100,1)}%</b> · speed {fmt((analysis?.shortHorizon?.flow?.speed || 0)*100,0)}%</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Absorption<br/><b>{fmt((analysis?.shortHorizon?.absorption?.strength || 0)*100,0)}%</b> · response {fmt(analysis?.shortHorizon?.absorption?.response || 0,2)}</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">0–5s Hedef<br/><b>{fmt(analysis?.shortHorizon?.targetBps || 0,1)} bps</b> · ETA {fmt(analysis?.shortHorizon?.timeToTargetMs || 0,0)} ms</div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Book Freshness<br/><b>{fmt((analysis?.shortHorizon?.freshness || 0)*100,0)}%</b> · {fmt(analysis?.shortHorizon?.ageMs || 0,0)} ms</div>

              <div className="rounded-lg bg-[#0b0f16] p-3">Opt TP1<br/><b>{fmt((analysis?.v28?.tp1Fraction || 0)*100,0)}%</b></div>
              <div className="rounded-lg bg-[#0b0f16] p-3">Opt Runner / Trail<br/><b>{fmt((analysis?.v28?.runnerTargetPct || 0)*100,2)}% / {fmt((analysis?.v28?.runnerTrailPct || 0)*100,2)}%</b></div>
            </div>
          </section>

          <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Açık Pozisyon</div>
            {openTrade ? <div className="mt-3 space-y-2">
              <div className="text-xl font-bold">{String(openTrade.type).toUpperCase()} · {openTrade.pair}</div>
              <div className="text-sm text-slate-400">Giriş: <span className="font-mono text-slate-200">{fmt(openTrade.open_rate,4)}</span></div>
              <div className="text-sm">K/Z: <span className={Number(openTrade.profit_pct)>=0?'text-emerald-400':'text-rose-400'}>{pct(openTrade.profit_pct)}</span></div>
              <div className="text-xs text-slate-400">Live Math: {openTrade.execution_plan?.winProbability ? `${(Number(openTrade.execution_plan.winProbability)*100).toFixed(1)}% model güveni` : '-'} · EV: {openTrade.execution_plan?.expectedValuePct ? `${(Number(openTrade.execution_plan.expectedValuePct)*100).toFixed(3)}%` : '-'} · TP1: {openTrade.tp1_fraction ? `${Number(openTrade.tp1_fraction)*100}%` : '-'} · Runner: {openTrade.runner_target_price ? fmt(openTrade.runner_target_price,4) : '-'} · Trail: {openTrade.optimizer_runner_trail_pct ? `${(Number(openTrade.optimizer_runner_trail_pct)*100).toFixed(2)}%` : '-'}</div>
                {status?.selector?.mode === 'ai' && <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs"><b>🤖 AI Kademeli Giriş:</b> {status?.active_position?.ladderStep ? `${Math.min(Number(status.active_position.ladderStep),3)}/3 kademe` : '1/3'} · Hedef toplam marjin {fmt(status?.active_position?.ladderTargetMargin,2)} USDT · {status?.active_position?.ladderStep < 3 ? 'Sonraki kademe yalnızca fiyat + whale teyidi devam ederse açılır.' : 'Tüm kademeler tamamlandı.'}</div>}
              <button onClick={() => command('/api/v1/forceexit', { tradeid: openTrade.id })} className="mt-2 rounded-lg bg-rose-600 px-3 py-2 text-sm"><LogOut className="inline h-4 w-4 mr-1"/>Pozisyonu Kapat</button>
            </div> : <div className="mt-8 text-center text-slate-500">Açık pozisyon yok.</div>}
          </section>

          <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Kural</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li>• 8 borsanın order book'u tek matematiksel modele normalize edilir.</li>
              <li>• Fiyat farkı artık tek başına giriş şartı değildir; V2 order-flow, likidite tüketimi ve execution edge ana filtredir.</li>
              <li>• Live Math Engine geçmiş işlem saklamaz; girişte spread + slippage + komisyon + likidite maliyetini hesaplar ve yalnızca net EV pozitifse IOC limit giriş dener.</li>
              <li>• Giriş için ilk 5 kademe + agresif trade-flow + likidite tüketimi + 8X freshness konsensüsü birlikte teyit edilir.</li>
              <li>• Sinyaller yeterince uyumlu değilse bot işlem açmaz.</li>
              <li>• Yön, freshness-ağırlıklı 8X konsensüs + OBI hızı + trade-flow + gerçeklenmiş delta ile hesaplanır; spoof/absorption çatışması işlemi engeller.</li>
              <li>• Add/Cancel/Execute ayrımı ilk 5 kademe değişimlerinden çıkarılır; Binance trade akışıyla eşleşen azalmalar execute, geri kalanı cancel olarak sınıflandırılır.</li>
              <li>• 8X fiyat farkı pozisyon yönetiminde yardımcıdır; ana giriş filtresi Scalp V2'dir.</li>
              <li>• Ters hareket için hard-stop korunur.</li>
            </ul>
          </section>
        </div>

        <section className="rounded-xl border border-[#202635] bg-[#10151e] p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Motor Logları</div>
          <div className="max-h-48 overflow-auto space-y-1 font-mono text-xs text-slate-400">
            {logs.slice(0,30).map(l => <div key={l.id}><span className="text-slate-600">{l.timestamp}</span> {l.message}</div>)}
          </div>
        </section>
      </main>
    </div>
  );
}
