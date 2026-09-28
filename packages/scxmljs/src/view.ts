/**
 * @tinyactors/scxmljs/view — the `<scxml-view>` custom element: a whole
 * statechart, drawn and running, with no JavaScript of your own.
 *
 *   <script type="module">import "@tinyactors/scxmljs/view";</script>
 *   <scxml-view src="traffic-light.scxml"></scxml-view>
 *
 * Importing this module registers `<scxml-view>`. The data model engine is
 * loaded on demand: the QuickJS sandbox by default, the host's engine with
 * the `trusted` attribute, and neither when you set the `session` property
 * to a session of your own.
 *
 * The layout is exported too (`layoutChart`, `autoCollapse`), for hosts that
 * draw charts themselves.
 *
 * @packageDocumentation
 */
export {
  ScxmlView,
  type ViewAnnounce,
  type ViewDirection,
  type ViewErrorDetail,
  type ViewLoadDetail,
  type ViewOptions,
  type ViewSendDetail,
  ViewSourceError,
} from "./view/element.ts";
export {
  autoCollapse,
  type BoxKind,
  type BoxLayout,
  type ChartLayout,
  type Direction,
  type EdgeKind,
  type EdgeLayout,
  type InitialMarker,
  type LayoutOptions,
  layoutChart,
  type Point,
  type Rect,
  type Size,
  type Spacing,
} from "./view/layout.ts";
export { defaultViewStrings, type ViewStateKind, type ViewStrings } from "./view/strings.ts";
