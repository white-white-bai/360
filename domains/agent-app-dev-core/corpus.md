## mcp-definition
source: MCP Specification § Overview — https://modelcontextprotocol.io/specification/2025-06-18
> Model Context Protocol (MCP) is an open protocol that enables seamless integration between LLM applications and external data sources and tools. Whether you’re building an AI-powered IDE, enhancing a chat interface, or creating custom AI workflows, MCP provides a standardized way to connect LLMs with the context they need.

## mcp-lsp-inspiration
source: MCP Specification § Overview — https://modelcontextprotocol.io/specification/2025-06-18
> MCP takes some inspiration from the Language Server Protocol , which standardizes how to add support for programming languages across a whole ecosystem of development tools. In a similar way, MCP standardizes how to integrate additional context and tools into the ecosystem of AI applications.

## mcp-security-intro
source: MCP Specification § Security and Trust & Safety — https://modelcontextprotocol.io/specification/2025-06-18
> The Model Context Protocol enables powerful capabilities through arbitrary data access and code execution paths. With this power comes important security and trust considerations that all implementors must carefully address.

## mcp-user-consent-data
source: MCP Specification § Security and Trust & Safety > Key Principles > User Consent and Control — https://modelcontextprotocol.io/specification/2025-06-18
> Users must explicitly consent to and understand all data access and operations

## mcp-tool-safety-caution
source: MCP Specification § Security and Trust & Safety > Key Principles > Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> Tools represent arbitrary code execution and must be treated with appropriate caution.

## mcp-tool-descriptions-untrusted
source: MCP Specification § Security and Trust & Safety > Key Principles > Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> In particular, descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server.

## mcp-tool-invocation-consent
source: MCP Specification § Security and Trust & Safety > Key Principles > Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> Hosts must obtain explicit user consent before invoking any tool

## react-separate-topics
source: arXiv:2210.03629 Abstract — https://arxiv.org/abs/2210.03629
> While large language models (LLMs) have demonstrated impressive capabilities across tasks in language understanding and interactive decision making, their abilities for reasoning (e.g. chain-of-thought prompting) and acting (e.g. action plan generation) have primarily been studied as separate topics.

## react-interleaved-synergy
source: arXiv:2210.03629 Abstract — https://arxiv.org/abs/2210.03629
> In this paper, we explore the use of LLMs to generate both reasoning traces and task-specific actions in an interleaved manner, allowing for greater synergy between the two: reasoning traces help the model induce, track, and update action plans as well as handle exceptions, while actions allow it to interface with external sources, such as knowledge bases or environments, to gather additional information.

## react-effectiveness-baselines
source: arXiv:2210.03629 Abstract — https://arxiv.org/abs/2210.03629
> We apply our approach, named ReAct, to a diverse set of language and decision making tasks and demonstrate its effectiveness over state-of-the-art baselines, as well as improved human interpretability and trustworthiness over methods without reasoning or acting components.

## react-hallucination-mitigation
source: arXiv:2210.03629 Abstract — https://arxiv.org/abs/2210.03629
> Concretely, on question answering (HotpotQA) and fact verification (Fever), ReAct overcomes issues of hallucination and error propagation prevalent in chain-of-thought reasoning by interacting with a simple Wikipedia API, and generates human-like task-solving trajectories that are more interpretable than baselines without reasoning traces.

## react-interactive-benchmarks
source: arXiv:2210.03629 Abstract — https://arxiv.org/abs/2210.03629
> On two interactive decision making benchmarks (ALFWorld and WebShop), ReAct outperforms imitation and reinforcement learning methods by an absolute success rate of 34% and 10% respectively, while being prompted with only one or two in-context examples.
