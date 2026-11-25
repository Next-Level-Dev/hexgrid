import React, { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, LogIn, Users, X } from 'lucide-react';
import { Player } from '../types/game';
import { useI18n } from '../i18n';

export interface InviteDetails {
  playerId: string;
  username: string;
  avatarUrl: string;
  expiresAt: string;
}

interface InviteDialogProps {
  token: string | null;
  invite: InviteDetails | null;
  error: string | null;
  onPasswordSet: (playerId: string) => void;
  onClose: () => void;
}

export const InviteDialog: React.FC<InviteDialogProps> = ({
  token,
  invite,
  error,
  onPasswordSet,
  onClose,
}) => {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmation) {
      setLocalError(t('Passwords do not match'));
      return;
    }
    if (password.length < 8) {
      setLocalError(t('Password must be at least 8 characters'));
      return;
    }

    setIsSaving(true);
    setLocalError(null);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        onPasswordSet(data.playerId);
      } else {
        setLocalError(data.error || t('Failed to set password'));
      }
    } catch (err: any) {
      setLocalError(err.message || t('Failed to set password'));
    } finally {
      setIsSaving(false);
    }
  };

  const shownError = localError || error;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 max-w-md w-full flex flex-col gap-3 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-emerald-400" />
            {t('Set Your Password')}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {shownError && (
          <div className="text-xs text-red-400 bg-red-950/50 p-2 rounded border border-red-800">
            {shownError}
          </div>
        )}

        {invite && (
          <>
            <p className="text-xs text-zinc-400">
              {t('Use this link once to choose a password for your account.')}
            </p>
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-2">
              <img
                src={invite.avatarUrl}
                alt={invite.username}
                className="w-10 h-10 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-zinc-500">{t('Codename / Username')}</div>
                <div className="text-sm font-semibold text-zinc-100 truncate">{invite.username}</div>
                <div className="text-[10px] text-zinc-500">
                  {t('Link valid for 7 days · single use')}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">{t('Operative ID')}</label>
              <input
                type="text"
                readOnly
                value={invite.playerId}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-500 font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">{t('Avatar Image URL')}</label>
              <input
                type="text"
                readOnly
                value={invite.avatarUrl}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-500"
              />
            </div>
          </>
        )}

        <div>
          <label className="text-[11px] text-zinc-400 block mb-1">{t('New Password')}</label>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="text-[11px] text-zinc-400 block mb-1">{t('Confirm Password')}</label>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
          />
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg"
          >
            {t('Cancel')}
          </button>
          <button
            type="submit"
            disabled={isSaving || (!invite && !error)}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            {isSaving ? t('Saving...') : t('Set Password')}
          </button>
        </div>
      </form>
    </div>
  );
};

interface LoginDialogProps {
  isOpen: boolean;
  allPlayers: Player[];
  initialPlayerId: string | null;
  onClose: () => void;
  onLoggedIn: (player: Player) => void;
}

export const LoginDialog: React.FC<LoginDialogProps> = ({
  isOpen,
  allPlayers,
  initialPlayerId,
  onClose,
  onLoggedIn,
}) => {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(initialPlayerId);
    setPassword('');
    setError(null);
  }, [isOpen, initialPlayerId]);

  if (!isOpen) return null;

  const selectedPlayer = allPlayers.find((p) => p.id === selectedId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayer || !password) return;

    setIsLoggingIn(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedPlayer.id, password }),
      });
      const data = await res.json();
      if (res.ok && data.player) {
        setPassword('');
        onLoggedIn(data.player);
      } else {
        setError(data.error || t('Failed to sign in'));
      }
    } catch (err: any) {
      setError(err.message || t('Failed to sign in'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 max-w-md w-full flex flex-col gap-3 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
            <LogIn className="w-4 h-4 text-emerald-400" />
            {t('Sign In')}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-950/50 p-2 rounded border border-red-800">
            {error}
          </div>
        )}

        {!selectedPlayer ? (
          <>
            <div>
              <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-400" />
                {t('Choose your operative')}
              </h4>
              <p className="text-xs text-zinc-400 mt-1">
                {t('Select the account you want to sign in with.')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
              {allPlayers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setError(null);
                  }}
                  className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-600 hover:bg-emerald-950/40 text-left"
                >
                  <img
                    src={p.avatarUrl}
                    alt={p.username}
                    className="w-8 h-8 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
                  />
                  <span className="flex-1 min-w-0 text-xs font-semibold text-zinc-100 truncate">
                    {p.username}
                  </span>
                  {p.isAdmin && <span className="text-[10px] text-amber-400 font-bold">[ADMIN]</span>}
                </button>
              ))}
              {allPlayers.length === 0 && (
                <div className="text-xs text-zinc-500">{t('No operatives available')}</div>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-2">
              <img
                src={selectedPlayer.avatarUrl}
                alt={selectedPlayer.username}
                className="w-10 h-10 rounded-lg bg-zinc-800 object-cover border border-zinc-700"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-zinc-500">{t('Selected Operative')}</div>
                <div className="text-sm font-semibold text-zinc-100 truncate">
                  {selectedPlayer.username}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setPassword('');
                  setError(null);
                }}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                {t('Change operative')}
              </button>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">{t('Password')}</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <p className="text-[11px] text-zinc-500">
              {t('No password set? Ask an administrator for a reset link.')}
            </p>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg"
              >
                {t('Cancel')}
              </button>
              <button
                type="submit"
                disabled={isLoggingIn}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1"
              >
                <LogIn className="w-3.5 h-3.5" />
                {isLoggingIn ? t('Signing in...') : t('Sign In')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
