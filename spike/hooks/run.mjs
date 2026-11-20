import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './src/scenarios.mjs';

/** Project root (two levels above this spike folder). */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Entry point: `node run.mjs <scenario...|all>`.
 * Output goes to `<project>/.tmp/other/spike-hooks/<timestamp>/<scenario>/`.
 */
async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length === 0 || requested.includes('all') ? Object.keys(SCENARIOS) : requested;
  const unknown = names.filter((name) => !SCENARIOS[name]);
  if (unknown.length > 0) {
    console.error(`Unknown scenario(s): ${unknown.join(', ')}. Known: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  const runRoot = path.join(PROJECT_ROOT, '.tmp', 'other', 'spike-hooks', timestamp);
  // Claude runs in a dedicated empty folder so the project's files do not influence the turns.
  const cwd = path.join(PROJECT_ROOT, '.tmp', 'other', 'spike-hooks', 'cwd');
  fs.mkdirSync(runRoot, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  console.log(`Output: ${runRoot}`);

  for (const name of names) {
    console.log(`\n=== ${name} ===`);
    const result = await SCENARIOS[name]({ runRoot, cwd });
    const results = Array.isArray(result) ? result : [result];
    for (const summary of results) {
      console.log(JSON.stringify(summary.findings, null, 2));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
