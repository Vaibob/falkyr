// Unit tests for the pure field-classification logic (no browser needed).
// Run: npx tsx src/apply/fields.test.ts
import assert from 'node:assert/strict';
import {
  classifyQuestion,
  pickDeclineOption,
  matchOption,
  bestIdentityField,
  bestAnswerForLabel,
} from './fields.js';
import { detectAts, atsHints } from './adapters.js';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  fn();
  pass++;
  console.log('  ok -', name);
};

console.log('classifyQuestion:');
t('gender → eeo', () => assert.equal(classifyQuestion('What is your gender?'), 'eeo'));
t('race/ethnicity → eeo', () => assert.equal(classifyQuestion('Race / Ethnicity (self-identification)'), 'eeo'));
t('disability → eeo', () => assert.equal(classifyQuestion('Do you have a disability?'), 'eeo'));
t('veteran → eeo', () => assert.equal(classifyQuestion('Protected veteran status'), 'eeo'));
t('sponsorship → sponsorship', () => assert.equal(classifyQuestion('Will you now or in the future require visa sponsorship?'), 'sponsorship'));
t('work-auth → work-auth', () => assert.equal(classifyQuestion('Are you legally authorized to work in the United States?'), 'work-auth'));
t('consent → consent', () => assert.equal(classifyQuestion('I agree to the privacy policy'), 'consent'));
t('how-did-you-hear → benign', () => assert.equal(classifyQuestion('How did you hear about us?'), 'benign'));

console.log('pickDeclineOption:');
t('finds "Prefer not to say"', () => assert.equal(pickDeclineOption(['Male', 'Female', 'Prefer not to say']), 'Prefer not to say'));
t('finds "Decline to self-identify"', () => assert.equal(pickDeclineOption(['Yes', 'No', 'I decline to self-identify']), 'I decline to self-identify'));
t('none on yes/no', () => assert.equal(pickDeclineOption(['Yes', 'No']), null));

console.log('matchOption:');
t('exact country', () => assert.equal(matchOption(['United States', 'India', 'Germany'], 'India'), 'India'));
t('containment', () => assert.equal(matchOption(['United States of America', 'India'], 'United States'), 'United States of America'));
t('no confident match', () => assert.equal(matchOption(['Yes', 'No'], 'Canada'), null));

console.log('identity + answer matching still intact:');
t('first name', () => {
  const r = bestIdentityField('First Name', { firstName: 'Vaibhav', fullName: 'Vaibhav Shelar' });
  assert.equal(r?.value, 'Vaibhav');
});
t('name-collision guard: "Company name" does NOT get the full name', () =>
  assert.equal(bestIdentityField('Company name', { fullName: 'Vaibhav Shelar', firstName: 'Vaibhav' }), null));
t('name-collision guard: "Product name" does NOT get the full name', () =>
  assert.equal(bestIdentityField('Product name', { fullName: 'Vaibhav Shelar' }), null));
t('plain "Name" still maps to full name', () => {
  const r = bestIdentityField('Name', { fullName: 'Vaibhav Shelar' });
  assert.equal(r?.value, 'Vaibhav Shelar');
});
t('"Full name" still maps to full name', () => {
  const r = bestIdentityField('Full name', { fullName: 'Vaibhav Shelar' });
  assert.equal(r?.value, 'Vaibhav Shelar');
});
t('answer fuzzy match', () => {
  const r = bestAnswerForLabel('Why do you want this role?', [{ question: 'Why do you want this role at the company?', answer: 'Because RL.' }]);
  assert.ok(r && r.answer.answer === 'Because RL.');
});

console.log('adapters:');
t('detect greenhouse', () => assert.equal(detectAts('https://job-boards.greenhouse.io/anthropic/jobs/1'), 'greenhouse'));
t('detect workday multiStep', () => assert.equal(atsHints(detectAts('https://x.wd1.myworkdayjobs.com/y')).multiStep, true));
t('detect ashby', () => assert.equal(detectAts('https://jobs.ashbyhq.com/cohere/abc'), 'ashby'));

console.log(`\n✅ ${pass} checks passed.`);
