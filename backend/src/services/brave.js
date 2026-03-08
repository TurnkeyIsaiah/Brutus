const { deductFlat } = require('../lib/tokens');

// Brave Search API: $0.003/search = 0.3 cents
const BRAVE_COST_CENTS = 0.3;

async function braveSearch(userId, query, count = 5) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('search_lang', 'en');

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': process.env.BRAVE_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Deduct Brave API cost from user balance
  deductFlat(userId, BRAVE_COST_CENTS).catch(console.error);

  const results = (data.web?.results || []).slice(0, count).map(r => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || ''
  }));

  return results;
}

function formatSearchResults(results) {
  if (!results.length) return '';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`)
    .join('\n\n');
}

module.exports = { braveSearch, formatSearchResults };
