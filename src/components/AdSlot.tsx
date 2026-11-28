/**
 * 📢 광고 슬롯 자리 (13번 · 추후 상용화 대비)
 *
 * 앱(.apk)으로 상용화할 때 중간 배너 광고를 넣을 자리를 **지금부터 비워 둡니다.**
 * · `ADS_ENABLED = false` 인 동안에는 화면에 아무것도 그리지 않습니다(높이 0 · 눈에 거슬리지 않게).
 * · 나중에 광고를 붙일 때 이 상수만 true 로 바꾸고 AdSlot 안에 배너(스크립트/이미지)를 넣으면,
 *   자리 잡기(레이아웃)를 다시 손대지 않아도 됩니다.
 * · 광고를 지우는 옵션(결제)을 넣을 때는 `AdSlot` 을 `adFree` 로 감싸면 됩니다.
 *
 * 지금 우리 가족이 쓰는 화면에는 광고가 전혀 뜨지 않습니다.
 */
export const ADS_ENABLED = false;

interface AdSlotProps {
  /** 어느 화면의 자리인지 (테스트·나중 배치용 이름) */
  where: 'main' | 'child' | 'parent';
  /** 광고 지우기(결제) 사용자면 자리를 차지하지 않습니다. */
  adFree?: boolean;
}

export function AdSlot({ where, adFree = false }: AdSlotProps) {
  if (!ADS_ENABLED || adFree) {
    // 자리만 기억해 두고 화면에는 아무것도 보이지 않습니다(hidden → 높이 0).
    return <div data-testid={`ad-slot-${where}`} data-ad-slot={where} hidden aria-hidden="true" />;
  }
  return (
    <div
      data-testid={`ad-slot-${where}`}
      data-ad-slot={where}
      aria-label="광고"
      className="mt-2.5 flex min-h-[64px] items-center justify-center rounded-2xl bg-white text-[10px] font-bold text-slate-300 ring-1 ring-slate-900/5"
    >
      광고 자리
    </div>
  );
}
