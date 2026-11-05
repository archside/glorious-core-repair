import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArguments } from '../src/arguments.mjs';
import { SOURCE_SHA256, loadSpecs } from '../src/patch.mjs';
import { prepareArchive } from '../src/archive.mjs';

let temporary;
try {
  const options = parseArguments(process.argv.slice(2), ['source']);
  if (options === null) {
    console.log('Usage: npm run test:vendor -- --source <CORE resources/app.asar>');
  } else {
    const prepared = await prepareArchive(options.source, SOURCE_SHA256, await loadSpecs());
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'core-repair-replay-'));
    for (const [index, [, replacement]] of [...prepared.replacements].entries()) {
      const kind = index === 0 ? 'main' : 'renderer';
      const original = path.join(temporary, `${kind}.original.js`);
      const patched = path.join(temporary, `${kind}.patched.js`);
      await fs.writeFile(original, replacement.original);
      await fs.writeFile(patched, replacement.patched);
      const script = fileURLToPath(new URL(`./replay-${kind}.cjs`, import.meta.url));
      const result = spawnSync(process.execPath, [script, original, patched], { stdio: 'inherit', windowsHide: true, timeout: 60000 });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${kind} replay failed`);
    }
    console.log('Vendor function replays passed. Hardware calls were replaced with test doubles; CORE was not launched.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) {
    const resolved = path.resolve(temporary);
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative.startsWith('core-repair-replay-') || relative.includes(path.sep)) throw new Error('Unexpected temporary directory');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
