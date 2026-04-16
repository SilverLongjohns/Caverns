const PORTRAITS: Record<string, string> = {
  vanguard: '/portraits/templar.png',
  shadowblade: '/portraits/phaseknife.png',
  cleric: '/portraits/suturist.png',
  artificer: '/portraits/junk_prophet.png',
};

export function getClassPortrait(classId: string): string | null {
  return PORTRAITS[classId] ?? null;
}
