"""OpenTelemetry, wired the honest way: configured by the standard environment variable, and a
no-op when it is absent.

No endpoint means no exporter means the spans below cost nothing and go nowhere — which is the
correct behavior for a machine that never asked for traces, and the reason `span()` can wrap hot
paths without a flag check at every call site. Configure once per process; `configured()` is the
cached door the stack uses.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from opentelemetry import trace


def configure() -> str | None:
    """Set the tracer provider from OTEL_EXPORTER_OTLP_ENDPOINT. Returns what it did."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if endpoint == "":
        return None

    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": "atp-agent"}))
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces"))
    )
    trace.set_tracer_provider(provider)
    return f"OTLP → {endpoint}"


@lru_cache(maxsize=1)
def configured() -> str | None:
    return configure()


@contextmanager
def span(name: str, **attributes: object) -> Iterator[None]:
    """A span on the ambient tracer. Before `configure()` this is the API's no-op tracer."""
    with trace.get_tracer("atp-agent").start_as_current_span(name) as current:
        for key, value in attributes.items():
            if isinstance(value, (str, int, float, bool)):
                current.set_attribute(key, value)
        yield
