# Coin Selector V4

## Modlar
- **Profesyonel:** Kullanıcının belirlediği en fazla 10 USDT paritesi taranır. Coinlerden yalnızca profesyonel mikro-yapı kapılarını geçenler aday olur; en yüksek skor seçilir.
- **Algoritma:** Binance USDT Futures piyasasından hacme göre seçilen `algorithm_scan_assets` kadar parite taranır ve aynı profesyonel mikro-yapı motoruyla en güçlü aday seçilir.

## Bekleme davranışı
Uygun aday yoksa motor `WAITING_FOR_MATCH` durumunda kalır. Yeni taramada uygun aday yakalandığında seçilir ve işlem kapısı yeniden değerlendirilir.

## Aday skoru
Aday sıralaması; Scalp V2 skoru, borsa uyumu, short-horizon skoru, net edge, whale net-flow ve güven bileşenlerini birlikte kullanır. Bu skor kâr garantisi değildir.

## Önemli mevcut mimari sınır
Ayar ekranında 1-10 maksimum pozisyon limiti saklanır; ancak bu sürümün mevcut canlı işlem yöneticisi tek aktif net Futures pozisyonunu güvenli biçimde yönetmektedir. 2-10 gerçek eşzamanlı pozisyon açma, pozisyon başına guardian/stop/TP ve Binance sembol bazlı senkronizasyonu kapsayan ayrı bir multi-position manager refaktörü gerektirir. Bu nedenle ayar 1'den büyük olsa bile motor tek canlı pozisyonla sınırlıdır; yanlış biçimde çoklu pozisyon açılmış gibi gösterilmez.


## Yapay Zekâ modu
- Profesyonel ve Algoritma modlarının mikro-yapı kapılarını kullanır; buna ek olarak order-flow, whale yönü, likidite, spread, short-horizon ve EV bileşenlerini ortak karar skoruna dönüştürür.
- Uygun aday yoksa BEKLEMEDE kalır.
- Seçilen global Zarar Koruması profili AI'nın maksimum kaldıraç, marjin ve hesap-risk sınırlarını belirler.
- Varsayılan zarar koruması Muhafazakar'dır.
- AI işlem açma zorunluluğuna sahip değildir; güvenlik kapılarından biri başarısızsa giriş yapılmaz.
