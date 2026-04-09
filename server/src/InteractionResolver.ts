import type {
  Room,
  InteractableDefinition,
  InteractableAction,
  OutcomeType,
  Item,
} from '@caverns/shared';

export interface ActionInfo {
  id: string;
  label: string;
  locked: boolean;
  lockReason?: string;
  used: boolean;
  usedBy?: string;
}

export interface InteractionResult {
  error?: string;
  outcomeType?: OutcomeType;
  narration?: string;
  lootItem?: Item;
  damage?: number;
  intel?: { targetRoomId: string; text: string };
}

export class InteractionResolver {
  private definitions: Map<string, InteractableDefinition>;
  private lootPool: Item[];

  constructor(definitions: InteractableDefinition[], lootPool: Item[]) {
    this.definitions = new Map(definitions.map(d => [d.id, d]));
    this.lootPool = lootPool;
  }

  getActions(
    interactableId: string,
    room: Room,
    playerClass: string,
    isSolo: boolean,
  ): { name: string; actions: ActionInfo[] } | { error: string } {
    const instance = room.interactables?.find(i => i.instanceId === interactableId);
    if (!instance) return { error: 'Interactable not found.' };

    const definition = this.definitions.get(instance.definitionId);
    if (!definition) return { error: 'Unknown interactable definition.' };

    const actions: ActionInfo[] = [];

    for (const action of definition.actions) {
      // Hide multiplayer-only actions in solo
      if (action.multiplayerOnly && isSolo) continue;

      const used = action.id in instance.usedActions;
      const locked = !!action.requiresClass && action.requiresClass !== playerClass;

      // Skip used non-repeatable actions unless they're locked (show locked even if used by someone else)
      if (used && !action.repeatable && !locked) continue;

      actions.push({
        id: action.id,
        label: action.label,
        locked,
        lockReason: locked ? `Requires ${action.requiresClass}` : undefined,
        used,
        usedBy: used ? instance.usedActions[action.id] : undefined,
      });
    }

    return { name: definition.name, actions };
  }

  resolve(
    playerId: string,
    playerName: string,
    interactableId: string,
    actionId: string,
    room: Room,
    playerClass: string,
    isSolo: boolean,
    lootPoolOverride?: Item[],
  ): InteractionResult {
    const instance = room.interactables?.find(i => i.instanceId === interactableId);
    if (!instance) return { error: 'Interactable not found.' };

    const definition = this.definitions.get(instance.definitionId);
    if (!definition) return { error: 'Unknown interactable definition.' };

    const action = definition.actions.find(a => a.id === actionId);
    if (!action) return { error: 'Unknown action.' };

    if (action.requiresClass && action.requiresClass !== playerClass) {
      return { error: `This action requires a ${action.requiresClass}.` };
    }

    if (action.multiplayerOnly && isSolo) {
      return { error: 'This action requires a party.' };
    }

    const alreadyUsed = actionId in instance.usedActions;
    if (alreadyUsed && !action.repeatable) {
      return { error: 'Already used.' };
    }

    // Mark action as used
    instance.usedActions[actionId] = playerName;

    const outcomeType = this.rollOutcome(action);

    switch (outcomeType) {
      case 'loot':
        return this.resolveLoot(definition, action, outcomeType, lootPoolOverride);
      case 'hazard':
        return this.resolveHazard(definition, action, outcomeType);
      case 'intel':
        return this.resolveIntel(definition, action, outcomeType, room);
      case 'reveal_room':
        return this.resolveRevealRoom(definition, action, outcomeType);
      case 'secret':
      case 'flavor':
        return this.resolveFlavor(definition, action, outcomeType);
    }
  }

  private rollOutcome(action: InteractableAction): OutcomeType {
    const entries = Object.entries(action.outcomes.weights) as [OutcomeType, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return entries[0][0];
  }

  private pickNarration(action: InteractableAction, outcomeType: OutcomeType): string | undefined {
    const pool = action.narration?.[outcomeType];
    if (!pool || pool.length === 0) return undefined;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private resolveLoot(
    definition: InteractableDefinition,
    action: InteractableAction,
    outcomeType: OutcomeType,
    lootPoolOverride?: Item[],
  ): InteractionResult {
    const pool = lootPoolOverride ?? this.lootPool;
    const item = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : undefined;

    const custom = this.pickNarration(action, outcomeType);
    const narration = item
      ? (custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}.`) + ` You find a {${item.rarity}:${item.name}}.`
      : (custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}. Nothing useful.`);

    return { outcomeType, narration, lootItem: item };
  }

  private resolveHazard(
    definition: InteractableDefinition,
    action: InteractableAction,
    outcomeType: OutcomeType,
  ): InteractionResult {
    const damage = 5 + Math.floor(Math.random() * 11);
    const custom = this.pickNarration(action, outcomeType);
    const narration = (custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}. Something lashes out.`) + ` -${damage} HP.`;
    return { outcomeType, narration, damage };
  }

  private resolveIntel(
    definition: InteractableDefinition,
    action: InteractableAction,
    outcomeType: OutcomeType,
    room: Room,
  ): InteractionResult {
    const exitIds = Object.values(room.exits).filter(Boolean) as string[];
    if (exitIds.length === 0) {
      return this.resolveFlavor(definition, action, 'flavor');
    }
    const targetRoomId = exitIds[Math.floor(Math.random() * exitIds.length)];
    const text = 'You sense something in a nearby passage.';
    const custom = this.pickNarration(action, outcomeType);
    const narration = custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}. Marks on the surface suggest activity nearby.`;
    return { outcomeType, narration, intel: { targetRoomId, text } };
  }

  private resolveRevealRoom(
    definition: InteractableDefinition,
    action: InteractableAction,
    outcomeType: OutcomeType,
  ): InteractionResult {
    const custom = this.pickNarration(action, outcomeType);
    const narration = custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}. A hidden passage reveals itself.`;
    return { outcomeType, narration };
  }

  private resolveFlavor(
    definition: InteractableDefinition,
    action: InteractableAction,
    outcomeType: OutcomeType,
  ): InteractionResult {
    const custom = this.pickNarration(action, outcomeType);
    const narration = custom ?? `You ${action.label.toLowerCase()} the ${definition.name.toLowerCase()}. Nothing of note.`;
    return { outcomeType, narration };
  }
}
