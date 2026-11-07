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
}) => {
  const days = Array.from({ length: currentDay }, (_, i) => i + 1);
  const canProgress = viewingDay < currentDay;

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-3 shadow-sm">
      {/* Historical Day Scrubber */}
      <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-thin">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-semibold uppercase tracking-wider shrink-0 mr-1">
          <History className="w-3.5 h-3.5 text-amber-400" />
          <span>Timeline:</span>
        </div>
        <div className="flex items-center gap-1">
          {days.map((day) => {
            const isSelected = day === viewingDay;
            const isLatest = day === currentDay;
            return (
              <button
                key={day}
                onClick={() => onSelectDay(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                  isSelected
                    ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20 ring-2 ring-amber-400/50'
                    : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50'
                }`}
              >
                Day {day}
                {isLatest && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
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
            className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-zinc-950 font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg shadow-amber-500/25 transition-all transform active:scale-95 disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-zinc-950" />
            {isAnimating ? 'Playing Day Animation...' : `Progress to Next Day (Day ${viewingDay + 1})`}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-3 py-1.5 rounded-lg font-mono">
            <CheckCircle2 className="w-3.5 h-3.5" />
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
