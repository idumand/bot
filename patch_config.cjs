const fs = require('fs');
let code = fs.readFileSync('src/components/ConfigEditor.tsx', 'utf8');

// 1. Add pairInput state
const stateRegex = /const \[success, setSuccess\] = useState<string \| null>\(null\);/;
code = code.replace(stateRegex, "const [success, setSuccess] = useState<string | null>(null);\n  const [pairInput, setPairInput] = useState<string | null>(null);");

// 2. Modify handleTradingParamsUpdate for pair_whitelist
const paramRegex = /\} else if \(field === 'pair_whitelist'\) \{\s*if \(\!updated\.exchange\) updated\.exchange = \{\};\s*updated\.exchange\.pair_whitelist = value\.split\(\',\'\)\.map\(\(s: string\) => s\.trim\(\)\)\.filter\(\(s: string\) => s\.length > 0\);\s*\}/;
const newParamLogic = `    } else if (field === 'pair_whitelist') {
      if (!updated.exchange) updated.exchange = {};
      updated.exchange.pair_whitelist = value.split(',').map((s: string) => {
        let coin = s.trim().toUpperCase();
        if (coin && !coin.includes('/')) {
           coin += '/USDT';
        }
        return coin;
      }).filter((s: string) => s.length > 0);
    }`;
code = code.replace(paramRegex, newParamLogic);

// 3. Update handleSave to apply pairInput
const saveRegex = /const handleSave = async \(\) => \{\s*try \{\s*const parsed = JSON\.parse\(configJson\);/;
const newSaveLogic = `  const handleSave = async () => {
    try {
      let currentJson = configJson;
      if (pairInput !== null && parsedConfig) {
        const updated = { ...parsedConfig };
        if (!updated.exchange) updated.exchange = {};
        updated.exchange.pair_whitelist = pairInput.split(',').map((s: string) => {
          let coin = s.trim().toUpperCase();
          if (coin && !coin.includes('/')) {
             coin += '/USDT';
          }
          return coin;
        }).filter((s: string) => s.length > 0);
        currentJson = JSON.stringify(updated, null, 2);
        setConfigJson(currentJson);
        setPairInput(null);
      }
      const parsed = JSON.parse(currentJson);`;
code = code.replace(saveRegex, newSaveLogic);

// 4. Update the input field render
const inputRegex = /<label className="block text-xs font-semibold text-slate-400 mb-1">\s*Bota Eklenecek Coinler \(Virgülle ayırın\)\s*<\/label>\s*<input\s*type="text"\s*value=\{\(parsedConfig\?\.exchange\?\.pair_whitelist \|\| \[\]\)\.join\(', '\)\}\s*onChange=\{\(e\) => handleTradingParamsUpdate\('pair_whitelist', e\.target\.value\)\}\s*disabled=\{\!parsedConfig\}\s*placeholder="BTC\/USDT, ETH\/USDT, XRP\/USDT"/;

const newInput = `<label className="block text-xs font-semibold text-slate-400 mb-1">
              Bota Eklenecek Coinler (Örn: BTC, ETH)
            </label>
            <input
              type="text"
              value={pairInput !== null ? pairInput : (parsedConfig?.exchange?.pair_whitelist || []).map((p: string) => p.replace('/USDT', '')).join(', ')}
              onChange={(e) => setPairInput(e.target.value)}
              onBlur={() => {
                if (pairInput !== null) {
                  handleTradingParamsUpdate('pair_whitelist', pairInput);
                  setPairInput(null);
                }
              }}
              disabled={!parsedConfig}
              placeholder="BTC, ETH, XRP"`;
code = code.replace(inputRegex, newInput);


fs.writeFileSync('src/components/ConfigEditor.tsx', code);
