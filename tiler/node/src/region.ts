import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 지역 이름(REGION 환경변수, 기본 gwanak). 예: REGION=seoul npm run s08
// 입력 fgb는 Python s05가 같은 이름으로 만든 것 (tiler/py/region.py)
export const REGION = process.env.REGION ?? "gwanak";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FGB = resolve(root, `data/work/${REGION}.fgb`);
export const TILES_DIR = resolve(root, `data/tiles/${REGION}`);

if (!existsSync(FGB))
  throw new Error(
    `${relative(root, FGB)} 없음. REGION=${REGION}로 Python s03~s05를 먼저 돌릴 것`,
  );
