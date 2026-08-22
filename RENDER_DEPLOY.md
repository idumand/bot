# Render deployment

This repository is intentionally structured with `package.json` at the repository root.

Build Command:
`npm install && npm run build`

Start Command:
`npm start`

Do not set a Root Directory unless this repository is placed inside another directory.

Required environment variables are defined by `render.yaml` as sync=false values:
- BINANCE_API_KEY
- BINANCE_SECRET_KEY
- APP_API_TOKEN
- VITE_API_TOKEN

The server listens on Render's `PORT` environment variable and falls back to port 3000 locally.
