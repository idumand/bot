# AI Kademeli Giriş

Yapay Zekâ modu pozisyonu tek seferde büyütmek yerine varsayılan olarak **%40 + %30 + %30** şeklinde yönetir.

## Kurallar

- 1. kademe: AI'nin onayladığı toplam hedef marjinin %40'ı.
- 2. kademe: fiyat mevcut pozisyon yönünde en az yaklaşık %0,15 ilerlediyse ve whale desteği en az %60 ise.
- 3. kademe: fiyat mevcut pozisyon yönünde en az yaklaşık %0,25 ilerlediyse ve whale desteği en az %68 ise.
- Her yeni kademede AI kararı yeniden hesaplanır.
- AI kararı geçersizleşirse yeni kademe açılmaz.
- Sistem zarar eden pozisyona körlemesine ekleme yapmaz; **averaging down yoktur**.
- İki kademe arasında en az 12 saniye beklenir.
- Her kademe aynı ortak Zarar Koruması profilinin kaldıraç, marjin ve hesap-riski sınırlarına tabidir.
- Yeni kademe sonrası ağırlıklı ortalama giriş fiyatı yeniden hesaplanır.
- Koruyucu stop yalnızca daha sıkı olacak şekilde yeniden konumlandırılır; yeni stop kurulamazsa mevcut stop korunur.
- IOC emri dolmazsa fiyat kovalanmaz ve kademe açılmaz.

Varsayılan risk profili **Muhafazakâr**dır.

## Professional-style AI profit protection

The AI position guardian now uses the same profit-preservation principle as the Professional mode: it continuously estimates expected continuation and adverse risk. If the live calculation predicts that the remaining path is negative expectancy, or that the expected adverse move can consume most of the current profit, the position is closed while it is still profitable. This rule runs before TP/runner logic and does not weaken the hard stop.
