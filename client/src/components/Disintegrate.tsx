import { useEffect, useRef, useState } from 'react';

interface DisintegrateProps {
  active: boolean;
  children: React.ReactNode;
}

const PARTICLE_SIZE = 3;
const DURATION = 900;

export function Disintegrate({ active, children }: DisintegrateProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hiding, setHiding] = useState(false);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!active || hasRun.current) return;
    if (!wrapperRef.current || !canvasRef.current) return;

    hasRun.current = true;
    const el = wrapperRef.current;
    const canvas = canvasRef.current;
    const rect = el.getBoundingClientRect();
    const w = Math.ceil(rect.width);
    const h = Math.ceil(rect.height);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Gather color regions from child elements
    const regions: { rx: number; ry: number; rw: number; rh: number; color: string }[] = [];
    const gather = (node: Element) => {
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      const bg = style.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        regions.push({
          rx: r.left - rect.left,
          ry: r.top - rect.top,
          rw: r.width,
          rh: r.height,
          color: bg,
        });
      }

      // For text nodes, use the text color
      if (node.childNodes.length > 0) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3 && child.textContent?.trim()) {
            regions.push({
              rx: r.left - rect.left,
              ry: r.top - rect.top,
              rw: r.width,
              rh: r.height,
              color: style.color,
            });
            break;
          }
        }
      }

      for (const child of node.children) {
        gather(child);
      }
    };

    // Add the wrapper's own background
    const wrapperStyle = getComputedStyle(el);
    const wrapperBg = wrapperStyle.backgroundColor;
    if (wrapperBg && wrapperBg !== 'rgba(0, 0, 0, 0)' && wrapperBg !== 'transparent') {
      regions.push({ rx: 0, ry: 0, rw: w, rh: h, color: wrapperBg });
    }
    gather(el);

    // Build particle grid
    const cols = Math.ceil(w / PARTICLE_SIZE);
    const rows = Math.ceil(h / PARTICLE_SIZE);

    interface Particle {
      originX: number;
      originY: number;
      color: string;
      vx: number;
      vy: number;
      delay: number;
    }

    const particles: Particle[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const px = col * PARTICLE_SIZE;
        const py = row * PARTICLE_SIZE;
        const cx = px + PARTICLE_SIZE / 2;
        const cy = py + PARTICLE_SIZE / 2;

        // Find the topmost region containing this point
        let color: string | null = null;
        for (let i = regions.length - 1; i >= 0; i--) {
          const r = regions[i];
          if (cx >= r.rx && cx < r.rx + r.rw && cy >= r.ry && cy < r.ry + r.rh) {
            color = r.color;
            break;
          }
        }
        if (!color) continue;

        // Right-to-left dissolve with randomness
        const normalizedX = col / cols;
        const delay = normalizedX * 0.5 + Math.random() * 0.15;

        particles.push({
          originX: px,
          originY: py,
          color,
          vx: 30 + Math.random() * 50,
          vy: (Math.random() - 0.5) * 30,
          delay,
        });
      }
    }

    setHiding(true);

    const startTime = performance.now();
    let animId: number;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);

      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        const localProgress = Math.max(0, (progress - p.delay) / (1 - p.delay));

        if (localProgress <= 0) {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.originX, p.originY, PARTICLE_SIZE, PARTICLE_SIZE);
          continue;
        }
        if (localProgress >= 1) continue;

        const ease = localProgress * localProgress;
        const alpha = 1 - localProgress;

        const x = p.originX + p.vx * ease;
        const y = p.originY + p.vy * ease;
        const size = PARTICLE_SIZE * (1 - ease * 0.3);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [active]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={wrapperRef} style={{ visibility: hiding ? 'hidden' : 'visible' }}>
        {children}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          display: active ? 'block' : 'none',
        }}
      />
    </div>
  );
}
