/**
 * The blackboard event vocabulary (ADR 0005).
 *
 * CLOSED: the renderer only ever sees these nine kinds. Layout is the renderer's
 * job, so an event says *what* is on the board, never where it sits on screen.
 *
 * The vocabulary is domain-neutral on purpose. `axis` and `band` exist because a
 * scale and a span on it are the two shapes a great deal of teaching needs —
 * offsets, timelines, periods, ranges — and adding them domain-neutrally means
 * the time-zones Domain does not smuggle its own concepts into the protocol.
 * There is deliberately no `timeZoneBand`.
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

export interface AxisMark {
  value: number;
  label?: string;
}

/**
 * A labelled scale. Covers an axis of offsets and a timeline alike, because the
 * protocol has no opinion about what the numbers mean.
 */
export interface DrawAxis extends Timed {
  kind: "axis";
  id: string;
  label: string;
  /** Domain values, not pixels. */
  from: number;
  to: number;
  marks: AxisMark[];
}

export type BandEmphasis = "neutral" | "attention";

/**
 * A span on an axis — a period, a range, a gap, an overlap.
 *
 * `emphasis` is the only presentational hint the vocabulary carries, and it is
 * deliberately coarse: the domain says "this span is the one to notice", and the
 * renderer decides what noticing looks like. Anything finer would move design
 * decisions into the model, which is the thing the closed vocabulary prevents.
 */
export interface DrawBand extends Timed {
  kind: "band";
  id: string;
  /** The axis this band is measured on. */
  axis: string;
  from: number;
  to: number;
  label: string;
  emphasis: BandEmphasis;
}

/**
 * Rows and columns.
 *
 * In the vocabulary rather than in `rich`, because a comparison table is
 * layout-heavy and ubiquitous in teaching: leaving it to the escape hatch would
 * mean the most common teaching shape is also the least reliable one to draw.
 */
export interface DrawTable extends Timed {
  kind: "table";
  id: string;
  columns: string[];
  rows: string[][];
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
  | DrawAxis
  | DrawBand
  | DrawTable
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
  "axis",
  "band",
  "table",
  "point",
  "highlight",
  "erase",
  "rich",
];

export const RICH_FORMATS: ReadonlyArray<RichFormat> = ["mermaid", "excalidraw", "svg"];
export const BAND_EMPHASES: ReadonlyArray<BandEmphasis> = ["neutral", "attention"];
export const SHAPE_KINDS: ReadonlyArray<ShapeKind> = ["rect", "ellipse", "arrow", "line"];

function needString(e: Record<string, unknown>, field: string, kind: string): string {
  const value = e[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`\`${kind}\` needs a non-empty string \`${field}\``);
  }
  return value;
}

function needNumber(e: Record<string, unknown>, field: string, kind: string): number {
  const value = e[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${kind}\` needs a finite numeric \`${field}\``);
  }
  return value;
}

function needOneOf<T extends string>(
  e: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  kind: string,
): T {
  const value = e[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`\`${kind}\` \`${field}\` must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

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
  needNumber(e, "at", "event");
  if (typeof e.kind !== "string" || !EVENT_KINDS.includes(e.kind as BlackboardEvent["kind"])) {
    throw new Error(
      `unknown blackboard event kind ${JSON.stringify(e.kind)}; vocabulary is closed: ${EVENT_KINDS.join(", ")}`,
    );
  }

  switch (e.kind as BlackboardEvent["kind"]) {
    case "text":
      needString(e, "id", "text");
      needString(e, "body", "text");
      return;

    case "shape":
      needString(e, "id", "shape");
      needOneOf(e, "shape", SHAPE_KINDS, "shape");
      needString(e, "from", "shape");
      needString(e, "to", "shape");
      return;

    case "axis": {
      needString(e, "id", "axis");
      needString(e, "label", "axis");
      const from = needNumber(e, "from", "axis");
      const to = needNumber(e, "to", "axis");
      if (to <= from) {
        throw new Error(`\`axis\` needs \`to\` greater than \`from\`, got ${from}..${to}`);
      }
      if (!Array.isArray(e.marks)) {
        throw new Error("`axis` needs a `marks` array (it may be empty)");
      }
      for (const mark of e.marks) {
        if (typeof mark !== "object" || mark === null) {
          throw new Error("`axis` marks must be objects with a numeric `value`");
        }
        const m = mark as Record<string, unknown>;
        needNumber(m, "value", "axis mark");
        if (m.label !== undefined && typeof m.label !== "string") {
          throw new Error("`axis` mark `label`, when present, must be a string");
        }
      }
      return;
    }

    case "band": {
      needString(e, "id", "band");
      needString(e, "axis", "band");
      needString(e, "label", "band");
      const from = needNumber(e, "from", "band");
      const to = needNumber(e, "to", "band");
      if (to <= from) {
        throw new Error(`\`band\` needs \`to\` greater than \`from\`, got ${from}..${to}`);
      }
      needOneOf(e, "emphasis", BAND_EMPHASES, "band");
      return;
    }

    case "table": {
      needString(e, "id", "table");
      if (!Array.isArray(e.columns) || e.columns.length === 0) {
        throw new Error("`table` needs a non-empty `columns` array");
      }
      for (const column of e.columns) {
        if (typeof column !== "string") throw new Error("`table` columns must be strings");
      }
      if (!Array.isArray(e.rows)) throw new Error("`table` needs a `rows` array (it may be empty)");
      for (const row of e.rows) {
        if (!Array.isArray(row)) throw new Error("`table` rows must be arrays of strings");
        if (row.length !== e.columns.length) {
          throw new Error(
            `\`table\` row has ${row.length} cells but there are ${e.columns.length} columns — ` +
              "a ragged table is a layout bug the renderer cannot fix",
          );
        }
        for (const cell of row) {
          if (typeof cell !== "string") throw new Error("`table` cells must be strings");
        }
      }
      return;
    }

    case "rich":
      needString(e, "id", "rich");
      needString(e, "body", "rich");
      needOneOf(e, "format", RICH_FORMATS, "rich");
      if (e.declared !== true) {
        throw new Error("`rich` must be declared: true — the escape hatch is not taken silently");
      }
      return;

    case "point":
    case "highlight":
    case "erase":
      needString(e, "target", e.kind);
      return;
  }
}
