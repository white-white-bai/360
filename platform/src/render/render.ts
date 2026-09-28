import type { BlackboardEvent } from "../events/types.ts";

/**
 * A rendered element. Deliberately free of coordinates: layout is the
 * renderer's job, so the surface describes *what* exists, in insertion order,
 * and a future UI decides where it goes (ADR 0005).
 */
export interface SurfaceElement {
  id: string;
  kind: "text" | "shape" | "rich";
  body?: string;
  shape?: string;
  from?: string;
  to?: string;
  format?: string;
  highlighted: boolean;
}

export interface Surface {
  elements: SurfaceElement[];
  /** The last element pointed at, if any. Focus, not content. */
  pointer: string | null;
}

/**
 * A PURE function of the event list.
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

  for (const event of events) {
    switch (event.kind) {
      case "text": {
        if (!byId.has(event.id)) order.push(event.id);
        byId.set(event.id, { id: event.id, kind: "text", body: event.body, highlighted: false });
        break;
      }
      case "shape": {
        if (!byId.has(event.id)) order.push(event.id);
        byId.set(event.id, {
          id: event.id,
          kind: "shape",
          shape: event.shape,
          from: event.from,
          to: event.to,
          highlighted: false,
        });
        break;
      }
      case "rich": {
        if (!byId.has(event.id)) order.push(event.id);
        byId.set(event.id, { id: event.id, kind: "rich", body: event.body, format: event.format, highlighted: false });
        break;
      }
      case "point": {
        pointer = event.target;
        break;
      }
      case "highlight": {
        const el = byId.get(event.target);
        if (el) el.highlighted = true;
        break;
      }
      case "erase": {
        byId.delete(event.target);
        break;
      }
    }
  }

  const elements: SurfaceElement[] = [];
  for (const id of order) {
    const el = byId.get(id);
    if (el) elements.push(el);
  }
  return { elements, pointer };
}
