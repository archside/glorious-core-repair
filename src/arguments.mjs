import path from 'node:path';

export function parseArguments(args, required) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (args[i] !== `--${key}` || !required.includes(key) || result[key] || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Unexpected, duplicate, or incomplete argument: ${args[i]}`);
    }
    result[key] = path.resolve(args[i + 1]);
  }
  for (const key of required) if (!result[key]) throw new Error(`Missing --${key}`);
  return result;
}
