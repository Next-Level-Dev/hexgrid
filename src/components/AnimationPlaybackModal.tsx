import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { GameEngineEvent } from '../types/game';
import { triggerVictoryConfetti, triggerNukeExplosionConfetti } from '../utils/visualEffects';

interface AnimationPlaybackModalProps {
  events: GameEngineEvent[];
  fromDay: number;
  toDay: number;
  onEventStep: (event: GameEngineEvent | null, index: number) => void;
  onComplete: () => void;
}

export const AnimationPlaybackModal: React.FC<AnimationPlaybackModalProps> = ({
  events,
  fromDay,
  toDay,
  onEventStep,
  onComplete,
}) => {
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(true);

  // Keep the latest callbacks in refs so the playback timer is not restarted
  // every time the parent re-renders (its handlers are recreated inline).
  const onEventStepRef = useRef(onEventStep);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onEventStepRef.current = onEventStep;
    onCompleteRef.current = onComplete;
  }, [onEventStep, onComplete]);

  // A new replay always starts from the beginning, paused at "preparing".
  useEffect(() => {
    setCurrentIndex(-1);
    setIsPlaying(true);
    onEventStepRef.current(null, -1);
  }, [events]);

  useEffect(() => {
    if (events.length === 0) {
      onCompleteRef.current();
    }
  }, [events]);

  // Advance exactly one event at a time. The timer lives outside the state
  // updater so event side effects (FX, confetti) only run once per step.
  useEffect(() => {
    if (events.length === 0 || !isPlaying) return;
    if (currentIndex >= events.length - 1) {
      if (currentIndex >= 0) setIsPlaying(false);
      return;
    }

    const next = currentIndex + 1;
    const timer = setTimeout(
      () => {
        const currentEvt = events[next];
        setCurrentIndex(next);
        onEventStepRef.current(currentEvt, next);

        if (currentEvt.type === 'nuke_launch') {
          triggerNukeExplosionConfetti();
        }

        if (next >= events.length - 1) {
          setIsPlaying(false);
        }
      },
      currentIndex < 0 ? 500 : 1200
    );

    return () => clearTimeout(timer);
  }, [events, isPlaying, currentIndex]);

  const currentEvent = currentIndex >= 0 ? events[currentIndex] : null;
  const isDone = currentIndex >= events.length - 1;

  const handleManualNext = () => {
    if (currentIndex + 1 >= events.length) return;
    setIsPlaying(false);
    const next = currentIndex + 1;
    const currentEvt = events[next];
    setCurrentIndex(next);
    onEventStepRef.current(currentEvt, next);
    if (currentEvt.type === 'nuke_launch') {
      triggerNukeExplosionConfetti();
    }
  };

  return (
    <div className="fixed z-50 w-full max-w-xl px-3 md:px-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
      <div className="bg-zinc-950/95 border border-zinc-700 rounded-2xl p-3 md:p-4 shadow-2xl backdrop-blur-md flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-white truncate">
              ROUND REPLAY: DAY {fromDay} → DAY {toDay}
            </h4>
          </div>
          <span className="text-xs font-mono text-zinc-400 shrink-0">
            Event {Math.min(Math.max(currentIndex + 1, 0), events.length)} of {events.length}
          </span>
        </div>

        {/* Current Event Description Banner */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 min-h-[48px] flex items-center justify-between">
          <div className="text-xs text-zinc-200 font-medium">
            {currentEvent ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-amber-400 font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-zinc-800">
                  {currentEvent.type.replace(/_/g, ' ')}
                </span>
                <span>{currentEvent.description}</span>
              </span>
            ) : currentIndex < 0 ? (
              'Preparing round replay...'
            ) : (
              'All events completed for this round.'
            )}
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="min-h-11 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold flex items-center gap-1.5 active:bg-zinc-600"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={handleManualNext}
              disabled={isDone}
              className="min-h-11 min-w-11 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold disabled:opacity-40 flex items-center justify-center active:bg-zinc-600"
              title="Next Event"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              onEventStep(null, events.length - 1);
              onComplete();
            }}
            className="min-h-11 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 active:scale-[0.98]"
          >
            <CheckCircle2 className="w-4 h-4" />
            {isDone ? 'Finish Replay' : 'Skip to Result'}
          </button>
        </div>
      </div>
    </div>
  );
};
