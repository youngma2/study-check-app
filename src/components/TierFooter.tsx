import { useState } from 'react';
import { cx } from '../lib/cx';
import { DIVISIONS, TIERS, tierThreshold } from '../lib/season';
import { useStudy } from '../lib/study-context';
import { TierEmblem } from './TierBadge';

/**
 * 🏆 티어 범례 + 📅 월말 결산 (⑨·⑩ · 3차 1번)
 *
 * 아이 화면과 부모(관리자) 화면 **맨 아래**에 공통으로 붙습니다.
 * · 범례: 지금 난이도(%) 기준의 티어 구간
 * · 결산: 기본은 **최근 3개월**, [자세히]를 누르면 최대 1년치(12개월)까지 펼침(다시 누르면 접힘)
 */

/** 기본으로 보여 줄 개월 수 */
const COLLAPSED_MONTHS = 3;
/** [자세히]로 펼쳤을 때 최대 개월 수(1년) */
const EXPANDED_MONTHS = 12;

function seasonLabel(season: string): string {
  const [year, month] = season.split('-');
  return `${year}.${month}`;
}

export function TierFooter() {
  const study = useStudy();
  const difficulty = study.appSettings.tierDifficulty;
  /** 1번 — 기본 3개월, [자세히]로 12개월까지 */
  const [expanded, setExpanded] = useState(false);
  const targets = study.isParent ? study.children : study.children.filter((member) => member.id === study.currentMember.id);

  return (
    <section data-testid="tier-footer" className="mt-4 space-y-2.5 pb-2">
      <div
        data-testid="tier-legend"
        className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold text-slate-800">🏆 티어 등급 범례</p>
          <span data-testid="tier-legend-difficulty" className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8.5px] font-extrabold text-slate-500">
            난이도 {difficulty === 0 ? '기본(0%)' : `${difficulty > 0 ? '+' : ''}${difficulty}%`}
          </span>
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {TIERS.map((tier) => {
            const min = tierThreshold(tier.min, difficulty);
            const max = tier.max === null ? null : tierThreshold(tier.max + 1, difficulty) - 1;
            return (
              <li
                key={tier.key}
                data-testid={`tier-legend-${tier.key}`}
                className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[10px] font-bold text-slate-600"
              >
                <TierEmblem tier={tier.key} division={0} size="xs" />
                <span className="w-14 shrink-0 font-extrabold text-slate-800">
                  {tier.emoji} {tier.label}
                </span>
                <span className="tabular-nums text-slate-400">
                  {max === null ? `${min} XP 이상` : `${min} ~ ${max} XP`}
                </span>
                <span className="ml-auto shrink-0 text-[8.5px] font-bold text-slate-300">
                  {tier.key === 'master' ? '최고 등급' : `${DIVISIONS[3]}·${DIVISIONS[2]}·${DIVISIONS[1]} 3단계`}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[8.5px] font-semibold leading-relaxed text-slate-400">
          XP 는 부모 확인 완료 기준 · 당일 100% · 하루 지남 50% · 이틀 이상 25% · 큰 티어 승급마다 🎁 뽑기 상자
        </p>
      </div>

      <div
        data-testid="monthly-log"
        className="rounded-[22px] bg-white p-3 shadow-card ring-1 ring-slate-900/5"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold text-slate-800">📅 월말 결산 (최근 12개월)</p>
          <button
            type="button"
            data-testid="monthly-log-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500 transition active:scale-95"
          >
            {expanded ? '접기' : '자세히'}
          </button>
        </div>
        <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
          기본 최근 {COLLAPSED_MONTHS}개월 · [자세히]를 누르면 1년치({EXPANDED_MONTHS}개월)까지 펼쳐요.
          그 달 마지막 날 기준 최종 티어이고, 난이도를 바꿔도 지난 결산은 그대로 남습니다.
        </p>

        {targets.length === 0 ? (
          <p className="mt-1.5 text-[10px] font-bold text-slate-400">아직 아이가 등록되지 않았어요.</p>
        ) : (
          targets.map((member) => {
            const all = study.monthlySettlementsFor(member.id);
            const list = all.slice(0, expanded ? EXPANDED_MONTHS : COLLAPSED_MONTHS);
            return (
              <div key={member.id} data-testid={`monthly-log-${member.id}`} className="mt-2">
                <p className="text-[10px] font-extrabold text-slate-600">
                  {member.emoji} {member.name}
                  <span className="ml-1 text-[8.5px] font-bold text-slate-400">
                    {list.length}/{all.length}개월
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {list.map((month) => {
                    const empty = month.xp <= 0;
                    return (
                      <li
                        key={month.season}
                        data-testid={`monthly-row-${member.id}-${month.season}`}
                        className={cx(
                          'flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[9.5px] font-bold',
                          empty ? 'text-slate-300' : 'text-slate-600',
                        )}
                      >
                        <span className="w-12 shrink-0 tabular-nums">{seasonLabel(month.season)}</span>
                        {empty ? (
                          <span>기록 없음</span>
                        ) : (
                          <>
                            <TierEmblem tier={month.level.key} division={month.level.division} size="xs" />
                            <span className="font-extrabold text-slate-800">{month.level.title}</span>
                            <span className="ml-auto shrink-0 tabular-nums text-slate-400">{Math.round(month.xp)} XP</span>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
