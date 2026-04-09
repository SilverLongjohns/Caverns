import type { ClassDefinition } from './classTypes.js';
import classesJson from './data/classes.json';

export const CLASS_DEFINITIONS: ClassDefinition[] = classesJson as ClassDefinition[];

export function getClassDefinition(className: string): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find(c => c.id === className);
}

export function getDefaultClassName(): string {
  return 'vanguard';
}
