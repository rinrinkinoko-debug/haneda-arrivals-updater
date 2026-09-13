import { chromium } from 'playwright-core';

const BASE = 'https://tokyo-haneda.com';
const INGEST = 'https://haneda-arrivals-2026.rinrinkinoko.chatgpt.site/api/ingest';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const now = new Date();
const dateAt = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + offset * 86400000));

async function scrape(date, kind) {
  const path = kind === 'dom' ? 'dms_search.html' : 'int_search.html';
  await page.goto(`${BASE}/flight/${path}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.locator('button.flight-search__purpose__switch').click({ timeout: 15000 });
  await page.locator('input[type=date].flight-form-parts__input').fill(date);
  await page.locator('main button.btn-conversion').filter({ hasText: '検索' }).first().click();
  await page.locator(`a[href*="${kind === 'dom' ? 'dms' : 'int'}_arrival.html"]`).first().waitFor({ timeout: 25000 });
  const more = page.getByRole('button', { name: '全ての情報を表示する' });
  if (await more.isVisible().catch(() => false)) await more.click();
  const flights = await page.locator(`a[href*="${kind === 'dom' ? 'dms' : 'int'}_arrival.html"]`).evaluateAll((links, { date, base }) => {
    const text = (node) => node?.textContent?.trim().replace(/\s+/g, ' ') || '';
    const target = date.slice(5).replace('-', '/');
    return links.map(a => {
      const on = a.querySelector('.flight-card__time__value--on');
      const changed = a.querySelector('.flight-card__time__value--change');
      const onDate = text(on?.querySelector('.flight-card__time__value__date'));
      if (onDate && onDate !== target) return null;
      const time = text(on?.querySelector('.flight-card__time__value__time'));
      const changedTime = text(changed?.querySelector('.flight-card__time__value__time'));
      const numbers = [...a.querySelectorAll('.flight-card__airline__item')].map(text).filter(Boolean);
      const href = a.getAttribute('href');
      const code = new URL(href, base).searchParams.get('flightNumber');
      const exitRow = [...a.querySelectorAll('dl')].find(dl => text(dl.querySelector('dt')) === '出口');
      return { id: code, origin: text(a.querySelector('.flight-card__purpose__item:not(.flight-card__purpose__item--hnd)')), time, ...(changedTime && changedTime !== time ? { changedTime } : {}), terminal: text(a.querySelector('.terminal-tag')).replace(/^T/, '') || '?', exit: text(exitRow?.querySelector('dd')).replace(/^[-－]$/, ''), flights: numbers.join(' / '), status: text(a.querySelector('.flight-status')), link: new URL(href, base).href };
    }).filter(Boolean);
  }, { date, base: BASE });
  const deduped = [...new Map(flights.map(f => [f.id, f])).values()];
  const minimum = kind === 'dom' ? 50 : 20;
  if (deduped.length < minimum) throw new Error(`Too few ${kind} flights for ${date}: ${deduped.length}`);
  return { date, kind, flights: deduped };
}

async function oidcToken() {
  const url = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(INGEST)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!response.ok) throw new Error(`OIDC token unavailable: ${response.status}`);
  return (await response.json()).value;
}

try {
  // The airport's daily search is available near the date, not indefinitely in advance.
  for (const date of [dateAt(0), dateAt(1)]) {
    for (const kind of ['dom', 'intl']) {
      const snapshot = await scrape(date, kind);
      const token = await oidcToken();
      const response = await fetch(INGEST, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
      if (!response.ok) throw new Error(`Ingest ${date}/${kind}: ${response.status} ${(await response.text()).slice(0,200)}`);
      console.log(`${date} ${kind}: ${snapshot.flights.length} flights`);
    }
  }
} finally { await browser.close(); }
