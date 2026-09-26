// Screenshot tool for visual reviews (not part of the app build).
// Usage: node scripts/shots.mjs <baseUrl> <outDir> <shots.json>   (uses the globally installed playwright)
// shots.json: [{ "name": "hero", "width": 1600, "height": 900, "query": "capture", "eval": "js...", "frames": 3, "wait": 0 }]
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const globalRoot = process.env.PLAYWRIGHT_ROOT ?? execSync('npm root -g').toString().trim();
const { chromium } = createRequire(join(globalRoot, 'noop.js'))('playwright');

const [base, outDir, spec] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(spec, 'utf8'));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.width ?? 1600, height: s.height ?? 900 }, deviceScaleFactor: s.dpr ?? 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const url = `${base}${s.query ? `?${s.query}` : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.lensLab && window.lensLab.frameCount > 0, null, { timeout: 120000 });
  // capture mode renders no animation frames, so CSS transitions would never finish: switch them off
  if (s.transitions !== true) await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  if (s.eval) await page.evaluate(s.eval);
  if (s.frames) await page.evaluate((n) => window.lensLab.renderFrames(n), s.frames);
  if (s.wait) await page.waitForTimeout(s.wait);
  const file = join(outDir, `${s.name}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  console.log(`${file}${logs.length ? `\n  ${logs.join('\n  ')}` : ''}`);
  await ctx.close();
}
await browser.close();
