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
      </div>

      <footer class="tc-modal__footer">
        <DexButton variant="ghost" @click="$emit('close')">Cancel</DexButton>
        <DexButton variant="solid" @click="onSave">Save</DexButton>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  DexButton,
  DexIconButton,
  DexText,
} from '@thryvlabs/dex-vue';

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
  'pipeline-stage-is-moved': {
    title: 'Pipeline stage is moved',
    subtitle: 'Fire when a deal moves between pipeline stages.',
    fields: [
      {
        id: 'pipeline',
        label: 'Pipeline',
        kind: 'select',
        options: ['Sales pipeline', 'Service pipeline', 'Renewals'],
      },
      {
        id: 'stage',
        label: 'Stage',
        kind: 'select',
        options: [
          'New',
          'Qualified',
          'Estimate Sent',
          'Estimate Signed',
          'Scheduled',
          'Won',
          'Lost',
        ],
      },
      {
        id: 'direction',
        label: 'When',
        kind: 'select',
        options: ['Enters stage', 'Leaves stage', 'Either'],
      },
    ],
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

function onSave() {
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
