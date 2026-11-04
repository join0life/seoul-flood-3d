// 측정 화면의 버튼·순서. 렌더러를 모름 → 어댑터만 받아서 1-3 Three.js 화면에도 그대로 붙임
//
// 순서: 재생 → (첫 재생이면) 타일셋 불러오기 시작 + 경로 재생 → 결과 JSON 다운로드 + console.table
// 새로고침 후 첫 재생 = first, 같은 화면에서 다시 재생 = revisit (렌더러 메모리에 타일이 남아 있는 상태)

import { play, validatePath } from "./player.js";
import { createRecorder } from "./recorder.js";
import { BENCH_CANVAS, canvasProblem } from "./canvas.js";

const STYLE =
  "position:absolute;bottom:30px;left:10px;background:#fff;padding:8px 10px;" +
  "font:12px/1.6 monospace;border-radius:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:520px";

function box() {
  const el = document.createElement("div");
  el.style.cssText = STYLE;
  document.body.append(el);
  return el;
}

function button(parent, label, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = onClick;
  parent.append(b);
  return b;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** "현재 카메라 값 복사" 버튼. path.json의 지점 하나를 그대로 붙여 넣을 수 있는 JSON을 클립보드로 */
export function mountCopyButton(getCamera, parent = box()) {
  button(parent, "현재 카메라 값 복사", async () => {
    const c = getCamera();
    // 위경도 6자리 ≈ 0.1m, 높이 0.1m, 각도 0.01°면 경로 지점으로 충분
    const point = {
      lon: round(c.lon, 6),
      lat: round(c.lat, 6),
      height: round(c.height, 1),
      heading: round(((c.heading % 360) + 360) % 360, 2),
      pitch: round(c.pitch, 2),
    };
    const text = JSON.stringify(point);
    console.log("[bench] 카메라", text);
    try {
      await navigator.clipboard.writeText(text); // localhost는 보안 컨텍스트라 허용
    } catch (e) {
      console.warn("[bench] 클립보드 실패 → 위 콘솔 값을 복사", e);
    }
  });
  return parent;
}

/**
 * captureAt(ms): 재생 시작 후 그 시각이 지난 첫 프레임의 캔버스를 PNG로 저장(?captureAt=3000). 없으면 null
 * 압축을 켰을 때와 껐을 때 같은 시각의 화면을 나란히 보려고 씀
 */
export async function mountBenchPanel({ adapter, region, pathUrl, captureAt = null }) {
  const panel = box();
  mountCopyButton(() => adapter.getCamera(), panel);
  const status = document.createElement("span");

  const path = await (await fetch(pathUrl, { cache: "no-store" })).json();
  const errors = validatePath(path);
  if (errors.length) {
    status.textContent = `path.json 미완성 (${errors.length}건, 콘솔 참고) → 평소 화면에서 "현재 카메라 값 복사"로 채울 것`;
    console.warn("[bench] path.json 문제\n" + errors.join("\n"));
    panel.append(status);
    return;
  }

  const nInput = document.createElement("select");
  for (const n of [1, 2, 3]) nInput.append(new Option(`${n}회차`, n));
  panel.append(nInput);

  let runs = 0;
  let last = null;
  let running = false;
  adapter.setCamera(path.start); // 타일은 아직 안 받음. 재생을 누르면 시작

  // 측정 캔버스(1680×928)로 그릴 수 없으면 재생을 막음. 잘린 캔버스로 잰 숫자는 다른 조건이라 비교 불가
  const ready = `${path.segments.map((s) => s.name).join(" → ")} · 재생을 누르면 타일을 받기 시작`;
  function guard() {
    if (running) return false;
    const problem = canvasProblem(adapter.describe().canvas);
    playBtn.disabled = Boolean(problem);
    if (problem) status.textContent = `⚠ 측정 불가: ${problem}`;
    else if (status.textContent.startsWith("⚠ 측정 불가")) status.textContent = ready;
    return !problem;
  }
  // 렌더러가 캔버스 크기를 다음 프레임에 맞추는 경우가 있어서 한 박자 뒤에 검사
  const afterFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.addEventListener("resize", () => afterFrames().then(guard));

  const playBtn = button(panel, "재생", async () => {
    if (!guard()) return; // 재생 직전에도 한 번 더(창 크기를 바꿨을 수 있음)
    running = true;
    playBtn.disabled = saveBtn.disabled = true;
    const kind = runs === 0 ? "first" : "revisit";
    const n = Number(nInput.value);
    const rec = createRecorder(adapter, path, { region, kind, n, canvasFixed: BENCH_CANVAS });
    runs++; // 실패한 회차도 셈: 타일이 일부 남아 있어서 다음 재생은 first가 아님
    let capture = null; // { dataUrl, atMs }

    try {
      const playStart = performance.now();
      if (captureAt !== null) {
        // toDataURL(1680×928 PNG 인코딩)이 그 프레임 작업에 섞임 → 캡처 회차는 평균에 넣지 않음
        rec.invalidate(`캡처 회차(?captureAt=${captureAt}): PNG 저장 시간이 프레임 시간에 섞임`);
      }
      rec.start();
      const loading = adapter.load(); // 재방문이면 null
      if (loading) rec.expectInitialTilesLoaded();
      loading?.then(
        () => rec.markInitialTilesLoaded(performance.now()),
        (e) => {
          // 재생은 계속 돌지만 타일 없이 잰 숫자라 invalid
          // Cesium은 Error가 아닌 RequestErrorEvent를 던질 때가 있음(.message 없음) → 문자열로
          rec.invalidate(`타일셋 불러오기 실패: ${e?.message ?? String(e)}`);
          console.error("[bench] 타일셋 불러오기 실패", e);
        },
      );
      status.textContent = `${kind} 재생 중: ${path.segments[0].name}`;
      await play(path, adapter, {
        onFrame: (now, i, workMs) => {
          rec.frame(now, i, workMs);
          // 이 콜백은 렌더 직후(Cesium scene.postRender)에 불림 → 방금 그린 화면을 읽을 수 있음
          if (captureAt !== null && !capture && now - playStart >= captureAt)
            capture = { dataUrl: adapter.captureNow(), atMs: Math.round(now - playStart) };
        },
        onSegmentEnd: (i, camera) => {
          rec.endSegment(i, camera);
          // 완료 확인용: 두 번 돌려서 같은 구간 끝 값이 나오는지 비교
          console.log(`[bench] 구간 끝 ${path.segments[i].name}`, JSON.stringify(camera));
          const next = path.segments[i + 1];
          if (next) status.textContent = `${kind} 재생 중: ${next.name}`;
        },
      });
      rec.stopNetwork();
      const contentEncoding = await probeEncoding(adapter.describe().tilesetUrl);
      last = rec.finish({ contentEncoding });
      report(last);
      if (captureAt !== null) saveCapture(capture, captureAt, contentEncoding, last.totalMs);
    } catch (e) {
      // 중간에 깨진 회차는 결과를 버림 (finish는 숨김 감지 리스너를 풀려고만 부름)
      rec.finish();
      status.textContent = `⚠ 재생 실패: ${String(e?.message ?? e).split("\n")[0]} → 새로고침 후 다시 잴 것`;
      console.error("[bench] 재생 실패", e);
    } finally {
      running = false;
      playBtn.disabled = false;
      saveBtn.disabled = last === null;
      guard();
    }
  });

  function report(r) {
    const initial = r.initialTilesPending ? `재생 끝까지 미완료(> ${r.totalMs}ms)` : `${r.initialTilesLoadedMs}ms`;
    console.log(`[bench] ${fileName(r)}  initialTilesLoaded ${initial}`);
    console.log("[bench] 전송", r.env.transfer);
    console.table(
      r.segments.map((s) => ({
        구간: s.name,
        프레임: s.frames,
        평균ms: s.avgFrameMs,
        최대ms: s.maxFrameMs,
        "느린%": round(s.slowFrameRatio * 100, 1),
        작업평균ms: s.avgWorkMs,
        작업p95ms: s.p95WorkMs,
        작업최대ms: s.maxWorkMs,
        불러옴: s.tilesLoaded,
        내림: s.tilesUnloaded,
        대기요청: s.pendingRequestsAtEnd,
        메모리MB: round(s.memoryBytesAtEnd / 1e6, 1),
      })),
    );
    status.textContent = `끝: ${fileName(r)} (다음 재생은 revisit)`;
    if (!r.valid) {
      status.textContent = `⚠ invalid: ${fileName(r)} · ${r.invalidReasons[0]} → 다시 잴 것`;
      console.warn("[bench] invalid (summarize 평균에서 빠짐)\n" + r.invalidReasons.join("\n"));
    }
  }

  const saveBtn = button(panel, "JSON 다운로드", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], { type: "application/json" }));
    a.download = fileName(last);
    a.click();
    URL.revokeObjectURL(a.href);
  });
  saveBtn.disabled = true;
  status.textContent = ready;
  panel.append(status);
  await afterFrames();
  guard();
}

/**
 * 그 주소를 받을 때 서버가 실제로 고른 압축 방식. Cesium이 보낸 요청의 응답 헤더는 JS에서 못 읽어서
 * 재생이 끝난 뒤 같은 주소로 HEAD를 한 번 보냄(측정 시간에는 안 들어감). 브라우저가 붙이는 Accept-Encoding은 같음
 */
async function probeEncoding(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.headers.get("content-encoding") ?? "identity";
  } catch {
    return null;
  }
}

const fileName = (r) => `${r.renderer}_${r.region}_${r.kind}_${r.n}.json`;

/**
 * 캡처 PNG 다운로드: capture_{br|gzip|none}_{captureAt}ms.png
 * 압축 여부는 재생 뒤 probeEncoding 결과(서버가 실제로 보낸 것). 재생 중에 확인하면 요청이 측정에 섞여서 끝나고 저장
 */
function saveCapture(capture, captureAt, contentEncoding, totalMs) {
  if (!capture) {
    console.warn(`[bench] 캡처 없음: captureAt ${captureAt}ms가 재생 시간(${totalMs}ms)보다 김`);
    return;
  }
  const enc = contentEncoding === "identity" ? "none" : (contentEncoding ?? "unknown");
  const a = document.createElement("a");
  a.href = capture.dataUrl;
  a.download = `capture_${enc}_${captureAt}ms.png`;
  a.click();
  console.log(`[bench] 캡처 저장 ${a.download} (실제 ${capture.atMs}ms 프레임)`);
}
