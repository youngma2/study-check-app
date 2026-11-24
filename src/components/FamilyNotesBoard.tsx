import { useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { NOTE_MAX_LENGTH, formatNoteTime, type NotesState } from '../lib/notes';
import { memberTheme } from '../lib/theme';
import type { FamilyNote, Member } from '../lib/types';
import { XIcon } from './icons';

interface FamilyNotesBoardProps {
  notes: FamilyNote[];
  members: Member[];
  currentMemberId: string;
  isParent: boolean;
  state: NotesState;
  onSubmit: (content: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 알림판을 읽었을 때 — 새 소식 배너를 닫습니다. */
  onSeen: () => void;
  notifyPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  onEnableAlerts: () => void;
}

/**
 * 💬 우리 가족 한마디
 *
 * 아빠·엄마·아이 누구나 짧은 일정이나 전할 말을 남기는 알림판입니다.
 * 새 글이 올라오면 다른 폰에 실시간으로 붙고, 아직 안 본 글은 위쪽 배너로 알려 줍니다.
 */
export function FamilyNotesBoard({
  notes,
  members,
  currentMemberId,
  isParent,
  state,
  onSubmit,
  onDelete,
  onSeen,
  notifyPermission,
  onEnableAlerts,
}: FamilyNotesBoardProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = state === 'ready';
  const visibleNotes = showAll ? notes : notes.slice(0, 4);

  const submit = async () => {
    if (sending || !ready) return;
    const text = draft.trim();
    if (!text) {
      setError('남길 말을 적어 주세요.');
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    const result = await onSubmit(text);
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? '한마디를 남기지 못했어요.');
      return;
    }
    setDraft('');
    onSeen();
  };

  const remove = async (note: FamilyNote) => {
    if (!window.confirm('이 한마디를 지울까요?')) return;
    setError(null);
    const result = await onDelete(note.id);
    if (!result.ok) setError(result.error ?? '한마디를 지우지 못했어요.');
  };

  return (
    <section
      data-testid="family-notes"
      onClick={onSeen}
      className="mt-3 rounded-[26px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
    >
      <header className="flex items-center gap-2 px-0.5 pb-2">
        <span aria-hidden className="text-[15px]">
          💬
        </span>
        <h2 className="min-w-0 flex-1 text-[13px] font-extrabold tracking-tight text-slate-900">
          우리 가족 한마디
          {notes.length > 0 ? (
            <span className="ml-1 text-[9.5px] font-bold text-slate-400">{notes.length}</span>
          ) : null}
        </h2>
        {notifyPermission === 'default' ? (
          <button
            type="button"
            data-testid="enable-alerts"
            onClick={(event) => {
              event.stopPropagation();
              onEnableAlerts();
            }}
            className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-[9.5px] font-extrabold text-indigo-600 ring-1 ring-indigo-100 transition active:scale-95"
          >
            🔔 알림 켜기
          </button>
        ) : null}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          ref={inputRef}
          data-testid="note-input"
          aria-label="가족 한마디 남기기"
          value={draft}
          maxLength={NOTE_MAX_LENGTH}
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            ready
              ? isParent
                ? '예) 토요일 10시 독서록 검사할게요'
                : '예) 오늘 영어 단어 5개 외웠어요!'
              : state === 'loading'
                ? '알림판 불러오는 중…'
                : '알림판 준비 중 (Supabase SQL 1회 실행)'
          }
          className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-3 py-2.5 text-[12px] font-semibold text-slate-800 outline-none ring-1 ring-slate-900/5 placeholder:text-slate-400 focus:bg-white focus:ring-indigo-300 disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="note-submit"
          disabled={!ready || sending || draft.trim().length === 0}
          className="shrink-0 rounded-2xl bg-indigo-600 px-3 py-2.5 text-[11.5px] font-extrabold text-white shadow-sm shadow-indigo-600/25 transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {sending ? '남기는 중…' : '남기기'}
        </button>
      </form>

      {error ? (
        <p data-testid="note-error" className="mt-1.5 px-1 text-[10.5px] font-bold text-rose-500">
          {error}
        </p>
      ) : null}

      {state === 'unavailable' ? (
        <p className="mt-2 rounded-2xl bg-sky-50 px-3 py-2 text-[10.5px] font-semibold leading-relaxed text-sky-800 ring-1 ring-sky-200/70">
          알림판은 Supabase에 표(<b className="font-extrabold">family_notes</b>)를 한 번 만들면 켜져요.
          <br />
          <span className="text-sky-700/80">
            setup.html 에서 <b className="font-extrabold">SQL 복사</b> → SQL Editor에 붙여넣고 Run 한 번이면 됩니다.
            공부 목록은 지금 그대로 잘 동작해요.
          </span>
        </p>
      ) : null}

      {ready && notes.length === 0 ? (
        <p
          data-testid="notes-empty"
          className="mt-2 rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] font-semibold text-slate-400"
        >
          아직 한마디가 없어요. 첫 소식을 남겨 보세요.
        </p>
      ) : null}

      {visibleNotes.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {visibleNotes.map((note) => {
            const author = members.find((member) => member.id === note.author_id);
            const theme = memberTheme(author?.color ?? 'sky');
            const canDelete = isParent || note.author_id === currentMemberId;
            return (
              <li
                key={note.id}
                data-testid="family-note"
                className="flex items-start gap-2 rounded-2xl bg-slate-50/80 p-2.5 ring-1 ring-slate-900/5"
              >
                <span
                  aria-hidden
                  className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px]', theme.soft)}
                >
                  {author?.emoji ?? '🙂'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-extrabold text-slate-800">
                      {author?.name ?? '가족'}
                    </span>
                    <span className="text-[9px] font-semibold text-slate-400">
                      {formatNoteTime(note.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] font-semibold leading-relaxed text-slate-700">
                    {note.content}
                  </p>
                </div>
                {canDelete ? (
                  <button
                    type="button"
                    aria-label="한마디 지우기"
                    data-testid="delete-note"
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(note);
                    }}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 active:scale-90"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {notes.length > 4 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowAll((value) => !value);
          }}
          className="mt-1.5 w-full rounded-xl py-1.5 text-[10.5px] font-extrabold text-slate-400 transition hover:bg-slate-50 active:scale-[0.99]"
        >
          {showAll ? '접기' : `이전 한마디 ${notes.length - 4}개 더 보기`}
        </button>
      ) : null}
    </section>
  );
}
