import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { displayGrade } from '../lib/grade';
import { memberTheme } from '../lib/theme';
import type { RealtimeState } from '../lib/storage';
import type { SyncState } from '../lib/study-context';
import type { Member } from '../lib/types';
import { Sheet } from './Sheet';
import { CheckIcon, LockIcon, PencilIcon } from './icons';
import { TierEmblemFor } from './TierBadge';
import { useStudy } from '../lib/study-context';

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  members: Member[];
  currentMemberId: string;
  /** 지금 보고 있는 사람이 부모인지 — 아이 화면에서는 아빠·엄마를 눌러도 PIN을 먼저 묻습니다. */
  viewerIsParent: boolean;
  onSelect: (memberId: string) => void;
  /** 아이 화면에서 아빠·엄마를 눌렀을 때 — PIN 확인 화면을 엽니다. */
  onRequestParent: (memberId: string) => void;
  onLock: () => void;
  onRename: (memberId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
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

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{ height: 18, width: 32 }}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition',
        on ? 'bg-emerald-500' : 'bg-slate-300',
      )}
    >
      <span
        className={cx('absolute h-3.5 w-3.5 rounded-full bg-white shadow transition-all', on ? 'left-[16px]' : 'left-[2px]')}
      />
    </span>
  );
}

const REALTIME_TEXT: Record<RealtimeState, string> = {
  off: '실시간 연결 끊김',
  connecting: '실시간 연결 중…',
  live: '실시간 연결됨',
  error: '실시간 연결 끊김 · 잠시 뒤 새로고침',
};

export function ProfileSheet({
  open,
  onClose,
  members,
  currentMemberId,
  viewerIsParent,
  onSelect,
  onRequestParent,
  onLock,
  onRename,
  onResetDemo,
  canReset,
  storageKind,
  syncState,
  realtimeState,
}: ProfileSheetProps) {
  const parents = members.filter((member) => member.role === 'parent');
  const children = members.filter((member) => member.role === 'child');
  const study = useStudy();
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [savingRewards, setSavingRewards] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft('');
      setRenameError(null);
    }
  }, [open]);

  const startRename = (member: Member) => {
    setEditingId(member.id);
    setDraft(member.name);
    setRenameError(null);
  };

  const submitRename = async () => {
    if (!editingId) return;
    setSaving(true);
    setRenameError(null);
    const result = await onRename(editingId, draft);
    setSaving(false);
    if (!result.ok) {
      setRenameError(result.error ?? '이름을 바꾸지 못했어요.');
      return;
    }
    setEditingId(null);
  };

  const renderRow = (member: Member) => {
    const theme = memberTheme(member.color);
    const active = member.id === currentMemberId;
    const editing = editingId === member.id;
    /** 부모 행 + 아이가 보는 중 → 누르면 PIN 부터 */
    const needsPin = member.role === 'parent' && !viewerIsParent;

    return (
      <div key={member.id}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid={`profile-row-${member.id}`}
            onClick={() => {
              if (needsPin) {
                onRequestParent(member.id);
                onClose();
                return;
              }
              onSelect(member.id);
              onClose();
            }}
            className={cx(
              'flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left ring-1 transition active:scale-[0.99]',
              active ? 'bg-indigo-50/70 ring-indigo-200' : 'bg-white ring-slate-900/5 hover:bg-slate-50',
            )}
          >
            <span
              className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[19px]', theme.soft)}
              aria-hidden
            >
              {member.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-slate-900">
                {member.role === 'child' ? <TierEmblemFor memberId={member.id} size="sm" /> : null}
                {member.name}
                {member.grade ? (
                  <span data-testid={`profile-grade-${member.id}`} className="text-[9.5px] font-bold text-slate-400">
                    {displayGrade(member.grade)}
                  </span>
                ) : null}
                {needsPin ? (
                  <span
                    data-testid={`lock-badge-${member.id}`}
                    className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-600 ring-1 ring-amber-200/70"
                  >
                    <LockIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
                    PIN
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">
                {member.role === 'parent'
                  ? needsPin
                    ? 'PIN을 입력하면 열려요'
                    : '확인 · 수정 · 삭제 가능'
                  : '완료 체크 · 자기 공부 추가 (삭제 불가)'}
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

          {viewerIsParent ? (
            <button
              type="button"
              aria-label={`${member.name} 이름 바꾸기`}
              onClick={() => (editing ? setEditingId(null) : startRename(member))}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-90"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-1.5 rounded-2xl bg-indigo-50/60 p-2 ring-1 ring-indigo-100">
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draft}
                maxLength={30}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitRename();
                  if (event.key === 'Escape') setEditingId(null);
                }}
                data-testid="rename-input"
                className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-slate-800 outline-none ring-1 ring-slate-900/5"
              />
              <button
                type="button"
                data-testid="rename-save"
                onClick={submitRename}
                disabled={saving}
                className="rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded-xl bg-white px-2.5 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200"
              >
                취소
              </button>
            </div>
            {renameError ? <p className="mt-1 px-1 text-[10.5px] font-bold text-rose-500">{renameError}</p> : null}
          </div>
        ) : null}
      </div>
    );
  };

  const togglePool = async (minutes: number) => {
    const pool = study.rewardSettings.pool;
    const nextPool = pool.includes(minutes) ? pool.filter((value) => value !== minutes) : [...pool, minutes].sort((a, b) => a - b);
    if (nextPool.length === 0) {
      setRewardError('보상은 한 가지 이상 남겨 주세요.');
      return;
    }
    setSavingRewards(true);
    setRewardError(null);
    const result = await study.saveRewardSettings({ pool: nextPool });
    setSavingRewards(false);
    if (!result.ok) setRewardError(result.error ?? '설정을 저장하지 못했어요');
  };

  const toggleNotify = async (key: 'notify_box' | 'notify_step') => {
    setSavingRewards(true);
    setRewardError(null);
    const result = await study.saveRewardSettings({ [key]: !study.rewardSettings[key] });
    setSavingRewards(false);
    if (!result.ok) setRewardError(result.error ?? '설정을 저장하지 못했어요');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={viewerIsParent ? '누구로 볼까요?' : '누구 시점으로 볼까요?'}
      subtitle={
        viewerIsParent
          ? '이름을 누르면 그 사람 시점으로 바뀝니다. 부모 화면은 PIN으로 잠겨 있어요.'
          : '아빠·엄마를 누르면 PIN을 먼저 물어요. 아이는 누르는 대로 바로 바뀝니다.'
      }
    >
      <div className="space-y-4 pb-1">
        <div>
          <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">
            부모
            {!viewerIsParent ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-600">
                <LockIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
                PIN 필요
              </span>
            ) : null}
          </p>
          <div className="space-y-1.5">{parents.map(renderRow)}</div>
        </div>

        <div>
          <p className="mb-1.5 px-1 text-[10px] font-extrabold tracking-wide text-slate-400">아이</p>
          <div className="space-y-1.5">{children.map(renderRow)}</div>
        </div>

        {viewerIsParent ? (
          <div data-testid="reward-settings" className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-900/5">
            <p className="text-[10px] font-extrabold tracking-wide text-slate-400">🎁 보상 뽑기 설정</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-500">상자에서 나올 수 있는 게임 시간</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[5, 10, 15, 20].map((minutes) => {
                const on = study.rewardSettings.pool.includes(minutes);
                return (
                  <button
                    key={minutes}
                    type="button"
                    data-testid={`pool-${minutes}`}
                    onClick={() => togglePool(minutes)}
                    disabled={savingRewards}
                    className={cx(
                      'rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ring-1 transition active:scale-95 disabled:opacity-60',
                      on ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-400 ring-slate-200',
                    )}
                  >
                    +{minutes}분
                  </button>
                );
              })}
            </div>
            <div className="mt-2 space-y-1.5">
              <button
                type="button"
                data-testid="notify-box"
                onClick={() => toggleNotify('notify_box')}
                disabled={savingRewards}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-[10.5px] font-bold text-slate-600">큰 티어 승급 알림 (뽑기 상자)</span>
                <Switch on={study.rewardSettings.notify_box} />
              </button>
              <button
                type="button"
                data-testid="notify-step"
                onClick={() => toggleNotify('notify_step')}
                disabled={savingRewards}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-[10.5px] font-bold text-slate-600">세부 단계 승급 알림</span>
                <Switch on={study.rewardSettings.notify_step} />
              </button>
            </div>
            {rewardError ? <p className="mt-1 text-[10px] font-bold text-rose-500">{rewardError}</p> : null}
          </div>
        ) : null}

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

        {viewerIsParent ? (
          <button
            type="button"
            data-testid="lock-parent"
            onClick={() => {
              onLock();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-[11.5px] font-extrabold text-white transition active:scale-[0.99]"
          >
            <LockIcon className="h-3.5 w-3.5" />
            관리 잠금
          </button>
        ) : null}

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
        ) : viewerIsParent ? (
          <p className="px-1 text-center text-[10px] font-semibold text-slate-400">
            {storageKind === 'supabase'
              ? '가족끼리 연결 중에는 여기서 초기화하지 않아요.'
              : '샘플 초기화는 부모만 할 수 있어요.'}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
