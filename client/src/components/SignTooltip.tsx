import { useEffect, useState } from 'react';

export function SignTooltip({ text }: { text: string | null }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  if (!text) return null;
  return (
    <div
      className="sign-tooltip"
      style={{ left: pos.x + 14, top: pos.y + 14 }}
    >
      {text}
    </div>
  );
}
