<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { ElMessage, ElMessageBox, ElNotification, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import DimensionChart from '../components/common/DimensionChart.vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useGuqinFilter } from '../hooks/useGuqinFilter';
import { thicknessGap } from '../utils/wood';
import { formatDate } from '../utils/layer';
import { planRename, type RenamePlan } from '../utils/renameGuqin';
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

const renameVisible = ref(false);
const renameLoading = ref(false);
const renameFrom = ref('');
const renameTo = ref('');

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
    try {
      await boardStore.updateBoard(editingId.value, payload);
    } catch (error) {
      ElMessage.error((error as Error).message);
      return;
    }
    ElMessage.success(`已更新板材 ${payload.boardNo}`);
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

/** 改琴号迁移预览：实时算出要搬哪些记录、哪条因新号已有而留下 */
const renamePlan = computed<RenamePlan | null>(() => {
  if (!renameVisible.value || !renameFrom.value) return null;
  return planRename(
    boardStore.boards,
    chamberStore.chambers,
    lacquerStore.layers,
    stringingStore.stringings,
    renameFrom.value,
    renameTo.value.trim(),
  );
});

const renameTargetExists = computed(() => boardStore.guqinNos.includes(renameTo.value.trim()));
const renameInvalid = computed(
  () => !renameTo.value.trim() || renameTo.value.trim() === renameFrom.value,
);

function openRename(guqinNo: string) {
  renameFrom.value = guqinNo;
  renameTo.value = '';
  renameVisible.value = true;
}

function chamberDesc(c: SoundChamber): string {
  return `槽腹深 ${c.chamberDepth}mm，纳音 ${c.nayinThickness}mm，掏膛人 ${c.carver}（${formatDate(c.carvedAt)}）`;
}

function stringingDesc(s: Stringing): string {
  return `${s.stringType}，弦距 ${s.stringGap}mm，上弦人 ${s.operator}（${formatDate(s.strungAt)}）`;
}

async function confirmRename() {
  const plan = renamePlan.value;
  if (!plan || renameInvalid.value) return;
  renameLoading.value = true;
  try {
    await boardStore.renameGuqin(plan.from, plan.to);
    renameVisible.value = false;

    const lines: string[] = [];
    lines.push(`已把琴号 ${plan.from} 改为 ${plan.to}：板材 ${plan.movingBoards.length} 块（${plan.movingBoards
      .map((b) => b.boardNo)
      .join('、')}）随号迁移。`);
    if (plan.movingLayers.length) {
      lines.push(`髹漆 ${plan.movingLayers.length} 遍已并入新琴号，合并后共 ${plan.movingLayers.length + plan.targetLayers.length} 遍并按施工日期重排。`);
    }
    if (plan.movingChamber && !plan.keptChamber) {
      lines.push(`槽腹记录已随号迁移。`);
    }
    if (plan.movingStringing && !plan.keptStringing) {
      lines.push(`上弦记录已随号迁移。`);
    }
    if (plan.keptChamber) {
      lines.push(
        `槽腹：新琴号 ${plan.to} 已有记录（${chamberDesc(plan.keptChamber)}），已保留这份；旧琴号 ${plan.from} 的槽腹（${
          plan.movingChamber ? chamberDesc(plan.movingChamber) : '无'
        }）未搬、未覆盖，请人工核对后删除或保留。`,
      );
    }
    if (plan.keptStringing) {
      lines.push(
        `上弦：新琴号 ${plan.to} 已有记录（${stringingDesc(plan.keptStringing)}），已保留这份；旧琴号 ${plan.from} 的上弦（${
          plan.movingStringing ? stringingDesc(plan.movingStringing) : '无'
        }）未搬、未覆盖，请人工核对后删除或保留。`,
      );
    }
    if (plan.duplicateParts.length) {
      lines.push(`注意：新琴号上${plan.duplicateParts.join('、')}已另有板材，迁移后出现重复部位，请到板材明细中挑板。`);
    }

    ElNotification({
      title: plan.keptChamber || plan.keptStringing ? '改琴号完成（有记录被保留）' : '改琴号完成',
      type: plan.keptChamber || plan.keptStringing ? 'warning' : 'success',
      duration: 10000,
      message: h('div', lines.map((line) => h('p', { style: 'margin: 4px 0;' }, line))),
    });
    selectedGuqin.value = plan.to;
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    renameLoading.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="page-title">板材登记与配对</h2>
    <p class="page-desc">同一琴号下面板与底板配对绑定，并按阴干年限回显含水率；三处厚度标注由槽腹记录派生。琴号敲错请用配对表中的「改琴号」，会把同号板材、槽腹、髹漆遍次与上弦一起迁到新琴号。</p>

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
          <el-table-column label="操作" width="168">
            <template #default="scope">
              <el-button link type="primary" @click="selectedGuqin = scope.row.guqinNo">剖面标注</el-button>
              <el-button link type="warning" @click="openRename(scope.row.guqinNo)">改琴号</el-button>
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
          <el-input
            v-model="form.guqinNo"
            placeholder="如：Q-2506"
            maxlength="20"
            :disabled="Boolean(editingId)"
          />
          <div v-if="editingId" class="field-hint">琴号敲错请关闭本弹窗，到配对表点「改琴号」，槽腹、髹漆、上弦会随板材一起迁移</div>
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

    <el-dialog v-model="renameVisible" :title="`改琴号 · ${renameFrom}`" width="640px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="改琴号是一次跨工序迁移"
        description="旧琴号下的全部板材、髹漆遍次、槽腹和上弦会一起搬到新琴号，避免进度页留下只有板材的空壳琴坯。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="96px">
        <el-form-item label="旧琴号">
          <el-input :model-value="renameFrom" disabled style="width: 200px" />
        </el-form-item>
        <el-form-item label="新琴号" required>
          <el-input v-model="renameTo" placeholder="如：Q-2511" maxlength="20" style="width: 200px" clearable />
        </el-form-item>
      </el-form>

      <template v-if="renamePlan">
        <el-divider content-position="left">迁移内容预览</el-divider>
        <ul class="rename-preview">
          <li>
            板材 <b>{{ renamePlan.movingBoards.length }}</b> 块一起迁移：
            <span v-for="board in renamePlan.movingBoards" :key="board.id" class="preview-chip">
              {{ board.part }} {{ board.boardNo }}
            </span>
            <el-tag
              v-for="part in renamePlan.duplicateParts"
              :key="part"
              type="warning"
              size="small"
              style="margin-left: 6px"
            >
              新号已有{{ part }}，迁移后重复需挑板
            </el-tag>
          </li>
          <li>
            髹漆 <b>{{ renamePlan.movingLayers.length }}</b> 遍一起迁移；
            <template v-if="renamePlan.targetLayers.length">
              新琴号原有 <b>{{ renamePlan.targetLayers.length }}</b> 遍，合并后按施工日期重排遍次、重算累计厚度（两边都不覆盖）。
            </template>
            <template v-else>新琴号尚无髹漆遍次。</template>
          </li>
          <li>
            槽腹：
            <template v-if="!renamePlan.movingChamber">旧琴号无槽腹记录，不涉及。</template>
            <template v-else-if="!renamePlan.keptChamber">旧琴号的槽腹记录随号迁移。</template>
            <template v-else>
              <el-tag type="warning" size="small">保留新号原件，不搬不盖</el-tag>
              <div class="preview-keep">
                新琴号 {{ renameTo }} 已有：{{ chamberDesc(renamePlan.keptChamber) }}
              </div>
              <div class="preview-keep">
                旧琴号 {{ renameFrom }} 这份将留下：{{ chamberDesc(renamePlan.movingChamber) }}
              </div>
            </template>
          </li>
          <li>
            上弦：
            <template v-if="!renamePlan.movingStringing">旧琴号无上弦记录，不涉及。</template>
            <template v-else-if="!renamePlan.keptStringing">旧琴号的上弦记录随号迁移。</template>
            <template v-else>
              <el-tag type="warning" size="small">保留新号原件，不搬不盖</el-tag>
              <div class="preview-keep">
                新琴号 {{ renameTo }} 已有：{{ stringingDesc(renamePlan.keptStringing) }}
              </div>
              <div class="preview-keep">
                旧琴号 {{ renameFrom }} 这份将留下：{{ stringingDesc(renamePlan.movingStringing) }}
              </div>
            </template>
          </li>
          <li v-if="renameTargetExists" class="rename-merge-note">
            新琴号 {{ renameTo }} 是已存在的琴号，本次为合并迁移，不会覆盖其已录的掏膛和上弦数据。
          </li>
        </ul>
      </template>

      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" :loading="renameLoading" :disabled="renameInvalid" @click="confirmRename">
          确认迁移
        </el-button>
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
.field-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #b8860b;
}
.rename-preview {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.8;
  color: #5c4a38;
}
.rename-preview li {
  margin-bottom: 6px;
}
.preview-chip {
  display: inline-block;
  margin: 0 4px;
  padding: 0 6px;
  border-radius: 4px;
  background: #f3ead9;
}
.preview-keep {
  margin-top: 2px;
  padding-left: 6px;
  color: #8a6d3b;
}
.rename-merge-note {
  color: #b8860b;
}
</style>
