<template>
  <div
    class="tc-overlay"
    role="presentation"
    @mousedown.self="$emit('close')"
    @keydown.esc="$emit('close')"
  >
    <div
      ref="rootEl"
      class="tc-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tc-title"
      tabindex="-1"
    >
      <header class="tc-modal__header">
        <DexIconButton
          name="x"
          label="Close"
          @click="$emit('close')"
        />
        <DexText id="tc-title" variant="heading-3" as="h2">
          {{ title }}
        </DexText>
      </header>

      <div class="tc-modal__body">
        <!-- ===========================================================
             Pipeline stage move — custom layout per the trigger spec.
             Three dependent dropdowns ("When moving" → "Pipeline" →
             "Stage"), a blue info notice, and value/id-keyed option
             rendering so analytics can target items by stable id.
             =========================================================== -->
        <template v-if="slug === 'pipeline-stage-is-moved'">
          <p class="tc-modal__lead">
            Trigger automation when a deal is moved into or out of a particular
            stage within a pipeline.
          </p>

          <div class="tc-info" role="note">
            <DexIcon name="info" class="tc-info__icon" aria-hidden="true" />
            <div class="tc-info__body">
              <p class="tc-info__text">
                Automations will not be triggered when a deal is created in
                this stage. To trigger based on a deal's starting stage, select
                "Deal enters stage" in Easy Automations.
              </p>
              <a
                class="tc-info__link"
                href="https://learn.thryv.com/hc/en-us/articles/40570771502605-Pipeline-Stage-Moved-Automation"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more
              </a>
            </div>
          </div>

          <div class="tc-modal__form">
            <PipelineDropdown
              id="psm-direction"
              label="When moving"
              :options="DIRECTION_OPTIONS"
              :value="draft.direction"
              placeholder="Select"
              required
              @update:value="onChange('direction', $event)"
            />

            <PipelineDropdown
              id="psm-pipeline"
              label="Pipeline"
              :options="PIPELINE_OPTIONS"
              :value="draft.pipeline"
              placeholder="Select"
              required
              @update:value="onPipelineChange"
            />

            <PipelineDropdown
              id="psm-stage"
              label="Stage"
              :options="stageOptions"
              :value="draft.stage"
              :disabled="!draft.pipeline"
              :placeholder="draft.pipeline ? 'Select' : 'Select a pipeline first'"
              required
              @update:value="onChange('stage', $event)"
            />
          </div>
        </template>

        <!-- ===========================================================
             Fallback: generic schema-driven layout used by every other
             trigger (Appointments, Product is purchased, …) until each
             gets a hand-tuned design.
             =========================================================== -->
        <template v-else>
          <p class="tc-modal__lead">{{ subtitle }}</p>

          <div class="tc-modal__form">
            <label
              v-for="f in schema.fields"
              :key="f.id"
              class="tc-field"
            >
              <span class="tc-field__label">{{ f.label }}</span>
              <select
                v-if="f.kind === 'select'"
                class="tc-field__control"
                :value="draft[f.id] ?? ''"
                @change="onChange(f.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>Choose…</option>
                <option v-for="opt in f.options" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
              <input
                v-else-if="f.kind === 'number'"
                type="number"
                class="tc-field__control"
                :value="draft[f.id] ?? ''"
                @input="onChange(f.id, ($event.target as HTMLInputElement).value)"
              />
              <input
                v-else
                type="text"
                class="tc-field__control"
                :value="draft[f.id] ?? ''"
                @input="onChange(f.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </template>
      </div>

      <footer class="tc-modal__footer">
        <DexButton variant="solid" :disabled="!canSave" @click="onSave">
          Save
        </DexButton>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  DexButton,
  DexIcon,
  DexIconButton,
  DexText,
} from '@thryvlabs/dex-vue';
import PipelineDropdown from './PipelineDropdown.vue';

type FieldKind = 'select' | 'text' | 'number';
type Field = {
  id: string;
  label: string;
  kind: FieldKind;
  options?: string[];
};
type Schema = { title: string; subtitle: string; fields: Field[] };

const props = defineProps<{
  slug: string;
  initialConfig: Record<string, string>;
}>();

const emit = defineEmits<{
  'update:config': [next: Record<string, string>];
  close: [];
}>();

const SCHEMAS: Record<string, Schema> = {
  'product-is-purchased': {
    title: 'Product is purchased',
    subtitle: 'Fire this automation when a contact completes a purchase.',
    fields: [
      {
        id: 'product',
        label: 'Product',
        kind: 'select',
        options: [
          'Any product',
          'Annual subscription',
          'Coaching package',
          'Starter kit',
          'Premium add-on',
        ],
      },
      {
        id: 'paymentType',
        label: 'Payment type',
        kind: 'select',
        options: ['Any', 'One-time', 'Subscription', 'Payment plan'],
      },
      {
        id: 'amount',
        label: 'Amount (USD)',
        kind: 'number',
      },
    ],
  },
  appointments: {
    title: 'Appointments',
    subtitle:
      'Fire this automation when an appointment matches the conditions below.',
    fields: [
      {
        id: 'condition',
        label: 'When',
        kind: 'select',
        options: [
          'Is scheduled',
          'Is completed',
          'Is cancelled',
          'Is rescheduled',
          'Is a no-show',
        ],
      },
      {
        id: 'appointmentType',
        label: 'Appointment type',
        kind: 'select',
        options: [
          'Any type',
          'Maintenance tune-up',
          'Repair',
          'Install',
          'Estimate',
          'Consultation',
        ],
      },
    ],
  },
  // Pipeline stage moved has a custom layout (info box + dependent
  // dropdowns) — the generic schema below only feeds the modal's title
  // / subtitle; the form markup lives inline in the template above.
  'pipeline-stage-is-moved': {
    title: 'Pipeline stage move',
    subtitle:
      'Trigger automation when a deal is moved into or out of a particular stage within a pipeline.',
    fields: [],
  },
};

const schema = computed<Schema>(
  () =>
    SCHEMAS[props.slug] ?? {
      title: props.slug,
      subtitle: 'Configure this trigger.',
      fields: [],
    },
);

const title = computed(() => schema.value.title);
const subtitle = computed(() => schema.value.subtitle);

// ===================================================================
// Pipeline stage move — data dictionaries
// ===================================================================

/** "When moving" direction options. Value = stable id stored in the
 *  trigger config; label = what the user sees. */
const DIRECTION_OPTIONS = [
  { value: 'IN', label: 'Into' },
  { value: 'OUT', label: 'Out of' },
];

/** Pipelines available to this tenant. In production this would come
 *  from the pipelines API; here we stub the live-example id so QA can
 *  match the spec verbatim. */
const PIPELINE_OPTIONS = [
  {
    value: '10000000000072932',
    label: 'KLG - SLP - Graphic Design Test Pipeline',
  },
  { value: '10000000000072933', label: 'Sales pipeline' },
  { value: '10000000000072934', label: 'Service pipeline' },
  { value: '10000000000072935', label: 'Renewals' },
];

/** Stage list per pipeline id. Stage IDs are also stable values so the
 *  trigger config persists a Pipeline → Stage tuple, not a label tuple. */
const STAGES_BY_PIPELINE: Record<string, { value: string; label: string }[]> = {
  '10000000000072932': [
    { value: '10000000000325450', label: 'Not started' },
    { value: '10000000000325452', label: 'Planning' },
    { value: '10000000000325454', label: 'In progress' },
    { value: '10000000000325456', label: 'In review' },
    { value: '10000000000325458', label: 'Complete' },
  ],
  '10000000000072933': [
    { value: '10000000000325460', label: 'New leads' },
    { value: '10000000000325462', label: 'Qualified leads' },
    { value: '10000000000325464', label: 'Quote sent' },
    { value: '10000000000325466', label: 'Negotiating' },
    { value: '10000000000325468', label: 'Quote accepted' },
  ],
  '10000000000072934': [
    { value: '10000000000325470', label: 'Ticket open' },
    { value: '10000000000325472', label: 'In service' },
    { value: '10000000000325474', label: 'Resolved' },
  ],
  '10000000000072935': [
    { value: '10000000000325480', label: 'Up for renewal' },
    { value: '10000000000325482', label: 'Renewed' },
    { value: '10000000000325484', label: 'Lapsed' },
  ],
};

const stageOptions = computed(() => {
  const pid = draft.pipeline;
  return pid && STAGES_BY_PIPELINE[pid] ? STAGES_BY_PIPELINE[pid] : [];
});

// Draft-based edit (per HANDOFF §13): mutate a draft until Save commits.
const draft = reactive<Record<string, string>>({ ...props.initialConfig });
const rootEl = ref<HTMLElement | null>(null);

watch(
  () => props.initialConfig,
  (next) => {
    for (const k of Object.keys(draft)) delete draft[k];
    Object.assign(draft, next);
  },
);

onMounted(() => {
  rootEl.value?.focus();
});

function onChange(id: string, value: string) {
  draft[id] = value;
}

/** When the pipeline changes, the previously-selected stage is no longer
 *  valid (each pipeline has its own stage list), so clear it. */
function onPipelineChange(nextPipelineId: string) {
  draft.pipeline = nextPipelineId;
  draft.stage = '';
}

/** All three required fields filled — Save is gated on this for the
 *  pipeline trigger; other triggers stay always-enabled until each
 *  gets its own validation. */
const canSave = computed(() => {
  if (props.slug !== 'pipeline-stage-is-moved') return true;
  return !!draft.direction && !!draft.pipeline && !!draft.stage;
});

function onSave() {
  if (!canSave.value) return;
  emit('update:config', { ...draft });
  emit('close');
}
</script>

<style scoped>
.tc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 36, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.tc-modal {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.25);
  outline: none;
}
.tc-modal__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--dex-borderColor-alpha-subtle, #e5e7eb);
}
.tc-modal__body {
  padding: 18px;
}
.tc-modal__lead {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--dex-fgColor-muted, #6b7280);
}
.tc-info {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--dex-color-blue-50, #eff6ff);
  border: 1px solid var(--dex-color-blue-200, #bfdbfe);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 0 0 18px;
}
.tc-info__icon {
  color: var(--dex-color-blue-700, #1d4ed8);
  flex: 0 0 auto;
  margin-top: 1px;
}
.tc-info__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tc-info__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--dex-color-blue-900, #1e3a8a);
}
.tc-info__link {
  font-size: 13px;
  font-weight: 600;
  color: var(--dex-color-blue-700, #1d4ed8);
  text-decoration: none;
}
.tc-info__link:hover {
  text-decoration: underline;
}
.tc-modal__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
.tc-field__label {
  font-weight: 600;
  color: var(--dex-fgColor-default, #272727);
}
.tc-field__control {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--dex-borderColor-default, #d1d5db);
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
}
.tc-field__control:focus {
  outline: 2px solid var(--dex-color-blue-700, #006ceb);
  outline-offset: -1px;
  border-color: transparent;
}
.tc-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--dex-borderColor-alpha-subtle, #e5e7eb);
}
</style>
