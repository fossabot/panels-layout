<template>
<div ref="container">
    Panels here
    <div v-for="pane in _GetAllContent()" :key="pane.id" :style="pane.style" >
        <div v-if="pane.contentDesc === null" class="emptyContentPane" />
        <component v-else :is="pane.contentDesc.component" v-bind="pane.contentDesc.props"
            :ref="el => pane.componentRef = el" />
    </div>

    <!-- XXX render splitters -->

    <!-- XXX render all panels -->
    <div v-for="panel in _GetAllPanels()" :key="panel.id">
        <slot v-if="panel.isEmpty" name="emptyContent">
            Empty panel
        </slot>
    </div>
</div>
</template>

<script setup lang="ts">
import type * as Vue from "vue"
import { ref, reactive, computed, defineEmits, onMounted, onBeforeUnmount } from "vue"

/**
 * User-defined data which is used as a key to get actual component and its properties when
 * instantiating layout. Plain types should be used to allow easy serialization.
 */
export type ContentSelector = any

export interface ContentDescriptor {
    /** Vue component class. */
    component: any
    /** Properties to bind to the instantiated component. */
    props: Object
}

export type ContentDescriptorProvider = (selector: ContentSelector) => ContentDescriptor

/**
 * Serializable type for saving and restoring current layout.
 */
export interface LayoutDescriptor {
    //XXX
}

const props = withDefaults(defineProps<{
    contentDescriptorProvider: ContentDescriptorProvider,
    /** Minimal size in pixels for splitter child content. */
    minSplitterContentSize: number,
    /** Spacing in pixels between splitter children. */
    splitterSpacing: number
}>(), {
    minSplitterContentSize: 10,
    splitterSpacing: 4
})

const _Emit = defineEmits<{
    /** Fired when layout is changed. */
    (e: "layoutUpdated", layoutDesc: LayoutDescriptor)
}>()

/** Can be used to restore layout previously saved from `layoutUpdated` event. */
function SetLayout(layoutDesc: LayoutDescriptor): void {
    //XXX
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// Private types

type Id = string

enum SplitterOrientation {
    VERTICAL,
    HORIZONTAL
}

/** Manages either vertically or horizontally split panels. Whole the split layout is formed by
 * hierarchy of these components.
 */
class Splitter {
    readonly orientation: SplitterOrientation
    /** Always has at least two children. */
    readonly children: (Splitter|Panel)[]
    readonly childrenSize: Vue.Ref<number[]> = ref([])

    constructor(orientation: SplitterOrientation, children: (Splitter|Panel)[],
                childrenSize?: number[]) {
        this.orientation = orientation
        if (children.length < 2) {
            throw new Error("Splitter must have at least two children")
        }
        this.children = children

        if (childrenSize) {
            if (childrenSize.length != children.length) {
                throw new Error("`childrenSize` length should be equal to `children` length")
            }
            this.childrenSize.value = childrenSize
        } else {
            for (let i = 0; i < children.length; i++) {
                this.childrenSize.value.push(props.minSplitterContentSize)
            }
        }
        //XXX redistribute size
    }

    //XXX should not allow last two children removal
    // Remove(idx)
}

/** Represents particular panel. Panel may have none (if empty), one or several (if tabbed) content
 * components . Panel parent is either splitter or null if root panel.
 */
class Panel {
    readonly id: Id = _GenerateId()
    readonly children: ContentPane[] = []

    get isEmpty() {
        structureTracker.Touch()
        return this.children.length == 0
    }
}

/** Contains instantiated content component. */
class ContentPane {
    readonly id: Id = _GenerateId()
    /** Reference to instantiated component. */
    componentRef: any

    contentDesc: ContentDescriptor | null

    //XXX reactivity
    style: any
}

/** Helper class for manual tracking changes on complex data without making all the data reactive.
 */
class ReactiveTracker {
    readonly value = ref(1)

    Touch(): void {
        if (!this.value) {
            throw new Error("Unexpected zero value")
        }
    }

    Update(): void {
        this.value.value++
    }
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// Private state and methods

const root: Panel | Splitter = new Panel()
const container: Vue.Ref<HTMLDivElement | null> = ref(null)
const resizeObserver = new ResizeObserver(_OnContainerResize)
/** Tracks all changes in content hierarchy. */
const structureTracker = new ReactiveTracker()
const containerSize = reactive({width: 0, height: 0})

function _GenerateId(): Id {
    return Date.now().toString(36).slice(-6) +
        (Math.random() * Number.MAX_SAFE_INTEGER).toString(36)
}

/** @return Flattened list of all content panes. */
function *_GetAllContent(): Generator<ContentPane, any, undefined> {
    for (const panel of _GetAllPanels()) {
        yield* panel.children
    }
}

/** @return Flattened list of all panels. */
function *_GetAllPanels(): Generator<Panel> {

    function *IterateItem(item: Panel | Splitter) {
        if (item instanceof Splitter) {
            for (const child of item.children) {
                yield *IterateItem(child)
            }
        } else {
            yield item
        }
    }

    structureTracker.Touch()
    yield *IterateItem(root)
}

function _OnContainerResize(entries: ResizeObserverEntry[]) {
    const sz = entries[0].contentBoxSize[0]
    containerSize.width = sz.inlineSize
    containerSize.height = sz.blockSize
}

onMounted(() => {
    resizeObserver.observe(container.value!)
})

onBeforeUnmount(() => {
    resizeObserver.disconnect()
})

</script>

<style scoped lang="less">

</style>
