// Temporary smoke test (deleted after run). Exercises the pure logic of the
// generate module without needing the native SQLite binary or the DB.
import { loadCareerOpsSources } from './sources.js';
import { buildPrompt, FORM_QUESTIONS, HONEST_GAPS_RULE } from './prompt.js';
import { extractJson, coerceBundle, isClaudeAvailable } from './claude.js';
import { buildFallbackBundle, REVIEW_MARKER } from './fallback.js';
import type { Job } from '../types.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

const job: Job = {
  id: 1, source: 'greenhouse', company: 'Acme RL Labs',
  role: 'Reinforcement Learning Engineer', url: 'https://x/y',
  location: 'Remote', remote: 'remote', comp_note: null, ats_provider: 'greenhouse',
  fit_score: 4.5,
  jd_text: 'We need someone with GRPO/DPO experience, verifiable rewards, vLLM serving, and frontier multi-node distributed RL with FSDP/Megatron. PhD preferred.',
  stage: 'evaluated', created_at: '', updated_at: '',
};

console.log('== sources ==');
const sources = loadCareerOpsSources();
ok('cv.md loaded', sources.cv.includes('Vaibhav Shelar'));
ok('profile.yml loaded', sources.profile.includes('target_range'));
ok('article-digest loaded', sources.articleDigest.includes('CER'));
ok('no missing sources', sources.missing.length === 0);

console.log('== prompt ==');
const prompt = buildPrompt(job, sources);
ok('prompt has honest-gaps rule', prompt.includes(HONEST_GAPS_RULE.slice(0, 40)));
ok('prompt embeds JD', prompt.includes('frontier multi-node distributed RL'));
ok('prompt embeds company+role', prompt.includes('Acme RL Labs') && prompt.includes('Reinforcement Learning Engineer'));
ok('prompt embeds cv text', prompt.includes('Eucloid'));
ok('prompt lists 5 questions', FORM_QUESTIONS.length === 5 && prompt.includes(FORM_QUESTIONS[2]));
ok('prompt asks for single JSON', prompt.includes('SINGLE JSON object'));
ok('prompt forbids INR anchoring', prompt.toLowerCase().includes('inr'));

console.log('== extractJson / coerceBundle ==');
const bare = '{"form_answers":[{"question":"Why this role?","answer":"Because RL."}],"cover_letter":"Hi.","cv_markdown":"# CV"}';
const fenced = '```json\n' + bare + '\n```';
const prosey = 'Sure! Here you go:\n' + bare + '\nHope that helps.';
const camel = '{"formAnswers":[{"question":"Q","answer":"A"}],"coverLetter":"c","cvMarkdown":"m"}';
ok('parse bare', !!coerceBundle(extractJson(bare)));
ok('parse fenced', !!coerceBundle(extractJson(fenced)));
ok('parse prose-wrapped', !!coerceBundle(extractJson(prosey)));
ok('parse camelCase keys', !!coerceBundle(extractJson(camel)));
ok('reject garbage', extractJson('no json here at all') === null);
const b = coerceBundle(extractJson(bare))!;
ok('coerced answers', b.formAnswers.length === 1 && b.formAnswers[0].question === 'Why this role?');
ok('coerced cover', b.coverLetter === 'Hi.');
ok('coerced cv', b.cvMarkdown === '# CV');
ok('reject empty object', coerceBundle({}) === null);

console.log('== fallback ==');
const fb = buildFallbackBundle(job, sources);
ok('fallback has 5 form answers', fb.formAnswers.length === 5);
ok('every form answer marked', fb.formAnswers.every(a => a.answer.startsWith(REVIEW_MARKER)));
ok('cover marked', fb.coverLetter.startsWith(REVIEW_MARKER));
ok('cv marked', fb.cvMarkdown.startsWith(REVIEW_MARKER));
ok('cv contains real cv.md', fb.cvMarkdown.includes('Eucloid'));
ok('salary answer real range', fb.formAnswers[2].answer.includes('$100K'));
ok('salary answer NOT INR', !/INR|₹|rupee/i.test(fb.formAnswers[2].answer));
ok('work-auth answer remote/no-reloc', /remote/i.test(fb.formAnswers[4].answer) && /not relocat/i.test(fb.formAnswers[4].answer));
ok('fallback invents no PhD claim', !/\bI (have|hold|earned|completed) a ph\.?d/i.test(JSON.stringify(fb)));
ok('cover addressed to company', fb.coverLetter.includes('Acme RL Labs'));
ok('cover names real project', fb.coverLetter.includes('FiscalAI') || fb.coverLetter.includes('DPO') || fb.coverLetter.includes('West Bengal'));

console.log('== claude availability ==');
console.log('  isClaudeAvailable() =>', isClaudeAvailable());

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
console.log('\n--- sample fallback "Why you?" ---\n' + fb.formAnswers[1].answer);
console.log('\n--- sample fallback salary ---\n' + fb.formAnswers[2].answer);
console.log('\n--- sample fallback work-auth ---\n' + fb.formAnswers[4].answer);
process.exit(fail === 0 ? 0 : 1);
