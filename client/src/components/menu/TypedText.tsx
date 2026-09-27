import { useEffect, useState } from 'react';
import { typedSlice } from '../../ui/typed.js';
import { prefersReducedMotion } from '../../ui/motion.js';

interface Props {
  text: string;
  cps?: number;
  /** Keep a blinking block cursor after the text (status consoles). */
  cursor?: boolean;
  className?: string;
}

function Typing({ text, cps, cursor, className }: Required<Omit<Props, 'className'>> & { className?: string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text : ''));
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(text); return; }
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const s = typedSlice(text, performance.now() - start, cps);
      setShown(s);
      if (s.length < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  const done = shown.length === text.length;
  return (
    <span className={`typed-text ${className ?? ''}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
      {(cursor || !done) && <span className="typed-text__cursor" aria-hidden="true">█</span>}
    </span>
  );
}

/** Text that types in at `cps`; a new `text` restarts it (keyed remount). */
export function TypedText({ text, cps = 40, cursor = false, className }: Props) {
  return <Typing key={text} text={text} cps={cps} cursor={cursor} className={className} />;
}
