const fs = require('fs');
let code = fs.readFileSync('src/components/Header.tsx', 'utf8');

const replacement = `
          {/* Render Server IP Badge */}
          <div className="hidden lg:flex items-center space-x-1.5 bg-[#1a3852]/20 border border-[#1e4a75]/40 px-3 py-1.5 rounded-lg text-xs font-medium text-[#7ab2e6] truncate">
             <Globe className="w-3.5 h-3.5 shrink-0" />
             <span className="font-mono tracking-wide">{serverIp}</span>
             <Copy className="w-3 h-3 ml-1 opacity-50 hover:opacity-100 cursor-pointer transition shrink-0" />
          </div>

          <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
            {botState === 'stopped' ? (
              <button
                onClick={() => onToggleBotState('running')}
                className="flex items-center space-x-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Başlat</span>
              </button>
            ) : (
                <button
                  onClick={() => onToggleBotState('stopped')}
                  className="flex items-center space-x-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 sm:px-3 py-1.5 rounded-lg font-semibold text-xs transition shrink-0"
                >
                  <Square className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] sm:text-xs">Durdur</span>
                </button>
            )}
`;

code = code.replace(/\{\/\* Render Server IP Badge \*\/\}[\s\S]*?\)\}/, replacement.trim());
fs.writeFileSync('src/components/Header.tsx', code);
