const express = require('express');
const cors = require('cors');
const { CricinfoScraper, LIVE_URL, FIXTURES_URL } = require('./scraper/cricinfoScraper');

const PORT = Number(process.env.PORT || 3000);
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 15000);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 3);

const app = express();
app.use(cors());
app.use(express.json());

const scraper = new CricinfoScraper({
  refreshIntervalMs: REFRESH_INTERVAL_MS,
  detailConcurrency: DETAIL_CONCURRENCY
});

const eventClients = new Set();

scraper.on('delta', (delta) => {
  const payload = `data: ${JSON.stringify(delta)}\n\n`;
  eventClients.forEach((res) => res.write(payload));
});

scraper.on('error', (error) => {
  const payload = {
    message: error.message,
    stack: error.stack,
    at: new Date().toISOString()
  };

  const message = `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
  eventClients.forEach((res) => res.write(message));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    running: scraper.running,
    lastUpdatedAt: scraper.state.meta.lastUpdatedAt
  });
});

app.get('/api', (_req, res) => {
  res.json({
    source: 'ESPN Cricinfo',
    upstream: {
      live: LIVE_URL,
      fixtures: FIXTURES_URL
    },
    routes: {
      root: '/api',
      all: '/api/all',
      live: '/api/live-cricket-score',
      fixtures: '/api/cricket-fixtures',
      popularTeams: '/api/popular-teams',
      liveMatches: '/api/live-matches',
      liveMatchDetails: '/api/live-match-details',
      fixtureMatchDetails: '/api/fixture-match-details',
      stream: '/api/events'
    }
  });
});

app.get('/api/all', (_req, res) => {
  res.json(scraper.snapshot());
});

app.get('/api/live-cricket-score', (_req, res) => {
  res.json({
    meta: scraper.state.meta,
    popularTeams: scraper.state.live.popularTeams,
    sections: scraper.state.live.sections,
    matches: scraper.state.live.matches,
    matchDetails: scraper.state.live.matchDetails,
    rawPageText: scraper.state.live.rawPageText
  });
});

app.get('/api/live-matches', (_req, res) => {
  const matches = scraper.state.live.matches || [];
  res.json({
    meta: scraper.state.meta,
    total: matches.length,
    matches
  });
});

app.get('/api/live-match-details', (_req, res) => {
  const details = scraper.state.live.matchDetails || [];
  res.json({
    meta: scraper.state.meta,
    total: details.length,
    details
  });
});

app.get('/api/popular-teams', (_req, res) => {
  res.json({
    meta: scraper.state.meta,
    total: scraper.state.live.popularTeams.length,
    teams: scraper.state.live.popularTeams
  });
});

app.get('/api/cricket-fixtures', (_req, res) => {
  res.json({
    meta: scraper.state.meta,
    matches: scraper.state.fixtures.matches,
    matchDetails: scraper.state.fixtures.matchDetails,
    sections: scraper.state.fixtures.sections,
    rawPageText: scraper.state.fixtures.rawPageText
  });
});

app.get('/api/fixture-match-details', (_req, res) => {
  const details = scraper.state.fixtures.matchDetails || [];
  res.json({
    meta: scraper.state.meta,
    total: details.length,
    details
  });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  eventClients.add(res);

  const initial = {
    event: 'snapshot',
    data: scraper.snapshot()
  };

  res.write(`event: ${initial.event}\ndata: ${JSON.stringify(initial.data)}\n\n`);

  req.on('close', () => {
    eventClients.delete(res);
  });
});

async function boot() {
  await scraper.start();

  const server = app.listen(PORT, () => {
    console.log(`Cricinfo proxy API listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    server.close();
    await scraper.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot().catch((error) => {
  console.error('Failed to start service', error);
  process.exit(1);
});
