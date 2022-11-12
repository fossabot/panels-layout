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

    <!-- <template v-for="splitter in _GetAllSplitters()" :key="splitter.id">
        <div v-for="(sep, index) in splitter.separators" :key="index" class="separator"
            :ref="el => sep.element = el as HTMLElement"
            :style="splitter.GetSeparatorStyle(index)"
            @pointerdown="splitter.OnSeparatorPointerDown($event, index)"
            @pointerup="splitter.OnSeparatorPointerUp($event, index)"
            @pointercancel="splitter.OnSeparatorPointerUp($event, index)"
            @pointermove="splitter.OnSeparatorPointerMove($event, index)" />
    </template> -->

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

    <!-- <template v-if="expandGhost !== null">
        <div class="expandGhostFrom" :style="expandGhost.expandInfo.fromRect.positionStyle">
            <slot name="expandGhostFrom" :isActive="expandGhost.isActive"
                :dir="expandGhost.expandInfo.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
        <div class="expandGhostTo" :style="expandGhost.expandInfo.toRect.positionStyle">
            <slot name="expandGhostTo" :isActive="expandGhost.isActive"
                :dir="expandGhost.expandInfo.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
        <div class="expandGhostResult" :style="expandGhost.expandInfo.resultRect.positionStyle">
            <slot name="expandGhostResult" :isActive="expandGhost.isActive"
                :dir="expandGhost.expandInfo.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
    </template> -->

</div>
</template>

<script setup lang="ts">
import type * as Vue from "vue"
import { ref, reactive, shallowReactive, onMounted, onBeforeUnmount, watch, nextTick } from "vue"
import * as T from "./PublicTypes"


const props = withDefaults(defineProps<{
    contentDescriptorProvider: T.ContentDescriptorProvider,
    /** Minimal size in pixels for splitter child content. */
    minSplitterContentSize?: number,
    /** Spacing in pixels between adjacent panels. */
    panelsSpacing?: number,
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
    /** Minimal drag distance in pixels before panel expanding. */
    panelOutwardDragThreshold?: number

}>(), {
    minSplitterContentSize: 30,
    panelsSpacing: 4,
    cornerGripSize: 14,
    panelInwardDragThreshold: 16,
    panelSplitDragDifferenceThreshold: 12,
    splitterDragZoneSize: 10,
    panelOutwardDragThreshold: 16
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

enum Orientation {
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

    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0) {
        this.x = x
        this.y = y
        this.width = width
        this.height = height
    }

    GetAxisCoord(orientation: Orientation): number {
        return orientation === Orientation.HORIZONTAL ? this.x : this.y
    }

    GetAxisSize(orientation: Orientation): number {
        return orientation === Orientation.HORIZONTAL ? this.width : this.height
    }

    get positionStyle() {
        return {
            left: this.x + "px",
            top: this.y + "px",
            width: this.width + "px",
            height: this.height + "px"
        }
    }

    get area() {
        return this.width * this.height
    }

    Intersect(other: Rect): Rect | null {
        const x = Math.max(this.x, other.x)
        const right = Math.min(this.x + this.width, other.x + other.width)
        if (right <= x) {
            return null
        }
        const y = Math.max(this.y, other.y)
        const bottom = Math.min(this.y + this.height, other.y + other.height)
        if (bottom <= y) {
            return null
        }
        return new Rect(x, y, right - x, bottom - y)
    }

    Contains(x: number, y: number): boolean {
        return x >= this.x && x < this.x + this.width &&
               y >= this.y && y < this.y + this.height
    }
}

/** Moveable edge. Panels may have some of their edges bound to one such. */
class Edge {
    readonly id: Id = _GenerateId()
    readonly orientation: Orientation
    position: number
    /** First list is for panel having this edge left or top, second one for panels having this
     * edge right or bottom.
     */
    readonly children: Map<Id, Panel>[] = [new Map(), new Map()]

    constructor(orientation: Orientation) {
        this.orientation = orientation
    }

    AddPanel(panel: Panel, side: T.Direction) {
        this.children[Edge.IsPreceding(side) ? 0 : 1].set(panel.id, panel)
    }

    RemovePanel(panel: Panel, side: T.Direction) {
        this.children[Edge.IsPreceding(side) ? 0 : 1].delete(panel.id)
    }

    static IsPreceding(side: T.Direction) {
        return side === T.Direction.LEFT || side === T.Direction.UP
    }
}

type ExpandGhostInfo = {
    /** True if is about to expand, false if is about to cancel. */
    isActive: boolean
    expandInfo: ExpandInfo
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
    EXPAND_CANCELLED,
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

class Panel {
    readonly id: Id = _GenerateId()
    /** It is either bound to some edge or to container corresponding edge if null. */
    edgeLeft: Edge | null = null
    edgeTop: Edge | null = null
    edgeRight: Edge | null = null
    edgeBottom: Edge | null = null
    /** Absolute position in layout container bounds. */
    rect = reactive(new Rect())

    readonly children: ContentPane[] = []

    readonly grips: {[corner in T.Corner]: CornerGrip}
    readonly gripDragInfo: GripDragInfo = {
        pointerId: null,
        corner: T.Corner.TL,
        startPos: {x: 0, y: 0},
        state: GripDragState.INITIAL
    }
    expandTarget: Panel | null = null

    constructor() {
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

    UpdateRect(): void {
        const p = props.panelsSpacing / 2
        const x1 = Math.round(this.edgeLeft ? this.edgeLeft.position + p : 0)
        const y1 = Math.round(this.edgeTop ? this.edgeTop.position + p : 0)
        const x2 = Math.round(this.edgeRight ? this.edgeRight.position - p : containerSize.width)
        const y2 = Math.round(this.edgeBottom ? this.edgeBottom.position - p : containerSize.height)
        this.rect.x = x1
        this.rect.y = y1
        this.rect.width = x2 - x1
        this.rect.height = y2 - y1
    }

    PageToClientCoord(x: number, y: number): Vector {
        const result = _PageToLayoutCoord(x, y)
        result.x -= this.rect.x
        result.y -= this.rect.y
        return result
    }

    /** Get panel if any under the specified layout coordinates. */
    // abstract HitTestPanel(x: number, y: number): Panel | null

    /** Reactive style attributes for absolute positioning inside the container. */
    get positionStyle() {
        return this.rect.positionStyle
    }

    get isEmpty() {
        structureTracker.Touch()
        return this.children.length == 0
    }

    GetEdge(side: T.Direction): Edge | null {
        switch (side) {
        case T.Direction.LEFT:
            return this.edgeLeft
        case T.Direction.RIGHT:
            return this.edgeRight
        case T.Direction.UP:
            return this.edgeTop
        case T.Direction.DOWN:
            return this.edgeBottom
        }
    }

    /** Bind the specified side to the specified edge (null for container edge).
     * @return Previously bound edge.
     */
    BindEdge(edge: Edge | null, side: T.Direction): Edge | null {
        const prevEdge = this.GetEdge(side)
        prevEdge?.RemovePanel(this, side)
        edge?.AddPanel(this, side)
        switch (side) {
        case T.Direction.LEFT:
            this.edgeLeft = edge
            break
        case T.Direction.RIGHT:
            this.edgeRight = edge
            break
        case T.Direction.UP:
            this.edgeTop = edge
            break
        case T.Direction.DOWN:
            this.edgeBottom = edge
            break
        }
        return prevEdge
    }

    /**
     * @param splitPos Split position in pixels along split axis. Origin is the panel client
     *      rectangle origin.
     * @param newFirst True if new panel precedes this one relative to split edge, false if it is
     *      inserted next to this one.
     * @return New edge if split successful, null if split not possible.
     */
    Split(orientation: Orientation, splitPos: number, newFirst: boolean): Edge | null {
        const initialSize = this.rect.GetAxisSize(orientation)
        if (initialSize < props.minSplitterContentSize * 2 + props.panelsSpacing) {
            return null
        }

        const oppOrientation = _OppositeOrientation(orientation)
        const edgeDir = _OrientationDirection(orientation, !newFirst)
        const orthoDir = _OrientationDirection(oppOrientation, false)
        const orthoDirOpp = _OppositeDirection(orthoDir)

        const edge = new Edge(oppOrientation)
        edges.set(edge.id, edge)
        edge.position = this.rect.GetAxisCoord(orientation) + splitPos
        const prevEdge = this.BindEdge(edge, edgeDir)

        const panel = new Panel()
        panels.set(panel.id, panel)
        panel.BindEdge(prevEdge, edgeDir)
        panel.BindEdge(edge, _OppositeDirection(edgeDir))
        panel.BindEdge(this.GetEdge(orthoDir), orthoDir)
        panel.BindEdge(this.GetEdge(orthoDirOpp), orthoDirOpp)

        this.UpdateRect()
        panel.UpdateRect()
        return edge
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
        this.expandTarget = null
        expandGhost.value = null
    }

    OnGripPointerUp(e: PointerEvent, corner: T.Corner): void {
        if (e.pointerId !== this.gripDragInfo.pointerId) {
            return
        }
        if (this.gripDragInfo.state === GripDragState.EXPAND) {
            //XXX
            // this.Expand(this.expandTarget!)
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
        const lytCoords = _PageToLayoutCoord(e.pageX, e.pageY)

        if (this.gripDragInfo.state === GripDragState.INITIAL) {
            if (d.x >= 0 && d.y >= 0 &&
                (d.x >= props.panelInwardDragThreshold || d.y >= props.panelInwardDragThreshold) &&
                Math.abs(d.x - d.y) > props.panelSplitDragDifferenceThreshold) {

                const newFirst = d.x > d.y ? dir.x > 0 : dir.y > 0
                //XXX
                const edge = this.Split(
                    d.x > d.y ? Orientation.HORIZONTAL : Orientation.VERTICAL,
                    d.x > d.y ? clientCoord.x : clientCoord.y,
                    newFirst)

                this.EndGripDrag()
                if (edge) {
                    /* Ensure splitter separator element is created to set pointer capture on. */
                    //XXX
                    // nextTick(() => {
                    //     this.parent!.StartDrag(e, newFirst ? this.childIndex - 1 : this.childIndex)
                    // })
                }
                return
            }

            // if ((d.x < 0 || d.y < 0) &&
            //     (d.x <= -props.panelOutwardDragThreshold || d.y <= -props.panelOutwardDragThreshold)) {

            //     const target = root.HitTestPanel(lytCoords.x, lytCoords.y)
            //     if (!target) {
            //         return
            //     }
            //     const expandInfo = _CalculateExpandInfo(this.rect, target.rect)
            //     if (!expandInfo) {
            //         return
            //     }
            //     expandGhost.value = {
            //         isActive: true,
            //         expandInfo
            //     }
            //     this.expandTarget = target
            //     this.gripDragInfo.state = GripDragState.EXPAND
            //     return
            // }

            return
        }

        if (this.gripDragInfo.state === GripDragState.EXPAND) {
            if (!this.expandTarget!.rect.Contains(lytCoords.x, lytCoords.y)) {
                this.gripDragInfo.state = GripDragState.EXPAND_CANCELLED
                expandGhost.value!.isActive = false
            }
            return
        }

        if (this.gripDragInfo.state === GripDragState.EXPAND_CANCELLED) {
            if (this.expandTarget!.rect.Contains(lytCoords.x, lytCoords.y)) {
                this.gripDragInfo.state = GripDragState.EXPAND
                expandGhost.value!.isActive = true
            }
            return
        }
    }
}

type SplitterDragInfo = {
    pointerId: any | null,
    /** Index of separator to drag. */
    index: number
    /** Start coordinate (page CS). */
    startPointerPos: number
    /** Children raw size sum. */
    sizeSum: number
    /** Initial raw size of first children. */
    startSize: number
    /** Pixel size to raw size ratio. */
    pixRatio: number
}

class SplitterSeparator {
    element?: HTMLElement
    readonly isActive = ref(false)
}

/** Manages either vertically or horizontally split panels. Whole the split layout is formed by
 * hierarchy of these components.
 */
// class Splitter extends PanelBase {
//     readonly orientation: SplitterOrientation
//     /** Always has at least two children. */
//     readonly children: (Splitter | Panel)[]
//     /** May be fractional, recalculated and snapped to pixels in UpdateRect() */
//     readonly childrenSize: number[] = []
//     readonly childrenPixelSize: number[] = []
//     /** Drag in progress when `pointerId` is not null. */
//     readonly dragInfo: SplitterDragInfo = {
//         pointerId: null,
//         index: 0,
//         startPointerPos: 0,
//         sizeSum: 0,
//         startSize: 0,
//         pixRatio: 0
//     }
//     readonly separators: SplitterSeparator[] = []
//     readonly layoutTracker = new ReactiveTracker()

//     constructor(orientation: SplitterOrientation, children: (Splitter | Panel)[],
//                 childrenSize?: number[]) {
//         super()
//         this.orientation = orientation
//         if (children.length < 2) {
//             throw new Error("Splitter must have at least two children")
//         }
//         this.children = children

//         if (childrenSize) {
//             if (childrenSize.length != children.length) {
//                 throw new Error("`childrenSize` length should be equal to `children` length")
//             }
//             this.childrenSize = childrenSize
//         } else {
//             for (let i = 0; i < children.length; i++) {
//                 this.childrenSize.push(props.minSplitterContentSize)
//             }
//         }

//         for (let i = 0; i < children.length; i++) {
//             const c = children[i]
//             c.parent = this
//             c.childIndex = i
//             if (i != 0) {
//                 this.separators.push(new SplitterSeparator())
//             }
//         }
//     }

//     UpdateRect(): void {
//         super.UpdateRect()
//         this._CalculateChildrenPixelSize()
//         for (const child of this.children) {
//             child.UpdateRect()
//         }
//     }

//     GetSeparatorStyle(index: number): Vue.CSSProperties {
//         this.layoutTracker.Touch()

//         let pos = props.splitterSpacing * index
//         for (let i = 0; i <= index; i++) {
//             pos += this.childrenPixelSize[i]
//         }
//         pos -= (props.splitterDragZoneSize - props.splitterSpacing) / 2

//         let style: Vue.CSSProperties
//         if (this.orientation === SplitterOrientation.HORIZONTAL) {
//             style = {
//                 top: this.rect.y + "px",
//                 height: this.rect.height + "px",
//                 left: this.rect.x + pos + "px",
//                 width: props.splitterDragZoneSize + "px"
//             }
//         } else {
//             style = {
//                 left: this.rect.x + "px",
//                 width: this.rect.width + "px",
//                 top: this.rect.y + pos + "px",
//                 height: props.splitterDragZoneSize + "px"
//             }
//         }
//         style.cursor = this.orientation === SplitterOrientation.HORIZONTAL ?
//             "col-resize" : "row-resize"
//         return style
//     }

//     /** Distribute available space between all children proportionally to current children size data
//      * snapping to integer pixels.
//      */
//     _CalculateChildrenPixelSize() {
//         let totalSize = 0
//         const numChildren = this.childrenSize.length
//         this.childrenPixelSize.length = numChildren
//         for (let i = 0; i < numChildren; i++) {
//             totalSize += this.childrenSize[i]
//         }
//         const allocatableSize = this.rect.GetAxisSize(this.orientation) -
//             (this.children.length - 1) * props.splitterSpacing
//         const sizeRatio = allocatableSize / totalSize

//         let curPos = 0
//         totalSize = 0
//         for (let i = 0; i < numChildren; i++) {
//             totalSize += this.childrenSize[i]
//             const newPos = Math.round(totalSize * sizeRatio)
//             this.childrenPixelSize[i] = newPos - curPos
//             curPos = newPos
//         }
//         this.layoutTracker.Update()
//     }

//     StartDrag(e: PointerEvent, index: number): void {
//         this.dragInfo.pointerId = e.pointerId
//         this.dragInfo.index = index
//         this.dragInfo.startPointerPos = this.orientation === SplitterOrientation.HORIZONTAL ?
//             e.pageX : e.pageY
//         const sep = this.separators[index]
//         sep.isActive.value = true
//         sep.element!.setPointerCapture(e.pointerId)

//         this.dragInfo.sizeSum = this.childrenSize[index] + this.childrenSize[index + 1]
//         this.dragInfo.startSize = this.childrenSize[index]
//         const pixSum = this.childrenPixelSize[index] + this.childrenPixelSize[index + 1]
//         this.dragInfo.pixRatio = pixSum / this.dragInfo.sizeSum
//     }

//     EndDrag(): void {
//         if (this.dragInfo.pointerId === null) {
//             return
//         }
//         const sep = this.separators[this.dragInfo.index]
//         sep.isActive.value = false
//         sep.element!.releasePointerCapture(this.dragInfo.pointerId)
//         this.dragInfo.pointerId = null
//     }

//     OnSeparatorPointerDown(e: PointerEvent, index: number): void {
//         if (e.altKey || e.shiftKey || e.ctrlKey) {
//             return
//         }
//         this.StartDrag(e, index)
//     }

//     OnSeparatorPointerUp(e: PointerEvent, index: number): void {
//         if (e.pointerId !== this.dragInfo.pointerId) {
//             return
//         }
//         this.EndDrag()
//     }

//     OnSeparatorPointerMove(e: PointerEvent, index: number): void {
//         if (e.pointerId !== this.dragInfo.pointerId) {
//             return
//         }
//         const minSize = props.minSplitterContentSize / this.dragInfo.pixRatio
//         const maxSize = this.dragInfo.sizeSum - minSize
//         if (minSize >= maxSize) {
//             /* No place for adjustment. */
//             return
//         }
//         const dragDelta =
//             (this.orientation === SplitterOrientation.HORIZONTAL ? e.pageX : e.pageY) -
//             this.dragInfo.startPointerPos
//         let newSize = this.dragInfo.startSize + dragDelta / this.dragInfo.pixRatio
//         if (newSize < minSize) {
//             newSize = minSize
//         } else if (newSize > maxSize) {
//             newSize = maxSize
//         }
//         this.childrenSize[index] = newSize
//         this.childrenSize[index + 1] = this.dragInfo.sizeSum - newSize
//         this.UpdateRect()
//     }

//     InsertChild(child: Panel | Splitter, index: number, size: number): void {
//         this.children.splice(index, 0, child)
//         this.childrenSize.splice(index, 0, size)
//         this.separators.splice(index, 0, new SplitterSeparator())
//         for (let i = index; i < this.children.length; i++) {
//             this.children[i].childIndex = i
//         }
//         child.parent = this
//         this.UpdateRect()
//         structureTracker.Update()
//     }

//     /** Replace current child at the specified index. */
//     SetChild(child: Panel | Splitter, index: number): void {
//         this.children[index] = child
//         child.parent = this
//         child.childIndex = index
//         child.UpdateRect()
//         structureTracker.Update()
//     }

//     /** Remove the specified child. At least two children should be left. */
//     RemoveChild(index: number) {
//         if (this.children.length === 2) {
//             throw new Error("Cannot remove last two children")
//         }
//         this.children.splice(index, 1)
//         this.childrenSize.splice(index, 1)
//         for (let i = index; i < this.children.length; i++) {
//             this.children[i].childIndex = i
//         }
//         this.UpdateRect()
//         structureTracker.Update()
//     }

//     HitTestPanel(x: number, y: number): Panel | null {
//         if (x < this.rect.x || x >= this.rect.x + this.rect.width ||
//             y < this.rect.y || y >= this.rect.y + this.rect.height) {
//             return null
//         }
//         const pos = this.orientation === SplitterOrientation.HORIZONTAL ?
//             x - this.rect.x : y - this.rect.y
//         let curPos = 0
//         for (let i = 0; i < this.childrenPixelSize.length; i++) {
//             const size = this.childrenPixelSize[i]
//             if (pos >= curPos && pos < curPos + size) {
//                 return this.children[i].HitTestPanel(x, y)
//             }
//             curPos += size + props.splitterSpacing
//         }
//         return null
//     }
// }

/** Represents particular panel. Panel may have none (if empty), one or several (if tabbed) content
 * components. Panel parent is either splitter or null if root panel.
 */
// class OldPanel extends PanelBase {

//     readonly grips: {[corner in T.Corner]: CornerGrip}

//     readonly gripDragInfo: GripDragInfo = {
//         pointerId: null,
//         corner: T.Corner.TL,
//         startPos: {x: 0, y: 0},
//         state: GripDragState.INITIAL
//     }

//     expandTarget: Panel | null = null


//     constructor() {
//         super()
//         this.grips = {
//             [T.Corner.TL]: new CornerGrip({
//                 top: "0",
//                 left: "0"
//             }),
//             [T.Corner.TR]: new CornerGrip({
//                 top: "0",
//                 right: "0"
//             }),
//             [T.Corner.BL]: new CornerGrip({
//                 bottom: "0",
//                 left: "0"
//             }),
//             [T.Corner.BR]: new CornerGrip({
//                 bottom: "0",
//                 right: "0"
//             })
//         }
//     }

//     get isEmpty() {
//         structureTracker.Touch()
//         return this.children.length == 0
//     }

//     GetCornerGripIconStyle(corner: T.Corner): Vue.StyleValue {
//         switch (corner) {
//         case T.Corner.TL:
//             return {}
//         case T.Corner.TR:
//             return {
//                 right: "0",
//                 transform: "scaleX(-1)"
//             }
//         case T.Corner.BL:
//             return {
//                 bottom: "0",
//                 transform: "scaleY(-1)"
//             }
//         case T.Corner.BR:
//             return {
//                 bottom: "0",
//                 right: "0",
//                 transform: "scaleX(-1) scaleY(-1)"
//             }
//         }
//     }

//     /**
//      * @param splitPos Split position in pixels along split axis. Origin is the panel client
//      *      rectangle origin.
//      * @param newFirst True if new panel precedes this one in a splitter, false if it is inserted
//      *      next to this one.
//      * @return True if split successful, false if split not possible.
//      */
//     Split(orientation: SplitterOrientation, splitPos: number, newFirst: boolean): boolean {
//         const initialPixelSize = this.rect.GetAxisSize(orientation)
//         if (initialPixelSize < props.minSplitterContentSize * 2 + props.splitterSpacing) {
//             return false
//         }
//         const parent = this.parent
//         const panel = new Panel()
//         const size1 = splitPos - props.splitterSpacing / 2
//         const size2 = initialPixelSize - props.splitterSpacing - size1
//         if (parent && parent.orientation === orientation) {
//             /* Insert new sibling in parent splitter. */
//             const pixelRatio = initialPixelSize / parent.childrenSize[this.childIndex]
//             parent.childrenSize[this.childIndex] = (newFirst ? size2 : size1) / pixelRatio
//             parent.InsertChild(panel, newFirst ? this.childIndex : this.childIndex + 1,
//                 (newFirst ? size1 : size2) / pixelRatio)

//         } else {
//             /* Create new splitter. */
//             const children = newFirst ? [panel, this] : [this, panel]
//             const childIdx = this.childIndex
//             const splitter = new Splitter(orientation, children, [size1, size2])
//             if (parent) {
//                 parent.SetChild(splitter, childIdx)
//             } else {
//                 root = splitter
//                 splitter.UpdateRect()
//                 structureTracker.Update()
//             }
//         }
//         return true
//     }

//     Expand(target: Panel) {
//         const parent: Splitter = this.parent!
//         /* Merge with sibling panel if it is the case. */
//         if (target.parent === parent) {
//             const siblingIdx = target.childIndex
//             if (siblingIdx !== this.childIndex - 1 && siblingIdx !== this.childIndex + 1) {
//                 /* Can merge only with neighbor sibling panel. */
//                 return
//             }
//             if (this.parent!.children.length > 2) {
//                 this.parent!.childrenSize[this.childIndex] += this.parent!.childrenSize[siblingIdx]
//                 this.parent!.RemoveChild(siblingIdx)
//             } else {
//                 const grandParent = parent.parent
//                 if (grandParent) {
//                     grandParent.SetChild(this, parent.childIndex)
//                 } else {
//                     root = this
//                     this.parent = null
//                     this.UpdateRect()
//                     structureTracker.Update()
//                 }
//             }
//             return
//         }
//         //XXX rebuild splitters if dragged outwards
//     }

//     OnGripPointerDown(e: PointerEvent, corner: T.Corner): void {
//         if (e.altKey || e.shiftKey || e.ctrlKey) {
//             return
//         }
//         this.gripDragInfo.pointerId = e.pointerId
//         this.gripDragInfo.corner = corner
//         this.gripDragInfo.startPos.x = e.pageX
//         this.gripDragInfo.startPos.y = e.pageY
//         const grip = this.grips[corner]
//         grip.isActive.value = true
//         grip.element!.setPointerCapture(e.pointerId)
//     }

//     EndGripDrag() {
//         if (this.gripDragInfo.pointerId === null) {
//             return
//         }
//         const grip = this.grips[this.gripDragInfo.corner]
//         grip.isActive.value = false
//         grip.element!.releasePointerCapture(this.gripDragInfo.pointerId)
//         this.gripDragInfo.pointerId = null
//         this.gripDragInfo.state = GripDragState.INITIAL
//         this.expandTarget = null
//         expandGhost.value = null
//     }

//     OnGripPointerUp(e: PointerEvent, corner: T.Corner): void {
//         if (e.pointerId !== this.gripDragInfo.pointerId) {
//             return
//         }
//         if (this.gripDragInfo.state === GripDragState.EXPAND) {
//             this.Expand(this.expandTarget!)
//         }
//         this.EndGripDrag()
//     }

//     OnGripPointerMove(e: PointerEvent, corner: T.Corner): void {
//         if (e.pointerId !== this.gripDragInfo.pointerId) {
//             return
//         }

//         const dir = _GetCornerOrientation(corner)
//         const d = {x: (e.pageX - this.gripDragInfo.startPos.x) * dir.x,
//                    y: (e.pageY - this.gripDragInfo.startPos.y) * dir.y}
//         const clientCoord = this.PageToClientCoord(e.pageX, e.pageY)
//         const lytCoords = _PageToLayoutCoord(e.pageX, e.pageY)

//         if (this.gripDragInfo.state === GripDragState.INITIAL) {
//             if (d.x >= 0 && d.y >= 0 &&
//                 (d.x >= props.panelInwardDragThreshold || d.y >= props.panelInwardDragThreshold) &&
//                 Math.abs(d.x - d.y) > props.panelSplitDragDifferenceThreshold) {

//                 const newFirst = d.x > d.y ? dir.x > 0 : dir.y > 0
//                 if (!this.Split(
//                     d.x > d.y ? SplitterOrientation.HORIZONTAL : SplitterOrientation.VERTICAL,
//                     d.x > d.y ? clientCoord.x : clientCoord.y,
//                     newFirst)) {

//                     this.EndGripDrag()
//                     return
//                 }
//                 this.EndGripDrag()
//                 /* Ensure splitter separator element is created to set pointer capture on. */
//                 nextTick(() => {
//                     this.parent!.StartDrag(e, newFirst ? this.childIndex - 1 : this.childIndex)
//                 })
//                 return
//             }

//             if ((d.x < 0 || d.y < 0) &&
//                 (d.x <= -props.panelOutwardDragThreshold || d.y <= -props.panelOutwardDragThreshold)) {

//                 const target = root.HitTestPanel(lytCoords.x, lytCoords.y)
//                 if (!target) {
//                     return
//                 }
//                 const expandInfo = _CalculateExpandInfo(this.rect, target.rect)
//                 if (!expandInfo) {
//                     return
//                 }
//                 expandGhost.value = {
//                     isActive: true,
//                     expandInfo
//                 }
//                 this.expandTarget = target
//                 this.gripDragInfo.state = GripDragState.EXPAND
//                 return
//             }

//             return
//         }

//         if (this.gripDragInfo.state === GripDragState.EXPAND) {
//             if (!this.expandTarget!.rect.Contains(lytCoords.x, lytCoords.y)) {
//                 this.gripDragInfo.state = GripDragState.EXPAND_CANCELLED
//                 expandGhost.value!.isActive = false
//             }
//             return
//         }

//         if (this.gripDragInfo.state === GripDragState.EXPAND_CANCELLED) {
//             if (this.expandTarget!.rect.Contains(lytCoords.x, lytCoords.y)) {
//                 this.gripDragInfo.state = GripDragState.EXPAND
//                 expandGhost.value!.isActive = true
//             }
//             return
//         }
//     }

//     HitTestPanel(x: number, y: number): Panel | null {
//         if (x < this.rect.x || x >= this.rect.x + this.rect.width ||
//             y < this.rect.y || y >= this.rect.y + this.rect.height) {
//             return null
//         }
//         return this
//     }
// }

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

const panels: Map<Id, Panel> = shallowReactive(new Map())
const edges: Map<Id, Edge> = shallowReactive(new Map())
const container: Vue.Ref<HTMLDivElement | null> = ref(null)
const resizeObserver = new ResizeObserver(_OnContainerResize)
/** Tracks all changes in content hierarchy. */
const structureTracker = new ReactiveTracker()//XXX is needed?
const containerSize = reactive({width: 0, height: 0})
const expandGhost: Vue.Ref<ExpandGhostInfo | null> = ref(null)

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

function _OppositeOrientation(orientation: Orientation): Orientation {
    return orientation === Orientation.HORIZONTAL ? Orientation.VERTICAL : Orientation.HORIZONTAL
}

function _OppositeDirection(dir: T.Direction): T.Direction {
    switch (dir) {
    case T.Direction.LEFT:
        return T.Direction.RIGHT
    case T.Direction.RIGHT:
        return T.Direction.LEFT
    case T.Direction.UP:
        return T.Direction.DOWN
    case T.Direction.DOWN:
        return T.Direction.UP
    }
}


function _OrientationDirection(orientation: Orientation, positive: boolean): T.Direction {
    if (orientation === Orientation.HORIZONTAL) {
        return positive ? T.Direction.RIGHT : T.Direction.LEFT
    } else {
        return positive ? T.Direction.DOWN : T.Direction.UP
    }
}

/** @return Flattened list of all content panes. */
function *_GetAllContent(): Generator<ContentPane, any, undefined> {
    for (const panel of _GetAllPanels()) {
        yield* panel.children
    }
}

/** @return Flattened list of all panels. */
function *_GetAllPanels(): Generator<Panel, any, undefined> {
    yield *panels.values()
}

/** @return Flattened list of all empty panels. */
function *_GetAllEmptyPanels(): Generator<Panel> {
    for (const panel of _GetAllPanels()) {
        if (panel.children.length === 0) {
            yield panel
        }
    }
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

type ExpandInfo = {
    fromRect: Rect
    toRect: Rect
    resultRect: Rect
    dir: T.Direction
}

//XXX is needed?
/** Calculate resulting rectangle after expanding r1 to r2. Returns null if not possible to expand
 * into the provided rectangle.
 */
function _CalculateExpandInfo(r1: Rect, r2: Rect): ExpandInfo | null {
    /* Select direction with maximal expand area. */
    let maxDir: T.Direction | null = null
    let maxArea = 0
    let maxResultRect: Rect | null = null, maxToRect: Rect | null = null
    for (const dir of [T.Direction.LEFT, T.Direction.RIGHT, T.Direction.UP, T.Direction.DOWN]) {
        const rect = _CalculateExpandRect(r1, r2, dir)
        if (rect == null) {
            continue
        }
        const toRect = rect.Intersect(r2)
        if (toRect == null) {
            continue
        }
        const area = toRect.area
        if (maxDir == null || area > maxArea) {
            maxDir = dir
            maxArea = area
            maxResultRect = rect
            maxToRect = toRect
        }
    }
    if (maxDir == null) {
        return null
    }
    const fromRect = maxResultRect!.Intersect(r1)
    if (fromRect == null) {
        return null
    }
    return {
        fromRect,
        toRect: maxToRect!,
        resultRect: maxResultRect!,
        dir: maxDir
    }
}

function _CalculateExpandRect(r1: Rect, r2: Rect, dir: T.Direction): Rect | null {
    let x: number, y: number, right: number, bottom: number
    switch (dir) {
    case T.Direction.RIGHT:
        x = r1.x
        right = r2.x + r2.width
        y = Math.max(r1.y, r2.y)
        bottom = Math.min(r1.y + r1.height, r2.y + r2.height)
        break
    case T.Direction.DOWN:
        y = r1.y
        bottom = r2.y + r2.height
        x = Math.max(r1.x, r2.x)
        right = Math.min(r1.x + r1.width, r2.x + r2.width)
        break
    case T.Direction.LEFT:
        x = r2.x
        right = r1.x + r1.width
        y = Math.max(r1.y, r2.y)
        bottom = Math.min(r1.y + r1.height, r2.y + r2.height)
        break
    case T.Direction.UP:
        y = r2.y
        bottom = r1.y + r1.height
        x = Math.max(r1.x, r2.x)
        right = Math.min(r1.x + r1.width, r2.x + r2.width)
        break
    }
    if (right <= x || bottom <= y) {
        return null
    }
    return new Rect(x, y, right - x, bottom - y)
}

onMounted(() => {
    const panel = new Panel()
    panels.set(panel.id, panel)
    resizeObserver.observe(container.value!)
})

onBeforeUnmount(() => {
    resizeObserver.disconnect()
})

watch(containerSize, () => {
    //XXX redistribute edges
    // update rects
    for (const panel of panels.values()) {
        panel.UpdateRect()
    }
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

.expandGhost {
    position: absolute;
}

.expandGhostFrom, .expandGhostTo {
    .expandGhost();

    .default {
        width: 100%;
        height: 100%;
        opacity: 0.4;
        background-color: aqua;//XXX

        &.active {
            background-color: orange;//XXX
        }
    }
}

.expandGhostResult {
    .expandGhost();

    .default {
        width: 100%;
        height: 100%;
        border: 2px solid rgb(255, 126, 126);//XXX
        border-radius: 4px;

        &.active {
            border-color: red;//XXX
        }
    }
}

</style>
