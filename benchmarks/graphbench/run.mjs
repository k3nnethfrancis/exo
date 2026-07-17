import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADAPTERS } from './adapters/index.mjs';
import { aggregateResults, resolveRepetitions } from './lib/aggregate.mjs';
import { createFixture } from './lib/fixture.mjs';
import { writeFixture } from './lib/fixture-io.mjs';
import { hardwareStamp } from './lib/hardware.mjs';
import { frameReport, roundDeep, summarize } from './lib/metrics.mjs';
import { computeLayoutQuality } from './lib/quality.mjs';
import { startServer } from './lib/server.mjs';
import { PROFILES, SEED, VIEWPORTS } from './profiles.mjs';
import { presentationProfileHash, resolvePresentationProfile } from './public/exo/stellar-scene.js';

const graphbenchRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(graphbenchRoot, '../..');
const playwrightUrl = pathToFileURL(path.join(repositoryRoot, 'node_modules/@playwright/test/index.js')).href;
const playwright = await import(playwrightUrl);
const { chromium } = playwright.default || playwright;
const profileName = readArgument('--profile') || 'smoke';
const profile = PROFILES[profileName];
const suppliedFixturePath = readArgument('--fixture');
if (!profile) throw new Error(`Unknown profile: ${profileName}. Choose ${Object.keys(PROFILES).join(', ')}`);
const repetitions = resolveRepetitions(readArgument('--repetitions'), profile.repetitions);
const viewportId = readArgument('--viewport') || profile.viewport || 'desktop';
const viewport = VIEWPORTS[viewportId];
if (!viewport) throw new Error(`Unknown viewport: ${viewportId}. Choose ${Object.keys(VIEWPORTS).join(', ')}`);

const runId = `${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}-${profileName}`;
const runDirectory = path.join(graphbenchRoot, 'artifacts', runId);
const fixtureDirectory = path.join(graphbenchRoot, 'artifacts', 'fixtures');
await fs.mkdir(runDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.GRAPHBENCH_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-webgpu'],
});
const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor });
const server = await startServer({ root: repositoryRoot, graphbenchRoot });
const results = [];
let hardware = null;

try {
  const stampPage = await context.newPage();
  await stampPage.goto(`${server.baseUrl}/benchmarks/graphbench/public/sigma.html`, { waitUntil: 'domcontentloaded' });
  hardware = await hardwareStamp(browser, stampPage);
  await stampPage.close();

  const fixtureCases = suppliedFixturePath ? [JSON.parse(await fs.readFile(path.resolve(suppliedFixturePath), 'utf8'))] : profile.cases;
  for (const fixtureCase of fixtureCases) {
    const fixture = suppliedFixturePath ? fixtureCase : createFixture({ ...fixtureCase, seed: SEED });
    const fixtureName = `${fixture.generatorVersion}-${fixture.nodeCount}-${fixture.edgeRatio}-${fixture.checksum}.json`;
    const fixturePath = path.join(fixtureDirectory, fixtureName);
    if (!suppliedFixturePath) await ensureFixture(fixturePath, fixture);
    server.setFixture(suppliedFixturePath ? path.resolve(suppliedFixturePath) : fixturePath);

    for (const engine of profile.engines) {
      const adapter = ADAPTERS[engine];
      for (const track of profile.tracks) {
        for (let trial = 1; trial <= repetitions; trial += 1) {
          process.stdout.write(`${engine.padEnd(10)} ${track.padEnd(8)} ${String(fixture.nodeCount).padStart(7)} nodes ${String(fixture.edgeCount).padStart(8)} links ${trial}/${repetitions} ... `);
          const result = await runCase({ context, server, adapter, track, fixture, trial, presentationProfile: profile.presentationProfile || 'benchmark-v1' });
          results.push(result);
          console.log(result.status === 'measured' ? 'measured' : `${result.status}: ${result.reason}`);
        }
      }
    }
  }
} finally {
  await server.close();
  await context.close();
  await browser.close();
}

const report = roundDeep({
  schemaVersion: 1,
  benchmark: 'Exo GraphBench',
  profile: profileName,
  repetitions,
  runId,
  seed: SEED,
  viewport: { id: viewportId, ...viewport },
  hardware,
  results,
  aggregates: aggregateResults(results),
});
await fs.writeFile(path.join(runDirectory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(runDirectory, 'summary.md'), renderMarkdown(report));
await fs.writeFile(path.join(graphbenchRoot, 'artifacts', 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(graphbenchRoot, 'artifacts', 'latest.md'), renderMarkdown(report));
console.log(`\nResults: ${path.join(runDirectory, 'summary.md')}`);

async function runCase({ context, server, adapter, track, fixture, trial, presentationProfile }) {
  const identity = {
    engine: adapter?.id || 'unknown',
    engineVersion: adapter?.version || null,
    track,
    trial,
    presentationProfile,
    fixture: {
      generator: fixture.generatorVersion,
      checksum: fixture.checksum,
      nodes: fixture.nodeCount,
      links: fixture.edgeCount,
      edgeRatio: fixture.edgeRatio,
      dataset: fixture.dataset || null,
      sourceUrl: fixture.sourceUrl || null,
      sourceSha256: fixture.sourceSha256 || null,
    },
  };
  if (!adapter) return { ...identity, status: 'unsupported', reason: 'No adapter is registered.' };
  if (!adapter.available) return { ...identity, status: 'unavailable', reason: adapter.reason };
  if (!adapter.capabilities[track]) return { ...identity, status: 'unsupported', reason: `${adapter.id} does not expose the ${track} track.` };

  const page = await context.newPage();
  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  const beganAt = performance.now();
  try {
    await page.goto(adapter.url(server.baseUrl, track, { presentationProfile }), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction((contract) => {
      const target = globalThis[contract];
      return target && typeof target.snapshot === 'function' && target.snapshot().ready === true;
    }, adapter.contract, { timeout: 90_000 });
    const readyMs = performance.now() - beganAt;
    const readySnapshot = await page.evaluate((contract) => globalThis[contract].snapshot(), adapter.contract);
    if (readySnapshot.nodeCount !== fixture.nodeCount || readySnapshot.edgeCount !== fixture.edgeCount) {
      throw new Error(`Fixture count mismatch: expected ${fixture.nodeCount}/${fixture.edgeCount}, received ${readySnapshot.nodeCount}/${readySnapshot.edgeCount}`);
    }
    if (presentationProfile === 'benchmark-v2') {
      const expectedHash = presentationProfileHash(resolvePresentationProfile(presentationProfile));
      if (readySnapshot.profile !== presentationProfile || readySnapshot.profileHash !== expectedHash) {
        throw new Error(`Visual profile mismatch: expected ${presentationProfile}/${expectedHash}, received ${readySnapshot.profile || 'missing'}/${readySnapshot.profileHash || 'missing'}`);
      }
    }
    let measurements;
    if (track === 'render') measurements = await measureRender(page, adapter);
    else if (track === 'product') measurements = await measureProduct(page, adapter);
    else measurements = await measureLayout(page, adapter, fixture);
    const snapshot = await page.evaluate((contract) => globalThis[contract].snapshot(), adapter.contract);
    return { ...identity, status: 'measured', readyMs, measurements, snapshot, diagnostics };
  } catch (error) {
    const snapshot = await page.evaluate((contract) => {
      try { return globalThis[contract]?.snapshot?.() || null; } catch { return null; }
    }, adapter.contract).catch(() => null);
    return { ...identity, status: 'failed', reason: error.message, snapshot, diagnostics };
  } finally {
    await page.close();
  }
}

async function measureRender(page, adapter) {
  const frameIntervals = await page.evaluate(async ({ contract, warmupFrames, measuredFrames }) => {
    const api = globalThis[contract];
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let frame = 0; frame < warmupFrames; frame += 1) {
      api.actions.render();
      await waitFrame();
    }
    const intervals = [];
    let previous = await waitFrame();
    for (let frame = 0; frame < measuredFrames; frame += 1) {
      api.actions.render();
      const next = await waitFrame();
      intervals.push(next - previous);
      previous = next;
    }
    return intervals;
  }, { contract: adapter.contract, warmupFrames: 30, measuredFrames: 180 });
  const gpuTiming = await readGpuTiming(page, adapter.contract);
  return {
    frame: frameReport(frameIntervals),
    memory: await measureMemory(page),
    gpuTiming,
  };
}

async function readGpuTiming(page, contract) {
  const initial = await page.evaluate((name) => globalThis[name].snapshot().gpuTiming || null, contract);
  if (!initial) return { status: 'unsupported', reason: 'Adapter does not expose GPU timing.' };
  if (!initial.supported) return { status: 'unsupported', reason: initial.reason || 'GPU timestamp queries are unavailable.' };
  if (!initial.stats?.count) {
    await page.waitForFunction((name) => {
      const timing = globalThis[name]?.snapshot?.().gpuTiming;
      return !timing?.supported || timing.stats?.count > 0;
    }, contract, { timeout: 2_000 }).catch(() => {});
  }
  const timing = await page.evaluate((name) => globalThis[name].snapshot().gpuTiming, contract);
  if (!timing.supported) return { status: 'unsupported', reason: timing.reason || 'GPU timestamp queries became unavailable.' };
  if (!timing.stats?.count) return { status: 'unavailable', reason: 'No GPU timestamp samples completed before the benchmark deadline.' };
  return {
    status: 'measured',
    source: 'webgpu-timestamp-query',
    samples: timing.samples,
    stats: timing.stats,
  };
}

async function measureProduct(page, adapter) {
  const surface = page.locator(adapter.surface);
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error(`Benchmark surface not found: ${adapter.surface}`);
  await page.evaluate((selector) => {
    const surface = document.querySelector(selector);
    globalThis.__graphBenchInputLatency = [];
    surface.addEventListener('pointermove', () => {
      const started = performance.now();
      requestAnimationFrame(() => globalThis.__graphBenchInputLatency.push(performance.now() - started));
    }, { passive: true });
  }, adapter.surface);
  const startX = bounds.x + bounds.width * 0.35;
  const startY = bounds.y + bounds.height * 0.52;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 48; step += 1) {
    await page.mouse.move(startX + step * 4, startY + Math.sin(step / 5) * 28);
  }
  await page.mouse.up();
  await page.waitForTimeout(100);
  const inputLatencies = await page.evaluate(() => globalThis.__graphBenchInputLatency);
  const selectionMs = await page.evaluate(async (contract) => {
    const beganAt = performance.now();
    globalThis[contract].actions.select(0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - beganAt;
  }, adapter.contract);
  return {
    inputToFrame: summarize(inputLatencies),
    selectionToFrameMs: selectionMs,
    memory: await measureMemory(page),
  };
}

async function measureLayout(page, adapter, fixture) {
  const beganAt = performance.now();
  await page.waitForFunction((contract) => globalThis[contract].snapshot().layout?.settled === true, adapter.contract, { timeout: 120_000 });
  const settledMs = performance.now() - beganAt;
  const exported = await page.evaluate((contract) => globalThis[contract].actions.positions(), adapter.contract);
  return {
    settledMs,
    quality: computeLayoutQuality({ fixture, positions: Float32Array.from(exported.values), dimensions: exported.dimensions }),
    memory: await measureMemory(page),
  };
}

async function measureMemory(page) {
  return page.evaluate(async () => {
    if (typeof performance.measureUserAgentSpecificMemory === 'function' && crossOriginIsolated) {
      try {
        const measured = await performance.measureUserAgentSpecificMemory();
        return { source: 'measureUserAgentSpecificMemory', bytes: measured.bytes };
      } catch {}
    }
    if (performance.memory) {
      return { source: 'performance.memory', bytes: performance.memory.usedJSHeapSize, totalHeapBytes: performance.memory.totalJSHeapSize };
    }
    return { source: 'unsupported', bytes: null };
  });
}

async function ensureFixture(filePath, fixture) {
  try { await fs.access(filePath); } catch { await writeFixture(filePath, fixture); }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function renderMarkdown(report) {
  const rows = report.aggregates.map((result) => {
    const distribution = result.distribution;
    const primary = distribution.count ? `${distribution.p50.toFixed(2)} / ${distribution.p95.toFixed(2)} ms` : '—';
    return `| ${result.engine} | ${result.track} | ${result.fixture.nodes.toLocaleString()} | ${result.fixture.links.toLocaleString()} | ${result.measured}/${result.attempted} | ${primary} |`;
  });
  const gaps = report.results.filter((result) => result.status !== 'measured');
  return `# Exo GraphBench — ${report.profile}\n\nRun \`${report.runId}\` on ${report.hardware.cpu?.model || 'unknown CPU'} with ${report.hardware.browser}. Each supported case has ${report.repetitions} independent browser-page trial(s).\n\n| Engine | Track | Nodes | Links | Trials | primary p50 / p95 |\n| --- | --- | ---: | ---: | ---: | ---: |\n${rows.join('\n') || '| — | — | — | — | — | — |'}\n\n## Capability gaps\n\n${gaps.map((gap) => `- **${gap.engine} / ${gap.track} / trial ${gap.trial}:** ${gap.status} — ${gap.reason}`).join('\n') || '- None.'}\n\nFull per-trial measurements and aggregate distributions are in \`results.json\`. Lower frame/input latency is better; layout quality metrics are not interchangeable with render throughput.\n`;
}
