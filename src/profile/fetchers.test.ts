// SSRF-guard matrix + fetcher shape tests. Run: npx tsx src/profile/fetchers.test.ts
// Network-free: only assertPublicHttpUrl's REJECTION paths are exercised
// (acceptance requires DNS; we use well-known public IP literals for that).
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, FetchGuardError } from './fetchers.js';

let pass = 0;
const t = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn();
  pass++;
  console.log('  ok -', name);
};

const rejects = async (url: string): Promise<void> => {
  await assert.rejects(assertPublicHttpUrl(url), FetchGuardError, `should reject ${url}`);
};

console.log('assertPublicHttpUrl:');

await t('rejects non-http schemes', async () => {
  await rejects('file:///etc/passwd');
  await rejects('ftp://example.com/x');
  await rejects('gopher://example.com');
});

await t('rejects localhost + .local names', async () => {
  await rejects('http://localhost:3001/api/health');
  await rejects('http://sub.localhost/x');
  await rejects('http://printer.local/');
});

await t('rejects loopback/private/link-local/CGNAT v4 literals', async () => {
  await rejects('http://127.0.0.1/');
  await rejects('http://127.9.9.9/');
  await rejects('http://10.0.0.5/');
  await rejects('http://172.16.0.1/');
  await rejects('http://172.31.255.255/');
  await rejects('http://192.168.1.1/');
  await rejects('http://169.254.169.254/latest/meta-data/'); // cloud metadata
  await rejects('http://100.64.0.1/');
  await rejects('http://0.0.0.0/');
});

await t('rejects v6 loopback/ULA/link-local/v4-mapped-private literals', async () => {
  await rejects('http://[::1]/');
  await rejects('http://[fc00::1]/');
  await rejects('http://[fd12:3456::1]/');
  await rejects('http://[fe80::1]/');
  await rejects('http://[::ffff:127.0.0.1]/');
  await rejects('http://[::ffff:10.0.0.1]/');
});

await t('rejects malformed URLs', async () => {
  await rejects('not a url');
  await rejects('http://');
});

await t('accepts public IP literals (no DNS needed)', async () => {
  const a = await assertPublicHttpUrl('https://1.1.1.1/');
  assert.equal(a.hostname, '1.1.1.1');
  const b = await assertPublicHttpUrl('http://[2606:4700:4700::1111]/');
  assert.ok(b.hostname.includes('2606'));
});

console.log(`\n${pass} passed`);
