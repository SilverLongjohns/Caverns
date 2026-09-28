export type Picks = Record<string, { keep: number[]; reroll?: string }>;

export function toggleKeep(p: Picks, id: string, take: number): Picks {
  const cur = p[id] ?? { keep: [] };
  const keep = cur.keep.includes(take) ? cur.keep.filter((t) => t !== take) : [...cur.keep, take].sort((a, b) => a - b);
  return { ...p, [id]: { ...cur, keep } };
}

export function setReroll(p: Picks, id: string, note: string): Picks {
  const cur = p[id] ?? { keep: [] };
  const next = { ...cur };
  // Stored as typed (trimming here would eat each space as it's typed); blank clears it.
  if (note.trim()) next.reroll = note;
  else delete next.reroll;
  return { ...p, [id]: next };
}

export function loadPicks(raw: string | null): Picks {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Picks) : {};
  } catch {
    return {};
  }
}

/** Ids still to curate: nothing promoted yet, and not marked deliberately unsampled (target 0). */
export function pendingIds(ids: string[], files: Record<string, string[] | undefined>, targets: Record<string, number>): string[] {
  return ids.filter((id) => !(files[id]?.length) && targets[id] !== 0);
}
