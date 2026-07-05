// Trust-critical tests for the Glove grounding bridge.
// Run: npx tsx src/profile/glove.test.ts   (uses an in-memory DB; touches no real data)
//
// IMPORTANT: env vars MUST be set before any project module loads (static
// imports are hoisted above statements), so everything below uses dynamic
// import() after this env block. Do not convert these back to static imports.
process.env.JOBPILOT_DB = ':memory:';
process.env.CAREER_OPS_ROOT = 'Z:\\definitely\\not\\a\\real\\careerops';
delete process.env.JOBPILOT_GROUNDING;

import assert from 'node:assert/strict';
import type { Job } from '../types.js';

const { upsertProfile, getProfile } = await import('../db/index.js');
const {
  cardAvoidTitles,
  cardTitleKeywords,
  effectiveLandmines,
  gloveActive,
  peerCardToDigest,
  synthesizeProfileYaml,
} = await import('./glove.js');
const { peerCardSchema, releaseBlockers } = await import('./peerCard.js');
type PeerCard = import('./peerCard.js').PeerCard;
const { loadCareerOpsSources } = await import('../generate/sources.js');
const { parseCandidateProfile } = await import('../apply/profile.js');
const { verifyGrounding } = await import('../verify/grounding.js');
const { neverClaimBlock } = await import('../generate/prompt.js');
const { filterRelevantPayloads, sourceKeywords } = await import('../ingest/providers.js');
const { buildFallbackBundle } = await import('../generate/fallback.js');

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

// ---------------------------------------------------------------------------
// Fixture: a released card for a fictional data engineer
// ---------------------------------------------------------------------------

const card: PeerCard = peerCardSchema.parse({
  version: 1,
  identity: {
    fullName: 'Dana Rivers',
    headline: 'Data engineer — batch to streaming',
    email: 'dana@example.com',
    phone: '+1 555 0100',
    location: 'Lisbon, Portugal (remote)',
    city: 'Lisbon',
    country: 'Portugal',
    links: { github: 'https://github.com/danarivers', linkedin: 'https://linkedin.com/in/danarivers' },
  },
  archetypes: [
    {
      title: 'Data platform engineer who owns pipelines end to end',
      strength: 'primary',
      why: 'Built and ran the ingestion platform at Acme; on-call for it for two years.',
      provenance: [{ source: 'resume' }],
    },
  ],
  proofPoints: [
    {
      claim: 'Cut nightly batch runtime from 6 hours to 40 minutes',
      evidence: 'Rewrote the Spark job partitioning at Acme; the 40-minute figure is from the resume.',
      metrics: ['6 hours', '40 minutes'],
      provenance: [{ source: 'resume', excerpt: 'reduced batch window 6h -> 40min' }],
    },
  ],
  voice: {
    summary: 'Plain, concrete, allergic to buzzwords.',
    traits: ['direct', 'numbers-first'],
    avoid: ['synergy'],
    sampleLines: ['I like pipelines that fail loudly and recover on their own.'],
  },
  huntingGrounds: {
    targetTitles: ['data engineer', 'data platform engineer'],
    keywords: ['data engineer', 'etl', 'spark', 'airflow'],
    companyShapes: ['mid-size product company with a real data team'],
    avoidTitles: ['machine learning engineer'],
    seniority: 'senior',
  },
  honestGaps: [
    {
      term: 'phd',
      label: 'PhD / doctorate',
      question: 'Peers in your role sometimes claim a PhD — do you have one?',
      status: 'confirmed-gap',
    },
    {
      term: 'kubernetes',
      label: 'Production Kubernetes ownership',
      question: 'Have you owned production Kubernetes?',
      status: 'have-it',
    },
  ],
  policy: {
    compTarget: '€75-90K',
    compMinimum: '€70K',
    locationFlexibility: 'Remote within EU timezones only.',
  },
});

const releasedYaml = synthesizeProfileYaml(card);
const digest = peerCardToDigest(card);

// ---------------------------------------------------------------------------

console.log('glove grounding bridge:');

t('release gate: unsure gaps block, resolved cards release', () => {
  const unsure = { ...card, honestGaps: [{ ...card.honestGaps[0], status: 'unsure' as const }] };
  assert.ok(releaseBlockers(unsure).length > 0);
  assert.equal(releaseBlockers(card).length, 0);
});

t('no profile row -> file mode (owner regression)', () => {
  assert.equal(getProfile(), undefined);
  assert.equal(gloveActive(), false);
  const s = loadCareerOpsSources();
  assert.equal(s.missing.length, 3); // bogus CAREER_OPS_ROOT -> all files missing
  assert.equal(s.honestGapLabels, undefined);
  assert.equal(cardTitleKeywords(), null);
});

t('draft alone NEVER grounds', () => {
  upsertProfile({ peer_card_draft: JSON.stringify(card), cv_md: '# Dana Rivers\nResume text.' });
  assert.equal(gloveActive(), false);
});

t('released card + approved cv -> glove grounds', () => {
  upsertProfile({
    peer_card: JSON.stringify(card),
    peer_card_approved_at: new Date().toISOString(),
    approved_cv_md: '# Dana Rivers\nCut nightly batch runtime from 6 hours to 40 minutes at Acme.',
  });
  assert.equal(gloveActive(), true);
  const s = loadCareerOpsSources();
  assert.ok(s.cv.includes('Dana Rivers'));
  assert.ok(s.profile.includes('candidate:'));
  assert.ok(s.articleDigest.includes('Proof points'));
  assert.equal(s.missing.length, 0);
  assert.deepEqual(s.honestGapLabels, ['PhD / doctorate']);
});

t('JOBPILOT_GROUNDING=files forces file mode back', () => {
  process.env.JOBPILOT_GROUNDING = 'files';
  assert.equal(gloveActive(), false);
  assert.equal(loadCareerOpsSources().missing.length, 3);
  delete process.env.JOBPILOT_GROUNDING;
  assert.equal(gloveActive(), true);
});

t('synthesized YAML round-trips through the REAL autofill parser', () => {
  const parsed = parseCandidateProfile(releasedYaml);
  assert.equal(parsed.fullName, 'Dana Rivers');
  assert.equal(parsed.firstName, 'Dana');
  assert.equal(parsed.lastName, 'Rivers');
  assert.equal(parsed.email, 'dana@example.com');
  assert.equal(parsed.phone, '+1 555 0100');
  assert.equal(parsed.city, 'Lisbon');
  assert.equal(parsed.country, 'Portugal');
  assert.equal(parsed.github, 'https://github.com/danarivers');
  assert.equal(parsed.linkedin, 'https://linkedin.com/in/danarivers');
});

t('policy keys reach the REAL offline fallback (yamlValue)', () => {
  const job: Job = {
    id: 1, source: 'test', company: 'TestCo', role: 'Data Engineer',
    url: 'https://example.com/j/1', location: null, remote: 'remote', comp_note: null,
    ats_provider: null, fit_score: null, jd_text: 'ETL pipelines', stage: 'discovered',
    created_at: '', updated_at: '',
  };
  const bundle = buildFallbackBundle(job, loadCareerOpsSources());
  const all = JSON.stringify(bundle);
  assert.ok(all.includes('€75-90K'), 'target_range should surface in fallback output');
});

t('TRUST: digest excludes confirmed gap terms (landmine tripwire stays armed)', () => {
  assert.ok(!digest.toLowerCase().includes('phd'), 'digest must not contain the gap term');
  // Full circuit through the REAL verifier: a fabricated PhD claim in a
  // tailored CV must hard-flag against glove-mode sources.
  const report = verifyGrounding(
    '- PhD in Computer Science.\n- Cut nightly batch runtime from 6 hours to 40 minutes.',
    loadCareerOpsSources(),
    effectiveLandmines([]),
  );
  assert.equal(report.clean, false);
  assert.ok(report.findings.some((f) => f.hardFlags.includes('phd')));
});

t('grounded claim from the approved cv is NOT flagged', () => {
  const report = verifyGrounding(
    '- Cut nightly batch runtime from 6 hours to 40 minutes at Acme.',
    loadCareerOpsSources(),
    effectiveLandmines([]),
  );
  assert.equal(report.clean, true);
});

t('effectiveLandmines: confirmed merges, have-it does not, config preserved', () => {
  const merged = effectiveLandmines(['frontier lab']);
  assert.ok(merged?.includes('phd'));
  assert.ok(merged?.includes('frontier lab'));
  assert.ok(!merged?.includes('kubernetes'));
});

t('prompt never-claim block carries gap labels (outside grounding text)', () => {
  const block = neverClaimBlock(loadCareerOpsSources());
  assert.ok(block.includes('PhD / doctorate'));
});

t('scan keywords: released card beats config beats defaults', () => {
  const kw = sourceKeywords({ titleKeywords: ['reinforcement learning'] } as never);
  assert.ok(kw.includes('data engineer'));
  assert.ok(!kw.includes('reinforcement learning'));
});

t('scan avoid-list drops matching titles', () => {
  assert.deepEqual(cardAvoidTitles(), ['machine learning engineer']);
  const kept = filterRelevantPayloads(
    [
      { url: 'https://example.com/a', role: 'Senior Data Engineer', company: 'A', source: 't' },
      { url: 'https://example.com/b', role: 'Machine Learning Engineer, Data', company: 'B', source: 't' },
    ] as never,
    sourceKeywords({} as never),
    50,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].role, 'Senior Data Engineer');
});

console.log(`\n${pass} passed`);
