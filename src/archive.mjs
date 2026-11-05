import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { sha256, patchSource } from './patch.mjs';

// The exact dependency version is pinned because these two ASAR helpers are internal.
const library = path.dirname(fileURLToPath(import.meta.resolve('@electron/asar')));
const { Pickle } = await import(pathToFileURL(path.join(library, 'pickle.js')));
const { getFileIntegrityFromBuffer } = await import(pathToFileURL(path.join(library, 'integrity.js')));

export async function fileHash(filename, range) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename, range)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareArchive(source, expectedHash, specs) {
  if (await fileHash(source) !== expectedHash) {
    throw new Error('Unsupported CORE archive fingerprint. Nothing was patched. Do not bypass this check.');
  }
  asar.uncache(source);
  const raw = asar.getRawHeader(source);
  const inventory = [];
  function walk(files, prefix = '') {
    for (const [name, entry] of Object.entries(files)) {
      if (['.', '..'].includes(name) || /[/\\]/.test(name)) throw new Error('Unsafe archive member name');
      const member = prefix ? `${prefix}/${name}` : name;
      if (entry.link) throw new Error(`Archive symlinks require separate review: ${member}`);
      inventory.push({ member, entry });
      if (entry.files) walk(entry.files, member);
    }
  }
  walk(raw.header.files);
  const replacements = new Map();
  for (const spec of specs) {
    const entry = inventory.find(item => item.member === spec.member)?.entry;
    if (!entry || entry.files || entry.unpacked) throw new Error(`Expected packed member: ${spec.member}`);
    const original = asar.extractFile(source, path.normalize(spec.member));
    replacements.set(spec.member, { original, patched: patchSource(original, spec) });
  }
  return { source, expectedHash, raw, inventory, replacements };
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function rejectLinks(directory) {
  const stat = await fsp.lstat(directory);
  if (stat.isSymbolicLink()) throw new Error(`Unpacked symlink requires separate review: ${directory}`);
  if (!stat.isDirectory()) throw new Error('Unpacked asset root is not a directory');
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unpacked symlink requires separate review: ${filename}`);
    if (entry.isDirectory()) await rejectLinks(filename);
  }
}

export async function buildArchive(prepared, outputDirectory, expectedOutputHash) {
  const { source, expectedHash, raw, inventory, replacements } = prepared;
  const resolvedSource = await fsp.realpath(source);
  const destinationParent = await fsp.realpath(path.dirname(outputDirectory));
  const destination = path.join(destinationParent, path.basename(outputDirectory));
  const applicationRoot = path.dirname(path.dirname(resolvedSource));
  if (isWithin(applicationRoot, destination)) throw new Error('Output must be outside the source application folder');
  try {
    await fsp.lstat(destination);
    throw new Error('Output directory already exists; refusing to overwrite');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const unpackedSource = `${source}.unpacked`;
  const hasUnpacked = fs.existsSync(unpackedSource);
  if (hasUnpacked) await rejectLinks(unpackedSource);
  for (const { member, entry } of inventory) {
    if (entry.unpacked && !entry.files) {
      const bytes = asar.extractFile(source, path.normalize(member));
      if (entry.integrity) assert.deepEqual(getFileIntegrityFromBuffer(bytes), entry.integrity, `Unpacked integrity: ${member}`);
    }
  }
  const sourceDataStart = 8 + raw.headerSize;
  const sourcePayloadSize = fs.statSync(source).size - sourceDataStart;
  assert(Number.isSafeInteger(sourcePayloadSize) && sourcePayloadSize > 0);
  const header = structuredClone(raw.header);
  let appendOffset = sourcePayloadSize;
  for (const [member, replacement] of replacements) {
    const entry = member.split('/').reduce((node, name) => node.files[name], header);
    entry.offset = String(appendOffset);
    entry.size = replacement.patched.length;
    entry.integrity = getFileIntegrityFromBuffer(replacement.patched);
    appendOffset += entry.size;
  }
  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(JSON.stringify(header));
  const headerBuffer = headerPickle.toBuffer();
  const sizePickle = Pickle.createEmpty();
  sizePickle.writeUInt32(headerBuffer.length);
  await fsp.mkdir(destination);
  const output = path.join(destination, 'app.asar');
  async function* content() {
    yield sizePickle.toBuffer();
    yield headerBuffer;
    yield* fs.createReadStream(source, { start: sourceDataStart });
    for (const replacement of replacements.values()) yield replacement.patched;
  }
  await pipeline(Readable.from(content()), fs.createWriteStream(output, { flags: 'wx' }));
  if (hasUnpacked) await fsp.cp(unpackedSource, `${output}.unpacked`, { recursive: true, errorOnExist: true, force: false });
  asar.uncache(output);
  const rebuilt = asar.getRawHeader(output);
  assert.deepEqual(rebuilt.header, header);
  assert.equal(fs.statSync(output).size, 8 + rebuilt.headerSize + appendOffset);
  assert.equal(await fileHash(source, { start: sourceDataStart }), await fileHash(output, {
    start: 8 + rebuilt.headerSize,
    end: 8 + rebuilt.headerSize + sourcePayloadSize - 1,
  }));
  let unchangedFiles = 0;
  let unpackedFiles = 0;
  let directories = 0;
  for (const { member, entry } of inventory) {
    const normalized = path.normalize(member);
    const actual = asar.statFile(output, normalized, false);
    if (entry.files) {
      const { files: oldFiles, ...oldMetadata } = entry;
      const { files: newFiles, ...newMetadata } = actual;
      assert.deepEqual(newMetadata, oldMetadata);
      assert.deepEqual(Object.keys(newFiles), Object.keys(oldFiles));
      directories++;
    } else if (replacements.has(member)) {
      assert.equal(sha256(asar.extractFile(output, normalized)), sha256(replacements.get(member).patched));
    } else {
      assert.deepEqual(actual, entry);
      assert.equal(sha256(asar.extractFile(source, normalized)), sha256(asar.extractFile(output, normalized)), member);
      unchangedFiles++;
    }
    if (entry.unpacked && !entry.files) unpackedFiles++;
  }
  assert.deepEqual(asar.listPackage(source), asar.listPackage(output));
  assert.equal(await fileHash(source), expectedHash, 'Source changed during build');
  const outputSha256 = await fileHash(output);
  if (expectedOutputHash) assert.equal(outputSha256, expectedOutputHash, 'Output differs from reviewed repair');
  const report = {
    sourceSha256: expectedHash, outputSha256, changedMembers: [...replacements.keys()],
    unchangedFiles, directories, unpackedFiles, originalPayloadPreserved: true,
    sourceUnmodified: true, applicationLaunched: false, hardwareAccessed: false,
  };
  await fsp.writeFile(path.join(destination, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
