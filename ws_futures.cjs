const WebSocket = require('ws');
const ws = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');
ws.on('open', () => console.log('connected futures'));
ws.on('message', (data) => {
  console.log('msg futures', data.toString().substring(0, 300));
  ws.close();
});
ws.on('error', (e) => console.log('error', e));
