"""Console hygiene for a Windows terminal whose codepage is GBK.

The failure this exists for: a grounded run completes, the provider has been paid, and then
printing the answer dies on one character the codepage cannot encode (U+2212, a minus sign).
Output is the cheapest part of the program and must never be the part that fails.
"""

from __future__ import annotations

import sys


def utf8_console() -> None:
    """UTF-8 out, and `replace` so an unencodable glyph degrades instead of killing a paid run."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
