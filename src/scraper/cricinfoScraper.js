const EventEmitter = require('events');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const LIVE_URL = 'https://www.espncricinfo.com/live-cricket-score';
const FIXTURES_URL = 'https://www.espncricinfo.com/cricket-fixtures';

function buildListingExtractionInBrowser() {
  const text = (node) => node?.textContent?.trim() || null;

  const href = (node) => {
    const link = node?.getAttribute('href');
    if (!link) return null;
    if (link.startsWith('http')) return link;
    return `https://www.espncricinfo.com${link}`;
  };

  const uniqueBy = (arr, keyFn) => {
    const seen = new Set();
    return arr.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const parsePopularTeams = () => {
    const candidates = Array.from(document.querySelectorAll('a[href*="/team/"]')).map((a) => ({
      name: text(a),
      url: href(a)
    }));

    return uniqueBy(
      candidates.filter((item) => item.name && item.url),
      (item) => item.url
    );
  };

  const parseSectionCards = () => {
    const sections = [];
    const sectionSelectors = ['section', '[data-testid*="section"]', 'div[class*="ds-mb"]'];

    sectionSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((section) => {
        const titleNode =
          section.querySelector('h2') ||
          section.querySelector('h3') ||
          section.querySelector('[data-testid*="title"]');

        const title = text(titleNode);
        if (!title) return;

        const cardNodes = section.querySelectorAll('article, li, a[href*="/series/"], a[href*="/live-cricket-score"]');

        const cards = Array.from(cardNodes)
          .map((card) => {
            const linkNode = card.matches('a') ? card : card.querySelector('a');
            const detailNodes = card.querySelectorAll('p, span, div');
            const badgeNodes = card.querySelectorAll('[class*="status"], [class*="result"], [class*="state"]');

            const details = Array.from(detailNodes)
              .map((node) => text(node))
              .filter(Boolean)
              .slice(0, 20);

            const badges = Array.from(badgeNodes)
              .map((node) => text(node))
              .filter(Boolean)
              .slice(0, 8);

            return {
              title:
                text(card.querySelector('h2')) ||
                text(card.querySelector('h3')) ||
                text(card.querySelector('strong')) ||
                details[0] ||
                null,
              url: href(linkNode),
              details,
              score: details.filter((line) => /\d+\/?\d*|ov|over|won|need|trail|lead|target/i.test(line)),
              summary: details.find((line) => /won|need|trail|lead|target|match|innings|draw|tie/i.test(line)) || null,
              badges,
              rawText: text(card)
            };
          })
          .filter((item) => item.rawText && item.rawText.length > 5);

        if (!cards.length) return;

        sections.push({
          title,
          cards: uniqueBy(cards, (item) => `${item.url || ''}-${item.rawText}`)
        });
      });
    });

    return uniqueBy(sections, (section) => `${section.title}:${section.cards.length}`);
  };

  const parseFixtures = () => {
    const matchCards = Array.from(document.querySelectorAll('a[href*="/series/"] article, article, li'));

    const matches = matchCards
      .map((card) => {
        const anchor = card.closest('a') || card.querySelector('a');
        const lines = Array.from(card.querySelectorAll('span, p, div'))
          .map((node) => text(node))
          .filter(Boolean)
          .slice(0, 20);

        return {
          url: href(anchor),
          title: text(card.querySelector('h3')) || lines[0] || null,
          when: lines.find((line) => /(AM|PM|GMT|UTC|IST|AEST|CET|\d{1,2}:\d{2})/i.test(line)) || null,
          venue: lines.find((line) => /stadium|ground|park|oval|club|field|arena/i.test(line)) || null,
          details: lines,
          rawText: text(card)
        };
      })
      .filter((item) => item.rawText && item.rawText.length > 5);

    return uniqueBy(matches, (item) => `${item.url || ''}-${item.rawText}`);
  };

  return {
    popularTeams: parsePopularTeams(),
    sections: parseSectionCards(),
    matches: parseFixtures(),
    rawPageText: document.body?.innerText || null
  };
}

function buildMatchDetailExtractionInBrowser() {
  const text = (node) => node?.textContent?.trim() || null;

  const href = (node) => {
    const link = node?.getAttribute('href');
    if (!link) return null;
    if (link.startsWith('http')) return link;
    return `https://www.espncricinfo.com${link}`;
  };

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map((node) => text(node)).filter(Boolean);

  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map((node) => text(node))
    .filter(Boolean)
    .slice(0, 500);

  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((node) => ({ label: text(node), url: href(node) }))
    .filter((item) => item.url)
    .slice(0, 1000);

  const lists = Array.from(document.querySelectorAll('ul, ol')).map((list) => ({
    items: Array.from(list.querySelectorAll('li')).map((item) => text(item)).filter(Boolean)
  })).filter((list) => list.items.length);

  const tables = Array.from(document.querySelectorAll('table')).map((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => text(th)).filter(Boolean);
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) => text(cell)).filter(Boolean)
    ).filter((row) => row.length);

    return {
      headers,
      rows
    };
  }).filter((table) => table.headers.length || table.rows.length);

  const keyValues = Array.from(document.querySelectorAll('dl, [class*="ds-grid"], [class*="match-info"]')).map((node) => {
    const keys = Array.from(node.querySelectorAll('dt, [class*="label"]')).map((item) => text(item)).filter(Boolean);
    const values = Array.from(node.querySelectorAll('dd, [class*="value"]')).map((item) => text(item)).filter(Boolean);
    if (!keys.length && !values.length) return null;
    return { keys, values };
  }).filter(Boolean);

  return {
    pageTitle: document.title,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || window.location.href,
    headings,
    paragraphs,
    lists,
    keyValues,
    tables,
    links,
    rawPageText: document.body?.innerText || null,
    scrapedAt: new Date().toISOString()
  };
}

class CricinfoScraper extends EventEmitter {
  constructor({ refreshIntervalMs = 15000, detailConcurrency = 3 } = {}) {
    super();
    this.refreshIntervalMs = refreshIntervalMs;
    this.detailConcurrency = detailConcurrency;
    this.browser = null;
    this.livePage = null;
    this.fixturesPage = null;
    this.timer = null;
    this.running = false;

    this.state = {
      meta: {
        source: 'espncricinfo',
        liveUrl: LIVE_URL,
        fixturesUrl: FIXTURES_URL,
        lastUpdatedAt: null,
        refreshIntervalMs,
        detailConcurrency
      },
      live: {
        popularTeams: [],
        sections: [],
        rawPageText: null,
        matches: [],
        matchDetails: []
      },
      fixtures: {
        matches: [],
        sections: [],
        rawPageText: null,
        matchDetails: []
      }
    };
  }

  async start() {
    if (this.running) return;

    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.livePage = await this.browser.newPage();
    this.fixturesPage = await this.browser.newPage();

    await Promise.all([
      this.livePage.goto(LIVE_URL, { waitUntil: 'networkidle2', timeout: 120000 }),
      this.fixturesPage.goto(FIXTURES_URL, { waitUntil: 'networkidle2', timeout: 120000 })
    ]);

    this.running = true;
    await this.refresh();

    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.emit('error', error));
    }, this.refreshIntervalMs);

    this.emit('started', {
      startedAt: new Date().toISOString(),
      refreshIntervalMs: this.refreshIntervalMs,
      detailConcurrency: this.detailConcurrency
    });
  }

  async stop() {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.emit('stopped', { stoppedAt: new Date().toISOString() });
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  static uniqueUrls(urls) {
    return [...new Set((urls || []).filter(Boolean))];
  }

  async scrapeDetailPages(urls) {
    if (!this.browser) return [];
    const queue = CricinfoScraper.uniqueUrls(urls);
    const results = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const url = queue[cursor];
        cursor += 1;

        let page;
        try {
          page = await this.browser.newPage();
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
          const detail = await page.evaluate(buildMatchDetailExtractionInBrowser);
          results.push({
            url,
            detail
          });
        } catch (error) {
          results.push({
            url,
            detail: null,
            error: error.message
          });
        } finally {
          if (page) {
            await page.close();
          }
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.detailConcurrency, queue.length || 1) }, () => worker());
    await Promise.all(workers);

    return results;
  }

  diff(previous, current) {
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return null;
    }

    const prevLive = previous.live.matches || [];
    const currLive = current.live.matches || [];
    const prevFixtures = previous.fixtures.matches || [];
    const currFixtures = current.fixtures.matches || [];

    const mapBy = (list, key) => new Map(list.map((item) => [key(item), item]));
    const prevLiveMap = mapBy(prevLive, (item) => item.url || item.rawText);
    const currLiveMap = mapBy(currLive, (item) => item.url || item.rawText);
    const prevFixturesMap = mapBy(prevFixtures, (item) => item.url || item.rawText);
    const currFixturesMap = mapBy(currFixtures, (item) => item.url || item.rawText);

    return {
      detectedAt: current.meta.lastUpdatedAt,
      live: {
        added: [...currLiveMap.entries()].filter(([key]) => !prevLiveMap.has(key)).map(([, value]) => value),
        updated: [...currLiveMap.entries()]
          .filter(([key, value]) => prevLiveMap.has(key) && JSON.stringify(prevLiveMap.get(key)) !== JSON.stringify(value))
          .map(([, value]) => value)
      },
      fixtures: {
        added: [...currFixturesMap.entries()].filter(([key]) => !prevFixturesMap.has(key)).map(([, value]) => value),
        updated: [...currFixturesMap.entries()]
          .filter(([key, value]) => prevFixturesMap.has(key) && JSON.stringify(prevFixturesMap.get(key)) !== JSON.stringify(value))
          .map(([, value]) => value)
      }
    };
  }

  async refresh() {
    if (!this.livePage || !this.fixturesPage) return;
    const previous = this.snapshot();

    await Promise.all([
      this.livePage.reload({ waitUntil: 'networkidle2', timeout: 120000 }),
      this.fixturesPage.reload({ waitUntil: 'networkidle2', timeout: 120000 })
    ]);

    const [livePayload, fixturesPayload] = await Promise.all([
      this.livePage.evaluate(buildListingExtractionInBrowser),
      this.fixturesPage.evaluate(buildListingExtractionInBrowser)
    ]);

    const liveCards = livePayload.sections.flatMap((section) =>
      section.cards.map((card) => ({
        section: section.title,
        ...card
      }))
    );

    const fixtureCards = fixturesPayload.matches;

    const [liveDetails, fixtureDetails] = await Promise.all([
      this.scrapeDetailPages(liveCards.map((card) => card.url)),
      this.scrapeDetailPages(fixtureCards.map((card) => card.url))
    ]);

    this.state = {
      ...this.state,
      meta: {
        ...this.state.meta,
        lastUpdatedAt: new Date().toISOString()
      },
      live: {
        popularTeams: livePayload.popularTeams,
        sections: livePayload.sections,
        rawPageText: livePayload.rawPageText,
        matches: liveCards,
        matchDetails: liveDetails
      },
      fixtures: {
        matches: fixtureCards,
        sections: fixturesPayload.sections,
        rawPageText: fixturesPayload.rawPageText,
        matchDetails: fixtureDetails
      }
    };

    const changes = this.diff(previous, this.state);
    this.emit('snapshot', this.snapshot());

    if (changes) {
      this.emit('delta', changes);
    }
  }
}

module.exports = {
  CricinfoScraper,
  LIVE_URL,
  FIXTURES_URL
};
