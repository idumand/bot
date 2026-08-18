const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const apiForceExit = `
  app.post('/api/v1/forceexit', async (req, res) => {
    const { tradeid } = req.body;
    if (activePosition && (activePosition.trade_id.toString() === tradeid.toString() || tradeid === 'all')) {
        await closeActivePosition('Kullanıcı Tarafından Manuel Olarak Zorla Kapatıldı');
        res.json({ status: 'success', message: 'İşlem başarıyla kapatıldı.' });
    } else {
        res.status(400).json({ error: 'Aktif açık işlem bulunamadı veya ID eşleşmedi.' });
    }
  });
`;

code = code.replace(
  "app.post('/api/v1/stop', (req, res) => {",
  apiForceExit + "\n  app.post('/api/v1/stop', (req, res) => {"
);

fs.writeFileSync('server.ts', code);
