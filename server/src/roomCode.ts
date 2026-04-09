export function generateRoomCode(existing: Set<string>): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code: string;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * 26)];
    }
  } while (existing.has(code));
  return code;
}
