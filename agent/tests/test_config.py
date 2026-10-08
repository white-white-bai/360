from agent.config import DEFAULT_BASE_URL, DEFAULT_EMBED_MODEL, config_from_env, load_local_env


def test_a_key_without_a_model_is_not_a_provider() -> None:
    # Both are required, exactly as the terminal instructions have said all along: a key with no
    # model is a machine that does not know what it would run.
    assert config_from_env({"ATP_API_KEY": "k"}) is None
    assert config_from_env({"ATP_MODEL": "m"}) is None
    assert config_from_env({}) is None


def test_the_environment_shapes_the_provider() -> None:
    config = config_from_env(
        {"ATP_API_KEY": "secret-key", "ATP_MODEL": "m-one", "ATP_BASE_URL": "https://example.test/v1/"}
    )
    assert config is not None
    assert config.base_url == "https://example.test/v1", "a trailing slash is not part of an origin"
    assert config.chat_url == "https://example.test/v1/chat/completions"
    assert config.embeddings_url == "https://example.test/v1/embeddings"
    assert config.embed_model == DEFAULT_EMBED_MODEL


def test_the_description_never_carries_the_key() -> None:
    config = config_from_env({"ATP_API_KEY": "super-secret", "ATP_MODEL": "m"})
    assert config is not None
    described = config.describe()
    assert "super-secret" not in described
    assert "12 chars" in described
    assert config.base_url == DEFAULT_BASE_URL


def test_the_openai_alias_is_accepted_like_the_platform_does() -> None:
    config = config_from_env({"OPENAI_API_KEY": "k", "ATP_MODEL": "m"})
    assert config is not None
    assert config.api_key == "k"


def test_zdr_is_a_switch_that_does_not_ride_on_typos() -> None:
    on = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m", "ATP_ZDR": "1"})
    assert on is not None and on.zdr is True
    typed = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m", "ATP_ZDR": "please"})
    assert typed is not None and typed.zdr is False, "a flag has a meaningful default; a typo is off"
    default = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m"})
    assert default is not None and default.zdr is False


def test_the_zdr_header_rides_with_auth_when_on() -> None:
    config = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m", "ATP_ZDR": "true"})
    assert config is not None
    headers = config.auth_headers()
    assert headers["authorization"] == "Bearer k"
    assert headers["x-cmd-zdr"] == "1"

    plain = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m"})
    assert plain is not None
    assert "x-cmd-zdr" not in plain.auth_headers()


def test_the_repo_env_file_is_read_and_the_process_wins(tmp_path) -> None:
    file = tmp_path / ".env"
    file.write_text('# comment\nATP_API_KEY="from-file"\nATP_MODEL=from-file\n', encoding="utf-8")
    target = {"ATP_MODEL": "from-process"}
    load_local_env(file, target)
    assert target["ATP_MODEL"] == "from-process", "a variable the process has is not overwritten"
    assert target["ATP_API_KEY"] == "from-file", "a variable it lacks is filled in"


def test_a_missing_env_file_is_not_an_error(tmp_path) -> None:
    target: dict[str, str] = {}
    load_local_env(tmp_path / "nope" / ".env", target)
    assert target == {}


def test_prices_are_optional_and_unreadable_ones_are_none() -> None:
    priced = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m", "ATP_PRICE_IN": "0.28", "ATP_PRICE_OUT": "0.42"})
    assert priced is not None and priced.price_in == 0.28 and priced.price_out == 0.42

    typo = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m", "ATP_PRICE_IN": "cheap"})
    assert typo is not None and typo.price_in is None, "a typo is not a price"

    bare = config_from_env({"ATP_API_KEY": "k", "ATP_MODEL": "m"})
    assert bare is not None and bare.price_out is None


def test_the_ledger_prices_a_model_the_operator_priced() -> None:
    from agent.ledger import PRICES
    from agent.model import ProviderModel

    config = config_from_env(
        {"ATP_API_KEY": "k", "ATP_MODEL": "m-priced", "ATP_PRICE_IN": "1", "ATP_PRICE_OUT": "2"}
    )
    assert config is not None
    model = ProviderModel(config)
    try:
        model.ledger.record("lead-explainer", "m-priced", 500_000, 250_000)
        row = model.ledger.rows()[0]
        assert row.priced is True
        assert row.cost_usd == 1.0
    finally:
        PRICES.pop("m-priced", None)
