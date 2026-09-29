# Park Character (switch character mid-run)

**Date:** 2026-09-29
**Status:** Design approved section by section; pending spec review.
**Builds on:** the reconnect fixes of 2026-09-29 (`GameSession.reattachConnection` resends the dungeon state and re-keys the seat, including the running fight). This spec reuses that reattach for resume.

## Intent

A player can step away from a dungeon run with one character, play another, and later come back to the first one exactly where they left it. Today that is impossible:
- a run ends only in victory or a wipe;
- the server tracks one run per account;
- choosing another character mid-run is refused.

### User decisions (2026-09-29)

- **Park the character.** The old character stays in the run as an idle seat and is resumed later from character select. Rejected:
  - abandon-only;
  - retreat that keeps everything for free;
  - keeping the run locked until it ends.
- **No parking in combat.** Parking is allowed only while exploring.
- **Mobs ignore away seats.** A parked character can't be detected and is never pulled into a fight.
- **Explicit park, plus safe disconnects.**
  - A Park button parks you.
  - A plain disconnect or reload outside combat gets the same protection, and reconnecting auto-resumes.
  - A disconnect mid-fight keeps today's behaviour: turns are AFK-skipped, and reattach resumes into the fight.
- **The character select card offers Resume only.** Parked runs don't expire; they last until resumed, until the party finishes, or until a server restart.
- **An escape in exploration, never in combat.** "Leave run" takes the character back to town for a **toll: 25 gold or one item**.

## 1. Model

- **Presence per seat.** `GameSession` replaces `disconnectedConnections` with a presence state per seat:
  - `connected`;
  - `disconnected`: the socket dropped, and reconnecting auto-resumes;
  - `parked`: the player chose to park, and resuming happens from character select.

  "Away" means `parked`, or `disconnected` while the seat is not in a fight.
- **Runs are found by character.** `ActiveSessionMap` changes from account → run to **character → run**.
  - One account can have a character parked in run A while playing another in town, or while parked in run B.
  - Reconnect reattach and resume both look the run up by character ID (`GameSession.findConnectionByCharacter`).
  - The account-based lookup on reconnect becomes: for each of this account's characters that has a run with a `disconnected` seat, reattach. Parked seats are *not* auto-resumed on reconnect.
- **Away seats are invisible to mobs.**
  - `MobAIManager` detection skips away seats.
  - A fight that starts in an away seat's room does not add that seat.
  - A seat that disconnects mid-fight stays in the fight (today's behaviour).
- **No explicit freeze.** A solo run with nobody present can't change: away seats can't be detected, and parking is blocked in combat. Mob patrols may keep ticking, which is harmless.
- **When parking is allowed.** The seat must not be in a fight, must not be downed (so a downed player can't dodge a wipe), and must have no loot prompt open. The server enforces this; disabled buttons in the UI are not relied on.
- **A parked seat gets a placeholder ID.** Every seat is keyed by its connection ID, and after parking that connection is back in town. So on park the seat is re-keyed to `parked:<characterId>`, and nothing the run sends to that seat can reach the town client. Resume re-keys it from the placeholder to the new connection, reusing the reconnect re-keying.
- **Away seats are left out of new loot rounds,** so a parked seat never holds up a need/greed roll.

## 2. Flows

### Park (new client → server `park_run`)
1. **Validate.** The server checks the seat can park (section 1). Otherwise it sends `error` with the reason ("You can't park during a fight." / "Finish the loot roll first.").
2. **Detach.**
   - The seat's presence becomes `parked`, and the seat is re-keyed to `parked:<characterId>`.
   - The world's outbound party entry is updated to the placeholder ID.
   - The connection is removed from `dungeonConnections` and from the instance's `connections`.
   - `ctx.characterId` is cleared.
   - The character **stays `in_use`**, so no other connection can select it as a fresh character.
3. **Tell the client.** The server sends `run_parked`, then the character list for the selected world. The client clears its dungeon state and shows character select.
4. **Tell the party.** Present party members get a log line ("<name> steps back into the shadows.") and a `player_update` carrying `presence: 'parked'`.

### Resume (character select)
- **The card.** A parked character's card reads **"In run: Resume"**, with the subtitle "Parked in <room name>". The character list gains `parkedRun: { roomName: string } | null`.
- **Choosing it** sends the normal `select_character`.
  - The server sees that the character has a run (character → run map) and a `parked` seat.
  - Instead of joining the world, it runs the reconnect reattach: the dungeon state is resent, the seat is re-keyed, and presence becomes `connected`.
  - It also updates the world's outbound party entry (`handle.party[].connectionId`) to the new connection.
- **The `in_use` check.** `select_character` allows an `in_use` character only when the character → run map says it is parked in a run owned by this account.

### Escape (new client → server `leave_run`)
- **Message:** `{ type: 'leave_run', toll: { kind: 'gold' } | { kind: 'item', source: 'inventory' | 'consumables', index: number } | { kind: 'free' } }`. Items are addressed by slot, because two potions share an item ID.
- **Client prompt.**
  - "Pay 25 gold": disabled when gold < 25.
  - "Leave an item": pick from inventory or pouch (consumables). Equipped gear is not eligible.
  - If neither is possible, the prompt says leaving is free and sends `{ kind: 'free' }`.
- **Server.**
  1. **Validate.** The seat must be allowed to park (not in a fight, no loot prompt open). The toll must be payable:
     - **`gold`** requires gold ≥ 25;
     - **`item`** requires a filled slot at that index in inventory or consumables (equipped gear has no slot here, so it can't be chosen);
     - **`free`** is accepted only when neither of the others is payable.

     Otherwise it sends `error`.
  2. **Pay.** Deduct the toll. The gold amount (25) lives in shared config, not in code literals.
  3. **Save and remove.** Snapshot the character to the database and remove the seat from the run. The character stays `in_use`, because it is now active in town on this connection.
  4. **Return.** Return just that player to the world at the portal, using a new per-member `WorldSession.returnMemberFromDungeon(sessionId, characterId, connectionId)`. Today's `returnFromDungeon` handles only the whole party. The client gets the same world messages as after a victory.
  5. **Clean up.**
     - **Solo** (no other seats left): the run ends, the instance is torn down, and the outbound handle is closed.
     - **Party:** the others carry on. Loot rolls, turn orders and the mob AI drop the seat.
  6. **Log.** Present party members get a log line, "<name> slips away through the portal.", and a new `party_member_left { playerId }` message so their client drops the seat.

### Run ends while a seat is parked
- **Victory.** Every seat, parked ones included, is snapshotted and released as today. A parked character later appears in town at the portal.
- **Wipe.** A wipe counts only seats that are in the fight or present. If a parked seat survives, the run stays alive as a frozen run that character can resume. Only when no seats are left alive does the run end as a wipe.

### Disconnect
- **Outside a fight:** presence becomes `disconnected`, away rules apply, and reconnecting auto-resumes (today's reattach).
- **In a fight:** unchanged. Turns are AFK-skipped and reattach resumes into the fight.
- **In both cases** the world party entry's connection ID is updated on reattach. This fixes the bug where a player who reloaded mid-run was not returned to town when the run ended.

### Logout
Logging out while the character's seat is in a run leaves the seat `parked` (it is not released). Today's logout clears `in_use` but leaves the seat in the run, which is inconsistent.

## 3. Client UI

- **`CharacterSlotCard`** shows one of three states:
  - "Resume";
  - "In run: Resume", with the room subtitle;
  - "In use", for a character active on another connection.

  It keeps the existing relic button styling.
- **Exploration action bar** gets two buttons, **Park** and **Leave run**:
  - both are hidden during a fight;
  - both are also not shown while downed or while a loot prompt is up, because the action bar shows the downed or loot bar instead (the server refuses both anyway).

  Park confirms in one step ("Park <name> here? You can resume from character select."). Leave run opens the toll modal, in CRT styling matching `CharacterModal`.
- **Party panel.** Away seats are dimmed with an "away" tag, driven by a new optional `away?: boolean` field on `Player`, which `player_update` already carries.
- **Store.**
  - `run_parked` resets `connectionStatus` to `connected` and clears the dungeon state (rooms, players, combat, positions, explored tiles, game over). The character list that follows puts the view on character select.
  - Escape reuses the existing world-return handling.

## 4. Out of scope

- Keeping parked runs across a server restart. Runs stay in memory; a restart returns characters to town with their last saved state, as today.
- An expiry for parked runs.
- Parking or escaping during a fight.
- Tolls other than 25 gold or one item.
- Showing parked party members' positions differently on the map beyond the dimmed "away" state.

## 5. Testing

- **`GameSession`:**
  - parking is refused in a fight and with a loot prompt open;
  - a parked seat is skipped by mob detection and not added to a fight in its room;
  - resuming a parked seat re-keys it and resends the dungeon state;
  - wipe with a parked survivor: the run stays alive;
  - escape tolls:
    - gold is deducted;
    - the chosen item is removed from inventory or pouch;
    - `free` is accepted only when nothing is payable;
    - equipped items and missing items are rejected;
  - escape from a solo run ends the run; escape from a party run leaves the others running.
- **`ActiveSessionMap`:** per character. One account with two characters in two runs resolves both.
- **`WorldSession`:**
  - `returnMemberFromDungeon` returns only that member, and the handle stays open while other seats remain;
  - the party entry's connection ID is updated on reattach (regression test).
- **`index.ts` flows,** through sandbox Playwright scripts in `.sandbox/`:
  1. Enter a run and park. Create or resume character B, reach town, and open the character panel.
  2. Resume character A from its "In run" card: you land back in the same room.
  3. Leave the run paying gold: gold drops by 25 and you are in town at the portal.
  4. Try to park mid-fight: refused.
  5. Reload outside a fight: auto-resumes.
- **Full suites** green (shared, server, client with `tsc`).

## Review Focus

- **Two tabs on one account:** tab 1 parks A, tab 2 resumes A while tab 1 is on character select. Only one connection may hold the seat, and the reattach must win cleanly.
- **Parking while another party member's fight is in the same room:** the fight is not "your" fight, so parking is allowed, and the seat must not be added to it later.
- **Leaving an item that is also the only healing consumable, or the last item in the pouch:** removal must not break the pouch slots.
- **A party finishes the run while a member is parked:** that member must be released, and must not be stuck `in_use` with no run.
- **Reconnecting after a server restart with a stale session token:** there is no run, so the player should reach character select with no "In run" cards.
