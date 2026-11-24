"""공부 체크 앱 홈 화면 아이콘 만들기.

원본(1024~1254px, 둥근 사각형 밖이 흰색)에서 둥근 모서리 안쪽으로 살짝 잘라
흰 모서리가 하나도 없는 인디고-라벤더 그라데이션 아이콘을 만듭니다.

    python3 scripts/make-icons.py [원본.png]

만드는 파일 (public/icons/):
  icon-192.png, icon-512.png          — 그대로 쓰는 아이콘(any)
  icon-maskable-512.png               — 안드로이드 적응형(가장자리 여백 16%, 같은 그라데이션으로 채움)
  apple-touch-icon.png (180x180)      — iOS 홈 화면
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'
DEFAULT_RAW = pathlib.Path('/workspace/downloads/study_app_icon_raw.png')

# 둥근 사각형 모서리 안쪽으로 들어가는 비율(변 길이 대비). 흰 모서리가 남지 않게.
INSET_RATIO = 0.085
# maskable: 512 안에서 내용이 차지하는 비율(가장자리 여백 16% → 적응형 마스크 안전 영역 80% 이내)
MASKABLE_CONTENT_RATIO = 0.76
WHITE_CUTOFF = 735  # R+G+B 가 이보다 크면 배경(흰색)으로 봅니다


def content_square(image: Image.Image) -> tuple[int, int, int]:
    arr = np.asarray(image.convert('RGB')).astype(int)
    content = arr.sum(axis=2) < WHITE_CUTOFF
    ys, xs = np.where(content)
    if len(xs) == 0:
        raise SystemExit('원본에서 아이콘 영역을 찾지 못했습니다.')
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    side = min(x1 - x0 + 1, y1 - y0 + 1)
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    left = cx - side // 2
    top = cy - side // 2
    print(f'아이콘 영역: x {x0}~{x1}, y {y0}~{y1} ({x1 - x0 + 1}×{y1 - y0 + 1}) → 정사각 {side}px')
    return left, top, side


def check_no_white(square: Image.Image, name: str) -> None:
    arr = np.asarray(square.convert('RGB')).astype(int)
    ring = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    worst = int(ring.sum(axis=1).max())
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    print(f'{name}: 테두리 최대 밝기(RGB합) {worst} · 모서리 {[tuple(int(v) for v in c) for c in corners]}')
    if worst >= WHITE_CUTOFF:
        raise SystemExit(f'{name}: 테두리에 흰색이 남아 있습니다(합 {worst}). INSET_RATIO 를 키우세요.')


def main() -> int:
    import sys

    raw_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_RAW
    raw = Image.open(raw_path).convert('RGB')
    print(f'원본 {raw_path} {raw.size[0]}×{raw.size[1]}')

    left, top, side = content_square(raw)
    inset = int(round(side * INSET_RATIO))
    inner = side - inset * 2
    square = raw.crop((left + inset, top + inset, left + inset + inner, top + inset + inner))
    check_no_white(square, '잘라낸 사각형')

    OUT.mkdir(parents=True, exist_ok=True)

    for size, filename in ((192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')):
        icon = square.resize((size, size), Image.LANCZOS)
        icon.save(OUT / filename, optimize=True)
        print(f'{filename}: {size}×{size}')

    # maskable — 안전 영역 안에 내용을 넣고, 남는 여백은 아이콘 가장자리 그라데이션을
    # 그대로 이어 그린(2차 곡면 적합) 색으로 채웁니다. 흰색·블록 자국 없이 매끈하게.
    maskable = make_maskable(square)
    maskable.save(OUT / 'icon-maskable-512.png', optimize=True)
    print(f'icon-maskable-512.png: 512×512 (내용 {MASKABLE_CONTENT_RATIO * 100:.0f}% · 여백 12%)')

    return 0


def gradient_plane(arr: np.ndarray, band: int = 18) -> np.ndarray:
    """아이콘 테두리 안쪽 띠에서 색을 읽어 2차 곡면(그라데이션) 계수를 구합니다."""
    n = arr.shape[0]
    grid = np.arange(n)
    gx, gy = np.meshgrid(grid, grid)
    ring = (
        (gx >= 4) & (gx <= band)
        | (gx >= n - band - 1) & (gx <= n - 5)
        | (gy >= 4) & (gy <= band)
        | (gy >= n - band - 1) & (gy <= n - 5)
    )
    xs = (gx[ring] - n / 2) / (n / 2)
    ys = (gy[ring] - n / 2) / (n / 2)
    design = np.stack([np.ones_like(xs), xs, ys, xs * xs, ys * ys, xs * ys], axis=1)
    coef, *_ = np.linalg.lstsq(design, arr[ring], rcond=None)
    return coef


def paint_gradient(coef: np.ndarray, width: int, height: int, offset: int, n: int) -> np.ndarray:
    """내용 사각형이 (offset, offset)에 놓이는 캔버스 전체를 같은 그라데이션으로 채웁니다."""
    gx, gy = np.meshgrid(np.arange(width), np.arange(height))
    xs = (gx - offset - n / 2) / (n / 2)
    ys = (gy - offset - n / 2) / (n / 2)
    design = np.stack(
        [np.ones_like(xs), xs, ys, xs * xs, ys * ys, xs * ys], axis=-1
    ).reshape(-1, 6)
    plane = design @ coef
    return np.clip(plane, 0, 255).reshape(height, width, 3)


def make_maskable(square: Image.Image) -> Image.Image:
    arr = np.asarray(square).astype(float)
    n = arr.shape[0]
    offset = int(round(n * (1 - MASKABLE_CONTENT_RATIO) / (2 * MASKABLE_CONTENT_RATIO)))
    size = n + offset * 2

    canvas = paint_gradient(gradient_plane(arr), size, size, offset, n)

    # 내용이 놓이는 자리: 가장자리 20px을 부드럽게 섞어 이음매를 지웁니다.
    feather = 20
    alpha = np.ones((n, n))
    ramp = np.linspace(0, 1, feather)
    alpha[:feather, :] *= ramp[:, None]
    alpha[-feather:, :] *= ramp[::-1, None]
    alpha[:, :feather] *= ramp[None, :]
    alpha[:, -feather:] *= ramp[::-1][None, :]
    region = canvas[offset : offset + n, offset : offset + n]
    blended = arr * alpha[..., None] + region * (1 - alpha[..., None])
    canvas[offset : offset + n, offset : offset + n] = blended

    return Image.fromarray(np.round(canvas).astype(np.uint8)).resize((512, 512), Image.LANCZOS)


if __name__ == '__main__':
    raise SystemExit(main())
