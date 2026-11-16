import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { GameEngineEvent } from '../types/game';
import { triggerNukeExplosionConfetti } from '../utils/visualEffects';
import { useI18n } from '../i18n';

interface AnimationPlaybackModalProps {
  events: GameEngineEvent[];
  fromDay: number;
  toDay: number;
  autoPlay?: boolean;
  onEventStep: (event: GameEngineEvent | null, index: number) => void;
  onComplete: () => void;
}

export const AnimationPlaybackModal: React.FC<AnimationPlaybackModalProps> = ({
  events,
  fromDay,
  toDay,
  autoPlay = false,
  onEventStep,
  onComplete,
}) => {
  const { t } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(-1);

  const onEventStepRef = useRef(onEventStep);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onEventStepRef.current = onEventStep;
    onCompleteRef.current = onComplete;
  }, [onEventStep, onComplete]);

  useEffect(() => {
    setCurrentIndex(-1);
    onEventStepRef.current(null, -1);
  }, [events]);

  useEffect(() => {
    if (events.length === 0) {
      onCompleteRef.current();
    }
  }, [events]);

  useEffect(() => {
    if (!autoPlay || events.length === 0) return;
    if (currentIndex >= events.length - 1) return;

    const next = currentIndex + 1;
    const timer = setTimeout(
      () => {
        const event = events[next];
        setCurrentIndex(next);
        onEventStepRef.current(event, next);

        if (event.type === 'nuke_launch') {
          triggerNukeExplosionConfetti();
        }
      },
      currentIndex < 0 ? 500 : 1200
    );

    return () => clearTimeout(timer);
  }, [autoPlay, events, currentIndex]);

  useEffect(() => {
    if (!autoPlay || events.length === 0 || currentIndex < events.length - 1) return;
    const timer = setTimeout(() => onCompleteRef.current(), 1200);
    return () => clearTimeout(timer);
  }, [autoPlay, events.length, currentIndex]);

  const currentEvent = currentIndex >= 0 ? events[currentIndex] : null;
  const isDone = currentIndex >= events.length - 1;

  const handleAdvance = () => {
    if (isDone) {
      onCompleteRef.current();
      return;
    }

    const next = currentIndex + 1;
    const event = events[next];
    setCurrentIndex(next);
    onEventStepRef.current(event, next);

    if (event.type === 'nuke_launch') {
      triggerNukeExplosionConfetti();
    }
  };

  return (
    <div className="fixed z-50 w-full max-w-xl px-3 md:px-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
      <div className="bg-zinc-950/95 border border-zinc-700 rounded-2xl p-3 md:p-4 shadow-2xl backdrop-blur-md flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-white truncate">
              {t('ROUND REPLAY: DAY {from} → DAY {to}', { from: fromDay, to: toDay })}
            </h4>
          </div>
          <span className="text-xs font-mono text-zinc-400 shrink-0">
            {t('Event {current} of {total}', {
              current: Math.min(Math.max(currentIndex + 1, 0), events.length),
              total: events.length,
            })}
          </span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 min-h-[48px] flex items-center justify-between">
          <div className="text-xs text-zinc-200 font-medium">
            {currentEvent ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-amber-400 font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-zinc-800">
                  {t(currentEvent.type.replace(/_/g, ' '))}
                </span>
                <span>{currentEvent.description}</span>
              </span>
            ) : currentIndex < 0 ? (
              t('Preparing round replay...')
            ) : (
              t('All events completed for this round.')
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {autoPlay ? (
            <div className="min-h-11 px-3 py-2 rounded-lg bg-zinc-800/70 text-amber-300 text-xs font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              {t('Auto-playing full match replay...')}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAdvance}
              className="min-h-11 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 active:scale-[0.98]"
            >
              {isDone ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              {isDone ? t('Finish') : t('Next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
