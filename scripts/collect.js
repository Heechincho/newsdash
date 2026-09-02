// 투자지표 대시보드 - 데이터 수집 스크립트
// 실행: node scripts/collect.js
// 결과: data/market.json 에 저장됨 (index.html은 이 파일만 fetch함)

const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; InvestDashboardBot/1.0)';

// 지수/원자재 목록 (Yahoo Finance 심볼, 인증키 불필요)
const INSTRUMENTS = [
  { key: 'sp500', label: 'S&P 500', symbol: '^GSPC' },
  { key: 'nasdaq', label: '나스닥', symbol: '^IXIC' },
  { key: 'dow', label: '다우존스', symbol: '^DJI' },
  { key: 'wti', label: 'WTI유가', symbol: 'CL=F' },
  { key: 'gold', label: '금', symbol: 'GC=F' },
  { key: 'dollarIndex', label: '달러인덱스', symbol: 'DX-Y.NYB' },
  { key: 'vix', label: 'VIX(변동성지수)', symbol: '^VIX' },
];

// 뉴스 RSS 목록 (인증키 불필요)
const RSS_FEEDS = [
  { source: '연합뉴스', url: 'https://www.yna.co.kr/rss/economy.xml' },
  { source: '한국경제', url: 'https://www.hankyung.com/feed/economy' },
];

const NEWS_LIMIT = 15;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchInstrument({ key, label, symbol }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    const text = await fetchText(url);
    const json = JSON.parse(text);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') {
      throw new Error('가격 정보 없음');
    }
    return {
      key,
      label,
      symbol,
      price: meta.regularMarketPrice,
      changePercent: meta.regularMarketChangePercent ?? null,
      previousClose: meta.chartPreviousClose ?? null,
      currency: meta.currency ?? null,
      ok: true,
    };
  } catch (err) {
    console.error(`[market] ${label}(${symbol}) 수집 실패:`, err.message);
    return { key, label, symbol, ok: false, error: err.message };
  }
}

function decodeXmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function parseRssItems(xml, source) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleMatch || !linkMatch) continue;
    items.push({
      source,
      title: decodeXmlEntities(titleMatch[1]),
      link: decodeXmlEntities(linkMatch[1]),
      pubDate: pubDateMatch ? decodeXmlEntities(pubDateMatch[1]) : null,
    });
  }
  return items;
}

async function fetchRss({ source, url }) {
  try {
    const xml = await fetchText(url);
    return parseRssItems(xml, source);
  } catch (err) {
    console.error(`[news] ${source} 수집 실패:`, err.message);
    return [];
  }
}

async function main() {
  console.log('시장 데이터 수집 시작...');
  const instruments = await Promise.all(INSTRUMENTS.map(fetchInstrument));

  console.log('뉴스 수집 시작...');
  const newsArrays = await Promise.all(RSS_FEEDS.map(fetchRss));
  let news = newsArrays.flat();

  // 최신순 정렬 (pubDate 파싱 실패한 항목은 뒤로)
  news.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });
  news = news.slice(0, NEWS_LIMIT);

  const result = {
    updatedAt: new Date().toISOString(),
    instruments,
    news,
  };

  const outPath = path.join(__dirname, '..', 'data', 'market.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`저장 완료: ${outPath}`);
  console.log(`- 지표 ${instruments.filter((i) => i.ok).length}/${instruments.length}개 성공`);
  console.log(`- 뉴스 ${news.length}건 수집`);
}

main().catch((err) => {
  console.error('수집 실패:', err);
  process.exit(1);
});
