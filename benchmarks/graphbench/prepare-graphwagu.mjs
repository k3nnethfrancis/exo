import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(root, '.cache', 'graphwagu');
const commit = 'bee7b7b834d96a81cff7a1c8910c4a78b9d9c48b';
const repository = 'https://github.com/harp-lab/GraphWaGu.git';
const patch = path.join(root, 'patches', 'graphwagu-benchmark.patch');

await fs.rm(cache, { recursive: true, force: true });
await fs.mkdir(path.dirname(cache), { recursive: true });
await run('git', ['clone', '--quiet', repository, cache]);
await run('git', ['checkout', '--quiet', commit], cache);
await run('git', ['apply', '--check', patch], cache);
await run('git', ['apply', patch], cache);
await run('npm', ['install', '--no-audit', '--no-fund'], cache);
await run('npm', ['run', 'build'], cache);
await fs.writeFile(path.join(cache, 'GRAPHBENCH_SOURCE.json'), `${JSON.stringify({ repository, commit }, null, 2)}\n`);
console.log(`Prepared GraphWaGu ${commit} at ${path.join(cache, 'dist')}`);

async function run(command, arguments_, cwd = root) {
  const { stdout, stderr } = await execute(command, arguments_, { cwd, maxBuffer: 20 * 1024 * 1024 });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}
