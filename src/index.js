const express = require('express');
const cors = require('cors');
const { CricinfoMatchScraper, DEFAULT_MATCH_URL } = require('./scraper/matchScraper');

const PORT = Number(process.env.PORT || 3000);
const HEADLESS = process.env.HEADLESS === 'false' ? false : true;
const DEFAULT_URL = process.env.MATCH_URL || DEFAULT_MATCH_URL;

const app = express();
app.use(cors());
app.use(express.json());

const scraper = new CricinfoMatchScraper({
  matchUrl: DEFAULT_URL,
  headless: HEADLESS
});

async function fetchMatchPayload(req) {
  const url = req.query.url || DEFAULT_URL;
  return scraper.scrape(url);
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    matchUrl: DEFAULT_URL,
    headless: HEADLESS,
    lastScrapedAt: scraper.lastScrapedAt
  });
});

app.get('/match', async (req, res) => {
  try {
    const payload = await fetchMatchPayload(req);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/scorecard', async (req, res) => {
  try {
    const payload = await fetchMatchPayload(req);
    res.json(payload.scorecard || { innings: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/commentary', async (req, res) => {
  try {
    const payload = await fetchMatchPayload(req);
    res.json(payload.commentary || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const payload = await fetchMatchPayload(req);
    res.json(payload.stats || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/table', async (req, res) => {
  try {
    const payload = await fetchMatchPayload(req);
    res.json(payload.table || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function boot() {
  await scraper.init();

  const server = app.listen(PORT, () => {
    console.log(`Match scraper API listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    server.close();
    await scraper.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot().catch((error) => {
  console.error('Failed to start service', error);
  process.exit(1);
});
