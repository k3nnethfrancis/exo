import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeFixture(filePath, fixture) {
  await mkdir(dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const metadata = { ...fixture };
  delete metadata.nodes;
  delete metadata.edges;
  const prefix = JSON.stringify(metadata).slice(0, -1);
  await write(stream, `${prefix},"nodes":[`);
  for (let index = 0; index < fixture.nodes.length; index += 1) {
    await write(stream, `${index ? ',' : ''}${JSON.stringify(fixture.nodes[index])}`);
  }
  await write(stream, '],"edges":[');
  for (let index = 0; index < fixture.edges.length; index += 1) {
    await write(stream, `${index ? ',' : ''}${JSON.stringify(fixture.edges[index])}`);
  }
  stream.end(']}\n');
  await once(stream, 'finish');
}

async function write(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}
