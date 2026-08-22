# Scalp Engine V2.8 — Auto Optimizer

V2.8, V2.7 High Conviction katmanının üzerine işlem geçmişinden öğrenen ancak risk limitlerini artırmayan bir execution optimizer ekler.

## Öğrenilen parametreler

- TP1 fraction: 25%, 35%, 45%
- Runner target: 0.8%, 1.0%, 1.2%, 1.5%, 2.0%
- Runner trailing: 0.15%, 0.20%, 0.25%, 0.30%, 0.40%

## Veri

Her kapanan işlem için mevcut MFE/MAE, entry score ve rejim kullanılır. Önce aynı score/rejim bucket'ı aranır; yeterli örnek yoksa yakın score aralığı fallback olarak kullanılır. En az 6 örnek yoksa V2.7 varsayılanları korunur.

## Güvenlik

Optimizer kaldıraç veya maksimum risk limitini artırmaz. Sadece kâr alma/runner yönetimi parametrelerini seçer. Küçük örneklemde fallback kullanır ve adayları sabit konservatif aralıklarla sınırlar.

## API

`GET /api/v1/optimizer` mevcut optimizer kararını ve son işlemlerin MFE/MAE verisini döndürür.
