# Render build fix

The previous Render error was caused by invalid JSX in `TradingDashboard.tsx` around the adaptive target block.

Broken pattern:
```tsx
{t.take_profit_pct && (
  <div>...</div>
  {t.adaptive_target_pct !== undefined && (...)}
)}
```

A JSX expression cannot contain two sibling elements unless they are wrapped in a fragment/container.

Fixed pattern uses `<>...</>` around the two conditional children.

Deploy this version from the repository root and use:
- Build: `npm install && npm run build`
- Start: `npm start`

Do not deploy an older `sfeef_adaptive.zip` or `sfeef_risk_protection_v3.zip` over this source.
