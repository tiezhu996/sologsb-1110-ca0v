import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain, toPlainList } from '../utils/plain';
import { pairBoards, boardUsable } from '../utils/wood';
import { cumulativeThickness } from '../utils/layer';
import { useChamberStore } from './chamberStore';
import { useLacquerStore } from './lacquerStore';
import { useStringingStore } from './stringingStore';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { BoardPart, BoardPair, WoodBoard, WoodDefect, WoodGrain, WoodSpecies } from '../types/wood-board';

export interface BoardInput {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt?: string;
  remark?: string;
}

interface BoardState {
  boards: WoodBoard[];
  hydrated: boolean;
}

/** 槽腹/上弦迁移结果：搬走或因新号已有而被留下（保留新号原有那份） */
export interface RecordMigration<T> {
  moved: T | undefined;
  kept: T | undefined;
}

/** 改琴号的跨工序迁移报告：板材页据此向档案员说清搬了什么、留了什么 */
export interface GuqinMigrationReport {
  from: string;
  to: string;
  boardNos: string[];
  chamber: RecordMigration<SoundChamber>;
  stringings: RecordMigration<Stringing>[];
  /** 合并到新号的髹漆遍次（遍次已重排、累计厚度已重算） */
  movedLayerIds: string[];
  /** 新号原有髹漆遍次，保持原序不动 */
  keptLayerIds: string[];
}

/** 板材与面板/底板配对 */
export const useBoardStore = defineStore('board', {
  state: (): BoardState => ({ boards: [], hydrated: false }),

  getters: {
    /** 面板与底板按琴号配对并回显含水率 */
    pairs(state): BoardPair[] {
      return pairBoards(state.boards);
    },
    /** 可用板材数（无裂纹且阴干达标） */
    usableCount(state): number {
      return state.boards.filter(boardUsable).length;
    },
    guqinNos(state): string[] {
      return Array.from(new Set(state.boards.map((b) => b.guqinNo))).sort();
    },
    boardsOf(state) {
      return (guqinNo: string): WoodBoard[] => state.boards.filter((b) => b.guqinNo === guqinNo);
    },
  },

  actions: {
    async hydrate() {
      this.boards = await db.boards.orderBy('boardNo').toArray();
      this.hydrated = true;
    },

    async addBoard(input: BoardInput): Promise<WoodBoard> {
      const board: WoodBoard = {
        id: uid('board'),
        boardNo: input.boardNo.trim(),
        guqinNo: input.guqinNo.trim(),
        part: input.part,
        species: input.species,
        dryYears: Number(input.dryYears) || 0,
        thicknessMm: Number(input.thicknessMm) || 0,
        grain: input.grain,
        defect: input.defect,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        remark: input.remark?.trim() || undefined,
      };
      await db.boards.put(toPlain(board));
      this.boards = [board, ...this.boards];
      return board;
    },

    async updateBoard(id: string, patch: Partial<BoardInput>) {
      const current = this.boards.find((b) => b.id === id);
      if (!current) return;
      const next: WoodBoard = { ...current, ...patch };
      await db.boards.put(toPlain(next));
      this.boards = this.boards.map((b) => (b.id === id ? next : b));
    },

    async removeBoard(id: string) {
      await db.boards.delete(id);
      this.boards = this.boards.filter((b) => b.id !== id);
    },

    /** 配对绑定：把某块板材与同琴号的另一部位板材绑定 */
    async pair(panelId: string, baseId: string) {
      const panel = this.boards.find((b) => b.id === panelId);
      const base = this.boards.find((b) => b.id === baseId);
      if (!panel || !base) return;
      const guqinNo = panel.guqinNo;
      const updated = [panel, base].map((b) => ({ ...b, guqinNo }));
      for (const board of updated) {
        await db.boards.put(toPlain(board));
      }
      this.boards = this.boards.map((b) => updated.find((u) => u.id === b.id) ?? b);
    },

    /**
     * 改琴号＝一次跨工序迁移（同一个事务，避免中途失败留下半迁状态）：
     * 旧号下的全部板材、髹漆遍次一并搬到新号；槽腹与上弦若新号已有记录，
     * 保留新号原有那份，旧号那份留在原处不覆盖，具体哪条被留下写进返回报告。
     */
    async migrateGuqinNo(fromGuqinNo: string, toGuqinNo: string): Promise<GuqinMigrationReport> {
      const from = fromGuqinNo.trim();
      const to = toGuqinNo.trim();
      if (!from || !to || from === to) {
        throw new Error('新旧琴号不能为空，且不能相同');
      }

      const report: GuqinMigrationReport = {
        from,
        to,
        boardNos: [],
        chamber: { moved: undefined, kept: undefined },
        stringings: [],
        movedLayerIds: [],
        keptLayerIds: [],
      };

      await db.transaction('rw', db.boards, db.chambers, db.lacquers, db.stringings, async () => {
        // 板材：旧号下的其它板材连同当前板材一起搬走，不允许旧号再留下空壳板材
        const fromBoards = await db.boards.where('guqinNo').equals(from).toArray();
        if (fromBoards.length) {
          report.boardNos = fromBoards.map((b) => b.boardNo);
          await db.boards.where('guqinNo').equals(from).modify({ guqinNo: to });
        }

        // 槽腹：每张琴一份。新号已有掏膛记录时保留它，旧号那份留在旧号，不覆盖
        const fromChamber = await db.chambers.where('guqinNo').equals(from).first();
        const toChamber = await db.chambers.where('guqinNo').equals(to).first();
        if (fromChamber) {
          if (toChamber) {
            report.chamber = { moved: undefined, kept: toChamber };
          } else {
            await db.chambers
              .where('guqinNo')
              .equals(from)
              .modify({ guqinNo: to });
            report.chamber = { moved: { ...fromChamber, guqinNo: to }, kept: undefined };
          }
        }

        // 上弦：新号已有上弦记录则保留原份，旧号那份留在旧号，逐条报告
        const fromStringings = await db.stringings.where('guqinNo').equals(from).toArray();
        const toStringings = await db.stringings.where('guqinNo').equals(to).toArray();
        for (const s of fromStringings) {
          if (toStringings.length) {
            report.stringings.push({ moved: undefined, kept: toStringings[0] });
          } else {
            await db.stringings.where('id').equals(s.id).modify({ guqinNo: to });
            report.stringings.push({ moved: { ...s, guqinNo: to }, kept: undefined });
          }
        }

        // 髹漆遍次：全部搬到新号并与原遍次合并，按施工先后重排遍次、重算累计厚度
        const fromLayers = await db.lacquers.where('guqinNo').equals(from).toArray();
        const toLayers = await db.lacquers.where('guqinNo').equals(to).toArray();
        report.keptLayerIds = toLayers.map((l) => l.id);
        if (fromLayers.length) {
          const order = new Map<string, number>();
          [...toLayers, ...fromLayers].forEach((layer, index) => {
            if (!order.has(layer.id)) order.set(layer.id, index);
          });
          const merged = [...toLayers, ...fromLayers]
            .sort((a, b) => {
              const time = new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
              return time || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
            })
            .map((layer, index) => ({
              ...layer,
              guqinNo: to,
              seq: index + 1,
              totalThickness: 0,
            }))
            .map((layer, index, list) => ({
              ...layer,
              totalThickness: cumulativeThickness(list, layer.seq),
            }));
          await db.lacquers.bulkPut(toPlainList(merged));
          report.movedLayerIds = fromLayers.map((l) => l.id);
        }
      });

      // 以库为准重新装载各工序 store，保证进度页立即按新琴号聚合
      const chamberStore = useChamberStore();
      const lacquerStore = useLacquerStore();
      const stringingStore = useStringingStore();
      await Promise.all([
        this.hydrate(),
        chamberStore.hydrate(),
        lacquerStore.hydrate(),
        stringingStore.hydrate(),
      ]);

      return report;
    },
  },
});
