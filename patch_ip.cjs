const fs = require('fs');
let code = fs.readFileSync('src/components/Header.tsx', 'utf8');

const regex = /\{\/\* Render Server IP Badge \*\/\}[\s\S]*?<\/div>/;
const replacement = `
          {/* Render Server IP Badge */}
          <div 
            onClick={handleCopyIp}
            className="flex items-center space-x-1.5 bg-[#1a3852]/20 border border-[#1e4a75]/40 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-medium text-[#7ab2e6] cursor-pointer hover:bg-[#1a3852]/40 transition shrink-0"
            title="IP Adresini Kopyala"
          >
             {copiedIp ? <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-emerald-400" /> : <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
             <span className="font-mono tracking-wide">{copiedIp ? 'Kopyalandı' : serverIp}</span>
             <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 opacity-70" />
          </div>
`;

code = code.replace(regex, replacement.trim());
fs.writeFileSync('src/components/Header.tsx', code);
