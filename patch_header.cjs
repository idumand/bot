const fs = require('fs');
let code = fs.readFileSync('src/components/Header.tsx', 'utf8');

const regex = /<button[\s\S]*?onClick=\{\(\) => onToggleBotState\(botState === 'paused' \? 'running' : 'paused'\)\}[\s\S]*?<\/button>/;
code = code.replace(regex, "");

fs.writeFileSync('src/components/Header.tsx', code);
