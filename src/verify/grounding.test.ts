// Unit tests for the deterministic grounding verifier. Run: npx tsx src/verify/grounding.test.ts
import assert from 'node:assert/strict';
import { verifyGrounding, type GroundingSources } from './grounding.js';

const sources: GroundingSources = {
  cv: 'Vaibhav Shelar. GRPO on Qwen3.5-VL. CER fell ~30 percent per round. FiscalAI RAG with bge-reranker. DPO framework: human-AI agreement rose 40 percent, manual review load dropped 50 percent.',
  profile: 'target_range: $100K-140K USD. Pune, India. remote-only.',
  articleDigest: '60,000+ handwritten records. 4-part composite verifiable reward. vLLM serving.',
};

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

console.log('verifyGrounding:');

t('grounded reformulation is NOT flagged', () => {
  const r = verifyGrounding('- Cut CER ~30% per round with a GRPO verifiable-reward loop over 60,000 records.', sources);
  assert.equal(r.clean, true);
});

t('fabricated metric IS flagged (unmatched number)', () => {
  const r = verifyGrounding('- Boosted model accuracy by 95% across the board.', sources);
  assert.equal(r.clean, false);
  assert.ok(r.findings[0].unmatchedNumbers.includes('95'));
});

t('PhD claim is a HARD flag', () => {
  const r = verifyGrounding('- PhD in Reinforcement Learning from Stanford.', sources);
  assert.equal(r.clean, false);
  assert.ok(r.findings[0].hardFlags.includes('phd'));
});

t('frontier distributed-RL claim is a hard flag', () => {
  const r = verifyGrounding('- Trained frontier models with DeepSpeed and Megatron at scale.', sources);
  assert.ok(r.findings.some((f) => f.hardFlags.includes('deepspeed') || f.hardFlags.includes('megatron')));
});

t('a real metric (40%) stays grounded', () => {
  const r = verifyGrounding('- Raised human-AI agreement 40% with a DPO framework.', sources);
  assert.equal(r.clean, true);
});

t('headings and markers are skipped', () => {
  const r = verifyGrounding('# Vaibhav Shelar\n## Experience\n> [[review-needed]]\n---', sources);
  assert.equal(r.totalLines, 0);
  assert.equal(r.clean, true);
});

console.log(`\n✅ ${pass} checks passed.`);
