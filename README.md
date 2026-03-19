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
```
