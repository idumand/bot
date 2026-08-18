const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const newForceClose = `
  const handleForceCloseTrade = async (tradeId: string) => {
    try {
      const res = await fetch('/api/v1/forceexit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeid: tradeId })
      });
      const data = await res.json();
      if (data.status === 'success') {
         addLog('SYSTEM', 'İşlem başarıyla Binance üzerinden zorla kapatıldı.');
         // Update UI locally just to be fast, it will be overwritten by fetchTrades next tick
         setTrades((prev) =>
          prev.map((t) => {
            if (t.id === tradeId) {
              return {
                ...t,
                is_open: false,
                close_rate: t.current_rate,
                close_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
                close_reason: 'Kullanıcı Manuel',
              };
            }
            return t;
          })
        );
      } else {
         addLog('ERROR', data.error || 'İşlem kapatılırken bir hata oluştu.');
      }
    } catch (e) {
      addLog('ERROR', 'Sunucuya bağlanılamadı. İşlem kapatılamadı.');
    }
  };
`;

const regex = /const handleForceCloseTrade = \(tradeId: string\) => \{[\s\S]*?\};\n/m;
code = code.replace(regex, newForceClose + "\n");

fs.writeFileSync('src/App.tsx', code);
