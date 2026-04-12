# Overworld Phase 6 — Stash NPC & Stash UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Standing on the stash interactable tile in town opens a stash UI that lets the player move items between their character's inventory and a per-character stash. This is the first and only town interaction in v1.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Depends on:** Phase 5 (`docs/superpowers/plans/2026-04-12-overworld-phase-5-dungeons.md`) — characters can actually walk around in a world, and the legacy lobby flow is gone. Also depends on Phase 3 which authored the stash interactable in the starter map.

**Ships alone.** Small phase, unrelated churn in the same PR will drown the review.

---

## Audit finding (from plan prep)

At the time this plan was written, `client/src/` has **no stash UI code**. Only the `account_stash` DB table exists, untouched since it was added in the account-persistence plan. That means Phase 6 is NOT "wire a stash NPC to an existing UI" — it's "build the stash UI from scratch + wire it to the NPC."

This expands Phase 6 from small to medium. Reflected in the task list below.

---

## Decisions locked in this phase

1. **Stash ownership: per-character, not per-account, not per-world.** V1 choice. Rationale: characters are the gameplay unit, they're world-bound, and per-character is the simplest model that doesn't leak items between characters that were never meant to share. A shared world-stash is more flavorful but introduces "who owns what" questions (when a character is deleted, when a member leaves a world, when items are contested between characters) that we don't want to answer right now. Per-character sidesteps all of it.
2. **The existing `account_stash` table is dropped and replaced.** A new `character_stash` table mirrors its shape but keys on `character_id`. Migrating the existing table's contents isn't worth it — it's smoke-test data and the feature was never wired up.
3. **Stash capacity: fixed 20 slots.** Arbitrary. Expandable later via a column or a gameplay unlock. Not configurable per-character in v1.
4. **Interaction trigger: standing on the tile + press E, or click the interactable.** Two input paths, both fire the same `overworld_interact` message. If only one ends up implemented in Phase 6, press-E is the priority — click-to-interact is a nice-to-have.
5. **Modal, not a separate view.** The stash UI is a modal overlay on top of `WorldView`. It doesn't change `currentView`; the player is still `in_world` and their character can still be walked on by others. Closing the modal returns focus to the map. This is simpler than adding an `in_stash` state and matches the "modal UI over persistent world" pattern.
6. **Two-panel layout.** Left panel: character inventory + consumables pouch. Right panel: stash. Click an item to transfer it across. No drag-and-drop in v1.
7. **Transfers are server-authoritative.** Client sends a transfer message (`stash_deposit`, `stash_withdraw`); server validates the slot/item, mutates both the character row and the stash row in a single transaction, and broadcasts a `stash_updated` back to the requester. No optimistic client state.
8. **Consumables + inventory + equipment: inventory and consumables are transferable; equipment is NOT.** You can't stash a worn weapon directly — unequip first. This avoids the "stash locked my only weapon" footgun.
9. **No stash access from inside a dungeon.** The interactable only exists on the overworld map. Dungeons have their own rules.
10. **Multiple characters of the same account have separate stashes.** Flavor-flag later if it feels wrong; for v1, no cross-character sharing.

---

## File structure

### New files

**Server:**
- `server/src/db/migrations/1744300000_character_stash.sql` — drop `account_stash`, create `character_stash`
- `server/src/StashRepository.ts` — get/set/transfer operations
- `server/src/StashRepository.test.ts`

**Client:**
- `client/src/components/StashModal.tsx` — two-panel stash UI

### Modified files

**Shared:**
- `shared/src/messages.ts` — new messages: `overworld_interact`, `stash_opened`, `stash_updated`, `stash_deposit`, `stash_withdraw`, `stash_close`

**Server:**
- `server/src/db/types.ts` — remove `AccountStashTable`, add `CharacterStashTable`; register the new table
- `server/src/WorldSession.ts` — handle `interact`-style requests: given a connection and the interactable they're standing on, validate proximity and route to the right handler. Keep the stash-specific logic in `index.ts` rather than burdening `WorldSession` with inventory mutations.
- `server/src/index.ts` — new message handlers for stash ops; reads/writes through `StashRepository` and `CharacterRepository`

**Client:**
- `client/src/store/gameStore.ts` — stash modal state (`openStash: { items, capacity } | null`), handlers for `stash_opened` / `stash_updated`
- `client/src/hooks/useGameActions.ts` — `interactOverworld()`, `stashDeposit(kind, fromIdx)`, `stashWithdraw(stashIdx, toKind, toIdx?)`, `stashClose()`
- `client/src/components/WorldMapView.tsx` — press-E key listener when standing on an interactable; click listener on interactable tiles
- `client/src/components/WorldView.tsx` — render `<StashModal>` when `openStash` is non-null
- `client/src/styles/index.css` — modal styling matching the existing PlayerHUD inventory look

### Files NOT touched in Phase 6

- `server/src/GameSession.ts` — dungeons don't touch stash
- `server/src/PlayerManager.ts` — inventory mutation stays where it already lives
- `client/src/components/PlayerHUD.tsx` — no changes; the stash modal is a separate surface

---

## Task list

### Task 1: Schema migration

**Files:**
- Create: `server/src/db/migrations/1744300000_character_stash.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- Up Migration

DROP TABLE IF EXISTS account_stash;

CREATE TABLE character_stash (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  items        jsonb NOT NULL DEFAULT '[]',
  gold         int   NOT NULL DEFAULT 0,
  capacity     int   NOT NULL DEFAULT 20
);
```

- [ ] **Step 2: Write the down migration**

```sql
-- Down Migration
DROP TABLE IF EXISTS character_stash;

CREATE TABLE account_stash (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]',
  gold       int   NOT NULL DEFAULT 0
);
```

- [ ] **Step 3: Run locally**

```
npm run migrate -w server
```

Verify via `\d character_stash`.

### Task 2: Kysely types

**Files:**
- Modify: `server/src/db/types.ts`

- [ ] **Step 1: Remove `AccountStashTable`**

Delete the interface and its `account_stash` entry in `Database`.

- [ ] **Step 2: Add `CharacterStashTable`**

```ts
export interface CharacterStashTable {
  character_id: string;
  items: (Item | null)[];
  gold: number;
  capacity: number;
}
```

Register in `Database`:

```ts
character_stash: CharacterStashTable;
```

### Task 3: `StashRepository`

**Files:**
- Create: `server/src/StashRepository.ts`
- Create: `server/src/StashRepository.test.ts`

- [ ] **Step 1: Repository shape**

```ts
export class StashRepository {
  constructor(private db: Kysely<Database>) {}

  async ensure(characterId: string): Promise<CharacterStashTable>;
  async get(characterId: string): Promise<CharacterStashTable>;
  async setItems(characterId: string, items: (Item | null)[]): Promise<void>;
}
```

`ensure` inserts an empty row on first access using `ON CONFLICT DO NOTHING`, then selects. Called lazily on first stash open.

`setItems` writes the entire items array in a single update (not per-slot). Stash mutations happen entirely in-memory in `index.ts`, then persisted in one write.

- [ ] **Step 2: Tests**

- `ensure` on a new character creates a row with 20 null slots
- `ensure` on an existing character is a no-op
- `setItems` round-trips correctly (read returns what was written)
- `setItems` with more items than `capacity` throws (or truncates — pick one, test, document)

### Task 4: Shared message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Client messages**

```ts
| { type: 'overworld_interact'; interactableId: string }
| { type: 'stash_deposit'; from: 'inventory' | 'consumables'; fromIndex: number }
| { type: 'stash_withdraw'; stashIndex: number; to: 'inventory' | 'consumables' }
| { type: 'stash_close' }
```

- [ ] **Step 2: Server messages**

```ts
| {
    type: 'stash_opened';
    stash: { items: (Item | null)[]; capacity: number };
  }
| {
    type: 'stash_updated';
    stash: { items: (Item | null)[]; capacity: number };
    // Optional: player's new inventory/consumables so the HUD refreshes.
    // If the existing player_update flow already covers this, omit.
  }
```

Check whether `player_update` already carries inventory/consumables. If yes, a deposit/withdraw can simply emit one `stash_updated` (stash side) plus one `player_update` (character side). Don't duplicate.

### Task 5: Server routing

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: `overworld_interact` handler**

```ts
case 'overworld_interact': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const result = session.getInteractableAtMember(playerId, msg.interactableId);
  if (!result) { sendTo(playerId, { type: 'error', message: 'Nothing to interact with here.' }); break; }

  if (result.kind === 'stash') {
    const ctx = connectionAccounts.get(playerId);
    if (!ctx?.characterId || !stashRepo) break;
    await stashRepo.ensure(ctx.characterId);
    const stash = await stashRepo.get(ctx.characterId);
    sendTo(playerId, { type: 'stash_opened', stash: { items: stash.items, capacity: stash.capacity } });
  }
  break;
}
```

`WorldSession.getInteractableAtMember` is a small helper added in Task 8 that validates (a) the member exists, (b) they're standing on the named interactable, and (c) returns the interactable's kind + label.

- [ ] **Step 2: `stash_deposit` handler**

```ts
case 'stash_deposit': {
  const ctx = connectionAccounts.get(playerId);
  if (!ctx?.characterId || !characterRepo || !stashRepo) break;

  const ch = await characterRepo.getById(ctx.characterId);
  if (!ch) break;

  // Validate source slot
  const sourceArray = msg.from === 'inventory' ? ch.inventory : ch.consumables;
  const item = sourceArray[msg.fromIndex];
  if (!item) { sendTo(playerId, { type: 'error', message: 'No item in that slot.' }); break; }

  // Find a free stash slot
  const stash = await stashRepo.get(ctx.characterId);
  const freeIdx = stash.items.findIndex(s => s === null);
  if (freeIdx < 0) { sendTo(playerId, { type: 'error', message: 'Stash is full.' }); break; }

  // Mutate
  stash.items[freeIdx] = item;
  sourceArray[msg.fromIndex] = null;

  // Persist both sides
  await stashRepo.setItems(ctx.characterId, stash.items);
  // Update the character row — reuse existing snapshot helpers for inventory/consumables
  await characterRepo.snapshotInventory(ctx.characterId, ch.inventory, ch.consumables);

  // If the character is currently hydrated inside a GameSession or WorldSession-held
  // Player, also update that in-memory copy. For v1 this is simplified: stash interactions
  // only happen while the character is in WorldSession (decision 9), and WorldSession does
  // not hold Player state (inventory lives in the DB row until dungeon entry hydrates it).
  // So the DB write is sufficient.

  sendTo(playerId, { type: 'stash_updated', stash: { items: stash.items, capacity: stash.capacity } });
  // Refresh character-side state on the client via the existing player_update channel
  // if available; otherwise send a targeted character update message.
  break;
}
```

The "inventory/consumables lives in the DB row when the character is not in a dungeon" assumption is the key simplification. Confirm it by tracing `CharacterRepository.snapshot` / the current hydration flow. If it's wrong — e.g., if `WorldSession` or the new overworld pipeline holds a live in-memory `Player` while the character is in the world — then stash ops need to mutate that in-memory copy too, and this task grows.

- [ ] **Step 3: `stash_withdraw` handler**

Mirror of deposit: validate the stash slot, find a free destination slot in the target inventory/consumables array, move, persist, respond.

Errors to handle:
- No item in the requested stash slot
- Destination inventory/consumables full
- Trying to withdraw to the wrong array type (e.g., a potion into `inventory` instead of `consumables`) — for v1, let the client decide which array is the target; server doesn't second-guess item types. This avoids a typing rabbit hole.

- [ ] **Step 4: `stash_close` handler**

No-op on the server — closing is purely a client-side UI event. The server never needs to know. Omit the message entirely unless a reason appears.

**Decision:** omit `stash_close` from Task 4 Step 1 as well. Saves a round-trip. The client just clears `openStash` locally.

- [ ] **Step 5: `snapshotInventory` helper on `CharacterRepository`**

Similar to `snapshotOverworldPos` — a small targeted update that writes only inventory + consumables jsonb, avoiding the full `snapshot` helper.

```ts
async snapshotInventory(id: string, inventory: (Item | null)[], consumables: (Item | null)[]): Promise<void> {
  await this.db.updateTable('characters')
    .set({
      inventory: JSON.stringify(inventory) as never,
      consumables: JSON.stringify(consumables) as never,
      last_played_at: new Date(),
    })
    .where('id', '=', id)
    .execute();
}
```

### Task 6: `WorldSession.getInteractableAtMember`

**Files:**
- Modify: `server/src/WorldSession.ts`

- [ ] **Step 1: Helper**

```ts
getInteractableAtMember(connectionId: string, interactableId: string): OverworldInteractable | null {
  const member = this.members.get(connectionId);
  if (!member) return null;
  const it = this.map.interactables.find(i => i.id === interactableId);
  if (!it) return null;
  if (it.x !== member.pos.x || it.y !== member.pos.y) return null;
  return it;
}
```

Server enforces "must be standing on the tile" — never trusting the client's claim about proximity.

### Task 7: Client store

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Stash modal state**

```ts
openStash: { items: (Item | null)[]; capacity: number } | null;
```

Null when closed.

- [ ] **Step 2: Handlers**

- `stash_opened`: set `openStash`
- `stash_updated`: update `openStash` if non-null
- Client-only `closeStash()` action: set `openStash` to null

- [ ] **Step 3: Clear on dungeon entry**

`dungeon_entered` handler sets `openStash = null` so the modal doesn't linger across the transition. Belt-and-braces — it shouldn't be open during dungeon entry anyway, but disconnect races are cheap to defend against.

### Task 8: Client actions

**Files:**
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Senders**

```ts
interactOverworld: (interactableId: string) => send({ type: 'overworld_interact', interactableId }),
stashDeposit: (from: 'inventory' | 'consumables', fromIndex: number) =>
  send({ type: 'stash_deposit', from, fromIndex }),
stashWithdraw: (stashIndex: number, to: 'inventory' | 'consumables') =>
  send({ type: 'stash_withdraw', stashIndex, to }),
closeStash: () => useGameStore.setState({ openStash: null }),
```

### Task 9: Press-E + click triggers

**Files:**
- Modify: `client/src/components/WorldMapView.tsx`

- [ ] **Step 1: Self-interactable detection**

Compute, whenever the player's position changes: is `self.pos` on any map interactable?

```tsx
const selfInteractable = useMemo(() => {
  if (!worldMap || !self) return null;
  return worldMap.interactables.find(i => i.x === self.pos.x && i.y === self.pos.y) ?? null;
}, [worldMap, self]);
```

- [ ] **Step 2: Press-E listener**

```tsx
useEffect(() => {
  if (!selfInteractable) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'e' || e.key === 'E') {
      actions.interactOverworld(selfInteractable.id);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [selfInteractable]);
```

Scoped effect — only active while standing on an interactable. Clean up on walk-away.

- [ ] **Step 3: Click on interactable tile**

In the existing tile click handler from Phase 4, add a check: if the clicked tile is an interactable AND the player is already standing on it, fire `interactOverworld(id)` instead of routing a move. If they're not standing on it, treat it as a normal walk destination (the pathfinder routes them to it; once they arrive, they can press E).

- [ ] **Step 4: Visual prompt**

When `selfInteractable` is non-null, render a small "[E] Use Stash" prompt near the map or over the interactable tile. Minimal styling — this is informational, not decorative.

### Task 10: `StashModal` component

**Files:**
- Create: `client/src/components/StashModal.tsx`
- Modify: `client/src/components/WorldView.tsx` to render it
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Layout**

```tsx
export function StashModal({
  openStash,
  inventory,
  consumables,
  onDeposit,
  onWithdraw,
  onClose,
}: StashModalProps) {
  if (!openStash) return null;
  return (
    <div className="modal-overlay">
      <div className="stash-modal">
        <h2>Stash</h2>
        <div className="stash-panels">
          <div className="stash-panel">
            <h3>Character</h3>
            <div className="stash-section">
              <h4>Inventory</h4>
              {inventory.map((item, i) =>
                item ? (
                  <button key={i} className="stash-item" onClick={() => onDeposit('inventory', i)}>
                    {item.name}
                  </button>
                ) : (
                  <div key={i} className="stash-slot empty">—</div>
                )
              )}
            </div>
            <div className="stash-section">
              <h4>Consumables</h4>
              {consumables.map((item, i) =>
                item ? (
                  <button key={i} className="stash-item" onClick={() => onDeposit('consumables', i)}>
                    {item.name}
                  </button>
                ) : (
                  <div key={i} className="stash-slot empty">—</div>
                )
              )}
            </div>
          </div>
          <div className="stash-panel">
            <h3>Stash ({openStash.items.filter(Boolean).length} / {openStash.capacity})</h3>
            {openStash.items.map((item, i) =>
              item ? (
                <button key={i} className="stash-item" onClick={() => onWithdraw(i)}>
                  {item.name}
                </button>
              ) : (
                <div key={i} className="stash-slot empty">—</div>
              )
            )}
          </div>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
```

`onWithdraw` needs to know whether to put the item back into inventory or consumables. Two options:

- (a) The withdraw button is split into two ("→ Inventory" / "→ Consumables") — ugly but explicit.
- (b) The client guesses based on item.kind ("potion" → consumables, else → inventory) — clean but forks on a type field.

**Pick (b).** Add a helper `inferStashTarget(item: Item): 'inventory' | 'consumables'` in the component. Document the inference rule in a comment.

- [ ] **Step 2: Render from `WorldView`**

In `WorldView.tsx`:

```tsx
const openStash = useGameStore(s => s.openStash);
const myInventory = /* derived from active character */;
const myConsumables = /* ditto */;

<StashModal
  openStash={openStash}
  inventory={myInventory}
  consumables={myConsumables}
  onDeposit={actions.stashDeposit}
  onWithdraw={(stashIdx) => {
    const item = openStash!.items[stashIdx];
    if (!item) return;
    const target = inferStashTarget(item);
    actions.stashWithdraw(stashIdx, target);
  }}
  onClose={actions.closeStash}
/>
```

Where does `myInventory` come from? If the store already holds the character's inventory (from `player_update` in the dungeon flow), reuse it. If not — because the character is in the overworld and no Player hydration happened yet — the client needs the inventory to come across in a different channel. Confirm during implementation: check `gameStore.ts` for an existing "my character items" field that's populated in world state.

If there's no such field, add one: `activeCharacterItems: { inventory: (Item | null)[]; consumables: (Item | null)[] } | null`, populated during `world_state` (server needs to include them in the world_state payload) and refreshed on `stash_updated`.

- [ ] **Step 3: Styling**

Modal overlay darkens the map. Two columns side by side, each with a grid of item slots. Use the existing `.inventory-slot` / `.item-button` styling from `PlayerHUD.tsx` as a base to stay visually consistent.

### Task 11: Smoke test

- [ ] **Step 1: First-time stash use**

1. Create character → walk into town → walk onto stash tile → press E.
2. Expect: modal opens. Right panel is empty (20 empty slots). Left panel shows starter gear and starter potions.
3. Click "Starter Potion" (inventory side → consumables — wait, actually the potion lives in consumables already).
4. Click a potion in the consumables section. Expect: it moves to the stash. Both sides update.
5. Click the potion in the stash. Expect: it returns to consumables.
6. Close the modal. Walk around. Walk back onto the stash tile. Press E.
7. Expect: the stash remembers previous contents.

- [ ] **Step 2: Full stash, full inventory**

1. Deposit items until inventory is empty. Expect: stash fills; no errors.
2. Fill the stash to 20/20. Attempt to deposit a 21st item. Expect: error toast, nothing moves.
3. With a full inventory, try to withdraw. Expect: error toast, nothing moves.

- [ ] **Step 3: Persistence across sessions**

1. Deposit a unique item. Log out. Log back in. Select the same character. Walk to stash. Press E.
2. Expect: the deposited item is still there.

- [ ] **Step 4: Per-character isolation**

1. On the same account, create a second character in the same world. Visit the stash with character 2.
2. Expect: empty stash. Items from character 1 are not visible.

- [ ] **Step 5: Dungeon doesn't break it**

1. Deposit a unique item. Enter a dungeon. Finish or wipe. Return to the overworld.
2. Walk back to the stash. Press E.
3. Expect: the deposited item is still there. Dungeon loot has been added to character inventory (existing path), not the stash.

- [ ] **Step 6: Click vs. E**

1. Click the stash tile while standing on it. Expect: modal opens (if Task 9 Step 3 was done).
2. Click the stash tile while standing far away. Expect: character walks there. On arrival, press E or click again to open.

---

## Known rough edges to leave alone

- **No sorting, no search, no stack counts, no tooltips.** Items are just name-labeled buttons. Dungeon-inventory-level polish can come later.
- **Gold is not transferable via stash.** The `character_stash` row has a `gold` column but Phase 6 doesn't expose it. Depositing/withdrawing gold is a future feature.
- **No multi-select, no "deposit all."** One item at a time.
- **Single stash capacity of 20 across all characters.** No upgrades.
- **Stash UI is modal, blocks map interaction.** Can't see other members moving while the modal is open. Acceptable.
- **No audio, no animation.** Items teleport between panels on click. Fine.

---

## Open questions to resolve during implementation

1. **Does the overworld client already hold the active character's items?** The stash UI needs them on the left panel. Check `gameStore.ts` at Task 10 Step 2. If not, extend `world_state` to include them, and refresh on `stash_updated` and `player_update`.
2. **Equipment stashing.** Decision 8 says equipped items can't be stashed directly. Does the current inventory UI even let you *see* equipment separately from inventory? If yes, the stash just ignores equipped items (they're in a separate slot list). If no, audit. Phase 6 should not introduce an unequip flow.
3. **Stash-full vs inventory-full error feedback.** The current client has a general error-toast channel; use that. If it doesn't exist, inline error text in the modal is fine.
4. **Item-kind inference for withdraw target.** Decision is Task 10 Step 1 option (b). If the item type system doesn't cleanly distinguish potions from other consumables, fall back to option (a) (split buttons).

---

## Done when

- All tasks checked off.
- `npm run test -w server` passes, including `StashRepository` tests.
- `npm run build` in all workspaces is clean.
- Task 11 smoke test scenarios all pass.
- Deposited items survive logout → login → re-select character → re-open stash.
- Two characters in the same world on the same account have isolated stashes.
- Dungeon entry and exit do not affect stash contents.
- Standing on the stash tile shows a "[E] Use Stash" prompt; walking away removes it.
