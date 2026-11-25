import { useId } from 'react';
import { cx } from '../lib/cx';
import { DIVISIONS, type TierKey } from '../lib/season';
import { useStudy } from '../lib/study-context';

/**
 * 🏆 티어 엠블럼 — 브론즈·실버·골드·플래티넘·다이아·마스터를
 * 방패·보석·왕관 모양의 작은 SVG 아이콘으로 그립니다.
 * (이모지 대신 직접 그린 도형이라 이름 옆 14px 에서도 또렷하게 보입니다)
 */

export type EmblemSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Record<EmblemSize, number> = { xs: 14, sm: 18, md: 30, lg: 46 };
/** 작은 크기에서는 세부 단계 점을 생략합니다(보이지 않아서). */
const PIPS_FROM: EmblemSize[] = ['md', 'lg'];

interface Palette {
  from: string;
  to: string;
  edge: string;
  inner: string;
  glow: string;
}

const PALETTES: Record<TierKey, Palette> = {
  bronze: { from: '#d59a63', to: '#8a4a20', edge: '#6f3814', inner: '#ffe9d3', glow: '#c980501f' },
  silver: { from: '#dfe7ef', to: '#7f8b99', edge: '#5c6875', inner: '#ffffff', glow: '#9aa6b31f' },
  gold: { from: '#ffd75e', to: '#d0870f', edge: '#9d620a', inner: '#fff8dc', glow: '#f0b42924' },
  platinum: { from: '#8ff0e9', to: '#2b97a3', edge: '#1d7280', inner: '#e8fffd', glow: '#38d9d924' },
  diamond: { from: '#a9d1ff', to: '#3a63d8', edge: '#2a49ab', inner: '#f0f8ff', glow: '#5b8def24' },
  master: { from: '#c99bff', to: '#5b21b6', edge: '#46178f', inner: '#ffe9b0', glow: '#a855f729' },
};

export const TIER_LABEL: Record<TierKey, string> = {
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아',
  master: '마스터',
};

interface TierEmblemProps {
  tier: TierKey;
  /** 3 = III, 2 = II, 1 = I, 0 = 마스터 */
  division?: number;
  size?: EmblemSize;
  className?: string;
  /** 아이 이름 — 읽어 주는 이름표에 씁니다. 없으면 티어 이름만. */
  label?: string;
}

export function TierEmblem({ tier, division = 0, size = 'sm', className, label }: TierEmblemProps) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const palette = PALETTES[tier] ?? PALETTES.bronze;
  const px = SIZE_PX[size];
  const gradientId = `tier-grad-${uid}`;
  const shineId = `tier-shine-${uid}`;
  const showPips = PIPS_FROM.includes(size) && tier !== 'master' && division >= 1;

  const fill = `url(#${gradientId})`;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      className={cx('shrink-0', className)}
      role="img"
      aria-label={`${label ? `${label} ` : ''}${TIER_LABEL[tier]}${division >= 1 && division <= 3 ? ` ${DIVISIONS[division]}` : ''} 티어`}
      data-tier={tier}
      data-division={division}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="55%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
        <linearGradient id={shineId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {tier === 'master' ? <Crown fill={fill} edge={palette.edge} inner={palette.inner} shine={`url(#${shineId})`} /> : null}
      {tier === 'diamond' ? <Gem fill={fill} edge={palette.edge} inner={palette.inner} shine={`url(#${shineId})`} /> : null}
      {tier === 'platinum' ? <HexGem fill={fill} edge={palette.edge} inner={palette.inner} shine={`url(#${shineId})`} /> : null}
      {tier === 'bronze' || tier === 'silver' || tier === 'gold' ? (
        <Shield fill={fill} edge={palette.edge} inner={palette.inner} shine={`url(#${shineId})`} chevrons={tier === 'bronze' ? 1 : tier === 'silver' ? 2 : 3} />
      ) : null}

      {showPips ? (
        <g fill={palette.inner} stroke={palette.edge} strokeWidth={0.5}>
          {Array.from({ length: division }, (_, index) => (
            <circle key={index} cx={12 + (index - (division - 1) / 2) * 3.1} cy={19.4} r={1.05} />
          ))}
        </g>
      ) : null}
      {!showPips ? <circle cx={12} cy={12} r={11.4} fill="none" stroke={palette.edge} strokeOpacity={0.16} strokeWidth={0.7} /> : null}
    </svg>
  );
}

function Shield({ fill, edge, inner, shine, chevrons }: { fill: string; edge: string; inner: string; shine: string; chevrons: number }) {
  const rows = chevrons === 1 ? [13.2] : chevrons === 2 ? [11.4, 14.4] : [9.6, 12.6, 15.6];
  return (
    <g>
      <path d="M12 2.4 4.5 5.2v6.1c0 4.7 3.1 8.5 7.5 10.2 4.4-1.7 7.5-5.5 7.5-10.2V5.2z" fill={fill} stroke={edge} strokeWidth={0.85} strokeLinejoin="round" />
      <path d="M12 2.4 4.5 5.2v3.1c2.6.9 5 1.3 7.5 1.3s4.9-.4 7.5-1.3V5.2z" fill={shine} />
      <g stroke={inner} strokeWidth={1.45} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {rows.map((y) => (
          <path key={y} d={`M8.3 ${y} 12 ${y + 2.3} 15.7 ${y}`} />
        ))}
      </g>
    </g>
  );
}

function HexGem({ fill, edge, inner, shine }: { fill: string; edge: string; inner: string; shine: string }) {
  return (
    <g>
      <path d="M12 2.3 19.7 6.8v10.4L12 21.7 4.3 17.2V6.8z" fill={fill} stroke={edge} strokeWidth={0.85} strokeLinejoin="round" />
      <path d="M12 2.3 19.7 6.8H4.3z" fill={shine} />
      <g stroke={inner} strokeWidth={1.1} strokeLinecap="round" fill="none" strokeOpacity={0.9}>
        <path d="M7.4 9.1h9.2M12 9.1v9.2M9.4 6.8h5.2" />
      </g>
      <path d="M12 12.2 9.7 9.1l2.3-2.3 2.3 2.3z" fill={inner} fillOpacity={0.85} />
    </g>
  );
}

function Gem({ fill, edge, inner, shine }: { fill: string; edge: string; inner: string; shine: string }) {
  return (
    <g>
      <path d="M12 1.9 21.1 9.2 12 22.1 2.9 9.2z" fill={fill} stroke={edge} strokeWidth={0.85} strokeLinejoin="round" />
      <path d="M12 1.9 21.1 9.2H2.9z" fill={shine} />
      <g stroke={inner} strokeWidth={0.95} strokeLinecap="round" strokeOpacity={0.9}>
        <path d="M6.1 9.2h11.8M12 9.2v12.2M8.6 9.2 12 22.1M15.4 9.2 12 22.1M8.6 9.2 12 4.1l3.4 5.1" />
      </g>
    </g>
  );
}

function Crown({ fill, edge, inner, shine }: { fill: string; edge: string; inner: string; shine: string }) {
  return (
    <g>
      <path d="M3.2 8.4 7.4 11.6 12 4.4l4.6 7.2 4.2-3.2-1.7 11.1H4.9z" fill={fill} stroke={edge} strokeWidth={0.85} strokeLinejoin="round" />
      <path d="M3.2 8.4 7.4 11.6 12 4.4v3.9z" fill={shine} />
      <rect x="5.6" y="17.2" width="12.8" height="2.5" rx="1.2" fill={fill} stroke={edge} strokeWidth={0.8} />
      <g fill={inner} stroke={edge} strokeWidth={0.5}>
        <circle cx="3.6" cy="8" r="1.5" />
        <circle cx="12" cy="3.7" r="1.6" />
        <circle cx="20.4" cy="8" r="1.5" />
        <circle cx="12" cy="13.4" r="1.5" />
      </g>
    </g>
  );
}

/** 아이 id 로 지금 티어를 자동으로 붙입니다 — 티어가 오르면 이름 옆 아이콘이 따라 바뀝니다. */
export function TierEmblemFor({
  memberId,
  size = 'xs',
  className,
}: {
  memberId: string;
  size?: EmblemSize;
  className?: string;
}) {
  const study = useStudy();
  const stats = study.seasonStatsFor(memberId);
  if (!stats) return null;
  return <TierEmblem tier={stats.level.key} division={stats.level.division} size={size} className={className} />;
}
