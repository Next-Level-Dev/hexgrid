import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { GameEngineEvent } from '../types/game';
import { triggerVictoryConfetti, triggerNukeExplosionConfetti } from '../utils/visualEffects';

interface AnimationPlaybackModalProps {
  events: GameEngineEvent[];
  fromDay: number;
  toDay: number;
  onEventStep: (event: GameEngineEvent | null) => void;
  onComplete: () => void;
}

export const AnimationPlaybackModal: React.FC<AnimationPlaybackModalProps> = ({
  events,
  fromDay,
  toDay,
  onEventStep,
  onComplete,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (events.length === 0) {
      onComplete();
      return;
    }

    onEventStep(events[0]);

    if (!isPlaying) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= events.length) {
          clearInterval(timer);
          setIsPlaying(false);
          onEventStep(null);
          return prev;
        }

        const currentEvt = events[next];
        onEventStep(currentEvt);

        // Special confetti triggers
        if (currentEvt.type === 'nuke_launch') {
          triggerNukeExplosionConfetti();
        }
        return next;
      });
    }, 1200); // 1.2s per event step

    return () => clearInterval(timer);
  }, [events, isPlaying]);

  const currentEvent = events[currentIndex];
  const isDone = currentIndex >= events.length - 1;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4">
      <div className="bg-zinc-950/95 border-2 border-amber-500/80 rounded-2xl p-4 shadow-2xl backdrop-blur-md flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">
              ROUND REPLAY: DAY {fromDay} → DAY {toDay}
            </h4>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            Event {Math.min(currentIndex + 1, events.length)} of {events.length}
          </span>
        </div>

        {/* Current Event Description Banner */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 min-h-[56px] flex items-center justify-between">
          <div className="text-xs text-zinc-200 font-medium">
            {currentEvent ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-amber-400 font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-zinc-800">
                  {currentEvent.type.replace(/_/g, ' ')}
                </span>
                <span>{currentEvent.description}</span>
              </span>
            ) : (
              'All events completed for this round.'
            )}
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => {
                if (currentIndex + 1 < events.length) {
                  setCurrentIndex((c) => c + 1);
                  onEventStep(events[currentIndex + 1]);
                }
              }}
              disabled={isDone}
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold disabled:opacity-40"
              title="Next Event"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              onEventStep(null);
              onComplete();
            }}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            {isDone ? 'Finish Replay' : 'Skip to Result'}
          </button>
        </div>
      </div>
    </div>
  );
};
