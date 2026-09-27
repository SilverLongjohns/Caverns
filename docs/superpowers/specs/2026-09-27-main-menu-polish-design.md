# Main Menu Polish: Pre-Dungeon Screens on the Relic Kit

**Date:** 2026-09-27
**Branch:** `feature/main-menu-polish` (from `main` at `02ea44b`, which includes the UI revamp phase 1)
**Status:** Design approved, pending spec review

## Intent

Bring every screen before the dungeon onto the relic kit from UI revamp phase 1, so the whole game reads as one salvaged machine. The screens are: connecting, generating, login, character select, character creation, the town hub and its Stash/Store/Character panels, and game over.

Goals chosen by the user:

1. **Visual consistency:** the menus use the same bezels, bronze buttons, sockets and gauges as the dungeon.
2. **Layout and hierarchy:** fix the floaty, under-scaled layouts. Today character select is tiny slot boxes in empty space, the world-code/join/logout controls are scattered, and the create box is cramped.
3. **Feel and motion:** CRT-native motion, specifically
   - console power-on/off between screens;
   - typed headings;
   - button and hover feedback with synthesised sounds;
   - ambient life (lamp blinks, glitch line, scan roll).

Not in scope: new features (settings menu, class previews beyond today's), game logic, server messages, the intro cold open, and in-dungeon layout (apart from the bezel fix below).

**Standing constraints:**
- The menus speak the game's CRT/ASCII language (the cinematic pixel-art intro was rejected).
- Scanlines and flicker stay strong.
- The pixel-art Monolith Bazaar town backdrop (approved in PR #23) stays.

## Approved direction

- **Menus (B), mocked 2026-09-27:** the ASCII cave (`CaveBackground`) stays full-bleed. The logo sits above one centred bezel console, sized to its content.
- **Town hub (T2 with the bezel fix):** the bazaar art is full-bleed, with a world-name header centred at the top.
  - A **Services** console, sized to its content, on the left.
  - A small **Party** console at the top right, with Leave World in its footer.
  - A **Portal** console at the bottom centre, under the monolith gate in the art.
  - Rejected: full-height side consoles (tried and rejected by the user), one central console (T1), and a bottom dock (T3).

## 1. Structure and screen map

### New components (`client/src/components/menu/`)

**`MenuShell`**
- Props: `backdrop: 'cave' | 'town'`, `children`.
- Renders the full-bleed backdrop and a content slot:
  - `cave`: the existing `CaveBackground`, with the logo above the content.
  - `town`: the bazaar art (`/backgrounds/townbg.png`, pixelated cover), with no logo.
- Mounted once in `App.tsx` around all pre-dungeon views, so switching between login, character select and creation never remounts the backdrop.

**`MenuConsole`**
- Props: `title?`, `footer?: ReactNode`, `ambient?: boolean` (default `true`), `className?`, `children`.
- A thin menu wrapper over `RelicPanel`: centred, sized to its content, `max-width: 92vw`, with internal scroll when it's too tall. `max-height` is `calc(100vh - 220px)` on the cave backdrop (the 320px-wide logo is about 150px tall, plus gaps) and `calc(100vh - 48px)` on the town backdrop.
- The footer is separated from the body by a dashed divider.

**`ScreenTransition`**
- Props: `screenKey: string`, `children`.
- When `screenKey` changes, it keeps rendering the previous children while they power off, then powers the new children on.
- Driven by a pure reducer (section 4).

### Screen map

| App view | Backdrop | Console |
|---|---|---|
| `connecting`, `generating` | cave | small status console: typed status text ("Connecting to server…" / "The caverns shift and groan…") plus a blinking block cursor |
| `login` | cave | typed prompt, name field (existing key handling), lit Continue, auth error inside the console; the ↺ intro-replay link stays in the corner |
| `character_select` | cave | three slot cards plus a footer (details in section 3) |
| character create | cave | becomes its own console screen, no longer a modal over select (still driven by the same local state in `CharacterSelect`); Cancel powers back to select |
| `in_world` (town) | town | T2 layout (section 3) |
| Stash / Store / Character panels | town | a centred console over the town, powering on and off; the town consoles stay behind |
| `game_over` | cave | Victory / Wiped console with Return to Overworld |

`in_dungeon` keeps its current layout and doesn't use `MenuShell`.

### Kit fix: bezel slot

The frame art's metal is 17–18px thick, but `RelicPanel` gives it a 24px border. The transparent inner 6px shows whatever is behind the panel. On the bazaar that's a visible red-brown ring; in the dungeon it's hidden against the dark background.

- `relic.css` changes to `border: 18px solid transparent; border-image: url('/ui/relic_frame.png') 18 / 18px round;` with `background-clip: border-box`, so the glass is painted under the frame. The frame's outer corners are fully opaque (verified), so nothing pokes outside the metal.
- `.relic-panel__title` moves to sit on the new 18px rail.
- The arena comment and the unit-panel width compensation in `relic.css` must be re-checked: the bezel now costs 36px instead of 48px, so the arena gains width. The 28×8 duel baseline must be at least maintained.

## 2. Motion and sound

### Power on/off (`ScreenTransition`, CSS keyframes)

- **Off, about 220ms:** the console scales down to `scaleY(0.02)` while brightening into an amber-white line, then collapses to a dot and fades.
- **On, about 280ms:** the reverse, dot to line to full console, with a short brightness overshoot.
- Only the console animates; the backdrop and logo never do.
- A new `screenKey` arriving mid-transition skips straight to powering on the latest screen (no queue).
- Fires `playUi('power')` once per transition.

### Typed text (`TypedText`)

- **Types:** screen titles, "Welcome, name", status lines and the world code, at about 40 characters per second.
- **Status consoles** keep a blinking block cursor after typing finishes.
- **Buttons never type;** they're interactive immediately.
- **Timing:** the pure helper `typedSlice(text, elapsedMs, cps)` decides the visible text.
- **Screen readers:** the element carries the full text in `aria-label`, and the typing span is `aria-hidden`.

### Button and hover feedback

- **`RelicButton`:** a 60ms press flash (face brightens), plus `playUi('click')` on press.
- **Slot cards and town service rows:** the rim lights on hover, with `playUi('tick')`. Hover ticks are throttled to at most one per 80ms.
- **`audioEngine.playUi(name: 'click' | 'tick' | 'power')`:**
  - synthesised with Web Audio (no new audio files), routed through the existing master bus so the music volume slider and mute apply;
  - does nothing if audio isn't unlocked, the context isn't running, or Web Audio is unavailable;
  - never throws.

### Ambient life (`MenuConsole ambient`)

- **Bezel lamps:** slow, out-of-phase opacity blinks on overlay dots placed over the frame's lamp positions.
- **Glitch line:** a faint horizontal line crosses the glass once every 8–15s (randomised per console), taking about 400ms.
- **Scan roll:** a slow, faint band rolls down the glass.
- **CRT layer:** these add to the global CRT layer and must not weaken the scanlines or flicker.

### Reduced motion

Under `prefers-reduced-motion: reduce`:
- the power transition is an instant swap;
- typed text renders fully at once;
- lamp blinks, the glitch line and the scan roll are disabled.

Sounds still play.

## 3. Screen layouts

### Login

- Logo above a small console holding:
  - the typed prompt `> ENTER YOUR USERNAME TO LOG IN_`;
  - the name display with its existing global keydown handling;
  - Continue as a lit `RelicButton`;
  - the auth error in red inside the console.

### Character select

A `Characters` console, with "Welcome, name" typed under its title, and three slot cards of about 170×190.

- **Filled card:**
  - portrait (class portrait from `getClassPortrait`) in a socket;
  - name, then "Lv N · Class";
  - a lit Resume button;
  - a small Delete button, using the existing `onDelete` flow and its `window.confirm` prompt (`CharacterSlotCard.tsx:51`).
- **Empty card:** dashed border, a "+" socket, "Slot N · empty", and Create.
- **Footer:** "World" with the code in teal and Copy; the join-code input and Join; Logout at the right.

### Character creation

A `New Character` console about 720px wide:
- **Left column:** portrait socket and name field.
- **Middle column:**
  - class tabs as `RelicButton`s, with the selected class `hot`;
  - the class description;
  - starting gear as `ItemIcon` rows;
  - abilities.
- **Right column:** "Points: N / 10" and per-stat − / + as small `RelicButton`s.
- **Footer:** Create (lit) and Cancel.
- Validation and create flow are unchanged.

### Town hub (T2)

- **Header:** the world name centred at the top, in amber with a dark text shadow for legibility over the art.
- **Services console** (left, sized to content), one row per service: a socket with portrait or glyph, a name, and a description.
  - Rows: Stash, General Store (shopkeep portrait), your character (class portrait), Bulletin Board.
  - The Bulletin Board is dimmed when it has no notices.
- **Party console** (top right): member rows with class glyph socket, name and "Lv N · Class". Leave World sits in its footer.
- **Portal console** (bottom centre):
  - "⌘ Dripping Halls" in green and the ready count;
  - Ready/Unready (`hot` while you're ready);
  - Enter Dungeon, enabled under the same conditions as today.
- **Existing behaviour kept:** each service row keeps its existing `onInteract` / `onOpenCharacterPanel` handlers and its existing `open_audio.mp3` cue.
- **Removed:** the current full-width card grid.

### Stash, Store and Character panels

- Each is a centred `MenuConsole` over the town with a power on/off transition.
- **Contents:** item rows use `ItemIcon` plus name, stats and small `RelicButton`s, and the Store keeps the shopkeep portrait in a socket.
- **Unchanged:** all actions (deposit, withdraw, buy, sell, reroll, equip, drop, allocate, close) and their existing sound cues (`stash.mp3`, `buy-sell.mp3`).

### Game over

- A cave console with a typed "Victory!" or "Wiped…" title and the existing message.
- Return to Overworld is the lit button.

## 4. Error handling and testing

### Error handling

- **Transition watchdog:** `ScreenTransition` finishes any phase after 600ms even if `animationend` never fires (hidden tab, missing CSS), so the UI can't get stuck on a blank console.
- **Sound:** `playUi` never throws, and every failure path is silent.
- **Typed text:** a change of `text` restarts the typing; unmounting cancels the timer.
- **Missing town art:** if `townbg.png` fails to load, `MenuShell` falls back to the cave backdrop.
- **Portrait sockets:** they fall back to the slot/class glyph when an image fails to load.
- **Errors keep showing:** server errors (auth, join failure) render inside the relevant console, and no existing error display is removed.
- **Action callbacks:** all existing prop signatures on `LoginScreen`, `CharacterSelect`, `WorldView`, `TownView` and the panels stay the same.

### Tests (Vitest, test-first for logic)

- **`typedSlice(text, elapsedMs, cps)`:**
  - 0 and negative elapsed time give `''`;
  - partial progress;
  - completion caps at the full text;
  - the empty string;
  - multi-code-unit characters (`⌘`, `…`, emoji) are never split, because slicing works by code point.
- **Transition reducer `transition(state, event)`:**
  - states: `idle`, `off(from, to)`, `on(key)`;
  - events: `change(key)`, `offDone`, `onDone`, `timeout`;
  - a mid-transition `change` jumps to the latest key;
  - reduced motion goes straight to `idle` with the new key;
  - `timeout` finishes the current phase.
- **`playUi`:** with no context or a suspended context it's a no-op and doesn't throw; the hover throttle is tested with an injected clock.
- **Ambient scheduler `nextGlitchDelay(rand)`:** always within 8000–15000ms, tested with a seeded or stubbed random source.

### Visual and regression checks

- **Playwright screenshots at 1600×1000** (extending `.sandbox/explore-shot.mjs`) of:
  - connecting, login, character select (empty and with one character) and creation;
  - the town and each town panel.
- **Transition check:** after a screen change the outgoing console gets the `--off` class and is then removed, and the new console ends in the idle state.
- **Arena size:** `.sandbox/arena-size.mjs` on duel reports at least `{cols: 28, rows: 8}` after the bezel fix.
- **End-to-end:** the exploration script still reaches the dungeon.

### Done when

- `npm test` passes in every workspace;
- `tsc --noEmit` is clean for `client`;
- the user has reviewed the screenshots.

## Decisions log

- Scope: everything up to the dungeon. Goals: visual consistency, layout/hierarchy, feel/motion. No new features.
- Framing B for menus; T2 (content-sized consoles) for the town. Full-height side consoles were tried and rejected.
- All four motion types, with reduced motion honoured and sounds synthesised through the master bus.
- Approach 1: a persistent `MenuShell` plus a `ScreenTransition` reducer, keeping animation state out of the game store.
- The bezel slot is fixed to 18px in the shared kit, which also affects the dungeon screens.
