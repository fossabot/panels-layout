<template>
<div ref="container" class="container">
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
        <div v-for="(grip, corner) in panel.grips" :ref="el => grip.element = el as HTMLElement"
            class="cornerGrip" :style="grip.staticStyle"
            @pointerdown="panel.OnGripPointerDown($event, corner)"
            @pointerup="panel.OnGripPointerUp($event, corner)"
            @pointercancel="panel.OnGripPointerUp($event, corner)"
            @pointermove="panel.OnGripPointerMove($event, corner)" >

            <!-- XXX active needed? -->
            <slot name="cornerGrip" :corner="corner" :active="grip.isActive">
                <div class="cornerGripIcon" :class="{active: grip.isActive}"
                    :style="panel.GetCornerGripIconStyle(corner)" />
            </slot>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
import type * as Vue from "vue"
import { ref, reactive, defineEmits, onMounted, onBeforeUnmount, watch } from "vue"
import * as T from "./PublicTypes"


const props = withDefaults(defineProps<{
    contentDescriptorProvider: T.ContentDescriptorProvider,
    /** Minimal size in pixels for splitter child content. */
    minSplitterContentSize?: number,
    /** Spacing in pixels between splitter children. */
    splitterSpacing?: number,
    /** Size of corner grip zone for dragging. */
    cornerGripSize?: number,
    /** Minimal drag distance in pixels before panel splitting. */
    panelInwardDragThreshold?: number
    /** Minimal difference between drag distance in pixels along X and Y axes to take decision about
     * split direction.
     */
    panelSplitDragDifferenceThreshold?: number

}>(), {
    minSplitterContentSize: 10,
    splitterSpacing: 4,
    cornerGripSize: 14,
    panelInwardDragThreshold: 16,
    panelSplitDragDifferenceThreshold: 12
})

const _Emit = defineEmits<{
    /** Fired when layout is changed. */
    (e: "layoutUpdated", layoutDesc: T.LayoutDescriptor)
}>()

/** Can be used to restore layout previously saved from `layoutUpdated` event. */
function SetLayout(layoutDesc: T.LayoutDescriptor): void {
    //XXX
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// Private types

type Id = string

enum SplitterOrientation {
    VERTICAL,
    HORIZONTAL
}

type Vector = {
    x: number,
    y: number
}

class Rect {
    x: number
    y: number
    width: number
    height: number
}

/** Get axes directions towards panel content from the specified corner. */
function GetCornerOrientation(corner: T.Corner): Vector {
    switch (corner) {
    case T.Corner.TL:
        return {x: 1, y: 1}
    case T.Corner.TR:
        return {x: -1, y: 1}
    case T.Corner.BL:
        return {x: 1, y: -1}
    case T.Corner.BR:
        return {x: -1, y: -1}
    }
}

class PanelBase {
    parent: Splitter | null
    childIndex: number
    /** Absolute position in layout container bounds. */
    rect = reactive(new Rect())

    /**
     * @param childrenPixelSize Information from parent about pixel size for all its children.
     */
    UpdateRect(childrenPixelSize?: number[]): void {
        if (this.parent) {
            if (!childrenPixelSize) {
                throw new Error("childrenPixelSize not specified")
            }
            let pos = this.childIndex * props.splitterSpacing
            for (let i = 0; i < this.childIndex; i++) {
                pos += childrenPixelSize[i]
            }
            if (this.parent.orientation == SplitterOrientation.HORIZONTAL) {
                this.rect.x = this.parent.rect.x + pos
                this.rect.y = this.parent.rect.y
                this.rect.width = childrenPixelSize[this.childIndex]
                this.rect.height = this.parent.rect.height
            } else {
                this.rect.x = this.parent.rect.x
                this.rect.y = this.parent.rect.y + pos
                this.rect.width = this.parent.rect.width
                this.rect.height = childrenPixelSize[this.childIndex]
            }

        } else {
            this.rect.x = 0
            this.rect.y = 0
            this.rect.width = containerSize.width
            this.rect.height = containerSize.height
        }
    }
}

/** Manages either vertically or horizontally split panels. Whole the split layout is formed by
 * hierarchy of these components.
 */
class Splitter extends PanelBase {
    readonly orientation: SplitterOrientation
    /** Always has at least two children. */
    readonly children: (Splitter | Panel)[]
    /** May be fractional, recalculated and snapped to pixels in UpdateRect() */
    readonly childrenSize: number[] = []


    constructor(orientation: SplitterOrientation, children: (Splitter | Panel)[],
                childrenSize?: number[]) {
        super()
        this.orientation = orientation
        if (children.length < 2) {
            throw new Error("Splitter must have at least two children")
        }
        this.children = children

        if (childrenSize) {
            if (childrenSize.length != children.length) {
                throw new Error("`childrenSize` length should be equal to `children` length")
            }
            this.childrenSize = childrenSize
        } else {
            for (let i = 0; i < children.length; i++) {
                this.childrenSize.push(props.minSplitterContentSize)
            }
        }

        for (let i = 0; i < children.length; i++) {
            const c = children[i]
            c.parent = this
            c.childIndex = i
        }

        //XXX redistribute size
    }

    UpdateRect(): void {
        super.UpdateRect()
        const childrenPixelSize = this._CalculateChildrenPixelSize()
        for (const child of this.children) {
            child.UpdateRect(childrenPixelSize)
        }
    }

    /** Distribute available space between all children proportionally to current children size data
     * snapping to integer pixels.
     */
    _CalculateChildrenPixelSize(): number[] {

        let totalSize = 0
        const numChildren = this.childrenSize.length
        for (let i = 0; i < numChildren; i++) {
            totalSize += this.childrenSize[i]
        }
        const allocatableSize = (this.orientation == SplitterOrientation.HORIZONTAL ?
            this.rect.width : this.rect.height) -
            (this.children.length - 1) * props.splitterSpacing
        const sizeRatio = allocatableSize / totalSize

        const result: number[] = []
        let curPos = 0
        totalSize = 0
        for (let i = 0; i < numChildren; i++) {
            totalSize += this.childrenSize[i]
            const newPos = Math.round(totalSize * sizeRatio)
            result[i] = newPos - curPos
            curPos = newPos
        }
        return result
    }

    //XXX should not allow last two children removal
    // Remove(idx)
}

class GripInfo {
    readonly staticStyle: Vue.CSSProperties
    //XXX is needed?
    readonly isActive = ref(false)
    element?: HTMLElement

    constructor(staticStyle: Vue.CSSProperties) {
        this.staticStyle = Object.assign({}, {
            width: props.cornerGripSize + "px",
            height: props.cornerGripSize + "px",
            cursor: "crosshair"
        }, staticStyle)
    }
}

const enum GripDragState {
    /** No decision about action to take. */
    INITIAL,
    /** Expand panel to the neighbor splitter. */
    EXPAND,
    /** Pointer moved back to the panel after expand intention. */
    EXPAND_CANCELLED
    /* No state for panel splitting because this action is taken immediately and the drag state is
     * transferred to a splitter.
     */
}

type GripDragInfo = {
    pointerId: any | null,
    startPos: Vector
    //XXX reactive?
    state: GripDragState
}

/** Represents particular panel. Panel may have none (if empty), one or several (if tabbed) content
 * components . Panel parent is either splitter or null if root panel.
 */
class Panel extends PanelBase {
    readonly id: Id = _GenerateId()
    readonly children: ContentPane[] = []
    readonly grips: {[corner in T.Corner]: GripInfo}

    readonly gripDragInfo: GripDragInfo = {
        pointerId: null,
        startPos: {x: 0, y: 0},
        state: GripDragState.INITIAL
    }

    constructor() {
        super()
        this.grips = {
            [T.Corner.TL]: new GripInfo({
                top: "0",
                left: "0"
            }),
            [T.Corner.TR]: new GripInfo({
                top: "0",
                right: "0"
            }),
            [T.Corner.BL]: new GripInfo({
                bottom: "0",
                left: "0"
            }),
            [T.Corner.BR]: new GripInfo({
                bottom: "0",
                right: "0"
            })
        }
    }

    get isEmpty() {
        structureTracker.Touch()
        return this.children.length == 0
    }

    GetCornerGripIconStyle(corner: T.Corner): Vue.StyleValue {
        switch (corner) {
        case T.Corner.TL:
            return {}
        case T.Corner.TR:
            return {
                right: "0",
                transform: "scaleX(-1)"
            }
        case T.Corner.BL:
            return {
                bottom: "0",
                transform: "scaleY(-1)"
            }
        case T.Corner.BR:
            return {
                bottom: "0",
                right: "0",
                transform: "scaleX(-1) scaleY(-1)"
            }
        }
    }

    OnGripPointerDown(e: PointerEvent, corner: T.Corner) {
        if (e.altKey || e.shiftKey || e.ctrlKey) {
            return
        }
        this.gripDragInfo.pointerId = e.pointerId
        this.gripDragInfo.startPos.x = e.pageX
        this.gripDragInfo.startPos.y = e.pageY
        const grip = this.grips[corner]
        grip.isActive.value = true
        grip.element!.setPointerCapture(e.pointerId)
    }

    OnGripPointerUp(e: PointerEvent, corner: T.Corner) {
        if (this.gripDragInfo.pointerId === null) {
            return
        }
        const grip = this.grips[corner]
        grip.isActive.value = false
        grip.element!.releasePointerCapture(this.gripDragInfo.pointerId)

        if (this.gripDragInfo.state === GripDragState.EXPAND) {
            //XXX rebuild splitters if dragged outwards
        }

        this.gripDragInfo.pointerId = null
        this.gripDragInfo.state = GripDragState.INITIAL
    }

    OnGripPointerMove(e: PointerEvent, corner: T.Corner) {
        if (this.gripDragInfo.pointerId === null) {
            return
        }

        const dir = GetCornerOrientation(corner)
        const d = {x: (e.pageX - this.gripDragInfo.startPos.x) * dir.x,
                   y: (e.pageY - this.gripDragInfo.startPos.y) * dir.y}

        if (this.gripDragInfo.state === GripDragState.INITIAL) {
            if (d.x >= 0 && d.y >= 0 &&
                (d.x >= props.panelInwardDragThreshold || d.y >= props.panelInwardDragThreshold) &&
                Math.abs(d.x - d.y) > props.panelSplitDragDifferenceThreshold) {

                //XXX make split
                console.log("split")
            }
        }
        //XXX
    }
}

/** Contains instantiated content component. */
class ContentPane {
    readonly id: Id = _GenerateId()
    readonly contentDesc: T.ContentDescriptor
    /** Reference to instantiated component. */
    componentRef: any
    parent: Panel

    //XXX reactivity
    style: any

    constructor(desc: T.ContentDescriptor, parent: Panel)
    {
        this.contentDesc = desc
        this.parent = parent
    }

    get minWidth() {
        //XXX x,y per pane
        return props.minSplitterContentSize
    }

    get minHeight() {
        //XXX x,y per pane
        return props.minSplitterContentSize
    }
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

watch(containerSize, () => {
    console.log(containerSize)//XXX
    //XXX redistribute children size
    root.UpdateRect()
})

</script>

<style scoped lang="less">

.container {
    position: relative;
}

.cornerGrip {
    position: absolute;
}

.cornerGripIcon {
    width: 24px;
    height: 24px;
    pointer-events: none;
    position: absolute;
    visibility: hidden;
    background-image: url("./assets/grip.svg");

    :hover > & {
        visibility: visible;;
    }
}

</style>
