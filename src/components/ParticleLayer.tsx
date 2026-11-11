import React, { useEffect, useRef } from 'react';

export interface ParticleFx {
  id?: string;
  type: string;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  amount?: number;
  damage?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface ParticleLayerProps {
  activeFx?: ParticleFx | null;
  mapSize: number;
  cellSize: number;
}

const RED = ['#ef4444', '#dc2626', '#f87171', '#fca5a5'];
const YELLOW = ['#facc15', '#fbbf24', '#f59e0b', '#fde047'];
const GREEN = ['#22c55e', '#4ade80', '#16a34a', '#86efac'];
const GRAY = ['#a1a1aa', '#71717a', '#d4d4d8', '#52525b'];

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = (colors: string[]) => colors[Math.floor(Math.random() * colors.length)];

export const ParticleLayer: React.FC<ParticleLayerProps> = ({
  activeFx,
  mapSize,
  cellSize,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const dprRef = useRef(1);

  const width = mapSize * cellSize;
  const height = width;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
    }
  }, [width, height]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: drawWidth, height: drawHeight } = sizeRef.current;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, drawWidth, drawHeight);

    for (const particle of particlesRef.current) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.size * (0.55 + alpha * 0.45),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const step = (dt: number) => {
    const particles = particlesRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      particle.vy += particle.gravity * dt;
      const drag = Math.pow(particle.drag, dt);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  };

  const startLoop = () => {
    if (rafRef.current !== null) return;
    lastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;
      step(dt);
      draw();
      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!activeFx) {
      particlesRef.current = [];
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      draw();
      return;
    }
    const particles = particlesRef.current;

    const cellCenter = (x: number, y: number) => ({
      x: (x - 1) * cellSize + cellSize / 2,
      y: (y - 1) * cellSize + cellSize / 2,
    });

    const tileBox = (x: number, y: number) => ({
      left: (x - 1) * cellSize,
      top: (y - 1) * cellSize,
    });

    const burst = (
      originX: number,
      originY: number,
      colors: string[],
      count: number,
      options: {
        sizeMin: number;
        sizeMax: number;
        speedMin: number;
        speedMax: number;
        gravity: number;
        drag: number;
        lifeMin: number;
        lifeMax: number;
      }
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = random(0, Math.PI * 2);
        const speed = random(options.speedMin, options.speedMax);
        const life = random(options.lifeMin, options.lifeMax);
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: options.gravity,
          drag: options.drag,
          size: random(options.sizeMin, options.sizeMax),
          color: pick(colors),
          life,
          maxLife: life,
        });
      }
    };

    const { type, fromX, fromY, toX, toY, amount, damage } = activeFx;

    if (type === 'mine_triggered' && fromX !== undefined && fromY !== undefined) {
      const point = cellCenter(fromX, fromY);
      burst(point.x, point.y, [...RED, ...YELLOW], 60, {
        sizeMin: 4,
        sizeMax: 9,
        speedMin: 80,
        speedMax: 230,
        gravity: 0,
        drag: 0.2,
        lifeMin: 0.8,
        lifeMax: 1.5,
      });
    } else if (type === 'nuke_launch' && toX !== undefined && toY !== undefined) {
      const point = cellCenter(toX, toY);
      burst(point.x, point.y, [...RED, ...YELLOW], 120, {
        sizeMin: 5,
        sizeMax: 11,
        speedMin: 100,
        speedMax: 320,
        gravity: 0,
        drag: 0.18,
        lifeMin: 1.1,
        lifeMax: 2.1,
      });
    } else if (type === 'damage' && fromX !== undefined && fromY !== undefined) {
      const point = cellCenter(fromX, fromY);
      const count = Math.min(16, 6 + Math.max(1, damage ?? 1) * 2);
      burst(point.x, point.y, RED, count, {
        sizeMin: 1.5,
        sizeMax: 3.2,
        speedMin: 20,
        speedMax: 80,
        gravity: 260,
        drag: 0.9,
        lifeMin: 0.6,
        lifeMax: 1.1,
      });
    } else if (type === 'heal' && fromX !== undefined && fromY !== undefined) {
      const point = cellCenter(fromX, fromY);
      const count = Math.min(14, 5 + Math.max(1, amount ?? 1) * 2);
      burst(point.x, point.y, GREEN, count, {
        sizeMin: 1.5,
        sizeMax: 3.2,
        speedMin: 20,
        speedMax: 70,
        gravity: -220,
        drag: 0.9,
        lifeMin: 0.6,
        lifeMax: 1.1,
      });
    } else if (type === 'send_points') {
      const count = Math.min(12, 4 + Math.max(1, amount ?? 1) * 2);
      if (fromX !== undefined && fromY !== undefined) {
        const point = cellCenter(fromX, fromY);
        burst(point.x, point.y, YELLOW, count, {
          sizeMin: 1.5,
          sizeMax: 3.2,
          speedMin: 20,
          speedMax: 70,
          gravity: -220,
          drag: 0.9,
          lifeMin: 0.6,
          lifeMax: 1.1,
        });
      }
      if (toX !== undefined && toY !== undefined) {
        const point = cellCenter(toX, toY);
        burst(point.x, point.y, YELLOW, count, {
          sizeMin: 1.5,
          sizeMax: 3.2,
          speedMin: 20,
          speedMax: 70,
          gravity: -220,
          drag: 0.9,
          lifeMin: 0.6,
          lifeMax: 1.1,
        });
      }
    } else if (type === 'build' && toX !== undefined && toY !== undefined) {
      const box = tileBox(toX, toY);
      for (let i = 0; i < 24; i++) {
        const life = random(0.5, 0.9);
        particles.push({
          x: box.left + random(2, cellSize - 2),
          y: box.top + random(cellSize * 0.5, cellSize - 2),
          vx: random(-18, 18),
          vy: random(-35, -10),
          gravity: 0,
          drag: 0.6,
          size: random(1.8, 4),
          color: pick(GRAY),
          life,
          maxLife: life,
        });
      }
    } else if (type === 'building_destroyed' && fromX !== undefined && fromY !== undefined) {
      const box = tileBox(fromX, fromY);
      for (let i = 0; i < 40; i++) {
        const life = random(0.7, 1.3);
        particles.push({
          x: box.left + random(2, cellSize - 2),
          y: box.top + random(2, cellSize - 2),
          vx: random(-55, 55),
          vy: random(-70, 10),
          gravity: 280,
          drag: 0.92,
          size: random(1.8, 4),
          color: pick(GRAY),
          life,
          maxLife: life,
        });
      }
    }

    if (particles.length > 0) startLoop();
  }, [activeFx, cellSize]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-30"
      style={{ width, height }}
    />
  );
};
