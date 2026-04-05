# Generative Dungeon Design Spec

## Goal

Replace the static hand-authored dungeon with a Claude API-generated dungeon at game start. One API call produces a complete `DungeonContent` JSON object — rooms, mobs, items, theme, and layout — giving every run a unique dungeon. The static Dripping Halls content serves as a fallback if generation fails.

---

## Generation Flow

When the host clicks "Start Game":

1. **Client** sends `start_game` with the host's API key and selected difficulty (`easy | medium | hard`).
2. **Server** broadcasts a `generation_status` message with status `generating` — clients show a loading screen.
3. **Server** calls Claude API with a structured prompt containing the `DungeonContent` schema and difficulty constraints.
4. **Server** parses the response as JSON and validates it against the schema and game rules.
   - **Validation pass**: Wire up the dungeon and proceed to game start.
   - **Validation fail (first attempt)**: Retry once, appending the validation errors to the prompt.
   - **Total failure** (API error, timeout, both validation attempts fail): Fall back to `DRIPPING_HALLS`.
5. On fallback, server broadcasts `generation_status` with status `failed` and a reason string. Clients display a failure message before transitioning.
6. **Server** broadcasts `game_start` as usual — clients tear down loading screen and enter the game.
7. On fallback, the server also sends a `text_log` entry: *"Dungeon generation failed — playing The Dripping Halls instead."*

The API key is held in server memory for the duration of the session only. It is never persisted, logged, or broadcast to other clients.

---

## Lobby Changes

Two new inputs in the lobby, visible/editable by the host only:

### API Key Field
- Password-type text input.
- Only visible to the host.
- Never broadcast in `lobby_state`.
- Sent in the `start_game` message only.

### Difficulty Selector
- Three options: Easy / Medium / Hard. Default: Medium.
- Host controls the selection; all players can see the current choice.
- Included in `lobby_state` so non-host players see the selected difficulty.
- Sent in the `start_game` message.

### Message Protocol Changes

`start_game` (Client -> Server) gains two optional fields:
```typescript
{
  type: 'start_game';
  apiKey?: string;    // Anthropic API key, host only
  difficulty?: 'easy' | 'medium' | 'hard';  // default: 'medium'
}
```

`lobby_state` (Server -> Client) gains:
```typescript
{
  type: 'lobby_state';
  players: { id: string; name: string }[];
  hostId: string;
  difficulty: 'easy' | 'medium' | 'hard';  // current selection
}
```

New message `set_difficulty` (Client -> Server):
```typescript
{
  type: 'set_difficulty';
  difficulty: 'easy' | 'medium' | 'hard';
}
```
Only accepted from the host. Server updates the lobby difficulty and re-broadcasts `lobby_state`.

New message `generation_status` (Server -> Client):
```typescript
{
  type: 'generation_status';
  status: 'generating' | 'failed';
  reason?: string;  // only present when status is 'failed'
}
```

---

## Difficulty Constraints

Hard constraints passed to Claude in the prompt, per difficulty tier:

| Constraint | Easy | Medium | Hard |
|---|---|---|---|
| Room count | 6-8 | 9-12 | 12-16 |
| 1-skull mobs | 2-3 | 3-4 | 3-5 |
| 2-skull mobs | 0-1 | 1-2 | 2-3 |
| Boss HP | 100-150 | 150-250 | 250-400 |
| Boss damage | 15-20 | 20-30 | 28-40 |
| Boss defense | 4-6 | 6-10 | 9-14 |
| Consumable drops | 4-6 | 3-5 | 2-4 |
| Equipment drops | 4-6 | 5-8 | 6-10 |
| 1-skull mob HP | 15-25 | 20-35 | 30-50 |
| 1-skull mob damage | 6-10 | 8-12 | 10-16 |
| 2-skull mob HP | 40-60 | 50-80 | 70-110 |
| 2-skull mob damage | 10-16 | 14-22 | 18-28 |

Item stats are unconstrained — loot should be generous. A good run should feel like a power fantasy.

---

## Prompt Design

### System Prompt Structure

1. **Role**: "You are a dungeon designer for a cooperative dungeon crawler."
2. **Output format**: "Return ONLY valid JSON matching this TypeScript interface:" — followed by the `DungeonContent` type definition (Room, MobTemplate, Item, and all supporting types).
3. **Difficulty constraints**: The stat/count table for the selected difficulty tier.
4. **Design rules**:
   - Exactly one boss room with type `'boss'`
   - All rooms reachable from the entrance room (no orphans)
   - Room exits must be bidirectional (if room A exits north to B, room B must exit south to A)
   - Each `mobId` in room encounters must reference an entry in the `mobs` array
   - Each `itemId` in room loot and mob `lootTable` must reference an entry in the `items` array
   - `bossId` must match the boss mob's ID
   - `entranceRoomId` must match the entrance room's ID
   - Entrance room must have no encounter
   - All IDs (rooms, mobs, items) must be unique snake_case strings
5. **Creative freedom**: Theme, naming, descriptions, room connectivity, item design, and flavor are entirely up to Claude.

### User Message

```
Generate a <difficulty> dungeon.
```

### Retry Message

```
Your previous response had these errors: <validation error list>. Fix them and return the complete corrected JSON.
```

---

## Validation

After parsing Claude's JSON response, the server runs these checks in order:

### 1. Schema Validation
- All required fields present with correct types.
- `rooms`, `mobs`, `items` are non-empty arrays.
- All rooms have `id`, `type`, `name`, `description`, `exits`.
- All mobs have `id`, `name`, `description`, `skullRating`, `maxHp`, `damage`, `defense`, `initiative`, `lootTable`.
- All items have `id`, `name`, `description`, `rarity`, `slot`, `stats`.
- `entranceRoomId`, `bossId`, `name`, `theme`, `atmosphere` are non-empty strings.

### 2. Referential Integrity
- `entranceRoomId` points to an existing room.
- `bossId` points to an existing mob.
- Every `mobId` in room encounters exists in the mobs array.
- Every `itemId` in room loot exists in the items array.
- Every `itemId` in mob loot tables exists in the items array.

### 3. Graph Connectivity
- All room exits are bidirectional.
- All rooms are reachable from the entrance (BFS/DFS traversal).

### 4. Constraint Checks
- Entrance room has no encounter.
- Exactly one room with type `'boss'` exists.
- Room count falls within the difficulty range.
- All IDs are unique within their category (room IDs, mob IDs, item IDs).

If validation fails, the full list of errors is collected and used in the retry prompt. On second failure, the server falls back to `DRIPPING_HALLS`.

---

## Loading Screen

### Generating State
- Replaces the lobby view.
- Centered pulsing text: *"The caverns shift and groan..."*
- Simple animated ellipsis or CSS spinner below the text.
- No progress bar (generation time is unpredictable).

### Failed State
- Loading text changes to: *"The darkness resists... falling back to The Dripping Halls"*
- Displayed for ~2 seconds before `game_start` fires and the game begins.

### Transition
- On `game_start`, loading screen tears down and the game UI appears as normal.

---

## ASCII Art

Generated mobs do not receive ASCII art. The `MOB_ASCII_ART` record in `content.ts` is only used for mobs whose template ID matches a known key (the four existing mobs). The combat UI gracefully handles missing ASCII art by simply not rendering the art block.

---

## Fallback Behavior

The static `DRIPPING_HALLS` dungeon in `content.ts` is used when:
- The host does not provide an API key (start game without key = play static dungeon).
- The Claude API call fails (network error, timeout, auth error).
- Both validation attempts fail.

In all fallback cases:
1. `generation_status` with `status: 'failed'` and a `reason` is sent to all clients.
2. The loading screen shows a failure message for ~2 seconds.
3. The game starts with `DRIPPING_HALLS`.
4. A `text_log` entry with type `'system'` is sent: *"Dungeon generation failed — playing The Dripping Halls instead."*

If no API key is provided, skip the loading screen entirely and start with `DRIPPING_HALLS` immediately (no failure message needed — the host chose not to use generation).

---

## Scope Boundaries

### In Scope
- Single Claude API call to generate `DungeonContent` JSON
- Difficulty selection (easy/medium/hard) with constraint tables
- API key input in lobby (host only)
- Loading screen during generation
- Validation with one retry
- Fallback to static dungeon on failure
- New `generation_status` message type

### Out of Scope
- ASCII art generation for mobs
- Item stat balancing/constraints
- Streaming the generation response
- Caching or saving generated dungeons
- Multiple API providers
- API key persistence across sessions
- Progressive/on-the-fly room generation
