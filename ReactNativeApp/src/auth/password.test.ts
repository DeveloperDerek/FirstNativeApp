// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { passwordErrorMessage, passwordProblem, passwordStrength } from './password.ts';

describe('passwordProblem (step-tracker-register.txt, section 2)', () => {
  test('"short1" is too short', () => {
    assert.equal(passwordProblem('short1'), 'Use at least 8 characters.');
  });

  test('73 characters is too long', () => {
    assert.equal(passwordProblem('a'.repeat(73)), 'Use 72 characters or fewer.');
    assert.equal(passwordProblem('a'.repeat(72)), null);
  });

  test('8 characters is enough', () => {
    assert.equal(passwordProblem('walking8'), null);
  });

  test('"password1" is too common, in any case', () => {
    const common = 'This password is too common. Choose something harder to guess.';
    assert.equal(passwordProblem('password1'), common);
    assert.equal(passwordProblem('PassWord1'), common);
    assert.equal(passwordProblem('12345678'), common);
  });

  test('the email, its start, or the username is too common', () => {
    const common = 'This password is too common. Choose something harder to guess.';
    assert.equal(passwordProblem('derek.ho@gmail.com', ['derek.ho@gmail.com']), common);
    assert.equal(passwordProblem('Derek.Hoo', ['derek.hoo@gmail.com']), common);
    assert.equal(passwordProblem('derek_walks', ['x@y.com', 'derek_walks']), common);
    assert.equal(passwordProblem('derek.hoo!!', ['derek.hoo@gmail.com']), null);
  });

  test('Supabase counts bytes: 18 four-byte emoji are the most', () => {
    assert.equal(passwordProblem('🐝'.repeat(18)), null);
    assert.equal(passwordProblem('🐝'.repeat(19)), 'Use 72 characters or fewer.');
  });
});

describe('passwordStrength (a hint only)', () => {
  test('weak, OK, strong', () => {
    assert.equal(passwordStrength('short1'), 'weak');
    assert.equal(passwordStrength('password1'), 'weak');
    assert.equal(passwordStrength('aaaaaaaaaaaa'), 'weak');
    assert.equal(passwordStrength('walking8'), 'weak');
    assert.equal(passwordStrength('walking-far'), 'ok');
    assert.equal(passwordStrength('Walk-9-Miles'), 'strong');
    assert.equal(passwordStrength('correct horse battery'), 'strong');
  });
});

describe('passwordErrorMessage', () => {
  test('a breached password', () => {
    assert.equal(
      passwordErrorMessage({ code: 'weak_password', reasons: ['pwned'] }),
      'This password has appeared in a data breach. Choose a different one.'
    );
  });

  test('other refusals never say "Something went wrong"', () => {
    assert.equal(
      passwordErrorMessage({ code: 'weak_password', reasons: ['length'] }),
      'Choose a different password.'
    );
    assert.equal(passwordErrorMessage(new Error('boom')), 'Choose a different password.');
  });
});
