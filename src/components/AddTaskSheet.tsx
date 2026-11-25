import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { SUBJECTS } from '../lib/theme';
import type { ActionResult } from '../lib/study-context';
import type { Member, NewTaskInput, Task } from '../lib/types';
import { Sheet } from './Sheet';

interface AddTaskSheetProps {
  open: boolean;
  onClose: () => void;
  members: Member[];
  actor: Member;
  defaultDate: string;
  defaultMemberId: string;
  editing: Task | null;
  onSave: (input: NewTaskInput, editingId?: string) => Promise<ActionResult>;
}

const inputClass =
  'w-full rounded-xl border-0 bg-slate-100 px-3.5 py-2.5 text-[13px] font-semibold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 px-0.5 text-[11px] font-bold text-slate-500">{children}</p>;
}

export function AddTaskSheet({
  open,
  onClose,
  members,
  actor,
  defaultDate,
  defaultMemberId,
  editing,
  onSave,
}: AddTaskSheetProps) {
  const isChildView = actor.role === 'child';
  const [memberId, setMemberId] = useState(defaultMemberId);
  const [subject, setSubject] = useState('math');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setMemberId(editing.member_id);
      setSubject(editing.subject);
      setTitle(editing.title);
      setDate(editing.due_date);
    } else {
      setMemberId(defaultMemberId);
      setSubject('math');
      setTitle('');
      setDate(defaultDate);
    }
  }, [open, editing, defaultMemberId, defaultDate]);

  const selectedMember = members.find((member) => member.id === memberId) ?? members[0];

  const applyPreset = (presetTitle: string, presetSubject: string) => {
    setTitle(presetTitle);
    setSubject(presetSubject);
    setError(null);
  };

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError('무엇을 공부하는지 적어 주세요.');
      return;
    }
    setSaving(true);
    try {
      const result = await onSave(
        { member_id: memberId, title: trimmed, subject, due_date: date },
        editing?.id,
      );
      if (!result.ok) {
        setError(result.error ?? '저장하지 못했어요.');
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? '공부 항목 수정' : '공부 항목 추가'}
      subtitle={
        isChildView
          ? '완료하면 부모님이 확인해 줄 수 있어요.'
          : '추가한 항목은 아이가 완료 요청을 보낼 수 있어요.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FieldLabel>누구 공부인가요?</FieldLabel>
          {isChildView ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5">
              <span className="text-base" aria-hidden>
                {actor.emoji}
              </span>
              <span className="text-[13px] font-extrabold text-slate-800">{actor.name} (내 공부)</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  disabled={Boolean(editing)}
                  onClick={() => setMemberId(member.id)}
                  className={cx(
                    'flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[12.5px] font-extrabold transition active:scale-[0.98] disabled:opacity-60',
                    memberId === member.id
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                      : 'bg-slate-100 text-slate-600',
                  )}
                >
                  <span aria-hidden>{member.emoji}</span>
                  {member.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <FieldLabel>과목</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {SUBJECTS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSubject(item.key)}
                className={cx(
                  'rounded-full px-3 py-1.5 text-[11.5px] font-bold ring-1 transition active:scale-95',
                  subject === item.key
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-500 ring-slate-200',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>무엇을 하나요?</FieldLabel>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            placeholder="예) 문제집과 오답 노트"
            maxLength={60}
            className={inputClass}
            autoFocus={!editing}
          />
          {selectedMember && selectedMember.presets.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedMember.presets.map((preset) => (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => applyPreset(preset.title, preset.subject)}
                  className="rounded-full bg-slate-50 px-2.5 py-1 text-[10.5px] font-bold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 active:scale-95"
                >
                  + {preset.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <FieldLabel>날짜</FieldLabel>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={cx(inputClass, 'appearance-none')}
          />
        </div>

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600">{error}</p>
        ) : null}

        <button
          type="submit"
          data-testid="save-task"
          disabled={saving}
          className="w-full rounded-2xl bg-indigo-600 py-3.5 text-[13px] font-extrabold text-white shadow-float transition active:scale-[0.99] disabled:opacity-60"
        >
          {saving ? '저장 중…' : editing ? '수정 저장' : '추가하기'}
        </button>
      </form>
    </Sheet>
  );
}
