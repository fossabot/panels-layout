<template>
<div ref="container" class="container" :style="minContainerSizeStyle">
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

    <div v-for="edge in edges.values()" :key="edge.id" class="separator"
        :ref="el => edge.element = el as HTMLElement" :style="edge.separatorStyle"
            @pointerdown="edge.OnPointerDown($event)"
            @pointerup="edge.OnPointerUp($event)"
            @pointercancel="edge.OnPointerUp($event)"
            @pointermove="edge.OnPointerMove($event)" />

    <div v-for="panel in panels.values()" :key="panel.id" class="panel"
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

    <template v-if="expandGhost !== null">
        <div class="expandGhostFrom" :style="expandGhost.fromRect.positionStyle">
            <slot name="expandGhostFrom" :isActive="expandGhost.isActive"
                :dir="expandGhost.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
        <div class="expandGhostTo" :style="expandGhost.toRect.positionStyle">
            <slot name="expandGhostTo" :isActive="expandGhost.isActive"
                :dir="expandGhost.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
        <div class="expandGhostResult" :style="expandGhost.resultRect.positionStyle">
            <slot name="expandGhostResult" :isActive="expandGhost.isActive"
                :dir="expandGhost.dir">
                <div class="default" :class="{active: expandGhost.isActive}" />
            </slot>
        </div>
    </template>

</div>
</template>

<script setup lang="ts">
import { computed } from "@vue/reactivity";
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

type EdgeDragInfo = {
    pointerId: any | null,
    /** Start coordinate (page CS). */
    startPointerPos: number
    /** Initial position value. */
    startPos: number
    /** Pre-calculated minimal position limit. */
    minPos: number
    /** Pre-calculated maximal position limit. */
    maxPos: number
}

/** Moveable edge. Panels may have some of their edges bound to one such. */
class Edge {
    readonly id: Id = _GenerateId()
    readonly orientation: Orientation
    /** Coordinate along corresponding axis in container CS. */
    position: number
    /** First list is for panel having this edge left or top, second one for panels having this
     * edge right or bottom.
     */
    readonly children: Map<Id, Panel>[] = [new Map(), new Map()]
    /** Separator element. */
    element?: HTMLElement
    /** True when being dragged. */
    readonly isActive: Vue.Ref<boolean> = ref(false)
    /** Update when links to panels changed. */
    readonly layoutTracker = new ReactiveTracker()
    /** Drag in progress when `pointerId` is not null. */
    readonly dragInfo: EdgeDragInfo = {
        pointerId: null,
        startPointerPos: 0,
        startPos: 0,
        minPos: 0,
        maxPos: 0
    }

    constructor(orientation: Orientation, position: number) {
        this.orientation = orientation
        this.position = position
    }

    Destroy() {
        _Assert(this.children[0].size == 0, "Edge should be empty when destroying (0)")
        _Assert(this.children[1].size == 0, "Edge should be empty when destroying (1)")
        edges.delete(this.id)
    }

    AddPanel(panel: Panel, side: T.Direction) {
        this.children[Edge.IsPreceding(side) ? 0 : 1].set(panel.id, panel)
        this.layoutTracker.Update()
    }

    RemovePanel(panel: Panel, side: T.Direction) {
        this.children[Edge.IsPreceding(side) ? 0 : 1].delete(panel.id)
        this.layoutTracker.Update()
    }

    /** Check if panel is in preceding children list, if the edge is for the specified direction
     * (for the panel point of view).
     */
    static IsPreceding(side: T.Direction) {
        return side === T.Direction.RIGHT || side === T.Direction.DOWN
    }

    /** @return Direction from panel point of view). */
    GetDirection(isPreceding: boolean): T.Direction {
        if (this.orientation === Orientation.HORIZONTAL) {
            return isPreceding ? T.Direction.DOWN : T.Direction.UP
        }
        return isPreceding ? T.Direction.RIGHT : T.Direction.LEFT
    }

    GetChildren(side: T.Direction): Map<Id, Panel> {
        return this.children[Edge.IsPreceding(side) ? 0 : 1]
    }

    get separatorStyle(): Vue.CSSProperties {
        this.layoutTracker.Touch()
        let minCoord: number | null = null
        let maxCoord: number | null = null
        for (const panel of this.children[0].values()) {
            const coord = panel.rect.GetAxisCoord(this.orientation)
            const size = panel.rect.GetAxisSize(this.orientation)
            if (minCoord === null || coord < minCoord) {
                minCoord = coord
            }
            if (maxCoord === null || coord + size > maxCoord) {
                maxCoord = coord + size
            }
        }
        const p = props.splitterDragZoneSize / 2
        let style: Vue.CSSProperties
        if (this.orientation === Orientation.HORIZONTAL) {
            style = {
                top: this.position - p + "px",
                height: props.splitterDragZoneSize + "px",
                left: minCoord + "px",
                width: maxCoord! - minCoord! + "px"
            }
        } else {
            style = {
                left: this.position - p + "px",
                width: props.splitterDragZoneSize + "px",
                top: minCoord + "px",
                height: maxCoord! - minCoord! + "px"
            }
        }
        style.cursor = this.orientation === Orientation.HORIZONTAL ? "row-resize": "col-resize"
        return style
    }

    StartDrag(e: PointerEvent): void {
        this.dragInfo.pointerId = e.pointerId
        this.dragInfo.startPointerPos = this.orientation === Orientation.HORIZONTAL ?
            e.pageY : e.pageX
        this.isActive.value = true
        this.element!.setPointerCapture(e.pointerId)
        this.dragInfo.startPos = this.position

        let minPosition: number | null = null
        let maxPosition: number | null = null
        const oppOrientation = _OppositeOrientation(this.orientation)
        for (const panel of this.children[0].values()) {
            const pos = panel.rect.GetAxisCoord(oppOrientation) + panel.GetMinSize(oppOrientation)
            /* Find maximal value. */
            if (minPosition === null || pos > minPosition) {
                minPosition = pos
            }
        }
        for (const panel of this.children[1].values()) {
            const pos = panel.rect.GetAxisCoord(oppOrientation) +
                panel.rect.GetAxisSize(oppOrientation) - panel.GetMinSize(oppOrientation)
            /* Find minimal value. */
            if (maxPosition === null || pos < maxPosition) {
                maxPosition = pos
            }
        }
        this.dragInfo.minPos = minPosition! + props.panelsSpacing / 2
        this.dragInfo.maxPos = maxPosition! - props.panelsSpacing / 2
    }

    EndDrag(): void {
        if (this.dragInfo.pointerId === null) {
            return
        }
        this.isActive.value = false
        this.element!.releasePointerCapture(this.dragInfo.pointerId)
        this.dragInfo.pointerId = null
    }

    OnPointerDown(e: PointerEvent): void {
        if (e.altKey || e.shiftKey || e.ctrlKey) {
            return
        }
        this.StartDrag(e)
    }

    OnPointerUp(e: PointerEvent): void {
        if (e.pointerId !== this.dragInfo.pointerId) {
            return
        }
        this.EndDrag()
    }

    OnPointerMove(e: PointerEvent): void {
        if (e.pointerId !== this.dragInfo.pointerId) {
            return
        }
        if (this.dragInfo.minPos >= this.dragInfo.maxPos) {
            /* No place for adjustment. */
            return
        }
        const dragDelta =
            (this.orientation === Orientation.HORIZONTAL ? e.pageY : e.pageX) -
            this.dragInfo.startPointerPos
        let newPos = this.dragInfo.startPos + dragDelta
        if (newPos < this.dragInfo.minPos) {
            newPos = this.dragInfo.minPos
        } else if (newPos > this.dragInfo.maxPos) {
            newPos = this.dragInfo.maxPos
        }
        this.position = newPos
        this.UpdateChildrenRect()
    }

    UpdateChildrenRect() {
        for (let i = 0; i < 2; i++) {
            for (const panel of this.children[i].values()) {
                panel.UpdateRect()
            }
        }
    }

    static GetPosition(edge: Edge | null, dir: T.Direction): number {
        if (edge) {
            return edge.position
        }
        switch (dir) {
        case T.Direction.LEFT:
            return 0
        case T.Direction.RIGHT:
            return containerSize.width
        case T.Direction.UP:
            return 0
        case T.Direction.DOWN:
            return containerSize.height
        }
    }

    /** Merge this edge into the specified one. This edge is removed after that. In case it is
     * merged into container edge (null argument, panels from border side are destroyed).
     * @param dir Direction for the panel which initiates merging. When merging with container edge,
     *  panels from opposite side are destroyed.
     */
    Merge(edge: Edge | null, dir: T.Direction): void {
        let j = Edge.IsPreceding(dir) ? 0 : 1
        /* It is safe in JS to iterate while deleting elements. */
        for (const panel of this.children[j].values()) {
            panel.BindEdge(edge, dir)
            panel.UpdateRect()
        }
        j = j ? 0 : 1
        const oppDir = _OppositeDirection(dir)
        for (const panel of this.children[j].values()) {
            if (edge) {
                panel.BindEdge(edge, oppDir)
                panel.UpdateRect()
            } else {
                panel.Destroy()
            }
        }
        edges.delete(this.id)
    }

    /** Split the edge. Each side uses separate limit for children splitting. After this method
     * returns this edge has children left with orthogonal positive edge less or equal to the
     * specified limits. The returned edge has all the rest children. Null is returned if resulting
     * edge will not have any children.
     */
    Split(posLimit: number[]): Edge {
        const newEdgeChildren: Panel[][] = [[], []]
        const splitDir = _OrientationDirection(this.orientation, true)
        for (let i = 0; i < 2; i++) {
            for (const child of this.children[i].values()) {
                const pos = Edge.GetPosition(child.GetEdge(splitDir), splitDir)
                if (pos > posLimit[i]) {
                    newEdgeChildren[i].push(child)
                }
            }
        }
        const edge = _CreateEdge(this.orientation, this.position)
        for (let i = 0; i < 2; i++) {
            const dir = this.GetDirection(i == 0)
            for (const child of newEdgeChildren[i].values()) {
                child.BindEdge(edge, dir)
            }
        }
        return edge
    }
}

type ExpandGhostInfo = {
    /** True if is about to expand, false if is about to cancel. */
    isActive: boolean
    dir: T.Direction
    fromRect: Rect
    toRect: Rect
    resultRect: Rect
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
    /** Update when links to content panes changed. */
    readonly layoutTracker = new ReactiveTracker()

    readonly children: ContentPane[] = []

    readonly grips: {[corner in T.Corner]: CornerGrip}
    readonly gripDragInfo: GripDragInfo = {
        pointerId: null,
        corner: T.Corner.TL,
        startPos: {x: 0, y: 0},
        state: GripDragState.INITIAL
    }
    expandTarget: Panel | null = null
    expandDirection: T.Direction

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

    Destroy(): void {
        this.edgeLeft?.RemovePanel(this, T.Direction.LEFT)
        this.edgeRight?.RemovePanel(this, T.Direction.RIGHT)
        this.edgeTop?.RemovePanel(this, T.Direction.UP)
        this.edgeBottom?.RemovePanel(this, T.Direction.DOWN)
        //XXX some events
        panels.delete(this.id)
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
        this.layoutTracker.Touch()
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

    GetMinSize(orientation: Orientation): number {
        //XXX may be dynamic, depend on tabs visibility and content
        return props.minSplitterContentSize
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

        const edge = _CreateEdge(oppOrientation, this.rect.GetAxisCoord(orientation) + splitPos)
        const prevEdge = this.BindEdge(edge, edgeDir)

        const panel = _CreatePanel()
        panel.BindEdge(prevEdge, edgeDir)
        panel.BindEdge(edge, _OppositeDirection(edgeDir))
        panel.BindEdge(this.GetEdge(orthoDir), orthoDir)
        panel.BindEdge(this.GetEdge(orthoDirOpp), orthoDirOpp)

        this.UpdateRect()
        panel.UpdateRect()
        return edge
    }

    Expand(target: Panel, dir: T.Direction): void {
        const edge = this.GetEdge(dir)
        _Assert(edge != null, "No expand edge")
        _Assert(target.GetEdge(_OppositeDirection(dir)) === edge, "Expand edge mismatch")

        const farEdge = target.GetEdge(dir)
        const orthoNegDir = _OrientationDirection(edge.orientation, false)
        const orthoPosDir = _OrientationDirection(edge.orientation, true)
        let orthoNegEdge = this.GetEdge(orthoNegDir)
        let orthoPosEdge = this.GetEdge(orthoPosDir)
        let targetOrthoNegEdge = target.GetEdge(orthoNegDir)
        let targetOrthoPosEdge = target.GetEdge(orthoPosDir)

        /* Merge close ortho edges. */
        if (orthoNegEdge !== targetOrthoNegEdge &&
            Math.abs(Edge.GetPosition(orthoNegEdge, orthoNegDir) -
                     Edge.GetPosition(targetOrthoNegEdge, orthoNegDir)) <= props.minSplitterContentSize) {

            if (targetOrthoNegEdge == null) {
                orthoNegEdge!.Merge(null, orthoNegDir)
                orthoNegEdge = null
            } else {
                targetOrthoNegEdge.Merge(orthoNegEdge, orthoNegDir)
                targetOrthoNegEdge = orthoNegEdge
            }
        }
        if (orthoPosEdge !== targetOrthoPosEdge &&
            Math.abs(Edge.GetPosition(orthoPosEdge, orthoPosDir) -
                     Edge.GetPosition(targetOrthoPosEdge, orthoPosDir)) <= props.minSplitterContentSize) {


            if (targetOrthoPosEdge == null) {
                orthoPosEdge!.Merge(null, orthoPosDir)
                orthoPosEdge = null
            } else {
                targetOrthoPosEdge.Merge(orthoPosEdge, orthoPosDir)
                targetOrthoPosEdge = orthoPosEdge
            }
        }

        const isNegOutside = Edge.GetPosition(targetOrthoNegEdge, orthoNegDir) <
            Edge.GetPosition(orthoNegEdge, orthoNegDir)
        const isPosOutside = Edge.GetPosition(targetOrthoPosEdge, orthoPosDir) >
            Edge.GetPosition(orthoPosEdge, orthoPosDir)

        /* Make some preparations. Expand edge is split to part above and below (along orthogonal
         * axis, named by positive and negative axis direction) this panel. Target panel is split if
         * both its orthogonal edges are outside this panel corresponding edges.
         * Vertical case examples:
         *
         *            |
         * -----------+
         *    this    |  inside edge
         *            +-----------
         *            |  target
         *
         *
         *            |  outside edge
         *            +------------
         *            |
         * -----------+  target
         *    this    |
         *            ^expand edge
         *
         *
         *      shared edge
         * -----------+------------
         *    this    |  target
         *            |
         *
         *
         * Split scheme:
         *
         * orth.neg. ||<expand neg. edge
         * edge      ||
         * ----------+|
         *           ||   target orthogonal neg. edge
         *    this   |+------------
         *           ||
         *           ||  target
         * ---------+++
         * ^orth.   ||^new edge (for left children, right children position limit is set to target
         * pos. edge||           orthogonal pos. edge)
         *          ||
         *          +++------------
         *expand    ||    ^ target orthogonal pos. edge
         *pos. edge>||
         *          ||
         *  new edge^|
         *           ^old edge
         */
        this.BindEdge(farEdge, dir)
        let edgeSplitPos: number[]
        if (Edge.IsPreceding(dir)) {
            edgeSplitPos = [Edge.GetPosition(orthoPosEdge, orthoPosDir),
                            Edge.GetPosition(targetOrthoPosEdge, orthoPosDir)]
        } else {
            edgeSplitPos = [Edge.GetPosition(targetOrthoPosEdge, orthoPosDir),
                            Edge.GetPosition(orthoPosEdge, orthoPosDir)]
        }
        let expandPosEdge = edge.Split(edgeSplitPos)

        let targetSplit: Panel | null = null
        if (isNegOutside && isPosOutside) {
            /* Split the target panel. */
            targetSplit = _CreatePanel()
            targetSplit.BindEdge(farEdge, dir)
            targetSplit.BindEdge(expandPosEdge, _OppositeDirection(dir))
            targetSplit.BindEdge(target.GetEdge(orthoPosDir), orthoPosDir)
            /* Remaining edge will be set by orthogonal edge handling function. */
        } else if (isPosOutside) {
            /* Reassign target panel to positive part of previously split edge. */
            target.BindEdge(expandPosEdge, _OppositeDirection(dir))
        }

        function HandleOrthogonalEdge(
            orthoDir: T.Direction,
            orthoEdge: Edge | null,
            orthoTargetEdge: Edge | null,
            isOutside: boolean,
            target: Panel,
            edge: Edge) {

            if (orthoEdge === orthoTargetEdge) {
                /* Do nothing for shared edge. */
                return
            }
            if (isOutside) {
                /* Shrink target panel. No any structural changes. */
                target.BindEdge(orthoEdge, _OppositeDirection(orthoDir))
                return
            }

            /* Check if any neighbor over orthogonal edge is connected to expand edge. In such case
             * orthogonal edge is merged into target orthogonal edge. Actually, it can be just
             * checked if expand edge has some children from this panel side (this panel itself is
             * already unbound from this edge).
             */
            if (edge.GetChildren(dir).size > 0) {
                /* Orthogonal edge must exist in such case. */
                orthoEdge!.Merge(orthoTargetEdge, orthoDir)
                return
            }

            this.BindEdge(orthoTargetEdge, orthoDir)
            const oppDir = _OppositeDirection(dir)
            const oppEdge = this.GetEdge(oppDir)
            for (const panel of edge.GetChildren(oppDir).values()) {
                panel.BindEdge(oppEdge, oppDir)
                panel.UpdateRect()
            }
        }

        HandleOrthogonalEdge.call(this, orthoNegDir, orthoNegEdge, targetOrthoNegEdge, isNegOutside,
                                  target, edge)
        HandleOrthogonalEdge.call(this, orthoPosDir, orthoPosEdge, targetOrthoPosEdge, isPosOutside,
                                  targetSplit ? targetSplit : target, expandPosEdge)

        if (!isNegOutside && !isPosOutside) {
            target.Destroy()
        } else {
            target.UpdateRect()
        }
        if (edge.children[0].size == 0) {
            edge.Destroy()
        }
        if (expandPosEdge.children[0].size == 0) {
            expandPosEdge.Destroy()
        }
        this.UpdateRect()
        targetSplit?.UpdateRect()
    }

    /**
     * Check if expansion is possible to the specified layout coordinates. It sets `expandTarget`
     * and `expandDirection` if possible.
     * @param corner Corner which initiates expansion.
     * @return True if expand target set, false otherwise.
     */
    CheckExpand(corner: T.Corner, x: number, y: number): boolean {
        for (const dir of _CornerDirections(corner)) {
            const edge = this.GetEdge(dir)
            if (!edge) {
                continue
            }
            /* Check opposite side children. */
            const candidates = edge.GetChildren(_OppositeDirection(dir))
            for (const panel of candidates.values()) {
                if (panel.rect.Contains(x, y)) {
                    this.expandTarget = panel
                    this.expandDirection = dir
                    return true
                }
            }
        }
        return false
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
            this.Expand(this.expandTarget!, this.expandDirection)
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
                const edge = this.Split(
                    d.x > d.y ? Orientation.HORIZONTAL : Orientation.VERTICAL,
                    d.x > d.y ? clientCoord.x : clientCoord.y,
                    newFirst)

                this.EndGripDrag()
                if (edge) {
                    /* Ensure edge element is created to set pointer capture on. */
                    nextTick(() => {
                        edge.StartDrag(e)
                    })
                }
                return
            }

            if ((d.x < 0 || d.y < 0) &&
                (d.x <= -props.panelOutwardDragThreshold || d.y <= -props.panelOutwardDragThreshold)) {

                if (!this.CheckExpand(corner, lytCoords.x, lytCoords.y)) {
                    return
                }
                const resultRect = _CalculateExpandRect(this.rect, this.expandTarget!.rect,
                                                        this.expandDirection)
                _Assert(resultRect != null, "Empty expand rectangle")
                expandGhost.value = {
                    isActive: true,
                    dir: this.expandDirection,
                    fromRect: resultRect.Intersect(this.rect)!,
                    toRect: resultRect.Intersect(this.expandTarget!.rect)!,
                    resultRect
                }
                this.gripDragInfo.state = GripDragState.EXPAND
                return
            }

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
const containerSize = reactive({width: 0, height: 0})
const expandGhost: Vue.Ref<ExpandGhostInfo | null> = ref(null)

function _Assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error("Assertion failed: " + message)
    }
}

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

function _CornerDirections(corner: T.Corner): T.Direction[] {
    switch (corner) {
    case T.Corner.TL:
        return [T.Direction.LEFT, T.Direction.UP]
    case T.Corner.BL:
        return [T.Direction.LEFT, T.Direction.DOWN]
    case T.Corner.TR:
        return [T.Direction.RIGHT, T.Direction.UP]
    case T.Corner.BR:
        return [T.Direction.RIGHT, T.Direction.DOWN]
    }
}

/** @return Flattened list of all content panes. */
function *_GetAllContent(): Generator<ContentPane, any, undefined> {
    for (const panel of panels.values()) {
        yield* panel.children
    }
}

/** @return List of all empty panels. */
function *_GetAllEmptyPanels(): Generator<Panel> {
    for (const panel of panels.values()) {
        if (panel.children.length === 0) {
            yield panel
        }
    }
}

function _OnContainerResize(entries: ResizeObserverEntry[]) {
    const sz = entries[0].contentBoxSize[0]

    if (containerSize.width > 0 && containerSize.height > 0 &&
        sz.inlineSize > 0 && sz.blockSize > 0) {

        const widthRatio = sz.inlineSize / containerSize.width
        const heightRatio = sz.blockSize / containerSize.height
        for (const edge of edges.values()) {
            if (edge.orientation === Orientation.VERTICAL) {
                edge.position *= widthRatio
            } else {
                edge.position *= heightRatio
            }
        }
    }
    //XXX handle minimal size and redistribute somehow if such is reached for some panels

    containerSize.width = sz.inlineSize
    containerSize.height = sz.blockSize

    for (const panel of panels.values()) {
        panel.UpdateRect()
    }
}

function _PageToLayoutCoord(x: number, y: number): Vector {
    const rect = container.value!.getBoundingClientRect()
    return {
        x: x - rect.x - window.scrollX,
        y: y - rect.y - window.scrollY
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

function _CreateEdge(orientation: Orientation, position: number) {
    const edge = new Edge(orientation, position)
    edges.set(edge.id, edge)
    return edge
}

//XXX content descriptor
function _CreatePanel() {
    const panel = new Panel()//XXX
    panels.set(panel.id, panel)
    //XXX event
    return panel
}

onMounted(() => {
    const panel = new Panel()
    panels.set(panel.id, panel)
    resizeObserver.observe(container.value!)
})

onBeforeUnmount(() => {
    resizeObserver.disconnect()
})

const minContainerSizeStyle: Vue.ComputedRef<Vue.CSSProperties> = computed(() => {
    //XXX scan panels chains in both directions
    return {}
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
