<template>
  <div
    class="side-bar-toc"
    :class="[{ 'side-bar-toc-overflow': !wordWrapInToc, 'side-bar-toc-wordwrap': wordWrapInToc }]"
  >
    <div class="title">
      {{ t('sideBar.toc.title') }}
    </div>
    <el-tree
      v-if="tocData.length"
      ref="tocTreeRef"
      :data="tocData"
      :default-expand-all="true"
      :props="defaultProps"
      :expand-on-click-node="false"
      :indent="10"
      :icon="ArrowRight"
      node-key="slug"
      :highlight-current="true"
      @node-click="handleClick"
    />
  </div>
</template>

<script setup lang="ts">
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import bus from '../../bus'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from '@element-plus/icons-vue'
import { computed, ref, watch, nextTick } from 'vue'
import type { TreeInstance } from 'element-plus'

const { t } = useI18n()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const tocTreeRef = ref<TreeInstance | null>(null)

const defaultProps = {
  children: 'children',
  label: 'label'
}

const { toc, activeHeadingSlug } = storeToRefs(editorStore)
const { wordWrapInToc } = storeToRefs(preferencesStore)

// `listToTree` attaches a circular `parent` back-pointer to every node. Passing
// that straight to el-tree silently breaks `node-key` matching (so the active
// node never highlights), so project each node onto a plain, parent-free shape.
type PlainNode = { slug: string; label: unknown; lvl: unknown; children: PlainNode[] }
function stripParent (nodes: typeof toc.value): PlainNode[] {
  return nodes.map(({ slug, label, lvl, children }) => ({
    slug: typeof slug === 'string' ? slug : '',
    label,
    lvl,
    children: stripParent(children)
  }))
}
const tocData = computed(() => stripParent(toc.value))

// Drive el-tree's current-node highlight from the store. `nextTick` waits for
// the tree to (re-)render the nodes before we set the current key.
watch(activeHeadingSlug, () => {
  nextTick(() => {
    tocTreeRef.value?.setCurrentKey(activeHeadingSlug.value || undefined)
  })
})

const handleClick = (data: { slug?: unknown }): void => {
  // editor.vue resolves the slug to a heading by document order
  // (resolveTocHeadingElement) — bail out if the node has no slug (e.g.
  // unsluggable headings) to avoid emitting `undefined` / non-string payloads.
  if (typeof data.slug !== 'string' || data.slug.length === 0) return
  bus.emit('scroll-to-header', data.slug)
}
</script>

<style>
.side-bar-toc {
  height: calc(100% - 35px);
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Contain child overflow; el-tree scrolls internally */
}

.side-bar-toc .title {
  flex-shrink: 0;
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 37px 0 10px 0;
  padding-left: 25px;
}

.side-bar-toc .el-tree-node {
  margin-top: 8px;
}

.side-bar-toc .el-tree {
  /* Fill the remaining space and scroll internally so long TOCs do not
     overflow into the titlebar. */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: transparent;
  color: var(--sideBarColor);
  --el-color-primary: var(--themeColor);
}

.side-bar-toc .el-tree-node:focus > .el-tree-node__content {
  background-color: var(--sideBarItemHoverBgColor);
}

.side-bar-toc .el-tree-node__content:hover {
  background: var(--sideBarItemHoverBgColor);
}

.side-bar-toc .el-tree-node__label {
  background-color: transparent;
}

/* Highlight the active heading. The selector must include
   `.el-tree--highlight-current` to out-specify Element Plus's defaults, and the
   text color must be set via `--el-tree-text-color` (which el-tree inherits
   from) rather than `color` alone. */
.side-bar-toc .el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content {
  background: color-mix(in srgb, var(--themeColor) 15%, transparent);
  font-weight: 600;
  --el-tree-text-color: var(--themeColor);
}

.side-bar-toc
  .el-tree--highlight-current
  .el-tree-node.is-current
  > .el-tree-node__content
  .el-tree-node__label {
  background-color: transparent;
  color: var(--themeColor);
}

.side-bar-toc > li {
  font-size: 14px;
  margin-bottom: 15px;
  cursor: pointer;
}
.side-bar-toc-overflow {
  overflow: auto;
}
.side-bar-toc-wordwrap {
  overflow-x: hidden;
  overflow-y: auto;
}

.side-bar-toc-wordwrap .el-tree-node__content {
  white-space: normal;
  height: auto;
  min-height: 26px;
}
</style>
