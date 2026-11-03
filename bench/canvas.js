// 측정 캔버스 크기 고정. 렌더러를 모름 → Cesium 페이지와 내 렌더러가 같은 값을 씀
//
// 왜 고정하나: 그리는 픽셀 수가 다르면 프레임 시간을 비교할 수 없음(1365×928은 1680×928보다 약 19% 적음).
// 창 크기를 손으로 맞추면 매번 어긋나므로, ?bench=1일 때만 컨테이너를 CSS 픽셀로 못 박음.
// pixelRatio 1과 같이 쓰면 드로잉 버퍼 = 1680×928

export const BENCH_CANVAS = { width: 1680, height: 928 };

/** 컨테이너를 측정 크기로 고정 (창이 더 커도 왼쪽 위에 이 크기로만 그림) */
export function fixCanvasContainer(el) {
  Object.assign(el.style, {
    width: `${BENCH_CANVAS.width}px`,
    height: `${BENCH_CANVAS.height}px`,
    flex: "none",
  });
  // 창보다 크면 스크롤바가 생겨 화면이 밀림 → 측정 중에는 스크롤 없음
  document.documentElement.style.overflow = document.body.style.overflow = "hidden";
}

/**
 * 측정해도 되는 상태인지. 문제가 있으면 이유 문자열, 없으면 null
 * canvas = 어댑터 describe().canvas ({ cssWidth, cssHeight, width, height })
 */
export function canvasProblem(canvas) {
  const { width: W, height: H } = BENCH_CANVAS;
  // 창이 작으면 캔버스 일부가 화면 밖으로 잘림 → 화면에 안 보이는 부분은 브라우저가 다르게 다룰 수 있어 막음
  if (window.innerWidth < W || window.innerHeight < H)
    return `창 ${window.innerWidth}×${window.innerHeight}가 측정 캔버스 ${W}×${H}보다 작음 → 창을 키우고 새로고침`;
  if (canvas && (canvas.width !== W || canvas.height !== H))
    return `드로잉 버퍼 ${canvas.width}×${canvas.height} ≠ ${W}×${H}`;
  return null;
}
