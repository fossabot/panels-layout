# panels-layout

*See demo [here](https://vagran.github.io/panels-layout-demo/).*

This package provides panels and tabs layout for Vue framework (specifically it is written
for Vue 3). The behavior is mostly inspired (but not fully equal to) by similar
functionality in Blender 3D editor, however it is written from scratch, Blender source code
was not referenced.

https://user-images.githubusercontent.com/6065976/211197855-e9c5013d-2adc-46ee-81c7-be2eaec72641.mp4

The appearance is fully defined by the application code, not this package. This is mostly
by utilizing Vue slots feature, so there are slots for almost all elements of the layout.
Therefore it is not bound to any UI building framework. For example, the demo page mentioned above
uses Quasar but it can be anything compatible with Vue.

The first key feature of the concept is drag zones in each panel corner (grips). They are
visible when hovering cursor on it. Dragging this grip inside the panel will split it. Split
direction depends on drag direction. Dragging the grip outside the panel, onto some neighbor,
will make the panel expand onto that neighbor. Depending on neighbor positioning, it may
either fully consume the neighbor, make it shrink in perpendicular direction or split it
into parts.

Another key concept is Drag and Drop support for panes content (which does not have analogue in
the Blender). The application defines draggable elements which can be dragged between panels. In the demo application you can drag content selector element in the top-left corner of each panel. Try dragging it onto another panel.
By default it will swap the content on drop. Holding `Shift`
button while dragging will make it to copy the content in the another panel. Holding
`Ctrl` button will cause opening new tab for a moved or copied
content. Note that this behavior is specific to the demo application and can be fully customized by
the application. Dragging empty panel content as well as swapping with it is also supported.
This feature relies on HTML5 drag and drop functionality. It is not available on mobile
platforms but this can be overcome by using
[`mobile-drag-drop`](https://github.com/timruffles/mobile-drag-drop) polyfill.
Dragging between panels of one layout instance preserves components local state. However
dragging onto another layout instance (in this example use layout in the right drawer to
try) cannot preserve it. Also dragging onto another layout instance preserves the content of
the pane being dragged, so swap and move are not supported in such case.

## API description

*This is a brief description. See [demo application source](https://github.com/vagran/panels-layout-demo-src) for complete example.*

There is a single core Vue component - `PanelsLayout` which hosts all panels. See its commented list
of properties to figure out all parameters. Each panel may contain zero (empty panel), one or more (tabbed) content panes. Each pane content is defined by `ContentDescriptor` object which provides
Vue component class constructor, bound properties and events. To make it possible to implement
Blender-like content selectors, serialize layout state (e.g. for restoring it later), dragging
content to another layout instance and so on, another entity is introduced - `ContentSelector` which
is basically user-defined serializable type which can be converted to `ContentDescriptor` by user-provided factory function (`contentDescriptorProvider` property of `PanelsLayout` component).

When instantiating `PanelsLayout` component in a template, there is a bunch of slots which can be
used to fully customize appearance of the layout. All of them have some default implementation
but you should consider to make your own to match your application appearance. The demo provides
example of such customization based on Quasar framework components. Slots typically defined inside
a container element which already has proper size and position so you in most cases want to specify
 100% width and height for your content component. Tab bar slots are specified in flex container.
 Here is the slots list:
 * `contentPane` - pane content. See `ContentSlotProps`
type list of all scoped properties provided by the slot. Typically you want to instantiate your
content using Vue dynamic `component` tag, like this - `<component :is="slot.contentDesc.component" v-bind="slot.contentDesc.props ?? {}" v-on="slot.contentDesc.events ?? {}"`.
Slot-provided `setDraggable()` property function can be used to specify draggable element for
implementing content drag-and-drop support. Its first argument is arbitrary ID to distinguish between
several drag elements if it is your case. It is convenient to use Vue template-ref in form of
callback - `:ref="el => slot.setDraggable('selector', el)`.
 * `emptyContent` - empty panel content. Has `setContent()` and `setDraggable()` scoped properties.
 * `tabPrepend` - elements before tabs in a tab bar.
 * `tab` - tab element in a tab bar.
 * `tabAppend` - elements after last tab in a tab bar.
 * `cornerGrip` - panel corner drag zone.
 * `expandGhostFrom` - region of panel to expand when it is about to be expanded.
 * `expandGhostTo` - region to expand panel onto when it is about to be expanded.
 * `expandGhostResult` - region which corresponds to a new panel size after expansion is complete.
 * `dragSource` - region for a pane being dragged.
 * `dropTarget` - region for pane to drop onto.

## Install

```bash
npm install @lavaflow/panels-layout
```

## Incomplete features to be implemented later

There is a bunch of features which are not yet either fully complete or even not started. This
project was written as a component for another bigger project which I will continue to work on,
hopefully implementing all required functionality in this component as well.

 * Tabs implementation is currently in quite rudimentary state.
   * Tab bar overflow handling, showing some dropdown element with list of clipped tabs.
   * Tabs drag and drop with reordering.
   * When dragging pane content, it should be possible to drag it onto a tab bar, specifying position
among tabs to place the pane in.
   * In general more customizable tab bar
 * Container resize handling.
   * It should account minimal specified size for each panel content and redistribute space when
some panel limit is reached. Currently this limit is accounted only when dragging edges.
   * The container should have CSS `min-height` and `min-width` properties calculated based on
panels content specified minimal size.
