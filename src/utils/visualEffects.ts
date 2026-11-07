/**
 * Visual effects and particle helper for animations
 */
import confetti from 'canvas-confetti';

export function triggerVictoryConfetti() {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#10b981', '#3b82f6', '#f59e0b', '#ec4899'],
  });
}

export function triggerNukeExplosionConfetti() {
  confetti({
    particleCount: 120,
    spread: 100,
    origin: { y: 0.5 },
    colors: ['#ef4444', '#f97316', '#eab308'],
  });
}
