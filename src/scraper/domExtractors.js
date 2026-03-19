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

const parsePopularTeams = (root = document) => {
  const candidates = Array.from(
    root.querySelectorAll('a[href*="/team/"]')
  ).map((a) => ({
    name: text(a),
    url: href(a)
  }));

  return uniqueBy(
    candidates.filter((item) => item.name && item.url),
    (item) => item.url
  );
};

const parseSectionCards = (root = document) => {
  const sectionSelectors = [
    'section',
    '[data-testid*="section"]',
    'div[class*="ds-mb"]'
  ];

  const sections = [];

  sectionSelectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((section) => {
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
          const teamNodes = card.querySelectorAll('[class*="team"], span, p, div');
          const detailNodes = card.querySelectorAll('p, span, div');
          const badgeNodes = card.querySelectorAll('[class*="status"], [class*="result"], [class*="state"]');

          const teams = Array.from(teamNodes)
            .map((node) => text(node))
            .filter(Boolean)
            .slice(0, 6);

          const details = Array.from(detailNodes)
            .map((node) => text(node))
            .filter(Boolean)
            .slice(0, 10);

          const badges = Array.from(badgeNodes)
            .map((node) => text(node))
            .filter(Boolean)
            .slice(0, 4);

          const scoreBits = details.filter((t) => /\d+\/?\d*|ov|over|won|need|trail|lead|target/i.test(t));
          const summary = details.find((t) => /won|need|trail|lead|target|match|innings|draw|tie/i.test(t)) || null;

          const titleText =
            text(card.querySelector('h2')) ||
            text(card.querySelector('h3')) ||
            text(card.querySelector('strong')) ||
            (details.length ? details[0] : null);

          return {
            title: titleText,
            url: href(linkNode),
            teams,
            score: scoreBits,
            badges,
            summary,
            rawText: text(card)
          };
        })
        .filter((item) => item.rawText && item.rawText.length > 5);

      if (!cards.length) return;

      sections.push({ title, cards: uniqueBy(cards, (item) => `${item.url || ''}-${item.rawText}`) });
    });
  });

  return uniqueBy(sections, (section) => `${section.title}:${section.cards.length}`);
};

const parseFixtures = (root = document) => {
  const matchCards = Array.from(
    root.querySelectorAll('a[href*="/series/"] article, article, li')
  );

  const matches = matchCards
    .map((card) => {
      const anchor = card.closest('a') || card.querySelector('a');
      const lines = Array.from(card.querySelectorAll('span, p, div'))
        .map((node) => text(node))
        .filter(Boolean)
        .slice(0, 12);

      const when = lines.find((line) => /(AM|PM|GMT|UTC|IST|AEST|CET|\d{1,2}:\d{2})/i.test(line)) || null;
      const venue = lines.find((line) => /stadium|ground|park|oval|club|field|arena/i.test(line)) || null;
      const teams = lines.filter((line) => /women|men|XI|A|U\d|[A-Za-z]/.test(line)).slice(0, 6);

      return {
        url: href(anchor),
        title: text(card.querySelector('h3')) || lines[0] || null,
        teams,
        when,
        venue,
        details: lines,
        rawText: text(card)
      };
    })
    .filter((item) => item.rawText && item.rawText.length > 5);

  return uniqueBy(matches, (item) => `${item.url || ''}-${item.rawText}`);
};

module.exports = {
  parsePopularTeams,
  parseSectionCards,
  parseFixtures
};
