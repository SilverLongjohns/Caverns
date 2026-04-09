import type { InteractableDefinition } from './types.js';
import interactablesJson from './data/interactables.json';

const RETURN_PORTAL: InteractableDefinition = {
  id: '_return_portal',
  name: 'Passage',
  asciiChar: '\u25CB',
  biomes: [],
  slotSize: 'small',
  actions: [],
};

export const INTERACTABLE_DEFINITIONS: InteractableDefinition[] = [
  ...interactablesJson as InteractableDefinition[],
  RETURN_PORTAL,
];

export function getInteractableDefinition(id: string): InteractableDefinition | undefined {
  return INTERACTABLE_DEFINITIONS.find(d => d.id === id);
}
