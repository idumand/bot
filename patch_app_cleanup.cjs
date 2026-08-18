const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace lines 288-292
const lines = code.split('\n');
const fixedLines = [
  ...lines.slice(0, 287), // keep up to 286 (which is line 287)
  ...lines.slice(293)     // keep from 293 (which is line 294)
];
fs.writeFileSync('src/App.tsx', fixedLines.join('\n'));
