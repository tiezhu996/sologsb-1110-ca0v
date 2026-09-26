<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { ElMessage, ElMessageBox, ElNotification, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import DimensionChart from '../components/common/DimensionChart.vue';
import { useBoardStore, type GuqinMigrationReport } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useGuqinFilter } from '../hooks/useGuqinFilter';
import { thicknessGap } from '../utils/wood';
import { formatDate } from '../utils/layer';
import type { SoundChamber } from '../types/sound-chamber';
import type { Stringing } from '../types/stringing';
import {
  BOARD_PARTS,
  WOOD_DEFECTS,
  WOOD_GRAINS,
  WOOD_SPECIES,
  type BoardPart,
  type WoodBoard,
  type WoodDefect,
  type WoodGrain,
  type WoodSpecies,
} from '../types/wood-board';

const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const filter = useGuqinFilter();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
const selectedGuqin = ref('');

interface BoardForm {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt: string;
  remark: string;
}

const form = ref<BoardForm>({
  boardNo: '',
  guqinNo: '',
  part: '面板',
  species: '桐木',
  dryYears: 5,
  thicknessMm: 30,
  grain: '直纹',
  defect: '无',
  receivedAt: new Date().toISOString().slice(0, 10),
  remark: '',
});

const rules: FormRules = {
  boardNo: [{ required: true, message: '请输入板材号', trigger: 'blur' }],
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
};

const visible = computed(() => filter.applyBoards(boardStore.boards));
const visiblePairs = computed(() => {
  const nos = new Set(visible.value.map((b) => b.guqinNo));
  return boardStore.pairs.filter((pair) => nos.has(pair.guqinNo));
});

const chartMarks = computed(() => (selectedGuqin.value ? chamberStore.marksOf(selectedGuqin.value) : []));
const chartDepth = computed(() => chamberStore.byGuqin(selectedGuqin.value)?.chamberDepth ?? 0);

function openCreate() {
  editingId.value = '';
  form.value = {
    boardNo: `MB-${Date.now().toString().slice(-4)}`,
    guqinNo: boardStore.guqinNos[0] ?? 'Q-2506',
    part: '面板',
    species: '桐木',
    dryYears: 5,
    thicknessMm: 30,
    grain: '直纹',
    defect: '无',
    receivedAt: new Date().toISOString().slice(0, 10),
    remark: '',
  };
  dialogVisible.value = true;
}

function openEdit(board: WoodBoard) {
  editingId.value = board.id;
  form.value = {
    boardNo: board.boardNo,
    guqinNo: board.guqinNo,
    part: board.part,
    species: board.species,
    dryYears: board.dryYears,
    thicknessMm: board.thicknessMm,
    grain: board.grain,
    defect: board.defect,
    receivedAt: board.receivedAt.slice(0, 10),
    remark: board.remark ?? '',
  };
  dialogVisible.value = true;
}

/**
 * 改琴号是一次跨工序迁移：先让档案员看清迁移范围与冲突保留项，确认后才执行。
 * 新号已有槽腹/上弦时，保留新号原有那份，旧号那份不覆盖。
 */
async function confirmMigration(from: string, to: string): Promise<boolean> {
  const boardNos = boardStore.boardsOf(from).map((b) => b.boardNo);
  const fromChamber = chamberStore.byGuqin(from);
  const toChamber = chamberStore.byGuqin(to);
  const fromStringings = stringingStore.stringings.filter((s) => s.guqinNo === from);
  const toStringings = stringingStore.stringings.filter((s) => s.guqinNo === to);
  const movedLayerCount = lacquerStore.layersOf(from).length;
  const keptLayerCount = lacquerStore.layersOf(to).length;

  const lines: string[] = [];
  lines.push(`· 板材 ${boardNos.length} 块：${boardNos.join('、') || '—'}`);
  lines.push(`· 髹漆遍次 ${movedLayerCount} 遍${keptLayerCount ? `，与新号已有的 ${keptLayerCount} 遍合并续编` : ''}`);

  if (fromChamber) {
    lines.push(
      toChamber
        ? `· 槽腹：新号 ${to} 已有一份（掏膛 ${formatDate(toChamber.carvedAt)}，深 ${toChamber.chamberDepth}mm），保留新号这份；旧号 ${from} 的槽腹（深 ${fromChamber.chamberDepth}mm）留在原处不搬`
        : '· 槽腹 1 份：随琴号搬走',
    );
  }
  if (fromStringings.length) {
    lines.push(
      toStringings.length
        ? `· 上弦：新号 ${to} 已有上弦记录（${toStringings[0].stringType}，${formatDate(toStringings[0].strungAt)}），保留新号这份；旧号 ${from} 的上弦留在原处不搬`
        : `· 上弦 ${fromStringings.length} 条：随琴号搬走`,
    );
  }

  const message = h('div', { class: 'migrate-confirm' }, [
    h('div', { style: 'margin-bottom: 6px' }, `琴号 ${from} → ${to}，同琴号下的工序档案将一并迁移：`),
    ...lines.map((line) => h('div', { style: 'line-height: 1.9' }, line)),
    h(
      'div',
      { style: 'margin-top: 8px; color: #b88230' },
      '被留下的记录不会删除或覆盖，仍可在旧琴号下查到，需要时请到对应工序页另行处理。',
    ),
  ]);

  return ElMessageBox.confirm(message, '跨工序迁移确认', {
    type: 'warning',
    confirmButtonText: '执行迁移',
    cancelButtonText: '取消',
    dangerouslyUseHTMLString: false,
  })
    .then(() => true)
    .catch(() => false);
}

function chamberLine(label: string, chamber: SoundChamber): string {
  return `${label}（掏膛 ${formatDate(chamber.carvedAt)}，槽腹深 ${chamber.chamberDepth}mm，${chamber.carver}）`;
}

function stringingLine(label: string, stringing: Stringing): string {
  return `${label}（${stringing.stringType}，${formatDate(stringing.strungAt)} 上弦，${stringing.operator}）`;
}

/** 迁移完成后把搬走与留下的内容逐条说清，避免误覆盖已录好的掏膛与上弦 */
function notifyMigration(report: GuqinMigrationReport) {
  const conflicts: string[] = [];
  if (report.chamber.kept) {
    conflicts.push(`新号 ${report.to} 的${chamberLine('槽腹记录被保留', report.chamber.kept)}；旧号 ${report.from} 的槽腹未搬入、未覆盖。`);
  }
  report.stringings.forEach((item) => {
    if (item.kept) {
      conflicts.push(`新号 ${report.to} 的${stringingLine('上弦记录被保留', item.kept)}；旧号 ${report.from} 的上弦未搬入、未覆盖。`);
    }
  });

  const moved: string[] = [
    `板材 ${report.boardNos.length} 块（${report.boardNos.join('、') || '—'}）`,
    `髹漆遍次 ${report.movedLayerIds.length} 遍`,
  ];
  if (report.chamber.moved) moved.push(chamberLine('槽腹 1 份', report.chamber.moved));
  const movedStringings = report.stringings.filter((item) => item.moved);
  if (movedStringings.length) moved.push(stringingLine(`上弦 ${movedStringings.length} 条`, movedStringings[0].moved!));

  if (conflicts.length) {
    ElNotification({
      title: `已迁移到 ${report.to}（有记录被保留）`,
      type: 'warning',
      duration: 8000,
      message: h('div', [
        h('div', { style: 'margin-bottom: 4px' }, `已搬走：${moved.join('、')}。`),
        ...conflicts.map((line) => h('div', { style: 'line-height: 1.8' }, `· ${line}`)),
      ]),
    });
  } else {
    ElNotification({
      title: `已迁移到 ${report.to}`,
      type: 'success',
      duration: 6000,
      message: `已搬走：${moved.join('、')}。`,
    });
  }
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    boardNo: form.value.boardNo,
    guqinNo: form.value.guqinNo,
    part: form.value.part,
    species: form.value.species,
    dryYears: Number(form.value.dryYears) || 0,
    thicknessMm: Number(form.value.thicknessMm) || 0,
    grain: form.value.grain,
    defect: form.value.defect,
    receivedAt: new Date(`${form.value.receivedAt}T09:00:00`).toISOString(),
    remark: form.value.remark,
  };
  if (editingId.value) {
    const current = boardStore.boards.find((b) => b.id === editingId.value);
    if (current && payload.guqinNo.trim() && payload.guqinNo.trim() !== current.guqinNo) {
      const confirmed = await confirmMigration(current.guqinNo, payload.guqinNo.trim());
      if (!confirmed) return;
      // 迁移已把旧号下全部板材（含当前板材）改到新号，再回填本表单其余字段
      const report = await boardStore.migrateGuqinNo(current.guqinNo, payload.guqinNo.trim());
      await boardStore.updateBoard(editingId.value, payload);
      notifyMigration(report);
    } else {
      await boardStore.updateBoard(editingId.value, payload);
      ElMessage.success(`已更新板材 ${payload.boardNo}`);
    }
  } else {
    await boardStore.addBoard(payload);
    ElMessage.success(`已登记板材 ${payload.boardNo}（${payload.part}）`);
  }
  dialogVisible.value = false;
}

async function remove(board: WoodBoard) {
  const confirmed = await ElMessageBox.confirm(`确认删除板材 ${board.boardNo}？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await boardStore.removeBoard(board.id);
  ElMessage.success('已删除');
}
</script>

<template>
  <div>
    <h2 class="page-title">板材登记与配对</h2>
    <p class="page-desc">同一琴号下面板与底板配对绑定，并按阴干年限回显含水率；三处厚度标注由槽腹记录派生。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记板材</el-button>
      <el-button @click="selectedGuqin = boardStore.guqinNos[0] ?? ''">查看首张琴剖面</el-button>
    </div>

    <FilterBar
      :fields="[
        { key: 'guqin', label: '琴号', options: boardStore.guqinNos, width: 130 },
        { key: 'species', label: '树种', options: WOOD_SPECIES, width: 110 },
      ]"
      :result-count="visible.length"
      :total-count="boardStore.boards.length"
    />

    <EmptyPanel
      v-if="visible.length === 0"
      description="没有符合条件的板材"
      action-text="重置筛选条件"
      @action="filter.reset()"
    />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>面板 / 底板配对（含水率回显）</template>
        <el-table :data="visiblePairs" size="small" border>
          <el-table-column prop="guqinNo" label="琴号" width="110" />
          <el-table-column label="面板" min-width="200">
            <template #default="scope">
              <span v-if="scope.row.panel">{{ scope.row.panel.boardNo }} · {{ scope.row.panel.species }} · {{ scope.row.panel.thicknessMm }}mm</span>
              <el-tag v-else type="danger" size="small">缺面板</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="底板" min-width="200">
            <template #default="scope">
              <span v-if="scope.row.base">{{ scope.row.base.boardNo }} · {{ scope.row.base.species }} · {{ scope.row.base.thicknessMm }}mm</span>
              <el-tag v-else type="danger" size="small">缺底板</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="含水率" width="110">
            <template #default="scope">{{ scope.row.moisturePct }}%</template>
          </el-table-column>
          <el-table-column label="板厚差(mm)" width="120">
            <template #default="scope">{{ thicknessGap(scope.row) }}</template>
          </el-table-column>
          <el-table-column label="配对状态" width="110">
            <template #default="scope">
              <el-tag :type="scope.row.matched ? 'success' : 'warning'" size="small">{{ scope.row.matched ? '已配对' : '待配对' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="scope">
              <el-button link type="primary" @click="selectedGuqin = scope.row.guqinNo">剖面标注</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>板材明细</template>
        <el-table :data="visible" size="small" border>
          <el-table-column prop="boardNo" label="板材号" width="120" />
          <el-table-column prop="guqinNo" label="琴号" width="100" />
          <el-table-column prop="part" label="部位" width="80" />
          <el-table-column prop="species" label="树种" width="80" />
          <el-table-column prop="dryYears" label="阴干(年)" width="90" />
          <el-table-column prop="thicknessMm" label="厚度(mm)" width="90" />
          <el-table-column prop="grain" label="木纹" width="90" />
          <el-table-column prop="defect" label="缺陷" width="80" />
          <el-table-column label="入库" width="110">
            <template #default="scope">{{ formatDate(scope.row.receivedAt) }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="card-head">
            <span>槽腹剖面标注（DimensionChart）</span>
            <el-select v-model="selectedGuqin" placeholder="选择琴号" clearable style="width: 160px">
              <el-option v-for="no in boardStore.guqinNos" :key="no" :label="no" :value="no" />
            </el-select>
          </div>
        </template>
        <DimensionChart v-if="chartMarks.length" :marks="chartMarks" :chamber-depth="chartDepth" :guqin-no="selectedGuqin" />
        <el-empty v-else :image-size="60" description="选择已有槽腹记录的琴号即可查看剖面标注" />
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑板材' : '登记板材'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="板材号" prop="boardNo">
          <el-input v-model="form.boardNo" placeholder="如：MB-2511" maxlength="20" />
        </el-form-item>
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2506" maxlength="20" />
          <div v-if="editingId" class="guqin-hint">
            改动琴号会把同琴号下的其它板材、髹漆遍次、槽腹与上弦一起迁到新琴号；新琴号已有槽腹或上弦时保留其原有记录，不会覆盖。
          </div>
        </el-form-item>
        <el-form-item label="部位">
          <el-select v-model="form.part" style="width: 160px">
            <el-option v-for="part in BOARD_PARTS" :key="part" :label="part" :value="part" />
          </el-select>
        </el-form-item>
        <el-form-item label="树种">
          <el-select v-model="form.species" style="width: 160px">
            <el-option v-for="species in WOOD_SPECIES" :key="species" :label="species" :value="species" />
          </el-select>
        </el-form-item>
        <el-form-item label="阴干年限(年)">
          <el-input-number v-model="form.dryYears" :min="0" :max="60" placeholder="阴干年限" />
        </el-form-item>
        <el-form-item label="厚度(mm)">
          <el-input-number v-model="form.thicknessMm" :min="5" :max="80" :step="0.5" placeholder="厚度" />
        </el-form-item>
        <el-form-item label="木纹">
          <el-select v-model="form.grain" style="width: 160px">
            <el-option v-for="grain in WOOD_GRAINS" :key="grain" :label="grain" :value="grain" />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷">
          <el-select v-model="form.defect" style="width: 160px">
            <el-option v-for="defect in WOOD_DEFECTS" :key="defect" :label="defect" :value="defect" />
          </el-select>
        </el-form-item>
        <el-form-item label="入库日期">
          <el-date-picker v-model="form.receivedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="产地、纹理等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 12px;
  color: #8a7a68;
  font-size: 13px;
}
.toolbar {
  margin-bottom: 12px;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.guqin-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #b88230;
}
</style>
