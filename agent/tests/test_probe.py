from agent.probe import stale_env_hint


def test_a_stored_value_is_named_by_length_never_by_text() -> None:
    hint = stale_env_hint({"ATP_API_KEY": "sk-secret-value", "ATP_MODEL": "deepseek-chat"}, {})
    assert hint is not None
    assert "ATP_API_KEY (15 chars)" in hint
    assert "ATP_MODEL" in hint
    assert "sk-secret-value" not in hint, "the key itself never leaves the module"


def test_nothing_is_said_when_the_process_already_has_it() -> None:
    assert stale_env_hint({"ATP_API_KEY": "k"}, {"ATP_API_KEY": "k"}) is None
    assert stale_env_hint({}, {}) is None, "an empty registry is not a hint"
    assert stale_env_hint({"ATP_API_KEY": ""}, {}) is None, "an empty stored value is not a value"


def test_the_openai_alias_counts_as_having_a_key() -> None:
    assert stale_env_hint({"ATP_API_KEY": "k"}, {"OPENAI_API_KEY": "k"}) is None
