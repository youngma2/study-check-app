"""안드로이드 상단 바(badge)용 실루엣 아이콘 만들기.

안드로이드 크롬은 알림의 `badge` 이미지를 작은 크기(약 24dp)로 줄여 **알파값만**
남기고 흰색(또는 시스템 색)으로 칠합니다. 그래서
  · 배경은 투명(alpha 0)
  · 심볼은 불투명 흰색(#FFFFFF)
  · 선은 두껍게, 사이 간격은 넉넉하게(작게 줄여도 뭉개지지 않게)
이어야 합니다. 앱 아이콘(분홍빛 그라데이션 배경 + 흰 달력 + 초록 체크)을 그대로
줄이면 흰 네모가 되므로, 같은 심볼(달력 + 체크)을 도형으로 다시 그립니다.

    python3 scripts/make-badge.py

만드는 파일:
  public/badge-96.png        — 96×96 상단 바용(투명 배경 + 흰 실루엣)
  public/badge-192.png       — 같은 그림 192×192(큰 배지가 필요한 곳용)
  .tmp/badge-preview.png     — 어두운/밝은 배경 위 미리보기(확인용, 배포 안 함)
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
TMP = pathlib.Path('/workspace/.tmp')

# 384 단위로 그린 뒤 줄입니다(안티에일리어싱).
S = 384
STROKE = 34          # 달력 테두리 두께
TICK = 34            # 체크 두께
RADIUS = 62          # 달력 모서리


def symbol() -> Image.Image:
    """투명 배경 위 흰색 달력+체크 실루엣(384×384)."""
    image = Image.new('L', (S, S), 0)
    draw = ImageDraw.Draw(image)

    # 달력 몸통 — 둥근 사각형 테두리
    x0, y0, x1, y1 = 40, 96, 344, 344
    draw.rounded_rectangle(
        (x0, y0, x1, y1), radius=RADIUS, outline=255, width=STROKE
    )

    # 위쪽 고리 두 개(달력 철심)
    for cx in (112, 272):
        draw.rounded_rectangle((cx - 17, 34, cx + 17, 120), radius=17, fill=255)

    # 체크 — 굵게, 끝을 둥글게
    pts = [(116, 222), (168, 278), (272, 186)]
    draw.line(pts, fill=255, width=TICK, joint='curve')
    for px, py in pts:
        draw.ellipse((px - TICK // 2, py - TICK // 2, px + TICK // 2, py + TICK // 2), fill=255)

    return image


def to_rgba(mask: Image.Image, size: int) -> Image.Image:
    """알파 마스크 → 투명 배경 + 흰색(#FFFFFF) 이미지."""
    small = mask.resize((size, size), Image.LANCZOS)
    # 줄이면서 생긴 옅은 안티에일리어싱 알파는 살립니다(모양은 그대로, 색만 흰색).
    white = Image.new('RGB', (size, size), (255, 255, 255)).convert('RGBA')
    white.putalpha(small)
    return white


def preview(badge: Image.Image) -> None:
    """상단 바에서 실제 크기(96·48·24px)로 줄었을 때 어떻게 보이는지 확인."""
    scale = 4
    tile = 96 * scale
    canvas = Image.new('RGB', (tile * 3 + 40, tile * 2 + 30), (128, 128, 128))
    for row, bg in enumerate(((22, 22, 30), (245, 246, 250))):
        for col, px in enumerate((96, 48, 24)):
            shown = badge.resize((px, px), Image.LANCZOS)
            shown = shown.resize((px * scale, px * scale), Image.NEAREST)
            plate = Image.new('RGBA', (tile, tile), bg + (255,))
            plate.alpha_composite(shown, ((tile - px * scale) // 2, (tile - px * scale) // 2))
            canvas.paste(plate.convert('RGB'), (10 + col * (tile + 10), 10 + row * (tile + 10)))
    TMP.mkdir(parents=True, exist_ok=True)
    canvas.save(TMP / 'badge-preview.png')
    print(f'미리보기: {TMP / "badge-preview.png"} · 위 어두운 바 / 아래 밝은 배경, 96·48·24px')


def main() -> int:
    mask = symbol()
    PUBLIC.mkdir(parents=True, exist_ok=True)

    for size, name in ((96, 'badge-96.png'), (192, 'badge-192.png')):
        badge = to_rgba(mask, size)
        badge.save(PUBLIC / name, optimize=True)
        alpha = badge.getchannel('A')
        corners = [alpha.getpixel(p) for p in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1))]
        opaque = sum(1 for v in alpha.getdata() if v > 200)
        colors = {px[:3] for px in badge.getdata() if px[3] > 200}
        print(
            f'{name}: {size}×{size} · 모서리 알파 {corners} · 불투명 픽셀 {opaque}'
            f'({opaque / (size * size) * 100:.1f}%) · 불투명부 색 {sorted(colors)}'
        )
        if max(corners) != 0:
            raise SystemExit(f'{name}: 모서리가 투명하지 않습니다.')
        if colors and colors != {(255, 255, 255)}:
            raise SystemExit(f'{name}: 불투명 부분이 순수 흰색이 아닙니다: {sorted(colors)[:5]}')

    preview(to_rgba(mask, 96))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
