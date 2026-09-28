import type { Surface, SurfaceElement } from "./render.ts";

/**
 * Surface -> text.
 *
 * The only renderer so far, and the reason ADR 0005 accepted "no UI": the kernel
 * is judged by replaying the event stream, so a renderer that is honest and
 * boring is enough to see whether the teaching ran. A real UI is a later
 * consumer of exactly this `Surface`.
 *
 * Note what it does NOT do: place anything. Elements come out in insertion order
 * with their semantic relations intact, because the events never carried
 * coordinates in the first place.
 */

/** Compile-time exhaustiveness. A new element kind must be handled here. */
function assertNever(element: never): never {
  throw new Error(`unhandled surface element: ${JSON.stringify(element)}`);
}

function renderElement(element: SurfaceElement): string {
  const mark = element.highlighted ? "*" : " ";
  switch (element.kind) {
    case "text":
      return `${mark} [文字] ${element.body}`;

    case "shape":
      return `${mark} [图形 ${element.shape}] ${element.from} -> ${element.to}`;

    case "rich":
      // Finally exercised: the escape hatch renders as a labelled block, so an
      // undeclared-format failure and a working one look different on the board.
      return `${mark} [富内容 ${element.format}]\n${indent(element.body)}`;

    case "axis": {
      const marks = element.marks
        .map((mk) => (mk.label === undefined ? String(mk.value) : `${mk.value}(${mk.label})`))
        .join("  ");
      return `${mark} [轴 ${element.label}] ${element.from} .. ${element.to}${marks === "" ? "" : `   刻度: ${marks}`}`;
    }

    case "band": {
      const tone = element.emphasis === "attention" ? "  << 注意" : "";
      return `${mark} [区间 on ${element.axis}] ${element.from} .. ${element.to}  ${element.label}${tone}`;
    }

    case "table": {
      const header = `| ${element.columns.join(" | ")} |`;
      const divider = `|${element.columns.map(() => "---").join("|")}|`;
      const rows = element.rows.map((row) => `| ${row.join(" | ")} |`);
      return `${mark} [表格]\n${indent([header, divider, ...rows].join("\n"))}`;
    }

    default:
      return assertNever(element);
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
}

export function surfaceToText(surface: Surface): string {
  if (surface.elements.length === 0) return "(黑板是空的)";

  const lines = surface.elements.map(renderElement);
  if (surface.pointer !== null) {
    lines.push(`  (指针停在: ${surface.pointer})`);
  }
  return lines.join("\n");
}
