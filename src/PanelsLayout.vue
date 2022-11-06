<template>
<div ref="container" class="container">
    <div v-for="pane in _GetAllContent()" :key="pane.id" class="pane"
        :style="pane.positionStyle" >
        <component :is="pane.contentDesc.component" v-bind="pane.contentDesc.props"
            :ref="el => pane.componentRef = el" />
    </div>

    <div v-for="panel in _GetAllEmptyPanels()" :key="panel.id" class="emptyPanel"
        :style="panel.positionStyle">
        <slot name="emptyContent">
            <!-- XXX -->
            <div style="width: 100%;height:100%;background-color: darkgreen;">Empty panel {{panel.id}}</div>
        </slot>
    </div>

    <template v-for="splitter in _GetAllSplitters()" :key="splitter.id">
        <div v-for="(sep, index) in splitter.separators" :key="index" class="separator"
            :ref="el => sep.element = el as HTMLElement"
            :style="splitter.GetSeparatorStyle(index)" />
    </template>

    <div v-for="panel in _GetAllPanels()" :key="panel.id" class="panel"
        :style="panel.positionStyle">
        <div v-for="(grip, corner) in panel.grips" :key="corner"
            :ref="el => grip.element = el as HTMLElement"
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
    panelSplitDragDifferenceThreshold?: number,
    /** Width of splitter zone between child items which is draggable. Usually should be larger than
     * `splitterSpacing` to have actual draggable zone expanded past visible spacing.
     */
    splitterDragZoneSize?: number,

}>(), {
    minSplitterContentSize: 10,
    splitterSpacing: 4,
    cornerGripSize: 14,
    panelInwardDragThreshold: 16,
    panelSplitDragDifferenceThreshold: 12,
    splitterDragZoneSize: 10
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

    GetAxisSize(orientation: SplitterOrientation): number {
        return orientation === SplitterOrientation.HORIZONTAL ? this.width : this.height
    }
}

class PanelBase {
    readonly id: Id = _GenerateId()
    parent: Splitter | null
    childIndex: number
    /** Absolute position in layout container bounds. */
    rect = reactive(new Rect())

    UpdateRect(): void {
        if (this.parent) {
            let pos = this.childIndex * props.splitterSpacing
            for (let i = 0; i < this.childIndex; i++) {
                pos += this.parent.childrenPixelSize[i]
            }
            if (this.parent.orientation == SplitterOrientation.HORIZONTAL) {
                this.rect.x = this.parent.rect.x + pos
                this.rect.y = this.parent.rect.y
                this.rect.width = this.parent.childrenPixelSize[this.childIndex]
                this.rect.height = this.parent.rect.height
            } else {
                this.rect.x = this.parent.rect.x
                this.rect.y = this.parent.rect.y + pos
                this.rect.width = this.parent.rect.width
                this.rect.height = this.parent.childrenPixelSize[this.childIndex]
            }

        } else {
            this.rect.x = 0
            this.rect.y = 0
            this.rect.width = containerSize.width
            this.rect.height = containerSize.height
        }
    }

    PageToClientCoord(x: number, y: number): Vector {
        const result = _PageToLayoutCoord(x, y)
        result.x -= this.rect.x
        result.y -= this.rect.y
        return result
    }

    /** Reactive style attributes for absolute positioning inside the container. */
    get positionStyle() {
        return {
            left: this.rect.x + "px",
            top: this.rect.y + "px",
            width: this.rect.width + "px",
            height: this.rect.height + "px"
        }
    }
}

type SplitterDragInfo = {
    pointerId: any | null,
    /** Index of separator to drag. */
    index: number
    /** Start coordinate (page CS). */
    startPointerPos: number
    /** Start position of the separator being dragged. */
    startSeparatorPos: number
    /** Offset in pixels of drag point from separator center. */
    dragOffset: number
}

class SplitterSeparator {
    element?: HTMLElement
    readonly isActive = ref(false)
    readonly staticStyle: Vue.CSSProperties
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
    readonly childrenPixelSize: number[] = []
    /** Drag in progress when `pointerId` is not null. */
    readonly dragInfo: SplitterDragInfo = {
        pointerId: null,
        index: 0,
        startPointerPos: 0,
        startSeparatorPos: 0,
        dragOffset: 0
    }
    readonly separators: SplitterSeparator[] = []

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
            if (i != 0) {
                this.separators.push(new SplitterSeparator())
            }
        }

        //XXX redistribute size
    }

    UpdateRect(): void {
        super.UpdateRect()
        this._CalculateChildrenPixelSize()
        for (const child of this.children) {
            child.UpdateRect()
        }
    }

    GetSeparatorStyle(index: number): Vue.CSSProperties {
        let pos = props.splitterSpacing * index
        for (let i = 0; i <= index; i++) {
            pos += this.childrenPixelSize[i]
        }
        pos -= (props.splitterDragZoneSize - props.splitterSpacing) / 2

        let style: Vue.CSSProperties
        if (this.orientation === SplitterOrientation.HORIZONTAL) {
            style = {
                top: this.rect.y + "px",
                height: this.rect.height + "px",
                left: pos + "px",
                width: props.splitterDragZoneSize + "px"
            }
        } else {
            style = {
                left: this.rect.x + "px",
                width: this.rect.width + "px",
                top: pos + "px",
                height: props.splitterDragZoneSize + "px"
            }
        }
        style.cursor = this.orientation === SplitterOrientation.HORIZONTAL ?
            "col-resize" : "row-resize"
        return style
    }

    /** Distribute available space between all children proportionally to current children size data
     * snapping to integer pixels.
     */
    _CalculateChildrenPixelSize() {
        let totalSize = 0
        const numChildren = this.childrenSize.length
        this.childrenPixelSize.length = numChildren
        for (let i = 0; i < numChildren; i++) {
            totalSize += this.childrenSize[i]
        }
        const allocatableSize = this.rect.GetAxisSize(this.orientation) -
            (this.children.length - 1) * props.splitterSpacing
        const sizeRatio = allocatableSize / totalSize

        let curPos = 0
        totalSize = 0
        for (let i = 0; i < numChildren; i++) {
            totalSize += this.childrenSize[i]
            const newPos = Math.round(totalSize * sizeRatio)
            this.childrenPixelSize[i] = newPos - curPos
            curPos = newPos
        }
    }

    //XXX should not allow last two children removal
    // Remove(idx)
}

class CornerGrip {
    element?: HTMLElement
    readonly staticStyle: Vue.CSSProperties
    //XXX is needed?
    readonly isActive = ref(false)

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
    corner: T.Corner
    /** Page CS. */
    startPos: Vector
    //XXX reactive?
    state: GripDragState
}

/** Represents particular panel. Panel may have none (if empty), one or several (if tabbed) content
 * components. Panel parent is either splitter or null if root panel.
 */
class Panel extends PanelBase {
    readonly children: ContentPane[] = []
    readonly grips: {[corner in T.Corner]: CornerGrip}

    readonly gripDragInfo: GripDragInfo = {
        pointerId: null,
        corner: T.Corner.TL,
        startPos: {x: 0, y: 0},
        state: GripDragState.INITIAL
    }

    constructor() {
        super()
        this.grips = {
            [T.Corner.TL]: new CornerGrip({
                top: "0",
                left: "0"
            }),
            [T.Corner.TR]: new CornerGrip({
                top: "0",
                right: "0"
            }),
            [T.Corner.BL]: new CornerGrip({
                bottom: "0",
                left: "0"
            }),
            [T.Corner.BR]: new CornerGrip({
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

    /**
     * @param splitPos Split position in pixels along split axis. Origin is the panel client
     *      rectangle origin.
     * @param newFirst True if new panel precedes this one in a splitter, false if it is inserted
     *      next to this one.
     * @return True if split successful, false if split not possible.
     */
    Split(orientation: SplitterOrientation, splitPos: number, newFirst: boolean): boolean {
        const parent = this.parent
        if (parent && parent.orientation === orientation) {
            //XXX insert in parent
            return false
        } else {
            /* Create new splitter. */
            const panel = new Panel()
            const children = newFirst ? [panel, this] : [this, panel]
            const size1 = splitPos - props.splitterSpacing / 2
            const size2 = this.rect.GetAxisSize(orientation) - props.splitterSpacing - size1
            const splitter = new Splitter(orientation, children, [size1, size2])
            if (parent) {
                //XXX
                return false
            } else {
                root = splitter
            }
            splitter.UpdateRect()
            structureTracker.Update()
        }
        return true
    }

    OnGripPointerDown(e: PointerEvent, corner: T.Corner): void {
        if (e.altKey || e.shiftKey || e.ctrlKey) {
            return
        }
        this.gripDragInfo.pointerId = e.pointerId
        this.gripDragInfo.corner = corner
        this.gripDragInfo.startPos.x = e.pageX
        this.gripDragInfo.startPos.y = e.pageY
        const grip = this.grips[corner]
        grip.isActive.value = true
        grip.element!.setPointerCapture(e.pointerId)
    }

    EndGripDrag() {
        if (this.gripDragInfo.pointerId === null) {
            return
        }
        const grip = this.grips[this.gripDragInfo.corner]
        grip.isActive.value = false
        grip.element!.releasePointerCapture(this.gripDragInfo.pointerId)
        this.gripDragInfo.pointerId = null
        this.gripDragInfo.state = GripDragState.INITIAL
    }

    OnGripPointerUp(e: PointerEvent, corner: T.Corner): void {
        if (e.pointerId !== this.gripDragInfo.pointerId) {
            return
        }
        if (this.gripDragInfo.state === GripDragState.EXPAND) {
            //XXX rebuild splitters if dragged outwards
        }
        this.EndGripDrag()
    }

    OnGripPointerMove(e: PointerEvent, corner: T.Corner): void {
        if (e.pointerId !== this.gripDragInfo.pointerId) {
            return
        }

        const dir = _GetCornerOrientation(corner)
        const d = {x: (e.pageX - this.gripDragInfo.startPos.x) * dir.x,
                   y: (e.pageY - this.gripDragInfo.startPos.y) * dir.y}
        const clientCoord = this.PageToClientCoord(e.pageX, e.pageY)

        if (this.gripDragInfo.state === GripDragState.INITIAL) {
            if (d.x >= 0 && d.y >= 0 &&
                (d.x >= props.panelInwardDragThreshold || d.y >= props.panelInwardDragThreshold) &&
                Math.abs(d.x - d.y) > props.panelSplitDragDifferenceThreshold) {


                if (!this.Split(
                    d.x > d.y ? SplitterOrientation.HORIZONTAL : SplitterOrientation.VERTICAL,
                    d.x > d.y ? clientCoord.x : clientCoord.y,
                    d.x > d.y ? dir.x > 0 : dir.y > 0)) {

                    this.EndGripDrag()
                    return
                }
                //XXX transfer drag
                this.EndGripDrag()
                return
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

    /** Reactive style attributes for absolute positioning inside the container. */
    get positionStyle() {
        //XXX account tab height if any
        return this.parent.positionStyle
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

let root: Panel | Splitter = new Panel()
const container: Vue.Ref<HTMLDivElement | null> = ref(null)
const resizeObserver = new ResizeObserver(_OnContainerResize)
/** Tracks all changes in content hierarchy. */
const structureTracker = new ReactiveTracker()
const containerSize = reactive({width: 0, height: 0})

function _GenerateId(): Id {
    return Date.now().toString(36).slice(-6) +
        Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36)
}

/** Get axes directions towards panel content from the specified corner. */
function _GetCornerOrientation(corner: T.Corner): Vector {
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

function _OppositeOrientation(orientation: SplitterOrientation): SplitterOrientation {
    return orientation === SplitterOrientation.HORIZONTAL ?
        SplitterOrientation.VERTICAL : SplitterOrientation.HORIZONTAL
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

/** @return Flattened list of all empty panels. */
function *_GetAllEmptyPanels(): Generator<Panel> {
    for (const panel of _GetAllPanels()) {
        if (panel.children.length === 0) {
            yield panel
        }
    }
}

/** @return Flattened list of all splitters (depth first traversal order). */
function *_GetAllSplitters(): Generator<Splitter, any, undefined> {
    function *IterateItem(item: Panel | Splitter) {
        if (item instanceof Splitter) {
            for (const child of item.children) {
                yield *IterateItem(child)
            }
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

function _PageToLayoutCoord(x: number, y: number): Vector {
    const rect = container.value!.getBoundingClientRect()
    return {
        x: x - rect.x - window.scrollX,
        y: y - rect.y - window.scrollY
    }
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

.pane {
    position: absolute;
}

.emptyPanel {
    position: absolute;
}

.panel {
    position: absolute;
    pointer-events: none;
}

.cornerGrip {
    position: absolute;
    user-select: none;
    pointer-events: all;
}

.cornerGripIcon {
    width: 24px;
    height: 24px;
    pointer-events: none;
    position: absolute;
    visibility: hidden;
    background-image: url("./assets/grip.svg");

    :hover > & {
        visibility: visible;
    }
}

.separator {
    position: absolute;
    user-select: none;
}

</style>
