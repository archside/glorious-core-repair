import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { patchSource, sha256 } from '../src/patch.mjs';
import { prepareArchive, buildArchive, fileHash } from '../src/archive.mjs';
import { parseArguments } from '../src/arguments.mjs';

const library = path.dirname(fileURLToPath(import.meta.resolve('@electron/asar')));
const { Pickle } = await import(pathToFileURL(path.join(library, 'pickle.js')));

function specFor(member, before, after) {
  return { member, originalHash: sha256(before), patchedHash: sha256(after), edits: [{ name: 'fixture edit', before, after }] };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-repair-test-'));
  t.after(async () => {
    asar.uncacheAll();
    const resolved = path.resolve(directory);
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    assert(relative.startsWith('core-repair-test-') && !relative.includes(path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const source = path.join(directory, 'app', 'resources', 'app.asar');
  const files = path.join(directory, 'fixture');
  await fs.mkdir(path.join(files, 'mixed'), { recursive: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(path.join(files, 'main.js'), 'const result = "before";');
  await fs.writeFile(path.join(files, 'mixed', 'packed.txt'), 'packed child inside unpacked directory');
  await fs.writeFile(path.join(files, 'mixed', 'native.node'), 'synthetic native bytes; never executable');
  await asar.createPackageWithOptions(files, source, { unpack: '**/*.node' });
  const raw = asar.getRawHeader(source);
  const bytes = await fs.readFile(source);
  const header = structuredClone(raw.header);
  header.files.mixed.unpacked = true;
  header.files['main.js'].executable = true;
  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(JSON.stringify(header));
  const headerBytes = headerPickle.toBuffer();
  const size = Pickle.createEmpty();
  size.writeUInt32(headerBytes.length);
  await fs.writeFile(source, Buffer.concat([size.toBuffer(), headerBytes, bytes.subarray(8 + raw.headerSize)]));
  asar.uncache(source);
  const specs = [specFor('main.js', 'const result = "before";', 'const result = "after";')];
  return { directory, source, specs, hash: await fileHash(source), output: path.join(directory, 'output') };
}

test('exact patch hashes and unique anchors are required', () => {
  const spec = specFor('fixture', 'old', 'new');
  assert.equal(patchSource(Buffer.from('old'), spec).toString(), 'new');
  assert.throws(() => patchSource(Buffer.from('different'), spec), /fingerprint/);
  assert.throws(() => patchSource(Buffer.from('old'), { ...spec, patchedHash: 'wrong' }), /patched fingerprint/);
  const duplicate = specFor('fixture', 'old old', 'unused');
  duplicate.edits[0].before = 'old';
  assert.throws(() => patchSource(Buffer.from('old old'), duplicate), /ambiguous/);
  const missing = { ...spec, edits: [{ name: 'missing', before: 'absent', after: 'new' }] };
  assert.throws(() => patchSource(Buffer.from('old'), missing), /missing or ambiguous/);
});

test('scoped edits leave identical text outside the handler untouched', () => {
  const original = 'old\nBEGIN\nold\nEND\nold';
  const patched = 'old\nBEGIN\nnew\nEND\nold';
  const spec = { ...specFor('fixture', original, patched), start: 'BEGIN', end: 'END', edits: [{ name: 'scoped', before: 'old', after: 'new' }] };
  assert.equal(patchSource(Buffer.from(original), spec).toString(), patched);
});

test('archive preserves mixed packed flags, metadata, payload and source', async t => {
  const f = await fixture(t);
  const prepared = await prepareArchive(f.source, f.hash, f.specs);
  const result = await buildArchive(prepared, f.output);
  const output = path.join(f.output, 'app.asar');
  assert.equal(asar.extractFile(output, 'main.js').toString(), 'const result = "after";');
  assert.equal(asar.extractFile(output, path.normalize('mixed/packed.txt')).toString(), 'packed child inside unpacked directory');
  assert.equal(asar.extractFile(output, path.normalize('mixed/native.node')).toString(), 'synthetic native bytes; never executable');
  assert.equal(asar.statFile(output, 'mixed').unpacked, true);
  assert.equal(asar.statFile(output, path.normalize('mixed/packed.txt')).unpacked, undefined);
  assert.equal(asar.statFile(output, path.normalize('mixed/native.node')).unpacked, true);
  assert.equal(asar.statFile(output, 'main.js').executable, true);
  assert.equal(await fileHash(f.source), f.hash);
  assert.equal(result.unchangedFiles, 2);
  assert.equal(result.unpackedFiles, 1);
  assert.equal(result.originalPayloadPreserved, true);
  assert.deepEqual(result.changedMembers, ['main.js']);
});

test('unsupported archive cannot create output', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareArchive(f.source, 'wrong', f.specs), /Unsupported CORE archive/);
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
  assert.equal(await fileHash(f.source), f.hash);
});

test('existing output and source application folder are never overwritten', async t => {
  const f = await fixture(t);
  const prepared = await prepareArchive(f.source, f.hash, f.specs);
  await fs.mkdir(f.output);
  await fs.writeFile(path.join(f.output, 'keep.txt'), 'keep');
  await assert.rejects(buildArchive(prepared, f.output), /already exists/);
  assert.equal(await fs.readFile(path.join(f.output, 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(buildArchive(prepared, path.join(path.dirname(f.source), 'output')), /outside the source/);
  assert.equal(await fileHash(f.source), f.hash);
});

test('missing or changed unpacked assets stop before creating output', async t => {
  const f = await fixture(t);
  const prepared = await prepareArchive(f.source, f.hash, f.specs);
  await fs.writeFile(path.join(`${f.source}.unpacked`, 'mixed', 'native.node'), 'tampered');
  await assert.rejects(buildArchive(prepared, f.output));
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
});

test('command line rejects duplicate, unknown and missing flags', () => {
  assert.equal(parseArguments(['--help'], ['source']), null);
  assert.equal(parseArguments(['--source', 'app.asar'], ['source']).source, path.resolve('app.asar'));
  for (const args of [[], ['--source'], ['--force', 'yes'], ['--source', 'a', '--source', 'b']]) {
    assert.throws(() => parseArguments(args, ['source']));
  }
});
