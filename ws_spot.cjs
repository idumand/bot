const WebSocket = require('ws');
const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');
ws.on('open', () => console.log('connected spot'));
ws.on('message', (data) => {
  console.log('msg spot', data.toString().substring(0, 300));
  ws.close();
});
ws.on('error', (e) => console.log('error', e));
