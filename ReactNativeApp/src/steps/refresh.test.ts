// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MyGoal, MyStreak } from '@/api/goals';
import type { MyQuest } from '@/api/quests';
import type { SyncResult } from '@/api/steps';

import { currentAccount, isCurrent, setSignedInAccount, signedInAccount } from '../auth/account-guard.ts';
import { type KeyValueStore, saveDays, stepsKey } from '../storage/step-log.ts';
import { type RefreshDeps, type RefreshView, refreshSteps } from './refresh.ts';

/** A promise the test settles. */
function gate<T>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((res) => (open = res));
  return { promise, open };
}

const answer: SyncResult = {
  earned: 150,
  quests: [{ quest_id: 'q1' } as unknown as MyQuest],
  goal: { goal: 8000 } as unknown as MyGoal,
  streak: { current: 3 } as unknown as MyStreak,
};

/** The guard StepsProvider builds: same account, still signed in, same sharing. */
function contextFor(userId: string, sharing: boolean, sharingNow = { current: sharing }) {
  const mark = currentAccount();
  return {
    userId,
    sharing,
    signal: mark.signal,
    stillCurrent: () =>
      isCurrent(mark) && signedInAccount() === userId && sharingNow.current === sharing,
  };
}

/** Fakes for the phone's parts, recording every call. */
function fakes(sync: (entries: [Date, number][]) => Promise<SyncResult> = async () => answer) {
  const calls: string[] = [];
  const tokens: string[] = [];
  const syncStarted = gate<void>();
  const deps: RefreshDeps = {
    requestPermission: async () => 'granted',
    readDays: async () => [[new Date(), 9000]],
    getToken: async (uid) => (signedInAccount() === uid ? `token-${uid}` : null),
    saveSteps: async (_uid, entries) => {
      calls.push('saveSteps');
      return { day: entries[0][1] };
    },
    syncDay: (entries, auth) => {
      calls.push('syncDay');
      tokens.push(auth.token);
      syncStarted.open();
      return sync(entries);
    },
    syncQuestSteps: async (quests, auth) => {
      calls.push('syncQuestSteps');
      tokens.push(auth.token);
      return quests;
    },
    refreshBalance: async () => {
      calls.push('refreshBalance');
    },
    alert: (title) => {
      calls.push(`alert:${title}`);
    },
  };
  const record =
    (name: string) =>
    (value?: unknown) =>
      calls.push(`${name}:${JSON.stringify(value)}`);
  const view: RefreshView = {
    setLoading: record('setLoading'),
    setError: record('setError'),
    setPermission: record('setPermission'),
    setToday: record('setToday'),
    setLog: record('setLog'),
    setGoal: record('setGoal'),
    setStreak: record('setStreak'),
    setQuests: record('setQuests'),
    setRoll: record('setRoll'),
  };
  return { deps, view, calls, tokens, syncStarted: syncStarted.promise };
}

test('a refresh for the signed-in account sends its token and shows the answer', async () => {
  setSignedInAccount('a');
  const { deps, view, calls, tokens } = fakes();
  await refreshSteps(contextFor('a', true), deps, view);
  assert.deepEqual(tokens, ['token-a', 'token-a']);
  assert.ok(calls.includes('alert:Goal reached!'));
  assert.ok(calls.includes('syncQuestSteps'));
  assert.ok(calls.includes('setRoll:null'), 'a server without the roll: no roll');
  assert.equal(calls.at(-1), 'setLoading:false');
});

test('signing out and into B while A\'s upload is in flight', async () => {
  setSignedInAccount('a');
  const held = gate<SyncResult>();
  const a = fakes(() => held.promise);
  const ctxA = contextFor('a', true);
  const running = refreshSteps(ctxA, a.deps, a.view);
  await a.syncStarted;
  const before = a.calls.length;

  // Sign out, then sign in as B, while A's sync_day has no answer yet
  setSignedInAccount(undefined);
  setSignedInAccount('b');
  assert.equal(ctxA.signal.aborted, true, "A's unanswered requests are cancelled");

  held.open(answer);
  await running;
  // Everything A's refresh sent went as A, and nothing came after the
  // switch: no quest upload, alert, balance, state or error
  assert.deepEqual(a.tokens, ['token-a']);
  assert.deepEqual(a.calls.slice(before), []);

  // B's own refresh runs as B
  const b = fakes();
  await refreshSteps(contextFor('b', true), b.deps, b.view);
  assert.deepEqual(b.tokens, ['token-b', 'token-b']);
});

test('a sign-out during the history save leaves the history removed', async () => {
  setSignedInAccount('a');
  const data = new Map([[stepsKey('a'), '{}']]);
  const read = gate<void>();
  const store: KeyValueStore = {
    getItem: async (key) => {
      await read.promise;
      return data.get(key) ?? null;
    },
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  const { deps, view, calls } = fakes();
  deps.saveSteps = (uid, entries, stillCurrent) => saveDays(store, uid, entries, stillCurrent);
  const running = refreshSteps(contextFor('a', true), deps, view);
  await new Promise((res) => setTimeout(res, 0)); // reached the read

  // Sign-out: the guard first, then the phone's data is removed
  setSignedInAccount(undefined);
  data.delete(stepsKey('a'));
  read.open();
  await running;
  assert.equal(data.has(stepsKey('a')), false);
  assert.ok(!calls.some((c) => c.startsWith('setLog') || c === 'syncDay'));
});

test('sharing turned off mid-refresh: no quest upload and no error', async () => {
  setSignedInAccount('a');
  const sharingNow = { current: true };
  const held = gate<SyncResult>();
  const { deps, view, calls, syncStarted } = fakes(() => held.promise);
  const running = refreshSteps(contextFor('a', true, sharingNow), deps, view);
  await syncStarted;
  sharingNow.current = false;
  held.open({ ...answer, earned: 0 });
  await running;
  assert.ok(!calls.includes('syncQuestSteps'));
  assert.ok(!calls.some((c) => c.startsWith('setError:"')));
});

test('no token for the account (already signed out): nothing is saved or sent', async () => {
  setSignedInAccount('a');
  const { deps, view, calls } = fakes();
  deps.getToken = async () => null;
  await refreshSteps(contextFor('a', true), deps, view);
  assert.ok(!calls.includes('saveSteps'));
  assert.ok(!calls.includes('syncDay'));
});
