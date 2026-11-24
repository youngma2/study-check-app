import { cx } from '../lib/cx';
import { memberTheme } from '../lib/theme';
import type { SyncState } from '../lib/study-context';
import type { Member } from '../lib/types';
import { Sheet } from './Sheet';
import { CheckIcon } from './icons';

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  members: Member[];
  currentMemberId: string;
  onSelect: (memberId: string) => void;
  onResetDemo: () => void;
  canReset: boolean;
  storageKind: 'local' | 'supabase';
  syncState: SyncState;
}

const SYNC_TEXT: Record<SyncState, string> = {
  local: '이 기기에 저장 중 (localStorage)',
  syncing: '클라우드에서 불러오는 중…',
  synced: 'Supabase와 동기화됨',
  error: '클라우드 연결 실패 · 이 기기에 저장 중',
};

export function ProfileSheet({
  open,
  onClose,
  members,
  currentMemberId,
  onSelect,
  onResetDemo,
  canReset,
  storageKind,
  syncState,
}: ProfileSheetProps) {
  const parents = members.filter((member) => member.role === 'parent');
  const children = members.filter((member) => member.role === 'child');

  const renderRow = (member: Member) => {
    const theme = memberTheme(member.color);
    const active = member.id === currentMemberId;

    return (
      <button
        key={member.id}
        type="button"
        onClick={() => {
          onSelect(member.id);
          onClose();
        }}
        className={cx(
          'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ring-1 transition active:scale-[0.99]',
          active ? 'bg-indigo-50/70 ring-indigo-200' : 'bg-white ring-slate-900/5 hover:bg-slate-50',
        )}
      >
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[19px]', theme.soft)} aria-hidden>
          {member.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-slate-900">
            {member.name}
            {member.grade ? <span className="text-[9.5px] font-bold text-slate-400">{member.grade}</span> : null}
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">
            {member.role === 'parent' ? '확인 · 수정 · 삭제 가능' : '추가 · 완료 요청만 가능 (삭제 불가)'}
          </span>
        </span>
        <span
          className={cx(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full',
            active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-transparent',
          )}
        >
          <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </button>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="누구로 볼까요?"
      subtitle="역할을 바꾸면 권한이 어떻게 다른지 바로 확인할 수 있어요. (데모 모드)"
    >
      <div className="space-y-4 pb-1">
        <div>
          <p className="mb-1.5 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">부모</p>
          <div className="space-y-1.5">{parents.map(renderRow)}</div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">아이</p>
          <div className="space-y-1.5">{children.map(renderRow)}</div>
        </div>

        <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-900/5">
          <p className="text-[10.5px] font-semibold text-slate-500">
            <span className="font-extrabold text-slate-700">저장 상태</span> · {SYNC_TEXT[syncState]}
          </p>
          {storageKind === 'local' ? (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              데모 데이터예요. Supabase를 연결하면 가족 모두 같은 목록을 봅니다.
            </p>
          ) : null}
        </div>

        {canReset ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('이 기기의 목록을 샘플 데이터로 되돌릴까요? 지금까지 추가한 항목은 사라져요.')) {
                onResetDemo();
                onClose();
              }
            }}
            className="w-full rounded-xl px-3 py-2.5 text-[11px] font-bold text-rose-500 ring-1 ring-rose-100 transition active:scale-[0.99]"
          >
            샘플 데이터로 되돌리기
          </button>
        ) : (
          <p className="px-1 text-center text-[10px] font-semibold text-slate-400">
            샘플 초기화는 부모만 할 수 있어요.
          </p>
        )}
      </div>
    </Sheet>
  );
}
