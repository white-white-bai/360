/**
 * The blackboard event vocabulary (ADR 0005).
 *
 * CLOSED: the renderer only ever sees these six kinds. Layout is the renderer's
 * job, so an event says *what* is on the board, never where it sits on screen.
 *
 * The one escape hatch is `rich`, and it exists because a closed vocabulary
 * cannot express geometry, circuit diagrams or sequence charts. It is
 * "restricted": the payload's format is a closed set, and `declared: true` is
 * required so an undeclared escape hatch is a type error rather than a habit.
 */

/** Who is speaking / drawing. Mirrors `Position` in CONTEXT.md. */
export type Position = "lead-explainer" | "challenger";

/** Shared timeline coordinate. Narration and events are two streams, one clock. */
export interface Timed {
  at: number;
}

export interface WriteText extends Timed {
  kind: "text";
  id: string;
  body: string;
}

export type ShapeKind = "rect" | "ellipse" | "arrow" | "line";

export interface DrawShape extends Timed {
  kind: "shape";
  id: string;
  shape: ShapeKind;
  /** Semantic anchors, not screen coordinates — the renderer decides layout. */
  from: string;
  to: string;
}

/** Points at an element that already exists. Changes focus, not content. */
export interface PointAt extends Timed {
  kind: "point";
  target: string;
}

export interface Highlight extends Timed {
  kind: "highlight";
  target: string;
}

export interface Erase extends Timed {
  kind: "erase";
  target: string;
}

export type RichFormat = "mermaid" | "excalidraw" | "svg";

export interface RichContent extends Timed {
  kind: "rich";
  id: string;
  format: RichFormat;
  body: string;
  /** ADR 0005: the escape hatch must be declared, not taken silently. */
  declared: true;
}

export type BlackboardEvent =
  | WriteText
  | DrawShape
  | PointAt
  | Highlight
  | Erase
  | RichContent;

/** The narration stream. Separable from events on purpose (ADR 0005). */
export interface NarrationChunk extends Timed {
  actor: Position;
  text: string;
}

const EVENT_KINDS: ReadonlyArray<BlackboardEvent["kind"]> = [
  "text",
  "shape",
  "point",
  "highlight",
  "erase",
  "rich",
];

const RICH_FORMATS: ReadonlyArray<RichFormat> = ["mermaid", "excalidraw", "svg"];

/**
 * Events arrive from a model, which makes this a trust boundary rather than an
 * internal invariant. An unknown `kind` must be rejected here, loudly, instead
 * of reaching the renderer.
 */
export function assertBlackboardEvent(value: unknown): asserts value is BlackboardEvent {
  if (typeof value !== "object" || value === null) {
    throw new Error(`blackboard event must be an object, got ${typeof value}`);
  }
  const e = value as Record<string, unknown>;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) {
    throw new Error("blackboard event needs a finite numeric `at`");
  }
  if (typeof e.kind !== "string" || !EVENT_KINDS.includes(e.kind as BlackboardEvent["kind"])) {
    throw new Error(
      `unknown blackboard event kind ${JSON.stringify(e.kind)}; vocabulary is closed: ${EVENT_KINDS.join(", ")}`,
    );
  }
  switch (e.kind as BlackboardEvent["kind"]) {
    case "text":
      if (typeof e.id !== "string" || typeof e.body !== "string") {
        throw new Error("`text` needs string `id` and `body`");
      }
      return;
    case "shape":
      if (typeof e.id !== "string" || typeof e.shape !== "string" || typeof e.from !== "string" || typeof e.to !== "string") {
        throw new Error("`shape` needs string `id`, `shape`, `from`, `to`");
      }
      return;
    case "rich":
      if (typeof e.id !== "string" || typeof e.body !== "string") {
        throw new Error("`rich` needs string `id` and `body`");
      }
      if (!RICH_FORMATS.includes(e.format as RichFormat)) {
        throw new Error(`\`rich\` format must be one of ${RICH_FORMATS.join(", ")}`);
      }
      if (e.declared !== true) {
        throw new Error("`rich` must be declared: true — the escape hatch is not taken silently");
      }
      return;
    default:
      if (typeof e.target !== "string") {
        throw new Error(`\`${String(e.kind)}\` needs a string \`target\``);
      }
      return;
  }
}
