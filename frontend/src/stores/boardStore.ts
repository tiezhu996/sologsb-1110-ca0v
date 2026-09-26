import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { pairBoards, boardUsable } from '../utils/wood';
import { executeRename, planRename, type RenamePlan } from '../utils/renameGuqin';
import { useChamberStore } from './chamberStore';
import { useLacquerStore } from './lacquerStore';
import { useStringingStore } from './stringingStore';
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
      // 琴号不能只改一块板：必须走改琴号迁移，否则槽腹/髹漆/上弦会挂在旧琴号上，
      // 进度页多出只有板材的空壳琴坯
      if (patch.guqinNo !== undefined && patch.guqinNo.trim() !== current.guqinNo) {
        throw new Error('琴号变更请使用板材页的「改琴号」，会连同槽腹、髹漆、上弦一起迁移');
      }
      const next: WoodBoard = { ...current, ...patch };
      await db.boards.put(toPlain(next));
      this.boards = this.boards.map((b) => (b.id === id ? next : b));
    },

    /**
     * 改琴号（跨工序迁移）：把旧琴号下的其它板材、髹漆遍次、槽腹和上弦一起搬到新琴号。
     * 新琴号已有槽腹/上弦的保留新号原件（清单中的 kept* 字段标明哪条被留下），
     * 髹漆两边遍次合并重排，不做覆盖。
     */
    async renameGuqin(from: string, to: string): Promise<RenamePlan> {
      const target = to.trim();
      if (!from.trim()) throw new Error('旧琴号不能为空');
      if (!target) throw new Error('新琴号不能为空');
      if (from === target) throw new Error('新琴号与旧琴号相同，无需迁移');

      const [boards, chambers, layers, stringings] = await Promise.all([
        db.boards.toArray(),
        db.chambers.toArray(),
        db.lacquers.toArray(),
        db.stringings.toArray(),
      ]);
      const plan = planRename(boards, chambers, layers, stringings, from, target);
      if (plan.movingBoards.length === 0) {
        throw new Error(`琴号 ${from} 下没有板材，无法改琴号`);
      }
      await executeRename(plan);

      // 四张表在同一事务中已落库，重新水合所有 store，保证进度页等视图一致
      const chamberStore = useChamberStore();
      const lacquerStore = useLacquerStore();
      const stringingStore = useStringingStore();
      await Promise.all([this.hydrate(), chamberStore.hydrate(), lacquerStore.hydrate(), stringingStore.hydrate()]);
      return plan;
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
  },
});
