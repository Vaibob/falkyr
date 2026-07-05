// Unit tests for classifyClaudeFailure — the crux of QW3 (pause-on-limit vs
// degrade-to-template). Run: npx tsx src/generate/claude.test.ts
import assert from 'node:assert/strict';
import { classifyClaudeFailure } from './claude.js';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

console.log('classifyClaudeFailure — limit cases (must PAUSE, not template):');
t('usage limit', () => assert.equal(classifyClaudeFailure('You have hit your usage limit.', 1).kind, 'limit'));
t('session limit + reset hint', () => {
  const r = classifyClaudeFailure("You've hit your session limit · resets at 11pm", 1);
  assert.equal(r.kind, 'limit');
  assert.match(r.retryHint ?? '', /resets at 11pm/i);
});
t('rate limit', () => assert.equal(classifyClaudeFailure('Error: rate limit exceeded', 1).kind, 'limit'));
t('429', () => assert.equal(classifyClaudeFailure('HTTP 429 Too Many Requests', 1).kind, 'limit'));
t('overloaded (529)', () => assert.equal(classifyClaudeFailure('Error 529: overloaded', 1).kind, 'limit'));
t('try again later', () => assert.equal(classifyClaudeFailure('Please try again later', 1).kind, 'limit'));

console.log('classifyClaudeFailure — non-limit errors (template fallback is fine):');
t('generic crash', () => assert.equal(classifyClaudeFailure('Segmentation fault', 139).kind, 'error'));
t('bad flag', () => assert.equal(classifyClaudeFailure('unknown option --frobnicate', 2).kind, 'error'));
t('empty stderr', () => assert.equal(classifyClaudeFailure('', 1).kind, 'error'));

console.log(`\n✅ ${pass} checks passed.`);
