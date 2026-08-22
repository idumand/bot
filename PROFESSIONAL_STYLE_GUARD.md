# Ortak Profesyonel Kâr/Zarar Koruması

Profesyonel, Algoritma ve Yapay Zekâ modları aynı canlı Position Guardian katmanından geçer.

Guardian, TP/Runner çalışmadan önce her döngüde:
- mevcut kârı,
- beklenen devam olasılığını,
- tahmini ters hareketi,
- kalan hedefe göre beklenen değeri,
- order-flow ve reversal baskısını
hesaplar.

Kâr varken kalan beklenti negatife dönerse veya tahmini ters hareket mevcut kârın önemli bölümünü tüketebilecekse pozisyon TP'yi beklemeden kapatılır.

AI kademeli girişleri bu korumayı bypass edemez. Algoritma modu da Profesyonel modla aynı Guardian'ı kullanır.

Varsayılan risk profili: Muhafazakâr.
