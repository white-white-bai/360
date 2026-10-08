import sys

from agent.console import utf8_console


def test_console_survives_a_stream_that_cannot_reconfigure(monkeypatch) -> None:
    """The guard IS the function: under pytest, under a pipe, or under any object that is not a
    TextIOWrapper, reconfigure may simply not exist — and output must not be what fails a run."""

    class Bare:
        def write(self, text: str) -> None: ...

    monkeypatch.setattr(sys, "stdout", Bare())
    monkeypatch.setattr(sys, "stderr", Bare())
    utf8_console()  # must not raise
