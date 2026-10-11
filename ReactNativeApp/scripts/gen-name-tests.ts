// Writes the database test for the name rules from the app's rules and
// examples. Run with `npm run gen:name-tests` after changing
// src/auth/name-rules.ts or src/auth/name-cases.ts.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nameTestsSql } from '../src/auth/name-tests-sql.ts';

const target = fileURLToPath(
  new URL('../supabase/tests/database/name_rules.generated.test.sql', import.meta.url)
);
writeFileSync(target, nameTestsSql());
console.log(`Wrote ${target}`);
