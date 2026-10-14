import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
const executablePath = '/home/vicmonteiro/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

async function prepare(page) {
  await page.goto('http://127.0.0.1:4747', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ui-topbar', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const victor = page.locator('.ui-counter--victor');
  if (await victor.count()) await victor.waitFor({ timeout: 5000 }).catch(() => {});
  const agent = page.locator('.ui-agent', { hasText: 'devcodex' }).first();
  if (await agent.count()) {
    await agent.dispatchEvent('click');
  } else {
    const fallback = page.locator('.ui-agent').first();
    if (await fallback.count()) await fallback.dispatchEvent('click');
  }
  await page.waitForTimeout(1500);
  await page.locator('.ui-diario').first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.locator('.ui-diario').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
}

async function shot(width, height, name) {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await prepare(page);
  const file = join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
  console.log(file);
}

await shot(375, 900, 'escritorio-diario-victor-375.png');
await shot(1280, 900, 'escritorio-diario-victor-1280.png');
