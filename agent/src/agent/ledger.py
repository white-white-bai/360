"""Calls and money, per actor — the SpendMeter ported (platform/src/providers/meter.ts).

A single total would say what a session cost but not WHO spent it, and the actors in this stack
are not interchangeable (ADR 0004) — so "which actor is expensive" is as load-bearing as "how
expensive". Unknown models are priced as UNKNOWN: a number that looks like money but was never
measured is the thing the TypeScript ledger already refuses to print.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Row:
    actor: str
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    priced: bool = True


# Model -> (input $ / 1M tokens, output $ / 1M tokens).
#
# Empty at stage 0 on purpose. The real table is platform/src/providers/pricing.ts; it is ported
# the moment this stack makes its first live call, and until then every row is honestly unpriced.
PRICES: dict[str, tuple[float, float]] = {}


class Ledger:
    """Per-actor rows, most expensive first — i.e. the ones worth cutting."""

    def __init__(self) -> None:
        self._rows: dict[str, Row] = {}

    def record(self, actor: str, model: str, input_tokens: int, output_tokens: int) -> None:
        row = self._rows.setdefault(actor, Row(actor=actor))
        row.calls += 1
        row.input_tokens += input_tokens
        row.output_tokens += output_tokens
        price = PRICES.get(model)
        if price is None:
            row.priced = False
        else:
            row.cost_usd += input_tokens / 1_000_000 * price[0] + output_tokens / 1_000_000 * price[1]

    def rows(self) -> list[Row]:
        return sorted(self._rows.values(), key=lambda row: row.cost_usd, reverse=True)

    def total(self) -> Row:
        total = Row(actor="TOTAL")
        for row in self._rows.values():
            total.calls += row.calls
            total.input_tokens += row.input_tokens
            total.output_tokens += row.output_tokens
            total.cost_usd += row.cost_usd
            total.priced = total.priced and row.priced
        return total
