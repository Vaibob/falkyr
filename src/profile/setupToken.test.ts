// Tests for the connect wizard's fragile parts: the CLI-output regexes and the
// token store precedence. Run: npx tsx src/profile/setupToken.test.ts
process.env.JOBPILOT_DB = 'C:\\Users\\VAIBHA~1\\AppData\\Local\\Temp\\falkyr-tokentest\\t.db';
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

mkdirSync(dirname(process.env.JOBPILOT_DB!), { recursive: true });

const { __test } = await import('./setupToken.js');
const { getClaudeToken, storeClaudeToken, clearClaudeToken, isValidTokenShape, tokenIsStored } =
  await import('./claudeAuth.js');

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

console.log('setup-token parsing:');

t('authorize URL extracted from typical CLI output', () => {
  const out = [
    'Opening browser to sign in…',
    'If the browser does not open, visit:',
    '  https://claude.ai/oauth/authorize?code=true&client_id=abc123&scope=user%3Aprofile',
    'Paste the code from the browser here:',
  ].join('\n');
  const m = __test.deansi(out).match(__test.URL_RE);
  assert.ok(m);
  assert.ok(m![0].startsWith('https://claude.ai/oauth/authorize'));
});

t('URL extraction survives ANSI color codes', () => {
  const out = '[1mVisit:[0m https://console.anthropic.com/oauth?x=1[0m\n';
  const m = __test.deansi(out).match(__test.URL_RE);
  assert.ok(m);
  assert.ok(m![0].includes('console.anthropic.com/oauth'));
});

t('token extracted from CLI success output', () => {
  const out = 'Success! Your token:\n\n  sk-ant-oat01-AbCdEf123_-xyz\n\nStore it safely.';
  const m = out.match(__test.TOKEN_RE);
  assert.equal(m![0], 'sk-ant-oat01-AbCdEf123_-xyz');
});

t('token shape validation', () => {
  assert.ok(isValidTokenShape('sk-ant-oat01-AbCdEf123_-xyz'));
  assert.ok(!isValidTokenShape('sk-ant-api03-somethingelse'));
  assert.ok(!isValidTokenShape('hello'));
});

console.log('token store:');

t('store -> get -> stored wins over env -> clear', () => {
  clearClaudeToken();
  assert.equal(getClaudeToken(), null);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-fromenv';
  assert.equal(getClaudeToken(), 'sk-ant-oat01-fromenv');
  storeClaudeToken('sk-ant-oat01-fromfile');
  assert.equal(getClaudeToken(), 'sk-ant-oat01-fromfile'); // file > env
  assert.equal(tokenIsStored(), true);
  clearClaudeToken();
  assert.equal(getClaudeToken(), 'sk-ant-oat01-fromenv'); // env remains after disconnect
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  assert.equal(getClaudeToken(), null);
});

t('garbage token rejected by store', () => {
  assert.throws(() => storeClaudeToken('not-a-token'));
});

rmSync(dirname(process.env.JOBPILOT_DB!), { recursive: true, force: true });
console.log(`\n${pass} passed`);
