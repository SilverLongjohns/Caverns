const PORTRAITS: Record<string, string> = {
  vanguard: '/portraits/templar.png',
  artificer: '/portraits/junk_prophet.png',
};

export function getClassPortrait(classId: string): string | null {
  return PORTRAITS[classId] ?? null;
}
