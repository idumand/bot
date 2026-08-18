const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The bot is hardcoded to use TRADING_PAIR = 'BTC/USDT', we need it to use the list from the config!
const hardcodeRegex = /const TRADING_PAIR = 'BTC\/USDT';/;
code = code.replace(hardcodeRegex, "let TRADING_PAIR = 'BTC/USDT'; // Default, will be updated by config");

// We need to update the trading pair dynamically when config loads or is saved
const updateConfigRegex = /botConfig = req\.body;\s*fs\.writeFileSync\(CONFIG_PATH, JSON\.stringify\(botConfig, null, 2\)\);/m;
const newUpdateConfig = `botConfig = req.body;
      if (botConfig.exchange && botConfig.exchange.pair_whitelist && botConfig.exchange.pair_whitelist.length > 0) {
        TRADING_PAIR = botConfig.exchange.pair_whitelist[0];
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(botConfig, null, 2));`;
code = code.replace(updateConfigRegex, newUpdateConfig);

// And update it on startup when reading config
const readConfigRegex = /botConfig = JSON\.parse\(fs\.readFileSync\(CONFIG_PATH, 'utf-8'\)\);/m;
const newReadConfig = `botConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (botConfig.exchange && botConfig.exchange.pair_whitelist && botConfig.exchange.pair_whitelist.length > 0) {
        TRADING_PAIR = botConfig.exchange.pair_whitelist[0];
      }`;
code = code.replace(readConfigRegex, newReadConfig);


// Update the interval to 10 seconds (it was accidentally set to 1000ms = 1s in a previous step, which causes rate limits)
const loopRegex = /engineLoop = setInterval\(executeRealTradeLogic, 1000\);/;
code = code.replace(loopRegex, "engineLoop = setInterval(executeRealTradeLogic, 10000);");

fs.writeFileSync('server.ts', code);
