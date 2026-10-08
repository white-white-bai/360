from agent import telemetry


def test_nothing_is_exported_until_an_endpoint_says_where() -> None:
    assert telemetry.configure() is None, "no endpoint means no exporter, not a broken one"


def test_a_span_without_a_configured_provider_is_a_no_op() -> None:
    # The API's default tracer records nothing; the only requirement here is that wrapping a hot
    # path costs nothing and raises nothing on a machine that never asked for traces.
    with telemetry.span("model.call", actor="lead-explainer", tokens=12, ok=True):
        pass
