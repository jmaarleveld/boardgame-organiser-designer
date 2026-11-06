#!/usr/bin/env node
// Headless driver for the board game designer. Runs INSIDE the Playwright
// container (see shoot.sh). Loads a design JSON through the app's "Open" file
// input, waits until every 3D mesh has been built (or failed), runs an optional
// step list and writes screenshots + a report.json to the output dir.
//
// Env (set by shoot.sh):
//   PW_CORE    absolute path of the playwright-core package dir
//   APP_URL    e.g. http://127.0.0.1:5199/
//   DESIGN     design JSON path (inside the container)
//   OUT        output dir (inside the container)
//   STEPS      optional steps JSON path (inside the container)
//   VIEW       optional default camera preset: top|front|side|iso
//   VIEWPORT   optional WxH, default 1600x1000
//   BUILD_TIMEOUT optional ms, default 180000
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_CORE || 'playwright-core');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5199/';
const DESIGN = process.env.DESIGN;
const OUT = process.env.OUT || '/out';
const STEPS = process.env.STEPS;
const VIEW = process.env.VIEW || '';
const [VW, VH] = (process.env.VIEWPORT || '1600x1000').split('x').map(Number);
const BUILD_TIMEOUT = Number(process.env.BUILD_TIMEOUT || 180000);

const design = DESIGN ? JSON.parse(fs.readFileSync(DESIGN, 'utf8')) : null;
const labelOf = (ref) => {
  const it = design?.items?.find((i) => i.id === ref);
  return it ? it.label : ref;
};

const report = { url: APP_URL, design: DESIGN, shots: [], console: [], pageErrors: [], builds: [], steps: [] };
const log = (...a) => console.log('[driver]', ...a);

async function waitForBuild(page, tag) {
  // Ready = the renderer has published assemblyBounds for every item, no kernel
  // mesh build is in flight, and either no item is still a placeholder box or
  // the placeholders are explained by meshFailures(). Must hold for 3 polls in a
  // row (≈750 ms), because a build can start right after a project change.
  const t0 = Date.now();
  let stable = 0;
  let last = null;
  while (Date.now() - t0 < BUILD_TIMEOUT) {
    last = await page.evaluate(() => {
      const d = window.__bgid || {};
      const bounds = typeof d.assemblyBounds === 'function' ? d.assemblyBounds() : null;
      const failures = typeof d.meshFailures === 'function' ? d.meshFailures() : {};
      const inflight = typeof d.meshInflight === 'function' ? d.meshInflight() : null;
      const banner = document.querySelector('.kernel-banner')?.textContent || null;
      return {
        hook: !!bounds,
        items: bounds ? bounds.length : 0,
        placeholders: bounds ? bounds.filter((b) => b.placeholder).map((b) => b.id) : [],
        inflight,
        builds: d.meshBuilds ?? 0,
        failures,
        kernelError: banner,
      };
    });
    if (last.kernelError) break;
    const expected = design?.items?.length ?? last.items;
    const failed = Object.keys(last.failures).length;
    const ok =
      last.hook &&
      last.items >= expected &&
      (last.inflight === 0 || (last.inflight === null && expected === 0)) &&
      (last.placeholders.length === 0 || failed > 0);
    stable = ok ? stable + 1 : 0;
    if (stable >= 3) break;
    await page.waitForTimeout(250);
  }
  last.ms = Date.now() - t0;
  last.ready = stable >= 3;
  last.tag = tag;
  report.builds.push(last);
  log(`build[${tag}]`, JSON.stringify(last));
  if (!last.ready) log(`WARNING: build not settled after ${last.ms} ms (timeout ${BUILD_TIMEOUT})`);
  // Give three.js a couple of frames to draw the final meshes.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return last;
}

async function setView(page, view) {
  const label = { top: 'Top', front: 'Front', side: 'Side', iso: 'Iso', fit: 'Fit' }[view.toLowerCase()] || view;
  const scope = label === 'Fit' ? page : page.getByRole('group', { name: 'Camera' });
  await scope.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(300);
}

async function selectItem(page, ref) {
  const label = labelOf(ref);
  let rows = page.getByRole('treeitem');
  if ((await rows.count()) === 0) {
    await page.locator('.outline-toggle').click();
    rows = page.getByRole('treeitem');
  }
  const row = rows.filter({ has: page.locator('.outline-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  if ((await row.count()) === 0) throw new Error(`select: no Stacks row labelled "${label}"`);
  await row.first().click();
}

async function setField(page, label, value) {
  const insp = page.getByRole('region', { name: 'Inspector' });
  const field = insp
    .locator('label.field')
    .filter({ has: page.locator('.field-label', { hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }) })
    .first();
  if ((await field.count()) === 0) throw new Error(`field: no Inspector field labelled "${label}"`);
  const input = field.locator('input, select').first();
  const tag = await input.evaluate((el) => el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''));
  if (tag.startsWith('select')) {
    // Accept either the option label or its value.
    const byLabel = await input.locator('option', { hasText: String(value) }).count();
    await input.selectOption(byLabel ? { label: String(value) } : String(value));
  } else if (tag === 'input:checkbox') {
    await input.setChecked(value === true || value === 'true' || value === 1);
  } else {
    await input.fill(String(value));
    await input.press('Tab'); // NumberField commits on change; blur re-syncs the text.
  }
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name.endsWith('.png') ? name : `${name}.png`);
  if (opts.target === 'canvas' || opts.target === '3d') {
    await page.locator('main.centre').screenshot({ path: file });
  } else if (opts.target === 'inspector') {
    await page.locator('aside.right').screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  report.shots.push(file);
  log('shot', file);
}

async function runStep(page, step, i) {
  const kind = Object.keys(step).find((k) => k !== 'target' && k !== 'wait');
  report.steps.push(step);
  switch (kind) {
    case 'view':
      return setView(page, step.view);
    case 'select':
      return selectItem(page, step.select);
    case 'field': {
      const before = await page.evaluate(() => window.__bgid?.meshBuilds ?? 0);
      await setField(page, step.field, step.value);
      // A geometry change starts a new kernel build shortly after the store
      // update; wait (max 3 s) for it to start so the stability check does not
      // pass on the old mesh. Changes that don't alter geometry just time out.
      await page
        .waitForFunction((b) => (window.__bgid?.meshBuilds ?? 0) > b, before, { timeout: 3000 })
        .catch(() => log(`field ${step.field}: no new mesh build started (geometry unchanged or cached)`));
      return waitForBuild(page, `step${i}:field ${step.field}`);
    }
    case 'click': // button by accessible name
      return page.getByRole('button', { name: step.click, exact: true }).first().click();
    case 'key':
      return page.keyboard.press(step.key);
    case 'sleep':
      return page.waitForTimeout(step.sleep);
    case 'waitBuild':
      return waitForBuild(page, `step${i}`);
    case 'eval': {
      const r = await page.evaluate(step.eval);
      log(`eval[${i}]`, JSON.stringify(r));
      report.steps[report.steps.length - 1] = { ...step, result: r };
      return;
    }
    case 'bounds': {
      const b = await page.evaluate(() => window.__bgid?.assemblyBounds?.());
      fs.writeFileSync(path.join(OUT, `${step.bounds || 'bounds'}.json`), JSON.stringify(b, null, 2));
      return;
    }
    case 'shot':
      return shot(page, step.shot, step);
    default:
      throw new Error(`unknown step ${JSON.stringify(step)}`);
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
    ],
  });
  let exitCode = 0;
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') report.console.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => report.pageErrors.push(String(e)));
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
    report.webgl = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl ? gl.getParameter(gl.RENDERER) : null;
    });
    log('webgl renderer:', report.webgl);
    if (!report.webgl) throw new Error('no WebGL2 context: check the swiftshader flags');

    if (DESIGN) {
      // The Open button is disabled until persistence is ready; the hidden input
      // next to it takes setInputFiles directly.
      await page.getByRole('button', { name: 'Open', exact: true }).waitFor();
      await page.locator('input[type=file][accept*="json"]').setInputFiles(DESIGN);
      await page.waitForFunction(
        (n) => (window.__bgid?.assemblyBounds?.()?.length ?? -1) >= n,
        design.items?.length ?? 0,
        { timeout: 60000 },
      );
      const notice = await page.locator('.notice.error').textContent().catch(() => null);
      if (notice) report.pageErrors.push(`load notice: ${notice}`);
    }
    await waitForBuild(page, 'load');
    if (VIEW) await setView(page, VIEW);

    const steps = STEPS ? JSON.parse(fs.readFileSync(STEPS, 'utf8')) : [{ shot: 'full' }, { shot: '3d', target: 'canvas' }];
    for (let i = 0; i < steps.length; i++) {
      try {
        await runStep(page, steps[i], i);
      } catch (e) {
        log(`step ${i} failed:`, e.message);
        report.steps[report.steps.length - 1] = { ...steps[i], error: e.message };
        await shot(page, `error-step${i}`);
        exitCode = 2;
        break;
      }
    }
  } catch (e) {
    log('FAILED:', e.stack || e);
    report.fatal = String(e);
    exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  const failed = report.builds.some((b) => Object.keys(b.failures || {}).length || b.kernelError || !b.ready);
  if (failed && !exitCode) exitCode = 3;
  log(`done (exit ${exitCode}); report: ${path.join(OUT, 'report.json')}`);
  process.exit(exitCode);
})();
