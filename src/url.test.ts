// Unit tests for canonicalizeUrl — the dedup + Workable-form fix.
// Run: npx tsx src/url.test.ts
import assert from 'node:assert/strict';
import { canonicalizeUrl } from './url.js';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

console.log('canonicalizeUrl — Workable:');
t('/jobs/view/{code} → /{account}/j/{code}', () =>
  assert.equal(
    canonicalizeUrl('https://apply.workable.com/huggingface/jobs/view/81B46579FE'),
    'https://apply.workable.com/huggingface/j/81B46579FE',
  ));
t('already-canonical /{account}/j/{code} is unchanged', () =>
  assert.equal(
    canonicalizeUrl('https://apply.workable.com/huggingface/j/81B46579FE'),
    'https://apply.workable.com/huggingface/j/81B46579FE',
  ));
t('the two forms canonicalize EQUAL (dedup works)', () =>
  assert.equal(
    canonicalizeUrl('https://apply.workable.com/huggingface/jobs/view/81B46579FE/'),
    canonicalizeUrl('https://apply.workable.com/huggingface/j/81B46579FE'),
  ));

console.log('canonicalizeUrl — general hygiene:');
t('lowercases host', () =>
  assert.equal(canonicalizeUrl('https://Job-Boards.Greenhouse.IO/anthropic/jobs/5'), 'https://job-boards.greenhouse.io/anthropic/jobs/5'));
t('strips trailing slash', () =>
  assert.equal(canonicalizeUrl('https://jobs.lever.co/mistral/abc/'), 'https://jobs.lever.co/mistral/abc'));
t('strips utm_* params', () =>
  assert.equal(canonicalizeUrl('https://x.com/j/1?utm_source=hn&utm_medium=x'), 'https://x.com/j/1'));
t('KEEPS gh_jid (needed to load the job)', () =>
  assert.equal(canonicalizeUrl('https://helsing.ai/jobs/4676357101?gh_jid=4676357101'), 'https://helsing.ai/jobs/4676357101?gh_jid=4676357101'));
t('trailing dot in host removed', () =>
  assert.equal(canonicalizeUrl('https://apply.workable.com./huggingface/j/1'), 'https://apply.workable.com/huggingface/j/1'));
t('unparseable input returned trimmed', () => assert.equal(canonicalizeUrl('  not a url  '), 'not a url'));

console.log(`\n✅ ${pass} checks passed.`);
