// Unit tests for the per-user config precedence (env > file > default).
// Run: npx tsx src/userconfig.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUserConfig, resetUserConfigCache, configFilePath } from './userconfig.js';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

const dir = mkdtempSync(join(tmpdir(), 'jobpilot-cfg-'));
const savedEnv = { ...process.env };
const clearEnv = () => {
  for (const k of ['CAREER_OPS_ROOT', 'JOBPILOT_DB', 'JOBPILOT_GITHUB', 'JOBPILOT_SOURCES']) delete process.env[k];
  process.env.JOBPILOT_CONFIG_DIR = dir;
  resetUserConfigCache();
};

try {
  console.log('userconfig precedence:');

  t('default when no file and no env', () => {
    clearEnv();
    const c = getUserConfig();
    assert.equal(c.loadedFromFile, false);
    assert.match(c.careerOpsRoot, /career-ops$/);
    assert.equal(c.landmines, undefined); // grounding falls back to its default
  });

  t('file values are picked up', () => {
    clearEnv();
    writeFileSync(
      configFilePath(),
      JSON.stringify({
        careerOpsRoot: '/home/dana/career-ops',
        githubHandle: 'github.com/dana',
        landmines: ['sql', 'kubernetes'],
      }),
    );
    resetUserConfigCache();
    const c = getUserConfig();
    assert.equal(c.loadedFromFile, true);
    assert.equal(c.careerOpsRoot, '/home/dana/career-ops');
    assert.equal(c.githubHandle, 'github.com/dana');
    assert.deepEqual(c.landmines, ['sql', 'kubernetes']);
  });

  t('env overrides the file', () => {
    clearEnv();
    process.env.CAREER_OPS_ROOT = '/env/wins';
    resetUserConfigCache();
    assert.equal(getUserConfig().careerOpsRoot, '/env/wins');
  });

  t('malformed file does not throw — falls back to default', () => {
    clearEnv();
    writeFileSync(configFilePath(), '{ not valid json');
    resetUserConfigCache();
    const c = getUserConfig();
    assert.match(c.careerOpsRoot, /career-ops$/);
  });

  console.log(`\n✅ ${pass} checks passed.`);
} finally {
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
}
