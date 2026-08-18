const fs = require('fs');
let code = fs.readFileSync('src/components/ConfigEditor.tsx', 'utf8');

const replacement = `
    if (field === 'stake_amount') {
      if (value === 'unlimited' || value === '') {
        updated.stake_amount = value;
      } else {
        const val = value.replace(',', '.');
        if (val.endsWith('.') || (val.includes('.') && val.endsWith('0'))) {
          updated.stake_amount = val;
        } else {
          const num = Number(val);
          updated.stake_amount = isNaN(num) ? val : num;
        }
      }
    } else if (field === 'leverage') {
`;

code = code.replace(
  /if \(field === 'stake_amount'\) \{\s*updated\.stake_amount = [^;]+;\s*\}\s*else if \(field === 'leverage'\) \{/m,
  replacement.trim()
);

fs.writeFileSync('src/components/ConfigEditor.tsx', code);
