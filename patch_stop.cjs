const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = /app\.post\('\/api\/v1\/stop', \(req, res\) => \{\n\s*stopTradingEngine\(\);\n\s*res\.json\(\{ status: 'success', message: 'Node.js Bot Engine Stopped' \}\);\n\s*\}\);/;

const replacement = `app.post('/api/v1/stop', async (req, res) => {
    await stopTradingEngine();
    res.json({ status: 'success', message: 'Node.js Bot Engine Stopped' });
  });`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
