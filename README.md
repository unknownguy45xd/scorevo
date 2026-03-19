# ESPN Cricinfo Match Scraper API

Robust Puppeteer scraper for:

- `https://www.espncricinfo.com/series/jay-trophy-men-s-elite-cup-2025-26-1523984/nepal-police-club-vs-tribhuwan-army-club-final-1523992/full-scorecard`

The scraper reuses one browser instance, dynamically clicks tabs (`Summary`, `Scorecard`, `Commentary`, `Stats`, `Table`), waits for content loading, handles lazy-loading for commentary, and returns strict structured JSON.

If dynamic rendering fails, it falls back to `axios + cheerio` static parsing.

## Output JSON shape

```json
{
  "match_info": {},
  "scorecard": {
    "innings": []
  },
  "commentary": [],
  "stats": {},
  "table": {}
}
```
# ESPN Cricinfo Event-Based Proxy API

This service keeps a Puppeteer browser session alive and continuously scrapes:

- `https://www.espncricinfo.com/live-cricket-score`
- `https://www.espncricinfo.com/cricket-fixtures`

It scrapes listing pages **and then iterates through each discovered match URL in new tabs/pages** to collect full match-detail payloads (headings, tables, lists, links, and full page text).
It exposes Express routes with Cricinfo-style resources (`live-cricket-score`, `cricket-fixtures`) and pushes detected changes via Server-Sent Events.

## Features

- **Persistent browser** session with `puppeteer-extra` + stealth plugin.
- **Event-based updates** by polling and emitting deltas when new/changed records appear.
- **Deep scraping** of every discovered match page URL from live + fixtures listings.
- **REST API routes** for live scores, fixtures, popular teams, listing matches, and full detail objects.
- **REST API routes** for live scores, fixtures, popular teams, and combined data.
- **SSE endpoint** (`/api/events`) to stream updates to clients.

## Setup

```bash
npm install
npm start
```

## Environment Variables

- `PORT` (default: `3000`)
- `HEADLESS` (`true` by default; set `HEADLESS=false` to debug/bypass detection)
- `MATCH_URL` (override default match URL)

## API Endpoints

- `GET /health`
- `GET /match` → complete strict JSON payload
- `GET /scorecard`
- `GET /commentary`
- `GET /stats`
- `GET /table`

You can override URL per request:

```text
/match?url=https://www.espncricinfo.com/series/.../full-scorecard
Environment variables:

- `PORT` (default: `3000`)
- `REFRESH_INTERVAL_MS` (default: `15000`)
- `DETAIL_CONCURRENCY` (default: `3`)

## API Routes

- `GET /health`
- `GET /api`
- `GET /api/all`
- `GET /api/live-cricket-score`
- `GET /api/live-matches`
- `GET /api/live-match-details`
- `GET /api/popular-teams`
- `GET /api/cricket-fixtures`
- `GET /api/fixture-match-details`
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
