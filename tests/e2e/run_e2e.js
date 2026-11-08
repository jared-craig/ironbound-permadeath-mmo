import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  path.join(__dirname, 'tier1_features.test.js'),
  path.join(__dirname, 'tier2_boundaries.test.js'),
  path.join(__dirname, 'tier3_combinations.test.js'),
  path.join(__dirname, 'tier4_scenarios.test.js'),
  path.join(__dirname, 'tier5_adversarial.test.js'),
];

const res = spawnSync(process.execPath, ['--no-warnings', '--test', ...testFiles], {
  stdio: 'inherit',
});

process.exit(res.status ?? 1);
