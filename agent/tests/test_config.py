from agent.config import DEFAULT_BASE_URL, DEFAULT_EMBED_MODEL, config_from_env


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
