// Run after npm run build. Isolated browser fixtures; never contacts a live API.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = resolve('dist/client');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const isAsset = Boolean(extname(file));
    const body = await readFile(isAsset ? file : resolve(root, 'index.html'));
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] ?? 'text/html');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined });
  await mkdir('outputs/bipolar-ui', { recursive: true });
  const seed = await readFile('migrations/0040_attribute_subjects.sql', 'utf8');
  const description = (id) => {
    const line = seed.split('\n').find((text) => text.startsWith(`('${id}', 'zh-TW'`));
    assert.ok(line, `Original description missing: ${id}`);
    return line.match(/, NULL, '([^']*)'/)[1];
  };
  const attribute = { id: 'fixture-win', key: 'win', name: '取勝方式', minValue: 0, maxValue: 10, sortOrder: 0, scaleType: 'bipolar', endpoints: {
    low: { label: '得分取勝', question: '哪款遊戲更偏得分取勝？', fullDescription: description('attribute_score_race') },
    high: { label: '條件取勝', question: '哪款遊戲更偏條件取勝？', fullDescription: description('attribute_end_condition') },
  } };
  const subjects = ['測試遊戲甲', '測試遊戲乙', '測試遊戲丙', '測試遊戲丁'].map((displayName, i) => ({ id: `fixture-${i}`, slug: `fixture-${i}`, kind: 'game', displayName, bggIds: [] }));
  for (const width of [1280, 390]) for (const highPole of ['low', 'high']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    let submitted;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let json;
      if (url.pathname === '/api/session') json = { user: null, googleClientId: null, localDevLogin: false };
      else if (url.pathname === '/api/attributes/table') json = { generation: 2, throughVersion: 1, generatedAt: Date.now(), attributes: [attribute], subjects, values: subjects.map((subject, i) => ({ subjectId: subject.id, attributeId: attribute.id, score: [0, 2, 8, 10][i], directCount: 1, evidenceCount: 1 })), candidates: [], activities: [] };
      else if (url.pathname === '/api/attributes/table/changes') json = { changes: [], throughVersion: 1, hasMore: false };
      else if (url.pathname === '/api/attributes/question') json = { question: { attribute, highPole, subjectA: subjects[0], subjectB: subjects[1] }, activities: [], questionToken: 'isolated-fixture-question-token-long-enough' };
      else if (url.pathname === '/api/attributes/responses') { submitted = route.request().postDataJSON(); json = { ok: true, updatedValues: [] }; }
      else throw new Error(`Unexpected API request: ${url.pathname}`);
      await route.fulfill({ json });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/attributes`);
    const high = attribute.endpoints[highPole];
    await page.getByRole('heading', { name: high.question }).waitFor();
    const slider = page.getByRole('slider', { name: '評分：測試遊戲甲' });
    await slider.press('End');
    assert.equal(await slider.getAttribute('aria-valuenow'), '10');
    assert.ok((await slider.getAttribute('aria-valuetext')).includes(`10 為${high.label}`));
    assert.ok(await page.getByTitle(`${highPole === 'low' ? 10 : 0} 分：測試遊戲甲`).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    await page.screenshot({ path: `outputs/bipolar-ui/${width}-${highPole}.png`, fullPage: true });
    await Promise.all([
      page.waitForResponse('**/api/attributes/responses'),
      page.getByRole('button', { name: `測試遊戲甲更偏${high.label}` }).click(),
    ]);
    assert.equal(submitted.highPole, highPole);
    assert.equal(submitted.ratingA, 10);
    assert.equal(submitted.comparison, 'A_HIGHER');
    await page.getByText(/更偏「條件取勝」/).waitFor();
    assert.ok((await page.locator('.attributes-inline-activity').textContent()).includes('0＝得分取勝，10＝條件取勝'));
    await page.getByRole('link', { name: '屬性總表' }).click();
    await page.getByRole('button', { name: '取勝方式排序：正常' }).waitFor();
    await page.getByText('兩端說明', { exact: true }).click();
    assert.ok(await page.getByText(attribute.endpoints.low.fullDescription, { exact: true }).isVisible());
    assert.ok(await page.getByText(attribute.endpoints.high.fullDescription, { exact: true }).isVisible());
    await page.getByRole('button', { name: '取勝方式排序：正常' }).click();
    await page.getByRole('button', { name: '取勝方式排序：偏條件取勝優先' }).waitFor();
    assert.ok((await page.locator('.attributes-matrix tbody tr').first().textContent()).includes('測試遊戲丁'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Table page overflow');
    await page.screenshot({ path: `outputs/bipolar-ui/table-${width}-${highPole}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px / ${highPole}: vote, canonical activity, table descriptions and sorting, no overflow or console errors`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
