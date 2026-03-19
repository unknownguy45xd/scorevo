const EventEmitter = require('events');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const LIVE_URL = 'https://www.espncricinfo.com/live-cricket-score';
const FIXTURES_URL = 'https://www.espncricinfo.com/cricket-fixtures';

function buildExtractionInBrowser() {
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
              .slice(0, 12);

            const badges = Array.from(badgeNodes)
              .map((node) => text(node))
              .filter(Boolean)
              .slice(0, 4);

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
          .slice(0, 12);

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
    rawPageText: document.body?.innerText?.slice(0, 100000) || null
  };
}

class CricinfoScraper extends EventEmitter {
  constructor({ refreshIntervalMs = 15000 } = {}) {
    super();
    this.refreshIntervalMs = refreshIntervalMs;
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
        refreshIntervalMs
      },
      live: {
        popularTeams: [],
        sections: [],
        rawPageText: null
      },
      fixtures: {
        matches: [],
        sections: [],
        rawPageText: null
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
      refreshIntervalMs: this.refreshIntervalMs
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

  diff(previous, current) {
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return null;
    }

    const prevLive = previous.live.sections.flatMap((section) =>
      section.cards.map((card) => ({ section: section.title, card }))
    );
    const curLive = current.live.sections.flatMap((section) =>
      section.cards.map((card) => ({ section: section.title, card }))
    );

    const mapBy = (list, key) => new Map(list.map((item) => [key(item), item]));
    const prevLiveMap = mapBy(prevLive, (item) => `${item.section}:${item.card.url || item.card.rawText}`);
    const curLiveMap = mapBy(curLive, (item) => `${item.section}:${item.card.url || item.card.rawText}`);
    const prevFixturesMap = mapBy(previous.fixtures.matches, (item) => item.url || item.rawText);
    const curFixturesMap = mapBy(current.fixtures.matches, (item) => item.url || item.rawText);

    return {
      detectedAt: current.meta.lastUpdatedAt,
      live: {
        added: [...curLiveMap.entries()].filter(([key]) => !prevLiveMap.has(key)).map(([, value]) => value),
        updated: [...curLiveMap.entries()]
          .filter(([key, value]) => prevLiveMap.has(key) && JSON.stringify(prevLiveMap.get(key)) !== JSON.stringify(value))
          .map(([, value]) => value)
      },
      fixtures: {
        added: [...curFixturesMap.entries()].filter(([key]) => !prevFixturesMap.has(key)).map(([, value]) => value),
        updated: [...curFixturesMap.entries()]
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
      this.livePage.evaluate(buildExtractionInBrowser),
      this.fixturesPage.evaluate(buildExtractionInBrowser)
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
        rawPageText: livePayload.rawPageText
      },
      fixtures: {
        matches: fixturesPayload.matches,
        sections: fixturesPayload.sections,
        rawPageText: fixturesPayload.rawPageText
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
