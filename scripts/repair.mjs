import { parseArguments } from '../src/arguments.mjs';
import { SOURCE_SHA256, OUTPUT_SHA256, loadSpecs } from '../src/patch.mjs';
import { prepareArchive, buildArchive } from '../src/archive.mjs';

try {
  const options = parseArguments(process.argv.slice(2), ['source', 'output']);
  if (options === null) {
    console.log('Usage: node scripts/repair.mjs --source <CORE resources/app.asar> --output <NEW directory outside CORE>');
  } else {
    const prepared = await prepareArchive(options.source, SOURCE_SHA256, await loadSpecs());
    const report = await buildArchive(prepared, options.output, OUTPUT_SHA256);
    console.log(JSON.stringify(report, null, 2));
    console.log('Verified output created. Nothing was installed, launched, or sent to a device.');
  }
} catch (error) {
  console.error(`Repair stopped: ${error.message}`);
  console.error('Do not use an output directory unless the build reports success. No existing files were overwritten.');
  process.exitCode = 1;
}
