const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/hasSupportWall/g, 'isBidWallStrong');
code = code.replace(/hasResistanceWall/g, 'isAskWallStrong');

fs.writeFileSync('server.ts', code);
