import * as Vue from "vue"

/**
 * User-defined data which is used as a key to get actual component and its properties when
 * instantiating layout. Plain types should be used to allow easy serialization.
 */
export interface ContentSelector {}

export interface ContentDescriptor {
    /** Vue component class. */
    component: any
    /** Properties to bind to the instantiated component via `v-bind` directive . */
    props?: Object
    /** Event to subscribe in the instantiated component via `v-on` directive. */
    events?: Object
    /** Hide component instead of unmounting when tab is inactive. */
    hideInactive?: boolean
}

export type ContentDescriptorProvider = (selector: ContentSelector) => ContentDescriptor

/**
 * Serializable type for saving and restoring current layout.
 */
export interface LayoutDescriptor {
    //XXX
}

export const enum Corner {
    TL = "TL",
    TR = "TR",
    BL = "BL",
    BR = "BR"
}

export const enum Direction {
    UP = "UP",
    DOWN = "DOWN",
    LEFT = "LEFT",
    RIGHT = "RIGHT"
}

export const enum TabPosition {
    FIRST = "FIRST",
    LAST = "LAST",
    PREV = "PREV",
    NEXT = "NEXT"
}

export const enum DragAndDropMode {
    /** Swap source and target. Copied if targeted another layout instance. */
    SWAP = "SWAP",
    /** Source pane is moved into target panel (replace target pane). Copied if targeted another
     * layout instance.
     */
    MOVE = "MOVE",
    /** Target pane is replaced by a copy of source (created based on its content selector). */
    COPY = "COPY",
    /** Source pane is moved into new tab in target panel. Copied if targeted another layout
     *  instance.
     */
    MOVE_NEW_TAB = "MOVE_NEW_TAB",
    /** A copy of source is opened in a new tab (created based on its content selector). No tab if
     * target panel is initially empty.
     */
    COPY_NEW_TAB = "COPY_NEW_TAB"
}

export type DragAndDropModeSelectorFunc = (event: DragEvent) => DragAndDropMode

export type ContentSlotProps = {
    contentDesc: ContentDescriptor
    contentSelector: ContentSelector
    setContent: (contentSelector: ContentSelector) => void
    setDraggable: (id: any, element: HTMLElement | Vue.Component | null) => void
    createTab: (contentSelector: ContentSelector, position?: TabPosition, switchTo?: boolean) => void
    closeTab: () => void
    isTab: boolean
    tabIndex: number
    isActive: boolean
    setActive: () => void
}
