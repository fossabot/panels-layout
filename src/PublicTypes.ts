/**
 * User-defined data which is used as a key to get actual component and its properties when
 * instantiating layout. Plain types should be used to allow easy serialization.
 */
 export type ContentSelector = any

 export interface ContentDescriptor {
     /** Vue component class. */
     component: any
     /** Properties to bind to the instantiated component via `v-bind` directive . */
     props?: Object
     /** Event to subscribe in the instantiated component via `v-on` directive. */
     events?: Object
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
