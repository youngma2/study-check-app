import { cx } from '../lib/cx';
import { memberTheme } from '../lib/theme';
import type { RealtimeState } from '../lib/storage';
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
  onResetDemo: () => void | Promise<void>;
  canReset: boolean;
  storageKind: 'local' | 'supabase';
  syncState: SyncState;
  realtimeState: RealtimeState;
}

const SYNC_TEXT: Record<SyncState, string> = {
  local: '이 기기에 저장 중 (localStorage)',
  syncing: '클라우드에서 불러오는 중…',
  synced: '가족과 실시간 동기화 중 (Supabase)',
  setup: 'Supabase SQL 실행을 기다리는 중',
  error: '클라우드 연결 실패 · 이 기기에 저장 중',
};

const REALTIME_TEXT: Record<RealtimeState, string> = {
  off: '실시간 연결 꿈김',
  connecting: '실시간 연결 중…',
  live: '실시간 연결됨',
  error: '실시간 연결 꿈김 · 잠시 뒤 새로고침',
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
  realtimeState,
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
      subtitle="이름을 누르면 그 사람 시점으로 바뀝니다. 역할에 따라 할 수 있는 일이 달라요."
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
          {storageKind === 'supabase' ? (
            <p className="mt-1 flex items-center gap-1.5 text-[10px] leading-relaxed text-slate-400">
              <span
                aria-hidden
                className={cx(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  realtimeState === 'live'
                    ? 'bg-emerald-500'
                    : realtimeState === 'error'
                      ? 'bg-rose-500'
                      : 'bg-slate-300',
                )}
              />
              {REALTIME_TEXT[realtimeState]}
            </p>
          ) : (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              데모 데이터예요. Supabase를 연결하면 가족 모두 같은 목록을 봅니다.
            </p>
          )}
        </div>

        {canReset ? (
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('이 기기의 목록을 샘플 데이터로 되돌릴까요? 지금까지 추가한 항목은 사라져요.')) {
                await onResetDemo();
                onClose();
              }
            }}
            className="w-full rounded-xl px-3 py-2.5 text-[11px] font-bold text-rose-500 ring-1 ring-rose-100 transition active:scale-[0.99]"
          >
            샘플 데이터로 되돌리기
          </button>
        ) : (
          <p className="px-1 text-center text-[10px] font-semibold text-slate-400">
            {storageKind === 'supabase'
              ? '가족끼리 연결 중에는 여기서 초기화하지 않아요.'
              : '샘플 초기화는 부모만 할 수 있어요.'}
          </p>
        )}
      </div>
    </Sheet>
  );
}
