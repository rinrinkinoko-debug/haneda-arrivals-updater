import { chromium } from 'playwright-core';

const INGEST = 'https://haneda-arrivals-2026.rinrinkinoko.chatgpt.site/api/ingest';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const dateAt = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
const canonical = code => code.replace(/^ANA/, 'NH').replace(/^JAL/, 'JL').replace(/^ADO/, 'HD').replace(/^SNJ/, '6J').replace(/^SFJ/, '7G').replace(/^SKY/, 'BC');

async function getEntries(kind) {
  await page.goto('https://tokyo-haneda.com/flight/monthlyFlightSchedule.html', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.locator('select.select').first().selectOption(`${kind === 'dom' ? 'dms' : 'int'}-arrival`);
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.locator(`.month-${kind === 'dom' ? 'dms' : 'int'}-arrival table tbody tr`).first().waitFor({ timeout: 25000 });
  return page.evaluate(kind => {
    const result = [];
    const selector = `.month-${kind === 'dom' ? 'dms' : 'int'}-arrival table tbody tr`;
    for (const section of document.querySelectorAll('main section')) {
      const origin = section.querySelector('h3')?.textContent?.trim();
      if (!origin) continue;
      for (const row of section.querySelectorAll(selector)) {
        const cells = [...row.querySelectorAll('td')].map(cell => cell.textContent?.trim().replace(/\s+/g, ' ') || '');
        const time = cells[kind === 'dom' ? 1 : 0];
        if (!/^\d{2}:\d{2}$/.test(time || '')) {
          if (kind === 'intl' && result.length && cells[1] && /^\w+\d+$/.test(cells[1])) result.at(-1).codes.push(cells[1]);
          continue;
        }
        const code = cells[kind === 'dom' ? 3 : 2];
        const period = cells.at(-1)?.match(/(\d{4}\/\d{2}\/\d{2})\s*[～~]\s*(\d{4}\/\d{2}\/\d{2})/);
        if (!period || !code) continue;
        result.push({ origin, time, codes: [code], days: cells.slice(4, 11).map(value => value.includes('〇')), start: period[1].replaceAll('/', '-'), end: period[2].replaceAll('/', '-') });
      }
    }
    return result;
  }, kind);
}

async function token() {
  const response = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(INGEST)}`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!response.ok) throw new Error(`OIDC ${response.status}`);
  return (await response.json()).value;
}

try {
  for (const kind of ['dom', 'intl']) {
    const entries = await getEntries(kind);
    if (entries.length < (kind === 'dom' ? 100 : 30)) throw new Error(`Incomplete ${kind} monthly schedule (${entries.length})`);
    let saved = 0;
    for (let offset = 2; offset <= 92; offset++) {
      const date = dateAt(offset);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const grouped = new Map();
      for (const row of entries) {
        if (date < row.start || date > row.end || !row.days[weekday]) continue;
        const key = `${row.origin}|${row.time}`;
        if (!grouped.has(key)) grouped.set(key, { ...row, codes: [...row.codes] });
        else grouped.get(key).codes.push(...row.codes);
      }
      if (grouped.size < (kind === 'dom' ? 50 : 20)) continue;
      const flights = [...grouped.values()].map(row => {
        const code = row.codes.find(x => kind === 'dom' && /^(ADO|SNJ|SFJ|JAL|SKY)/.test(x)) || row.codes[0];
        const flightNumber = canonical(code);
        const terminal = kind === 'intl' ? '?' : /^(JAL|SKY|SFJ)/.test(code) ? '1' : '2';
        const link = `https://tokyo-haneda.com/flight/detail/${kind === 'dom' ? 'dms' : 'int'}_arrival.html?searchDt=${date.replaceAll('-', '')}&flightNumber=${encodeURIComponent(flightNumber)}`;
        return { id: `${flightNumber}-${row.time}`, origin: row.origin, time: row.time, terminal, flights: [...new Set(row.codes)].join(' / '), link };
      });
      const response = await fetch(INGEST, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ date, kind, flights }) });
      if (!response.ok) throw new Error(`Ingest ${date}/${kind}: ${response.status} ${(await response.text()).slice(0, 100)}`);
      saved++;
    }
    console.log(`${kind}: ${entries.length} published rows, ${saved} future days`);
  }
} finally { await browser.close(); }
