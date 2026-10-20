# Sounds

Every sound the app plays, where each one came from, and whether it's
still a placeholder. Update the table whenever you swap a file, so the
licence and credit for each sound stay on record.

Today only the daily roll (`src/app/roll.tsx`) makes noise. The sounds are
loaded by `src/roll/sounds.ts`.

---

## 1. The sounds

Status: **placeholder** (made by `scripts/generate-roll-sounds.py`),
**found** (picked but not yet tried on a phone), or **final**.

| File | Plays when | Feel | Max length | Status | Source | Licence | Credit needed |
|---|---|---|---|---|---|---|---|
| `pull.wav` | The lever is let go far enough down | Clunk + ratchet | 0.3 s | placeholder | generated | ours | no |
| `tick.wav` | Each tile passes the line (up to every 50 ms) | Tiny blip | **0.04 s** | placeholder | generated | ours | no |
| `stop.wav` | The reel lands | Low thunk | 0.25 s | placeholder | generated | ours | no |
| `win.wav` | An item is won (0.12 s after the thunk) | Short rising jingle | 0.8 s | placeholder | generated | ours | no |
| `win-big.wav` | Epic, Legendary or 500 coins won | Fanfare | 1.5 s | placeholder | generated | ours | no |
| `coins.wav` | Coins are won and spray out of the tray | Coin dings | 0.8 s | placeholder | generated | ours | no |

The placeholders' current lengths: pull 0.13 s, tick 0.02 s, stop 0.12 s,
win 0.47 s, win-big 0.98 s, coins 0.54 s.

---

## 2. Swapping one in

1. Trim the silence at the start (the sound should begin the instant the
   haptic does) and any long tail. Audacity: *Effect → Truncate Silence*,
   or select and delete.
2. Make it roughly as loud as the others (Audacity: *Effect → Normalize*
   to about -3 dB). The tick should be quieter than the rest.
3. Save it over the old file with the **same name**. WAV, MP3 and M4A all
   work; if the extension changes, change that line of `SOURCES` in
   `src/roll/sounds.ts` too.
4. Restart Metro with the cache cleared: `npx expo start -c`. No native
   rebuild needed. (A release build does need rebuilding to pick it up.)
5. Try it on a real phone with the ringer **on**. The roll stays silent
   while the phone is on silent, on purpose.
6. Update the row in section 1, and add the sound to section 5 if its
   licence asks for credit.

Once every row is **found** or **final**, delete
`scripts/generate-roll-sounds.py`. Running it again would write the
placeholders back over your sounds.

---

## 3. Adding a new sound

1. Put the file here in `assets/sounds/`.
2. Add it to `SOURCES` in `src/roll/sounds.ts` (for the roll). For a sound
   on another screen, move the hook somewhere shared first.
3. Call `play('name')` at the moment it should sound, next to the haptic
   if there is one.
4. Add a row to section 1.

---

## 4. Where to look

Keep to 8-bit or chiptune sounds so they match the pixel art.

| Where | Licence | Good for |
|---|---|---|
| [jsfxr](https://sfxr.me) | Yours (you make it) | Tick, coin, win. Presets: *Pickup/Coin*, *Blip/Select*, *Powerup* |
| [ChipTone](https://sfbgames.itch.io/chiptone) | Yours (you make it) | Lever clunk, fanfare |
| [Kenney audio](https://kenney.nl/assets/category:Audio) | CC0, no credit | *Casino Audio*, *Interface Sounds*, *Digital Audio* |
| [OpenGameArt](https://opengameart.org) | Varies per file | Search "8-bit", "chiptune", "coin", "slot" |
| [itch.io sound effects](https://itch.io/game-assets/tag-sound-effects) | Varies per pack | Cheap chiptune packs |
| [Freesound](https://freesound.org) | Varies per file | Filter to CC0 to skip credits |
| [Pixabay sound effects](https://pixabay.com/sound-effects/) | Pixabay licence | Free, commercial use OK |

Licence rules of thumb:
- **CC0**: use it, no credit needed.
- **CC-BY**: fine, but it **must** go in section 5 and in the app's credits.
- **CC-BY-NC** (non-commercial): avoid it if the app might ever earn money.
- Never use sounds ripped from real slot machines or other games.

Ideas and candidates (write down links before you forget them):

- 

---

## 5. Credits

Every sound whose licence asks for attribution. These must also appear in
the app before release.

| File | Title | Author | Link | Licence |
|---|---|---|---|---|
| | | | | |
