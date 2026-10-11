// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { NAME_CASES } from './name-cases.ts';
import { checkName } from './name-rules.ts';
import { nameTestsSql, sqlText } from './name-tests-sql.ts';

describe('name shapes (the shared examples)', () => {
  for (const c of NAME_CASES) {
    test(`${c.kind}: ${c.label}`, () => {
      const result = checkName(c.raw, c.kind);
      assert.equal(result.ok ? result.name : null, c.saved);
    });
  }
});

describe('what is reported', () => {
  test('length is counted in Unicode characters after NFC', () => {
    const r = checkName('José 👨‍👩‍👧', 'display');
    assert.ok(r.ok);
    assert.equal(r.length, 10); // J o s é, space, then 5 for the family
  });

  test('the refused character is named', () => {
    assert.deepEqual(checkName('Ana​', 'display'), {
      ok: false,
      reason: 'character',
      detail: 'U+200B',
    });
  });

  test('too long and empty are told apart', () => {
    const long = checkName('y'.repeat(16), 'group');
    assert.ok(!long.ok && long.reason === 'too_long');
    const empty = checkName(' ', 'group');
    assert.ok(!empty.ok && empty.reason === 'empty');
  });
});

describe('the database test', () => {
  test('is up to date (run `npm run gen:name-tests`)', () => {
    const file = new URL(
      '../../supabase/tests/database/name_rules.generated.test.sql',
      import.meta.url
    );
    assert.equal(readFileSync(file, 'utf8'), nameTestsSql());
  });

  test('strings are written as Postgres escapes', () => {
    assert.equal(sqlText("O'B\\"), "U&'O''B\\\\'");
    assert.equal(sqlText('é😀'), "U&'\\00e9\\+01f600'");
    assert.equal(sqlText(null), 'null::text');
  });
});
