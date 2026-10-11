// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ageOn,
  cleanEmail,
  cleanUsernameInput,
  currentLegalDocs,
  isoDayToDate,
  isValidEmail,
  isValidDisplayName,
  isValidUsername,
  registerErrorMessage,
  suggestUsername,
  toIsoDay,
  usernameCandidates,
} from './register.ts';

describe('usernames (step-tracker-register.txt, section 3)', () => {
  test('capitals become lower-case and spaces become underscores', () => {
    assert.equal(cleanUsernameInput('Derek Walks'), 'derek_walks');
    assert.equal(cleanUsernameInput('DEREK'), 'derek');
  });

  test('3 to 20 letters, numbers or _', () => {
    assert.ok(isValidUsername('derek_99'));
    assert.ok(!isValidUsername('de'));
    assert.ok(!isValidUsername('a'.repeat(21)));
    assert.ok(!isValidUsername('derek!'));
    assert.ok(!isValidUsername('Derek'));
  });

  test('suggested from the Apple/Google name first, then the email', () => {
    assert.equal(suggestUsername('Zoë Ann', 'z@x.com'), 'zoe_ann');
    assert.equal(suggestUsername(null, 'derek.ho@gmail.com'), 'derek_ho');
    assert.equal(suggestUsername('', 'derek.ho@gmail.com'), 'derek_ho');
  });

  test('never from a Hide my email address', () => {
    assert.equal(suggestUsername(null, 'abc123xyz@privaterelay.appleid.com'), null);
  });

  test('nothing usable gives no suggestion', () => {
    assert.equal(suggestUsername('李', null), null);
    assert.equal(suggestUsername(null, 'ab@x.com'), null);
  });

  test('long names are cut to 20', () => {
    assert.equal(suggestUsername('a very long name indeed here', null), 'a_very_long_name_ind');
  });

  test('numbers are added when the suggestion is taken, staying within 20', () => {
    const [first, second, third] = usernameCandidates('a_very_long_name_ind', () => 0.123456);
    assert.equal(first, 'a_very_long_name_ind');
    assert.equal(second, 'a_very_long_name_i12');
    assert.equal(third, 'a_very_long_name1234');
    for (const c of [first, second, third]) assert.ok(isValidUsername(c));
  });
});

describe('display names', () => {
  test('1 to 30 characters, emoji and accents allowed', () => {
    assert.ok(isValidDisplayName('Bé 🐝'));
    assert.ok(isValidDisplayName('x'.repeat(30)));
    assert.ok(!isValidDisplayName('x'.repeat(31)));
    assert.ok(!isValidDisplayName('   '));
  });
});

describe('birthday', () => {
  test('the picked local day is what is sent', () => {
    assert.equal(toIsoDay(new Date(2001, 0, 9, 23, 30)), '2001-01-09');
  });
});

describe('server error codes', () => {
  test('known codes have words, others fall through', () => {
    assert.equal(registerErrorMessage('USERNAME_TAKEN'), 'That username is taken.');
    assert.equal(registerErrorMessage('BAD_USERNAME'), '3 to 20 letters, numbers or _');
    assert.equal(registerErrorMessage('something else'), null);
  });
});

describe('step 1 email (section 2)', () => {
  test('trimmed and lower-cased', () => {
    assert.equal(cleanEmail('  Derek@Gmail.COM '), 'derek@gmail.com');
  });

  test('a basic shape', () => {
    assert.ok(isValidEmail('d@x.co'));
    assert.ok(!isValidEmail('derek'));
    assert.ok(!isValidEmail('derek@gmail'));
    assert.ok(!isValidEmail('de rek@gmail.com'));
  });
});

describe('currentLegalDocs (section 6h)', () => {
  const row = (document: 'terms' | 'privacy', version: string, published_at: string) => ({
    document,
    version,
    url: `https://example.test/${document}/${version}`,
    published_at,
  });
  const now = new Date('2026-11-15T00:00:00Z');

  test('the newest published version of each document', () => {
    assert.deepEqual(
      currentLegalDocs(
        [
          row('terms', 't1', '2026-10-01T00:00:00Z'),
          row('terms', 't2', '2026-11-01T00:00:00Z'),
          row('privacy', 'p1', '2026-10-01T00:00:00Z'),
        ],
        now
      ),
      [
        { document: 'privacy', version: 'p1', url: 'https://example.test/privacy/p1' },
        { document: 'terms', version: 't2', url: 'https://example.test/terms/t2' },
      ]
    );
  });

  test('a version published in the future is not current yet', () => {
    assert.deepEqual(
      currentLegalDocs(
        [row('terms', 't1', '2026-10-01T00:00:00Z'), row('terms', 't2', '2026-12-01T00:00:00Z')],
        now
      ).map((d) => d.version),
      ['t1']
    );
  });

  test('nothing published: nothing to agree to', () => {
    assert.deepEqual(currentLegalDocs([], now), []);
  });
});

describe('birthdays (section 3 and 6g)', () => {
  test('a server date is the same calendar day here', () => {
    const d = isoDayToDate('1990-05-01');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [1990, 4, 1]);
  });

  test('age counts the birthday itself', () => {
    const today = new Date(2026, 9, 10); // 10 October 2026
    assert.equal(ageOn('1990-10-10', today), 36);
    assert.equal(ageOn('1990-10-11', today), 35);
    assert.equal(ageOn('2013-10-10', today), 13);
    assert.equal(ageOn('2000-02-29', new Date(2026, 1, 28)), 25);
    assert.equal(ageOn('2000-02-29', new Date(2026, 2, 1)), 26);
  });
});
