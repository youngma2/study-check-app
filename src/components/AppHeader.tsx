import { cx } from '../lib/cx';
import { memberTheme } from '../lib/theme';
import type { Member } from '../lib/types';
import { ChevronDownIcon } from './icons';
import { TierEmblem } from './TierBadge';
import { SeasonBar } from './TierPanel';
import { useStudy } from '../lib/study-context';

interface AppHeaderProps {
  familyName: string;
  currentMember: Member;
  isParent: boolean;
  pendingCount: number;
  onOpenProfile: () => void;
}

export function AppHeader({
  familyName,
  currentMember,
  isParent,
  pendingCount,
  onOpenProfile,
}: AppHeaderProps) {
  const theme = memberTheme(currentMember.color);
  const study = useStudy();
  const tier = currentMember.role === 'child' ? study.seasonStatsFor(currentMember.id)?.level : null;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-900/5 bg-[#f5f6fa]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-md items-center gap-2.5 px-4 pb-2.5 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-[19px] shadow-lg shadow-indigo-500/25">
          <span aria-hidden>📚</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-[16px] font-extrabold tracking-tight text-slate-900">공부 체크</h1>
            {pendingCount > 0 ? (
              <span
                data-testid="pending-badge"
                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700"
              >
                확인 {pendingCount}
              </span>
            ) : null}
          </div>
          <p className="truncate text-[10.5px] font-semibold text-slate-500">{familyName}</p>
        </div>

        <button
          type="button"
          data-testid="open-profile"
          onClick={onOpenProfile}
          className="flex shrink-0 items-center gap-1 rounded-full bg-white py-1 pl-1 pr-2 ring-1 ring-slate-900/10 shadow-sm transition active:scale-95"
        >
          <span className={cx('relative grid h-7 w-7 place-items-center rounded-full text-[14px]', theme.avatar)} aria-hidden>
            {currentMember.emoji}
            {tier ? (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-[1px] shadow-sm ring-1 ring-slate-900/5">
                <TierEmblem tier={tier.key} division={tier.division} size="xs" />
              </span>
            ) : null}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[11px] font-extrabold text-slate-800">{currentMember.name}</span>
            <span className="text-[8.5px] font-bold text-slate-400">{isParent ? '부모' : '아이'}</span>
          </span>
          <ChevronDownIcon className="h-3 w-3 text-slate-400" />
        </button>
      </div>
      {currentMember.role === 'child' ? <SeasonBar memberId={currentMember.id} /> : null}
    </header>
  );
}
