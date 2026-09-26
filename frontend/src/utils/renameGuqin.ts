import { db } from './db';
import { toPlain } from './plain';
import { cumulativeThickness } from './layer';
import type { WoodBoard, BoardPart } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';

/** 改琴号（跨工序迁移）的执行清单与结果汇报 */
export interface RenamePlan {
  from: string;
  to: string;
  /** 旧琴号下要一起搬走的全部板材 */
  movingBoards: WoodBoard[];
  /** 新琴号上原有的板材（用于提示部位撞车） */
  targetBoards: WoodBoard[];
  /** 搬过去后新琴号上重复的部位（两面板/两底板，均保留，由人工挑板） */
  duplicateParts: BoardPart[];
  /** 旧琴号的槽腹：新号无槽腹时搬走，否则留在旧号 */
  movingChamber?: SoundChamber;
  /** 新琴号原有的槽腹：存在则保留这份，搬过来的不能盖掉 */
  keptChamber?: SoundChamber;
  /** 旧琴号的上弦：新号无上弦时搬走，否则留在旧号 */
  movingStringing?: Stringing;
  /** 新琴号原有的上弦：存在则保留这份，搬过来的不能盖掉 */
  keptStringing?: Stringing;
  /** 旧琴号要搬走的髹漆遍次 */
  movingLayers: LacquerLayer[];
  /** 新琴号原有的髹漆遍次（与搬来的合并，不覆盖） */
  targetLayers: LacquerLayer[];
}

/**
 * 生成改琴号迁移清单（纯函数，供确认弹窗预览）。
 * 板材：旧琴号下的全部板材一起搬；槽腹/上弦：一琴一份，新号已有则保留新号原件；
 * 髹漆：两边遍次合并。
 */
export function planRename(
  boards: WoodBoard[],
  chambers: SoundChamber[],
  layers: LacquerLayer[],
  stringings: Stringing[],
  from: string,
  to: string,
): RenamePlan {
  const movingBoards = boards.filter((b) => b.guqinNo === from);
  const targetBoards = boards.filter((b) => b.guqinNo === to);
  const movingParts = new Set(movingBoards.map((b) => b.part));
  const duplicateParts = (['面板', '底板'] as BoardPart[]).filter(
    (part) => movingParts.has(part) && targetBoards.some((b) => b.part === part),
  );

  const movingLayers = layers.filter((l) => l.guqinNo === from);
  const targetLayers = layers.filter((l) => l.guqinNo === to);

  return {
    from,
    to,
    movingBoards,
    targetBoards,
    duplicateParts,
    movingChamber: chambers.find((c) => c.guqinNo === from),
    keptChamber: chambers.find((c) => c.guqinNo === to),
    movingStringing: stringings.find((s) => s.guqinNo === from),
    keptStringing: stringings.find((s) => s.guqinNo === to),
    movingLayers,
    targetLayers,
  };
}

/** 髹漆遍次按施工日期排序（同日保留原有先后） */
function sortByAppliedAt(layers: LacquerLayer[]): LacquerLayer[] {
  return [...layers].sort((a, b) => {
    const byTime = new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
    if (byTime !== 0) return byTime;
    return a.seq - b.seq;
  });
}

/**
 * 执行跨工序改琴号：板材/槽腹/髹漆/上弦在同一个事务内搬到新琴号。
 *
 * 不覆盖原则：新琴号已有槽腹或上弦的，保留新号原来那份，旧号那份留在原处不搬；
 * 髹漆遍次与新号原有遍次合并，按施工日期重排遍次并重算累计厚度，谁也不盖谁。
 */
export async function executeRename(plan: RenamePlan): Promise<void> {
  const { from, to } = plan;
  if (!from.trim() || !to.trim()) {
    throw new Error('旧琴号与新琴号都不能为空');
  }
  if (from === to) {
    throw new Error('新琴号与旧琴号相同，无需迁移');
  }

  await db.transaction('rw', db.boards, db.chambers, db.lacquers, db.stringings, async () => {
    // 板材：旧琴号下的面板、底板等全部板材一起搬到新琴号
    for (const board of plan.movingBoards) {
      await db.boards.put(toPlain({ ...board, guqinNo: to }));
    }

    // 槽腹：新号已有槽腹则保留新号那份，旧号槽腹留在原处（不删、不盖）
    if (plan.movingChamber && !plan.keptChamber) {
      await db.chambers.put(toPlain({ ...plan.movingChamber, guqinNo: to }));
    }

    // 上弦：同上，新号已有上弦则保留新号那份
    if (plan.movingStringing && !plan.keptStringing) {
      await db.stringings.put(toPlain({ ...plan.movingStringing, guqinNo: to }));
    }

    // 髹漆：两边遍次合并，新号原有遍次排前，按施工日期重排并重算累计厚度
    if (plan.movingLayers.length) {
      const merged = sortByAppliedAt([...plan.targetLayers, ...plan.movingLayers]).map((layer, index) => {
        const seq = index + 1;
        return {
          ...layer,
          guqinNo: to,
          seq,
          totalThickness: 0,
        };
      });
      const withTotals = merged.map((layer) => ({
        ...layer,
        totalThickness: cumulativeThickness(merged, layer.seq),
      }));
      await db.lacquers.bulkPut(toPlain(withTotals));
    }
  });
}
