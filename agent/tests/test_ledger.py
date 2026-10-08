from agent.ledger import PRICES, Ledger


def test_rows_are_kept_per_actor() -> None:
    ledger = Ledger()
    ledger.record("lead-explainer", "m", 100, 20)
    ledger.record("lead-explainer", "m", 50, 10)
    ledger.record("verifier", "m", 10, 5)

    rows = {row.actor: row for row in ledger.rows()}
    assert rows["lead-explainer"].calls == 2
    assert rows["lead-explainer"].input_tokens == 150
    assert rows["verifier"].calls == 1

    total = ledger.total()
    assert total.calls == 3
    assert total.input_tokens == 160
    assert total.output_tokens == 35


def test_an_unpriced_model_is_never_reported_as_money() -> None:
    ledger = Ledger()
    ledger.record("lead-explainer", "no-such-model", 1_000_000, 1_000_000)
    row = ledger.rows()[0]
    assert row.cost_usd == 0.0
    assert row.priced is False, "a number that looks like money but was never measured is the bug"
    assert ledger.total().priced is False


def test_a_priced_model_adds_up() -> None:
    PRICES["test-model"] = (1.0, 2.0)
    try:
        ledger = Ledger()
        ledger.record("lead-explainer", "test-model", 500_000, 250_000)
        row = ledger.rows()[0]
        assert row.priced is True
        assert row.cost_usd == 1.0
        assert ledger.total().priced is True
    finally:
        del PRICES["test-model"]
