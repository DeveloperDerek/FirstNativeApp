// The slot machine's sounds: 8-bit placeholders from
// scripts/generate-roll-sounds.py. They follow the ringer switch and play
// over the player's own music rather than stopping it.
import { requireOptionalNativeModule } from 'expo';
import type { AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import { errorMessage } from '@/lib/error-message';

const SOURCES = {
  pull: require('../../assets/sounds/pull.wav'),
  tick: require('../../assets/sounds/tick.wav'),
  stop: require('../../assets/sounds/stop.wav'),
  win: require('../../assets/sounds/win.wav'),
  winBig: require('../../assets/sounds/win-big.wav'),
  coins: require('../../assets/sounds/coins.wav'),
} as const;

export type RollSound = keyof typeof SOURCES;

// Ticks come every 50 ms at full speed, quicker than one player can
// rewind, so they take turns between a few
const TICK_VOICES = 3;

/** Loads the roll's sounds while the screen is open; returns play(name). */
export function useRollSounds(): (name: RollSound) => void {
  const players = useRef<Record<RollSound, AudioPlayer[]> | null>(null);
  const nextTick = useRef(0);

  useEffect(() => {
    // A build made before expo-audio was added has no native module, and
    // loading the package there throws; the roll goes on silently
    if (!requireOptionalNativeModule('ExpoAudio')) {
      if (__DEV__) console.warn('Sound off: this build was made without expo-audio. Rebuild the app to hear the roll.');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio: typeof import('expo-audio') = require('expo-audio');
    audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(warn);
    const made = {} as Record<RollSound, AudioPlayer[]>;
    for (const name of Object.keys(SOURCES) as RollSound[]) {
      made[name] = Array.from({ length: name === 'tick' ? TICK_VOICES : 1 }, () =>
        audio.createAudioPlayer(SOURCES[name])
      );
    }
    players.current = made;
    return () => {
      players.current = null;
      for (const list of Object.values(made)) list.forEach((p) => p.remove());
    };
  }, []);

  return useCallback((name: RollSound) => {
    const list = players.current?.[name];
    if (!list) return;
    const p = list[name === 'tick' ? nextTick.current++ % list.length : 0];
    try {
      p.seekTo(0).catch(warn);
      p.play();
    } catch (e) {
      warn(e);
    }
  }, []);
}

/** A sound never breaks the roll. Dev builds say why one didn't play. */
function warn(e: unknown) {
  if (__DEV__) console.warn('Sound failed:', errorMessage(e));
}
