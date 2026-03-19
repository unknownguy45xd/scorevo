# ESPN Cricinfo Event-Based Proxy API

This service keeps a Puppeteer browser session alive and continuously scrapes:

- `https://www.espncricinfo.com/live-cricket-score`
- `https://www.espncricinfo.com/cricket-fixtures`

It exposes Express routes with Cricinfo-style resources (`live-cricket-score`, `cricket-fixtures`) and pushes detected changes via Server-Sent Events.

## Features

- **Persistent browser** session with `puppeteer-extra` + stealth plugin.
- **Event-based updates** by polling and emitting deltas when new/changed records appear.
- **REST API routes** for live scores, fixtures, popular teams, and combined data.
- **SSE endpoint** (`/api/events`) to stream updates to clients.

## Setup

```bash
npm install
npm start
```

Environment variables:

- `PORT` (default: `3000`)
- `REFRESH_INTERVAL_MS` (default: `15000`)

## API Routes

- `GET /health`
- `GET /api`
- `GET /api/all`
- `GET /api/live-cricket-score`
- `GET /api/live-matches`
- `GET /api/popular-teams`
- `GET /api/cricket-fixtures`
- `GET /api/events` (SSE stream)

## Example SSE Client

```js
const events = new EventSource('http://localhost:3000/api/events');

events.onmessage = (event) => {
  console.log('delta:', JSON.parse(event.data));
};

events.addEventListener('snapshot', (event) => {
  console.log('initial snapshot:', JSON.parse(event.data));
});
```
