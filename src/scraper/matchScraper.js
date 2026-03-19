const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

const DEFAULT_MATCH_URL =
  'https://www.espncricinfo.com/series/jay-trophy-men-s-elite-cup-2025-26-1523984/nepal-police-club-vs-tribhuwan-army-club-final-1523992/full-scorecard';

class CricinfoMatchScraper {
  constructor({ matchUrl = DEFAULT_MATCH_URL, headless = true, timeoutMs = 120000 } = {}) {
    this.matchUrl = matchUrl;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.browser = null;
    this.page = null;
    this.cache = null;
    this.lastScrapedAt = null;
  }

  async init() {
    if (this.browser) return;

    this.browser = await puppeteer.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1600, height: 1000 });
    await this.page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async openWithRetry(url, retries = 3) {
    await this.init();

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await this.page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: this.timeoutMs
        });
        await this.page.waitForSelector('body', { timeout: 30000 });
        return;
      } catch (error) {
        lastError = error;
        await this.delay(1000 * attempt);
      }
    }

    throw lastError;
  }

  async autoScroll() {
    await this.page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 1000;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 120);
      });
    });
  }

  async clickTab(label) {
    const clicked = await this.page.evaluate((tabLabel) => {
      const normal = (v) => (v || '').toLowerCase().trim();
      const wanted = normal(tabLabel);

      const candidates = Array.from(document.querySelectorAll('a, button, div, span'));
      const target = candidates.find((node) => {
        const txt = normal(node.textContent);
        return txt === wanted;
      });

      if (!target) return false;
      target.click();
      return true;
    }, label);

    if (!clicked) return false;
    await this.delay(1200);
    await this.autoScroll();
    await this.delay(600);
    return true;
  }

  async clickIfExists(textPattern) {
    const clicked = await this.page.evaluate((pattern) => {
      const re = new RegExp(pattern, 'i');
      const nodes = Array.from(document.querySelectorAll('button, a, span, div'));
      const target = nodes.find((node) => re.test((node.textContent || '').trim()));
      if (!target) return false;
      target.click();
      return true;
    }, textPattern);

    if (clicked) {
      await this.delay(1000);
    }

    return clicked;
  }

  async extractSummaryMatchInfo() {
    return this.page.evaluate(() => {
      const text = (node) => node?.textContent?.trim() || null;

      const title = text(document.querySelector('h1'));
      const result =
        text(document.querySelector('[class*="result"]')) ||
        Array.from(document.querySelectorAll('div, p, span')).map((n) => text(n)).find((t) => /won by|match drawn|tie/i.test(t || '')) ||
        null;

      const infoLines = Array.from(document.querySelectorAll('a, div, span, p'))
        .map((node) => text(node))
        .filter(Boolean);

      const venue = infoLines.find((line) => /stadium|ground|mulpani|park|oval|club/i.test(line)) || null;
      const date = infoLines.find((line) => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\d{4}/i.test(line)) || null;

      const teams = Array.from(document.querySelectorAll('a[href*="/team/"]'))
        .map((node) => text(node))
        .filter(Boolean);

      const playerOfMatchBlock = Array.from(document.querySelectorAll('div, p, span')).find((node) =>
        /player of the match/i.test((node.textContent || '').trim())
      );

      const playerOfMatch = playerOfMatchBlock
        ? (playerOfMatchBlock.parentElement?.textContent || playerOfMatchBlock.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
        : null;

      return {
        title,
        teams,
        result,
        venue,
        date,
        player_of_the_match: playerOfMatch
      };
    });
  }

  async extractScorecard() {
    await this.clickTab('Scorecard');

    return this.page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() || null;

      const parseTable = (table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => text(th)).filter(Boolean);
        const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
          const cells = Array.from(row.querySelectorAll('th, td')).map((c) => text(c));
          return cells.filter((c) => c !== null);
        }).filter((row) => row.length);

        return { headers, rows };
      };

      const inningsTabs = Array.from(document.querySelectorAll('button, a, span, div'))
        .filter((node) => /innings/i.test((node.textContent || '').trim()) && (node.textContent || '').trim().length < 40);

      const seen = new Set();
      const innings = [];

      for (const tab of inningsTabs) {
        const name = text(tab);
        if (!name || seen.has(name)) continue;
        seen.add(name);

        tab.click();
        await sleep(800);

        const title =
          text(document.querySelector('h2')) ||
          text(document.querySelector('h3')) ||
          name;

        const tables = Array.from(document.querySelectorAll('table')).map(parseTable).filter((t) => t.headers.length || t.rows.length);

        const battingTable = tables.find((table) => table.headers.some((h) => /bat|batter|r|b|4s|6s|sr/i.test(h)));
        const bowlingTable = tables.find((table) => table.headers.some((h) => /bow|o|m|w|econ/i.test(h)));

        const batting = (battingTable?.rows || []).map((row) => ({
          player_name: row[0] || null,
          dismissal_info: row[1] || null,
          runs: row[2] || null,
          balls: row[3] || null,
          fours: row[4] || null,
          sixes: row[5] || null,
          strike_rate: row[6] || null,
          raw: row
        }));

        const bowling = (bowlingTable?.rows || []).map((row) => ({
          bowler_name: row[0] || null,
          overs: row[1] || null,
          maidens: row[2] || null,
          runs_conceded: row[3] || null,
          wickets: row[4] || null,
          economy: row[5] || null,
          raw: row
        }));

        innings.push({
          innings_name: name,
          heading: title,
          batting,
          bowling,
          tables
        });
      }

      return { innings };
    });
  }

  async extractCommentary() {
    await this.clickTab('Commentary');

    for (let i = 0; i < 6; i += 1) {
      const clicked = await this.clickIfExists('load more|show more|more commentary');
      if (!clicked) break;
    }

    return this.page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() || null;
      const nodes = Array.from(document.querySelectorAll('article, li, div'));

      const items = nodes
        .map((node) => {
          const raw = text(node);
          if (!raw || raw.length < 8) return null;

          const over =
            text(node.querySelector('[class*="over"], [class*="time"], strong')) ||
            (raw.match(/\b\d+\.\d+\b/) || [])[0] ||
            null;

          const eventType = /\bSIX\b|\b6\b/.test(raw)
            ? '6'
            : /\bFOUR\b|\b4\b/.test(raw)
              ? '4'
              : /\bwicket\b|\bout\b/i.test(raw)
                ? 'wicket'
                : 'normal';

          return {
            over,
            event_type: eventType,
            description: raw
          };
        })
        .filter(Boolean);

      const unique = [];
      const seen = new Set();
      for (const item of items) {
        const key = `${item.over || ''}:${item.description}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }

      return unique;
    });
  }

  async extractStats() {
    await this.clickTab('Stats');

    return this.page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() || null;
      const parseTable = (table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((n) => text(n)).filter(Boolean);
        const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
          Array.from(row.querySelectorAll('th, td')).map((cell) => text(cell)).filter(Boolean)
        ).filter((row) => row.length);
        return { headers, rows };
      };

      const tables = Array.from(document.querySelectorAll('table')).map(parseTable);

      const keyStats = Array.from(document.querySelectorAll('h3, h4, p, span, div'))
        .map((node) => text(node))
        .filter(Boolean)
        .filter((line) => /run rate|partnership|highest|lowest|most|least|average|strike/i.test(line))
        .slice(0, 300);

      const partnerships = keyStats.filter((line) => /partnership/i.test(line));
      const runRateData = keyStats.filter((line) => /run rate/i.test(line));

      return {
        partnerships,
        run_rate_graph_data: runRateData,
        key_stats: keyStats,
        tables
      };
    });
  }

  async extractTable() {
    const found = await this.clickTab('Table');
    if (!found) {
      return {};
    }

    return this.page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() || null;
      const table = document.querySelector('table');
      if (!table) return {};

      const headers = Array.from(table.querySelectorAll('thead th')).map((th) => text(th)).filter(Boolean);
      const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => text(cell)).filter(Boolean);
        return {
          team: cells[0] || null,
          points: cells.find((value) => /^\d+$/.test(value || '')) || null,
          nrr: cells.find((value) => /[+-]\d+\.\d+/i.test(value || '')) || null,
          raw: cells
        };
      }).filter((row) => row.raw.length);

      return { headers, standings: rows };
    });
  }

  async fallbackStatic(url) {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('h1').first().text().trim() || $('title').text().trim() || null;
    const rawLines = $('body')
      .text()
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return {
      match_info: {
        title,
        teams: rawLines.filter((line) => /club|team|xi/i.test(line)).slice(0, 10),
        result: rawLines.find((line) => /won by|drawn|tie/i.test(line)) || null,
        venue: rawLines.find((line) => /stadium|ground|park|oval|mulpani/i.test(line)) || null,
        date: rawLines.find((line) => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\d{4}/i.test(line)) || null,
        player_of_the_match: rawLines.find((line) => /player of the match/i.test(line)) || null
      },
      scorecard: {
        innings: []
      },
      commentary: [],
      stats: {},
      table: {}
    };
  }

  async scrape(matchUrl = this.matchUrl) {
    const url = matchUrl || this.matchUrl;

    try {
      await this.openWithRetry(url, 3);
      await this.autoScroll();
      await this.clickTab('Summary');

      const matchInfo = await this.extractSummaryMatchInfo();
      const scorecard = await this.extractScorecard();
      const commentary = await this.extractCommentary();
      const stats = await this.extractStats();
      const table = await this.extractTable();

      const payload = {
        match_info: matchInfo,
        scorecard,
        commentary,
        stats,
        table
      };

      this.cache = payload;
      this.lastScrapedAt = new Date().toISOString();
      return payload;
    } catch (error) {
      const fallback = await this.fallbackStatic(url);
      fallback.error = `Dynamic scrape failed, served static fallback: ${error.message}`;
      this.cache = fallback;
      this.lastScrapedAt = new Date().toISOString();
      return fallback;
    }
  }
}

module.exports = {
  CricinfoMatchScraper,
  DEFAULT_MATCH_URL
};
