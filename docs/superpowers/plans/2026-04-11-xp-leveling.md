# XP & Leveling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add party-wide XP, leveling, and point-buy stat allocation with obfuscated stat names.

**Architecture:** New `progressionConfig.json` drives all tuning. `Player` type gains XP/level/allocation fields. `computePlayerStats` layers allocations on top of base+equipment. `PlayerManager` handles XP award and level-up detection. `GameSession.finishCombat` triggers XP distribution. Client gets an XP bar, stat allocation panel, and level-up glow animation.

**Tech Stack:** TypeScript, Vitest, React/Zustand, CSS keyframes

---

### Task 1: Progression Config & Types

**Files:**
- Create: `shared/src/data/progressionConfig.json`
- Create: `shared/src/data/progression.ts`
- Modify: `shared/src/data/configTypes.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create the progression config JSON**

```json
// shared/src/data/progressionConfig.json
{
  "xpPerSkull": {
    "1": 10,
    "2": 25,
    "3": 50
  },
  "levelThresholds": [0, 30, 75, 140, 230, 350],
  "statPointsPerLevel": 2,
  "statDefinitions": [
    { "id": "vitality", "displayName": "Vitality", "internalStat": "maxHp", "perPoint": 5 },
    { "id": "ferocity", "displayName": "Ferocity", "internalStat": "damage", "perPoint": 1 },
    { "id": "toughness", "displayName": "Toughness", "internalStat": "defense", "perPoint": 1 },
    { "id": "speed", "displayName": "Speed", "internalStat": "initiative", "perPoint": 1 },
    { "id": "tactics", "displayName": "Tactics", "internalStat": "maxEnergy", "perPoint": 5 }
  ]
}
```

- [ ] **Step 2: Add ProgressionConfig to configTypes.ts**

Add to end of `shared/src/data/configTypes.ts`:

```typescript
export interface StatDefinition {
  id: string;
  displayName: string;
  internalStat: string;
  perPoint: number;
}

export interface ProgressionConfig {
  xpPerSkull: Record<string, number>;
  levelThresholds: number[];
  statPointsPerLevel: number;
  statDefinitions: StatDefinition[];
}
```

- [ ] **Step 3: Create the typed config wrapper**

```typescript
// shared/src/data/progression.ts
import type { ProgressionConfig } from './configTypes.js';
import config from './progressionConfig.json' with { type: 'json' };
export const PROGRESSION_CONFIG: ProgressionConfig = config;
```

- [ ] **Step 4: Re-export from shared index**

Add to `shared/src/index.ts`:

```typescript
export { PROGRESSION_CONFIG } from './data/progression.js';
```

- [ ] **Step 5: Verify the shared package builds**

Run: `cd shared && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat: add progression config with XP thresholds and stat definitions
```

---

### Task 2: Player Type Changes

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add XP/level fields to Player interface**

In `shared/src/types.ts`, add these fields to the `Player` interface (after `usedEffects`):

```typescript
  xp: number;
  level: number;
  unspentStatPoints: number;
  statAllocations: Record<string, number>;
```

- [ ] **Step 2: Update createPlayer to initialize new fields**

In the `createPlayer` function in `shared/src/types.ts`, add to the returned object (after `usedEffects: []`):

```typescript
    xp: 0,
    level: 1,
    unspentStatPoints: 0,
    statAllocations: {},
```

- [ ] **Step 3: Update computePlayerStats to include allocations and maxEnergy**

Replace the `ComputedStats` interface and `computePlayerStats` function in `shared/src/types.ts`:

```typescript
export interface ComputedStats {
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  maxEnergy: number;
}

export function computePlayerStats(player: Player): ComputedStats {
  const classDef = getClassDefinition(player.className);
  const base = classDef?.baseStats ?? BASE_STATS;
  const stats: ComputedStats = { ...base, maxEnergy: ENERGY_CONFIG.maxEnergy };
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (!item) continue;
    stats.damage += item.stats.damage ?? 0;
    stats.defense += item.stats.defense ?? 0;
    stats.maxHp += item.stats.maxHp ?? 0;
    stats.initiative += item.stats.initiative ?? 0;
  }

  // Apply stat point allocations
  const { statDefinitions } = PROGRESSION_CONFIG;
  for (const def of statDefinitions) {
    const points = player.statAllocations[def.id] ?? 0;
    if (points <= 0) continue;
    const bonus = points * def.perPoint;
    const stat = def.internalStat as keyof ComputedStats;
    if (stat in stats) {
      (stats[stat] as number) += bonus;
    }
  }

  return stats;
}
```

Add the import at the top of `shared/src/types.ts`:

```typescript
import { PROGRESSION_CONFIG } from './data/progression.js';
```

- [ ] **Step 4: Add AllocateStatMessage and LevelUpMessage to messages.ts**

Add to `shared/src/messages.ts` in the Client -> Server section (before the `ClientMessage` union):

```typescript
export interface AllocateStatMessage {
  type: 'allocate_stat';
  statId: string;
  points: number;
}
```

Add `AllocateStatMessage` to the `ClientMessage` union type.

Add to the Server -> Client section (before the `ServerMessage` union):

```typescript
export interface LevelUpMessage {
  type: 'level_up';
  playerId: string;
  newLevel: number;
}
```

Add `LevelUpMessage` to the `ServerMessage` union type.

- [ ] **Step 5: Verify the shared package builds**

Run: `cd shared && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```
feat: add XP/level/allocation fields to Player, add stat allocation messages
```

---

### Task 3: PlayerManager XP & Leveling Methods

**Files:**
- Modify: `server/src/PlayerManager.ts`
- Modify: `server/src/PlayerManager.test.ts`

- [ ] **Step 1: Write failing tests for awardXp and level-up**

Add to `server/src/PlayerManager.test.ts`:

```typescript
import { PROGRESSION_CONFIG } from '@caverns/shared';

  it('awards XP and returns new total', () => {
    const pm = createManager();
    const total = pm.awardXp('p1', 10);
    expect(total).toBe(10);
    expect(pm.getPlayer('p1')!.xp).toBe(10);
  });

  it('detects single level-up and grants stat points', () => {
    const pm = createManager();
    pm.awardXp('p1', 30); // threshold for level 2
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(1);
    const p = pm.getPlayer('p1')!;
    expect(p.level).toBe(2);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel);
  });

  it('detects multi-level-up', () => {
    const pm = createManager();
    pm.awardXp('p1', 150); // past level 3 threshold (140)
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(3); // levels 2, 3, 4
    const p = pm.getPlayer('p1')!;
    expect(p.level).toBe(4);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel * 3);
  });

  it('does not level past max level', () => {
    const pm = createManager();
    pm.awardXp('p1', 99999);
    const levelsGained = pm.checkLevelUp('p1');
    const maxLevel = PROGRESSION_CONFIG.levelThresholds.length;
    expect(pm.getPlayer('p1')!.level).toBe(maxLevel);
  });

  it('returns 0 levels gained when XP is below next threshold', () => {
    const pm = createManager();
    pm.awardXp('p1', 5);
    const levelsGained = pm.checkLevelUp('p1');
    expect(levelsGained).toBe(0);
    expect(pm.getPlayer('p1')!.level).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: FAIL — `pm.awardXp is not a function`

- [ ] **Step 3: Implement awardXp and checkLevelUp in PlayerManager**

Add import to `server/src/PlayerManager.ts`:

```typescript
import {
  // ... existing imports ...
  PROGRESSION_CONFIG,
} from '@caverns/shared';
```

Add methods to `PlayerManager` class:

```typescript
  awardXp(playerId: string, amount: number): number {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    player.xp += amount;
    return player.xp;
  }

  checkLevelUp(playerId: string): number {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);
    const thresholds = PROGRESSION_CONFIG.levelThresholds;
    const maxLevel = thresholds.length;
    let newLevel = player.level;
    while (newLevel < maxLevel && player.xp >= thresholds[newLevel]) {
      newLevel++;
    }
    const levelsGained = newLevel - player.level;
    if (levelsGained > 0) {
      player.level = newLevel;
      player.unspentStatPoints += levelsGained * PROGRESSION_CONFIG.statPointsPerLevel;
    }
    return levelsGained;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: All PASS

- [ ] **Step 5: Write failing tests for allocateStat**

Add to `server/src/PlayerManager.test.ts`:

```typescript
  it('allocates stat points', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const result = pm.allocateStat('p1', 'vitality', 1);
    expect(result).toBe(true);
    const p = pm.getPlayer('p1')!;
    expect(p.statAllocations['vitality']).toBe(1);
    expect(p.unspentStatPoints).toBe(PROGRESSION_CONFIG.statPointsPerLevel - 1);
  });

  it('rejects allocation with insufficient points', () => {
    const pm = createManager();
    const result = pm.allocateStat('p1', 'vitality', 1);
    expect(result).toBe(false);
    expect(pm.getPlayer('p1')!.unspentStatPoints).toBe(0);
  });

  it('rejects allocation with invalid stat ID', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const result = pm.allocateStat('p1', 'nonexistent', 1);
    expect(result).toBe(false);
  });

  it('vitality allocation increases current HP', () => {
    const pm = createManager();
    pm.awardXp('p1', 30);
    pm.checkLevelUp('p1');
    const hpBefore = pm.getPlayer('p1')!.hp;
    pm.allocateStat('p1', 'vitality', 1);
    const hpAfter = pm.getPlayer('p1')!.hp;
    expect(hpAfter - hpBefore).toBe(5); // perPoint for vitality
  });
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: FAIL — `pm.allocateStat is not a function`

- [ ] **Step 7: Implement allocateStat in PlayerManager**

Add method to `PlayerManager` class:

```typescript
  allocateStat(playerId: string, statId: string, points: number): boolean {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Player ${playerId} not found`);

    const statDef = PROGRESSION_CONFIG.statDefinitions.find(s => s.id === statId);
    if (!statDef) return false;
    if (player.unspentStatPoints < points) return false;

    player.statAllocations[statId] = (player.statAllocations[statId] ?? 0) + points;
    player.unspentStatPoints -= points;

    // Recalculate maxHp and adjust current HP
    this.recalcMaxHp(player);

    return true;
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx vitest run src/PlayerManager.test.ts`
Expected: All PASS

- [ ] **Step 9: Commit**

```
feat: add XP award, level-up detection, and stat allocation to PlayerManager
```

---

### Task 4: GameSession XP Distribution & Stat Allocation Handler

**Files:**
- Modify: `server/src/GameSession.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add PROGRESSION_CONFIG import to GameSession.ts**

Add to the imports in `server/src/GameSession.ts`:

```typescript
import {
  // ... existing imports ...
  PROGRESSION_CONFIG,
} from '@caverns/shared';
```

- [ ] **Step 2: Add XP award logic to finishCombat**

In `server/src/GameSession.ts`, inside `finishCombat`, after the line `this.fireVictoryPassives(roomId);` and before `this.dropLoot(roomId);`, add:

```typescript
      // Award XP to all players
      const room = this.rooms.get(roomId);
      const skullRating = room?.encounter?.skullRating ?? 1;
      const xpAmount = PROGRESSION_CONFIG.xpPerSkull[String(skullRating)] ?? PROGRESSION_CONFIG.xpPerSkull['1'] ?? 0;
      if (xpAmount > 0) {
        const mobName = room?.encounter?.mobId ? this.mobs.get(room.encounter.mobId)?.name ?? 'enemy' : 'enemy';
        this.broadcast({ type: 'text_log', message: `Gained ${xpAmount} XP from defeating ${mobName}!`, logType: 'system' });
        for (const p of this.playerManager.getAllPlayers()) {
          this.playerManager.awardXp(p.id, xpAmount);
          const levelsGained = this.playerManager.checkLevelUp(p.id);
          if (levelsGained > 0) {
            const updatedPlayer = this.playerManager.getPlayer(p.id)!;
            // Heal to full on level up
            updatedPlayer.hp = computePlayerStats(updatedPlayer).maxHp;
            updatedPlayer.maxHp = computePlayerStats(updatedPlayer).maxHp;
            this.broadcast({ type: 'text_log', message: `${p.name} reached level ${updatedPlayer.level}!`, logType: 'system' });
            this.broadcast({ type: 'level_up', playerId: p.id, newLevel: updatedPlayer.level });
          }
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
        }
      }
```

Also remove the duplicate `const room = this.rooms.get(roomId);` that appears a few lines later (the existing one for the boss check). Change that line to reuse the `room` variable already declared above it.

- [ ] **Step 3: Add handleAllocateStat method to GameSession**

Add method to the `GameSession` class:

```typescript
  handleAllocateStat(playerId: string, statId: string, points: number): void {
    const result = this.playerManager.allocateStat(playerId, statId, points);
    if (!result) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot allocate stat point.' });
      return;
    }
    const player = this.playerManager.getPlayer(playerId)!;
    // Sync maxHp with computed stats
    const stats = computePlayerStats(player);
    player.maxHp = stats.maxHp;
    this.broadcast({ type: 'player_update', player });
  }
```

- [ ] **Step 4: Route allocate_stat message in index.ts**

Add to the switch statement in `server/src/index.ts` (before the `chat` case):

```typescript
      case 'allocate_stat': {
        getRoom(playerId)?.gameSession?.handleAllocateStat(playerId, msg.statId, msg.points);
        break;
      }
```

- [ ] **Step 5: Update energy cap to use computed maxEnergy**

In `server/src/PlayerManager.ts`, update `regenEnergy` to use computed stats instead of the flat config cap:

```typescript
  regenEnergy(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const stats = computePlayerStats(player);
    player.energy = Math.min(stats.maxEnergy, player.energy + amount);
  }
```

- [ ] **Step 6: Verify the server builds**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```
feat: distribute XP on combat victory, handle stat allocation messages
```

---

### Task 5: Client Store & Game Actions

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Add levelUpGlow state to the store**

In `client/src/store/gameStore.ts`, add to the `GameStore` interface:

```typescript
  levelUpGlow: boolean;
```

Add to `initialState`:

```typescript
  levelUpGlow: false,
```

- [ ] **Step 2: Handle level_up message in the store**

Add a case to `handleServerMessage` (after the `mob_alert` case):

```typescript
      case 'level_up': {
        if (msg.playerId === get().playerId) {
          set({ levelUpGlow: true });
          setTimeout(() => useGameStore.setState({ levelUpGlow: false }), 1500);
        }
        break;
      }
```

- [ ] **Step 3: Add allocateStat action to useGameActions**

In `client/src/hooks/useGameActions.ts`, add to the returned object:

```typescript
    allocateStat: (statId: string, points: number) =>
      send({ type: 'allocate_stat', statId, points }),
```

- [ ] **Step 4: Verify the client builds**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```
feat: handle level_up in client store, add allocateStat action
```

---

### Task 6: PlayerHUD — XP Bar, Level Badge, Stat Allocation Panel

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`

- [ ] **Step 1: Add PROGRESSION_CONFIG import and stat display name helper**

At the top of `client/src/components/PlayerHUD.tsx`, add:

```typescript
import { PROGRESSION_CONFIG } from '@caverns/shared';
import { computePlayerStats } from '@caverns/shared';
```

Replace the `formatStats` function with one that uses display names:

```typescript
const STAT_DISPLAY_NAMES: Record<string, string> = {};
for (const def of PROGRESSION_CONFIG.statDefinitions) {
  STAT_DISPLAY_NAMES[def.internalStat] = def.displayName;
}

function formatStats(stats: ItemStats): string {
  const parts: string[] = [];
  if (stats.damage) parts.push(`+${stats.damage} ${STAT_DISPLAY_NAMES['damage'] ?? 'dmg'}`);
  if (stats.defense) parts.push(`+${stats.defense} ${STAT_DISPLAY_NAMES['defense'] ?? 'def'}`);
  if (stats.maxHp) parts.push(`+${stats.maxHp} ${STAT_DISPLAY_NAMES['maxHp'] ?? 'hp'}`);
  if (stats.initiative) parts.push(`+${stats.initiative} ${STAT_DISPLAY_NAMES['initiative'] ?? 'init'}`);
  if (stats.healAmount) parts.push(`heals ${stats.healAmount}`);
  return parts.join(', ');
}
```

- [ ] **Step 2: Update PlayerHUD props and add allocateStat**

Update the `PlayerHUDProps` interface:

```typescript
interface PlayerHUDProps {
  onEquipItem: (inventoryIndex: number) => void;
  onDropItem: (inventoryIndex: number) => void;
  onUseConsumable: (consumableIndex: number) => void;
  onAllocateStat: (statId: string) => void;
}
```

Update the function signature:

```typescript
export function PlayerHUD({ onEquipItem, onDropItem, onUseConsumable, onAllocateStat }: PlayerHUDProps) {
```

- [ ] **Step 3: Add level badge and XP bar to the HUD**

After the `<div className="hud-class">` line, add:

```tsx
      <div className="hud-level">Lv {player.level}</div>
```

Compute XP bar values before the return statement:

```typescript
  const thresholds = PROGRESSION_CONFIG.levelThresholds;
  const maxLevel = thresholds.length;
  const isMaxLevel = player.level >= maxLevel;
  const currentThreshold = thresholds[player.level - 1] ?? 0;
  const nextThreshold = isMaxLevel ? currentThreshold : thresholds[player.level];
  const xpIntoLevel = player.xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  const xpPercent = isMaxLevel ? 100 : (xpNeeded > 0 ? (xpIntoLevel / xpNeeded) * 100 : 0);
```

Add the XP bar after the HP bar container:

```tsx
      <div className="xp-bar-container">
        <div className="xp-bar" style={{ width: `${xpPercent}%` }} />
        <span className="xp-text">
          {isMaxLevel ? 'MAX' : `${player.xp} / ${nextThreshold} XP`}
        </span>
      </div>
```

- [ ] **Step 4: Update the energy bar to use computed maxEnergy**

Replace the energy bar section:

```tsx
      <div className="energy-bar-container">
        <div className="energy-bar" style={{ width: `${((player.energy ?? 0) / stats.maxEnergy) * 100}%` }} />
        <span className="energy-text">{player.energy ?? 0}/{stats.maxEnergy} {STAT_DISPLAY_NAMES['maxEnergy'] ?? 'Energy'}</span>
      </div>
```

Add `stats` computation before the return:

```typescript
  const stats = computePlayerStats(player);
```

- [ ] **Step 5: Add stat allocation panel**

After the XP bar, add the stat allocation panel (only shown when the player has unspent points):

```tsx
      {player.unspentStatPoints > 0 && (
        <div className="stat-allocation">
          <div className="stat-alloc-header">
            +{player.unspentStatPoints} stat {player.unspentStatPoints === 1 ? 'point' : 'points'}
          </div>
          {PROGRESSION_CONFIG.statDefinitions.map((def) => (
            <div key={def.id} className="stat-alloc-row">
              <span className="stat-alloc-name">{def.displayName}</span>
              <span className="stat-alloc-value">{player.statAllocations[def.id] ?? 0}</span>
              <button className="stat-alloc-btn" onClick={() => onAllocateStat(def.id)}>+</button>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 6: Commit**

```
feat: add XP bar, level badge, and stat allocation panel to PlayerHUD
```

---

### Task 7: Wire Up onAllocateStat in App.tsx

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Pass onAllocateStat to PlayerHUD**

Find where `PlayerHUD` is rendered in `client/src/App.tsx`. It currently receives `onEquipItem`, `onDropItem`, `onUseConsumable`. Add:

```tsx
onAllocateStat={(statId) => actions.allocateStat(statId, 1)}
```

- [ ] **Step 2: Verify the client builds**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: wire up stat allocation action in App
```

---

### Task 8: Level-Up Glow Animation

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add glow overlay to App.tsx**

In `client/src/App.tsx`, read `levelUpGlow` from the store:

```typescript
const levelUpGlow = useGameStore((s) => s.levelUpGlow);
```

Render the overlay inside the game container (at the end, after all other content):

```tsx
{levelUpGlow && <div className="level-up-glow" />}
```

- [ ] **Step 2: Add CSS for the glow animation**

Add to `client/src/styles/index.css`:

```css
/* === Level-Up Glow === */
.level-up-glow {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  animation: level-glow 1.5s ease-out forwards;
}

@keyframes level-glow {
  0% {
    box-shadow: inset 0 0 80px 40px rgba(212, 168, 87, 0.6);
  }
  50% {
    box-shadow: inset 0 0 120px 60px rgba(212, 168, 87, 0.3);
  }
  100% {
    box-shadow: inset 0 0 0 0 rgba(212, 168, 87, 0);
  }
}
```

- [ ] **Step 3: Commit**

```
feat: add golden corner glow animation on level-up
```

---

### Task 9: XP Bar & Stat Allocation CSS

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add XP bar styles**

Add to `client/src/styles/index.css` (near the existing HP and energy bar styles):

```css
/* === XP Bar === */
.xp-bar-container {
  position: relative;
  height: 14px;
  background: #1a1a10;
  border: 1px solid #3d3122;
  border-radius: 2px;
  margin-bottom: 0.75rem;
  overflow: hidden;
}
.xp-bar {
  height: 100%;
  background: linear-gradient(90deg, #8b6914, #d4a857);
  transition: width 0.3s ease;
  border-radius: 1px;
  box-shadow: 0 0 6px rgba(212, 168, 87, 0.3);
}
.xp-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.65rem;
  line-height: 14px;
  color: #e0d0b0;
  text-shadow: 0 0 2px rgba(0,0,0,0.8);
}

/* === Level Badge === */
.hud-level {
  color: #d4a857;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
  text-shadow: 0 0 4px rgba(212, 168, 87, 0.4);
}

/* === Stat Allocation === */
.stat-allocation {
  margin-top: 0.75rem;
  padding: 0.5rem;
  border: 1px solid #d4a857;
  border-radius: 3px;
  background: #1a1610;
}
.stat-alloc-header {
  color: #d4a857;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
  text-shadow: 0 0 6px rgba(212, 168, 87, 0.4);
  animation: stat-points-pulse 2s ease-in-out infinite;
}
@keyframes stat-points-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.stat-alloc-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.8rem;
}
.stat-alloc-name {
  flex: 1;
  color: #c0b090;
}
.stat-alloc-value {
  color: #d4a857;
  min-width: 1.5rem;
  text-align: right;
}
.stat-alloc-btn {
  background: #3d3122;
  border: 1px solid #d4a857;
  color: #d4a857;
  width: 1.5rem;
  height: 1.5rem;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1;
  border-radius: 2px;
}
.stat-alloc-btn:hover {
  background: #5a4a30;
  text-shadow: 0 0 4px rgba(212, 168, 87, 0.6);
}
```

- [ ] **Step 2: Commit**

```
feat: add XP bar, level badge, and stat allocation panel styles
```

---

### Task 10: Verify Full Integration

**Files:**
- None (testing only)

- [ ] **Step 1: Run all server tests**

Run: `cd server && npx vitest run`
Expected: All PASS

- [ ] **Step 2: Run full TypeScript check across all packages**

Run: `npx tsc --noEmit -p shared/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Verify the game runs end-to-end**

Start the server and client, join a game, defeat a mob, and verify:
- XP gain text appears in the log
- XP bar fills up in the HUD
- On level-up: golden glow fires, stat points become available
- Stat allocation panel appears, clicking + allocates a point
- Stats update immediately after allocation

- [ ] **Step 4: Commit any fixes**

```
fix: integration fixes for XP/leveling system
```
