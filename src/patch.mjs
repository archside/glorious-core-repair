import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const SOURCE_SHA256 = '5a3fd42e820bfa5ee3a89d019b714816f970c9e42103a04364804bce96a5d1ea';
export const OUTPUT_SHA256 = 'e44aa029b9f0cf3d295b18fe9e69f326dcc8cb80a9d1acfc0b2daac735d41eef';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

export async function loadSpecs() {
  const read = async name => JSON.parse(await fs.readFile(new URL(`../patches/${name}.json`, import.meta.url), 'utf8'));
  const main = await read('main');
  const renderer = await read('renderer');
  return [
    {
      member: 'out/main/index.js',
      originalHash: main.base_sha256,
      patchedHash: main.patched_sha256,
      edits: main.changes,
      start: 'class GMMK3HEDeviceHandler extends KeyboardDeviceHandler {',
      end: '\nconst DeviceUpdateId =',
    },
    {
      member: renderer.source_member,
      originalHash: renderer.original_sha256,
      patchedHash: renderer.patched_sha256,
      edits: renderer.patches,
    },
  ];
}

export function patchSource(bytes, spec) {
  if (sha256(bytes) !== spec.originalHash) throw new Error(`Unsupported member fingerprint: ${spec.member}`);
  const source = bytes.toString('utf8');
  let start = 0;
  let end = source.length;
  if (spec.start) {
    start = source.indexOf(spec.start);
    end = source.indexOf(spec.end, start);
    if (start < 0 || end <= start) throw new Error(`Missing patch scope: ${spec.member}`);
  }
  let scope = source.slice(start, end);
  for (const edit of spec.edits) {
    if (!edit.before || scope.split(edit.before).length !== 2) {
      throw new Error(`Patch anchor is missing or ambiguous: ${edit.name}`);
    }
    scope = scope.replace(edit.before, () => edit.after);
  }
  const patched = Buffer.from(source.slice(0, start) + scope + source.slice(end));
  if (sha256(patched) !== spec.patchedHash) throw new Error(`Unexpected patched fingerprint: ${spec.member}`);
  return patched;
}
