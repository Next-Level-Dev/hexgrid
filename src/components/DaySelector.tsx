import React from 'react';
import { Play, FastForward, History, Sparkles, CheckCircle2 } from 'lucide-react';

interface DaySelectorProps {
  currentDay: number;
  viewingDay: number;
  lastDayViewed: number;
  isGameOver: boolean;
  onSelectDay: (day: number) => void;
  onProgressToNextDay: () => void;
  onPlayFullTimeline?: () => void;
  isAnimating: boolean;
  isClosed: boolean;
  maxVisibleDay?: number;
  isStateReady?: boolean;
}

export const DaySelector: React.FC<DaySelectorProps> = ({
  currentDay,
  viewingDay,
  lastDayViewed,
  isGameOver,
  onSelectDay,
  onProgressToNextDay,
  onPlayFullTimeline,
  isAnimating,
  isClosed,
  maxVisibleDay,
  isStateReady = true,
}) => {
  const highestVisibleDay = Math.max(1, Math.min(currentDay, maxVisibleDay ?? currentDay));
  const days = Array.from({ length: highestVisibleDay }, (_, i) => i + 1);
  const canProgress =
    !isClosed && !isAnimating && isStateReady && viewingDay >= 1 && viewingDay < highestVisibleDay;

  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-xl p-2 md:p-3 flex flex-col md:flex-row items-center justify-between gap-2 md:gap-3 shadow-sm">
      {/* Historical Day Scrubber */}
      <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-thin">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-semibold uppercase tracking-wider shrink-0 mr-1">
          <History className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Timeline:</span>
        </div>
        <div className="flex items-center gap-1">
          {days.map((day) => {
            const isSelected = day === viewingDay;
            const isLatest = day === currentDay;
            return (
              <button
                key={day}
                onClick={() => onSelectDay(day)}
                className={`px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative shrink-0 ${
                  isSelected
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                }`}
              >
                Day {day}
                {isLatest && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons: Progress to Next Day / Full Timeline */}
      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
        {canProgress ? (
          <button
            onClick={onProgressToNextDay}
            disabled={isAnimating}
            className="w-full md:w-auto min-h-11 md:min-h-0 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-zinc-950" />
            {isAnimating ? 'Playing Day Animation...' : `Progress to Next Day (Day ${viewingDay + 1})`}
          </button>
        ) : isClosed ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 px-3 py-1.5 rounded-lg font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Closed phase — next day unlocks after 02:00 UTC
          </div>
        ) : !isStateReady ? (
          <div className="flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-900/70 border border-zinc-700/60 px-3 py-1.5 rounded-lg font-mono">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            Loading Day {viewingDay} state...
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-3 py-1.5 rounded-lg font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Viewing Live State (Day {viewingDay})
          </div>
        )}

        {isGameOver && onPlayFullTimeline && (
          <button
            onClick={onPlayFullTimeline}
            disabled={isAnimating}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700 text-xs font-semibold rounded-lg transition-colors"
            title="Replay entire match timeline from Day 1 to finish"
          >
            <FastForward className="w-3.5 h-3.5" />
            Full Match Replay
          </button>
        )}
      </div>
    </div>
  );
};
