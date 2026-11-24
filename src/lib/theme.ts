import type { MemberColor } from './types';

export interface SubjectMeta {
  key: string;
  label: string;
  /** 작은 타일 안에 들어가는 한 글자 */
  short: string;
  tile: string;
  dot: string;
}

export const SUBJECTS: SubjectMeta[] = [
  { key: 'korean', label: '국어', short: '국', tile: 'bg-rose-50 text-rose-500 ring-rose-100', dot: 'bg-rose-400' },
  { key: 'english', label: '영어', short: '영', tile: 'bg-sky-50 text-sky-500 ring-sky-100', dot: 'bg-sky-400' },
  { key: 'math', label: '수학', short: '수', tile: 'bg-indigo-50 text-indigo-500 ring-indigo-100', dot: 'bg-indigo-400' },
  { key: 'science', label: '과학', short: '과', tile: 'bg-emerald-50 text-emerald-500 ring-emerald-100', dot: 'bg-emerald-400' },
  { key: 'reading', label: '독서', short: '독', tile: 'bg-amber-50 text-amber-600 ring-amber-100', dot: 'bg-amber-400' },
  { key: 'etc', label: '기타', short: '기', tile: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
];

const FALLBACK = SUBJECTS[SUBJECTS.length - 1];

export function subjectMeta(key: string): SubjectMeta {
  return SUBJECTS.find((subject) => subject.key === key) ?? FALLBACK;
}

export interface MemberTheme {
  avatar: string;
  soft: string;
  text: string;
  bar: string;
  ring: string;
}

export const MEMBER_THEMES: Record<MemberColor, MemberTheme> = {
  sky: {
    avatar: 'bg-sky-100 text-sky-600',
    soft: 'bg-sky-50',
    text: 'text-sky-600',
    bar: 'bg-sky-400',
    ring: 'ring-sky-200',
  },
  violet: {
    avatar: 'bg-violet-100 text-violet-600',
    soft: 'bg-violet-50',
    text: 'text-violet-600',
    bar: 'bg-violet-400',
    ring: 'ring-violet-200',
  },
  rose: {
    avatar: 'bg-rose-100 text-rose-600',
    soft: 'bg-rose-50',
    text: 'text-rose-600',
    bar: 'bg-rose-400',
    ring: 'ring-rose-200',
  },
  amber: {
    avatar: 'bg-amber-100 text-amber-600',
    soft: 'bg-amber-50',
    text: 'text-amber-600',
    bar: 'bg-amber-400',
    ring: 'ring-amber-200',
  },
};

export function memberTheme(color: MemberColor): MemberTheme {
  return MEMBER_THEMES[color] ?? MEMBER_THEMES.sky;
}
