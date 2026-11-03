import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 지역 이름(REGION 환경변수, 기본 gwanak). 예: REGION=seoul npm run s08
// 지역 목록은 tiler/regions.json 하나에 있음 (Python tiler/py/region.py도 같은 파일을 읽음)
// 입력 fgb는 Python s05가 같은 이름으로 만든 것
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REGIONS: Record<string, { building: string; description: string }> =
  JSON.parse(readFileSync(resolve(root, "tiler/regions.json"), "utf8"));

// Python(SystemExit)과 같은 모양: 메시지 한 줄 + 종료 코드 1.
// process.exit는 try/catch로 잡을 수 없음 → 스크립트 진입점용. 테스트 등에서 재사용하려면 throw로 바꿀 것
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

// 검사 먼저, 경로는 그다음
export const REGION = process.env.REGION ?? "gwanak";
if (!Object.hasOwn(REGIONS, REGION))
  fail(
    `REGION='${REGION}'는 없는 지역. 가능한 값: ${Object.keys(REGIONS).join(", ")}`,
  );

export const FGB = resolve(root, `data/work/${REGION}.fgb`);
export const TILES_DIR = resolve(root, `data/tiles/${REGION}`);
if (!existsSync(FGB))
  fail(
    `${relative(root, FGB)} 없음. REGION=${REGION}로 Python s03~s05를 먼저 돌릴 것`,
  );
