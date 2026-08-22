# Derin Analiz ve Replay

- Ana yön kaynağı: Binance Spot order book.
- Futures order book: teyit.
- Geçmiş pencere `deep_analysis.history_minutes` ile 1–120 dakika.
- Snapshot aralığı `deep_analysis.snapshot_seconds` ile 2–60 saniye.
- Balina, Spot `aggTrades` üzerinden gerçek gerçekleşmiş işlemlerden hesaplanır; görünen order-book duvarı balina kabul edilmez.
- Balina çarpanı yalnızca normal Deep Score sinyaliyle aynı yönde ise pozisyon marjını artırır; balina tek başına işlem açmaz.
- Replay kaydı `data/deep-analysis-replay.jsonl` altında tutulur.
- Replay canlı analiz sırasında 30/60/180 saniye gibi ufuklarda sinyalin sonradan doğru yönlü olup olmadığını ölçer. Eski order-book verisi yoksa geçmiş tarih için gerçek backtest yapılamaz.
