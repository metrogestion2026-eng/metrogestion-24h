import test from 'node:test';
import assert from 'node:assert/strict';
import { secondFactorState, verifySecondFactor } from '../shared/mfa-state.js';

function mock({ factors = [], level = 'aal1', listError = null, levelError = null, verifyError = null } = {}) {
  return {
    listFactors: async () => ({ data: { all: factors }, error: listError }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level }, error: levelError }),
    challengeAndVerify: async () => ({ error: verifyError }),
  };
}
const factor = { id: 'test-factor', status: 'verified', factor_type: 'totp' };
test('password login requires second factor once enrolled', async () => {
  assert.equal((await secondFactorState(mock({ factors: [factor] }))).required, true);
});
test('AAL2 already satisfies the challenge', async () => {
  assert.equal((await secondFactorState(mock({ factors: [factor], level: 'aal2' }))).required, false);
});
test('unfinished enrolment does not lock out the account', async () => {
  assert.equal((await secondFactorState(mock({ factors: [{ ...factor, status: 'unverified' }] }))).required, false);
});
test('accounts without a factor can still enter', async () => {
  assert.equal((await secondFactorState(mock())).required, false);
});
for (const args of [{ listError: new Error() }, { levelError: new Error() }, { level: null }]) {
  test('failed factor or assurance checks fail closed ' + Object.keys(args)[0], async () => {
    await assert.rejects(secondFactorState(mock(args)));
  });
}
test('verification rejects invalid codes before calling auth', async () => {
  let called = false;
  const mfa = mock();
  mfa.challengeAndVerify = async () => { called = true; return {}; };
  await assert.rejects(verifySecondFactor(mfa, 'factor', 'abc123'));
  assert.equal(called, false);
});
test('failed or expired challenge is not accepted', async () => {
  await assert.rejects(verifySecondFactor(mock({ verifyError: new Error(), level: 'aal2' }), 'factor', '123456'));
});
test('successful HTTP response without AAL2 is not accepted', async () => {
  await assert.rejects(verifySecondFactor(mock(), 'factor', '123456'));
});
test('a verified AAL2 challenge is accepted', async () => {
  await verifySecondFactor(mock({ level: 'aal2' }), 'factor', '123456');
});
