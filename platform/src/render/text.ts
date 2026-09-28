import type { Surface } from "./render.ts";

/**
 * Surface -> text.
 *
 * The only renderer in Phase 1, and the reason ADR 0005 accepted "no UI": the
 * kernel is judged by replaying the event stream, so a renderer that is honest
 * and boring is enough to see whether the teaching ran. A real UI is a later
 * consumer of exactly this `Surface`.
 *
 * Note what it does NOT do: place anything. Elements come out in insertion
 * order with their semantic relations intact, because the events never carried
 * coordinates in the first place.
 */
export function surfaceToText(surface: Surface): string {
  if (surface.elements.length === 0) return "(黑板是空的)";

  const lines = surface.elements.map((element) => {
    const mark = element.highlighted ? "*" : " ";
    switch (element.kind) {
      case "text":
        return `${mark} [文字] ${element.body ?? ""}`;
      case "shape":
        return `${mark} [图形 ${element.shape ?? "?"}] ${element.from ?? "?"} -> ${element.to ?? "?"}`;
      case "rich":
        return `${mark} [富内容 ${element.format ?? "?"}] ${element.body ?? ""}`;
      default:
        return `${mark} [?]`;
    }
  });

  if (surface.pointer !== null) {
    lines.push(`  (指针停在: ${surface.pointer})`);
  }
  return lines.join("\n");
}
