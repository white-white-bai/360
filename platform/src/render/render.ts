import type {
  AxisMark,
  BandEmphasis,
  BlackboardEvent,
  RichFormat,
  ShapeKind,
} from "../events/types.ts";

/**
 * A rendered element. Deliberately free of coordinates: layout is the renderer's
 * job, so the surface describes *what* exists, in timeline order, and a future
 * UI decides where it goes (ADR 0005).
 *
 * A discriminated union rather than a bag of optional fields, so that a renderer
 * must handle every kind. With optionals, forgetting `band` in a switch compiles
 * and silently draws nothing.
 */
interface Rendered {
  highlighted: boolean;
}

export type SurfaceElement =
  | ({ id: string; kind: "text"; body: string } & Rendered)
  | ({ id: string; kind: "shape"; shape: ShapeKind; from: string; to: string } & Rendered)
  | ({ id: string; kind: "rich"; format: RichFormat; body: string } & Rendered)
  | ({ id: string; kind: "axis"; label: string; from: number; to: number; marks: AxisMark[] } & Rendered)
  | ({
      id: string;
      kind: "band";
      axis: string;
      from: number;
      to: number;
      label: string;
      emphasis: BandEmphasis;
    } & Rendered)
  | ({ id: string; kind: "table"; columns: string[]; rows: string[][] } & Rendered);

export interface Surface {
  elements: SurfaceElement[];
  /** The last element pointed at, if any. Focus, not content. */
  pointer: string | null;
}

/**
 * A PURE function of the event list.
 *
 * Ordering comes from `at`, NOT from the array's order. Every event carries a
 * timeline coordinate, and that coordinate is the only thing entitled to decide
 * what happened first — otherwise the surface depends on an incidental property
 * of how the array happened to be built. The distinction is invisible while
 * events are appended in order, and becomes a silently rearranged board the
 * moment a log is read back from disk or a turn is inserted out of order.
 *
 * Ties keep their array order, because `sort` is stable — which matters when two
 * events deliberately share a position.
 *
 * This is the whole reason the blackboard is event-sourced (ADR 0005): the same
 * events always produce the same surface, which is what makes replay a real
 * acceptance mechanism and what makes "explain it differently" a matter of
 * producing a new sequence rather than undoing edits.
 */
export function render(events: readonly BlackboardEvent[]): Surface {
  const order: string[] = [];
  const byId = new Map<string, SurfaceElement>();
  let pointer: string | null = null;

  const place = (element: SurfaceElement): void => {
    if (!byId.has(element.id)) order.push(element.id);
    byId.set(element.id, element);
  };

  const timeline = [...events].sort((a, b) => a.at - b.at);

  for (const event of timeline) {
    switch (event.kind) {
      case "text":
        place({ id: event.id, kind: "text", body: event.body, highlighted: false });
        break;
      case "shape":
        place({
          id: event.id,
          kind: "shape",
          shape: event.shape,
          from: event.from,
          to: event.to,
          highlighted: false,
        });
        break;
      case "axis":
        place({
          id: event.id,
          kind: "axis",
          label: event.label,
          from: event.from,
          to: event.to,
          marks: event.marks.map((mark) => ({ ...mark })),
          highlighted: false,
        });
        break;
      case "band":
        place({
          id: event.id,
          kind: "band",
          axis: event.axis,
          from: event.from,
          to: event.to,
          label: event.label,
          emphasis: event.emphasis,
          highlighted: false,
        });
        break;
      case "table":
        place({
          id: event.id,
          kind: "table",
          columns: [...event.columns],
          rows: event.rows.map((row) => [...row]),
          highlighted: false,
        });
        break;
      case "rich":
        place({ id: event.id, kind: "rich", format: event.format, body: event.body, highlighted: false });
        break;
      case "point":
        pointer = event.target;
        break;
      case "highlight": {
        const element = byId.get(event.target);
        if (element) element.highlighted = true;
        break;
      }
      case "erase":
        byId.delete(event.target);
        break;
    }
  }

  const elements: SurfaceElement[] = [];
  for (const id of order) {
    const element = byId.get(id);
    if (element) elements.push(element);
  }
  return { elements, pointer };
}
