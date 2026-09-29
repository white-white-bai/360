## P-simplest-solution
source: Building effective agents → When (and when not) to use agents — https://www.anthropic.com/engineering/building-effective-agents
> When building applications with LLMs, we recommend finding the simplest solution possible, and only increasing complexity when needed.

## P-workflow-definition
source: Building effective agents → What are agents? — https://www.anthropic.com/engineering/building-effective-agents
> Workflows are systems where LLMs and tools are orchestrated through predefined code paths.

## P-agent-definition
source: Building effective agents → What are agents? — https://www.anthropic.com/engineering/building-effective-agents
> Agents , on the other hand, are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks.

## P-complexity-tradeoff
source: Building effective agents → When (and when not) to use agents — https://www.anthropic.com/engineering/building-effective-agents
> Agentic systems often trade latency and cost for better task performance, and you should consider when this tradeoff makes sense.

## P-use-llm-apis-directly
source: Building effective agents → When and how to use frameworks — https://www.anthropic.com/engineering/building-effective-agents
> We suggest that developers start by using LLM APIs directly: many patterns can be implemented in a few lines of code.

## P-augmented-llm
source: Building effective agents → Building block: The augmented LLM — https://www.anthropic.com/engineering/building-effective-agents
> The basic building block of agentic systems is an LLM enhanced with augmentations such as retrieval, tools, and memory.

## P-prompt-chaining
source: Building effective agents → Workflow: Prompt chaining — https://www.anthropic.com/engineering/building-effective-agents
> Prompt chaining decomposes a task into a sequence of steps, where each LLM call processes the output of the previous one.

## P-routing
source: Building effective agents → Workflow: Routing — https://www.anthropic.com/engineering/building-effective-agents
> Routing classifies an input and directs it to a specialized followup task.

## P-evaluator-optimizer
source: Building effective agents → Workflow: Evaluator-optimizer — https://www.anthropic.com/engineering/building-effective-agents
> In the evaluator-optimizer workflow, one LLM call generates a response while another provides evaluation and feedback in a loop.

## P-tool-safety
source: MCP Specification 2025-06-18 → Security and Trust & Safety → Key Principles → Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> Tools represent arbitrary code execution and must be treated with appropriate caution.

## P-tool-annotations-untrusted
source: MCP Specification 2025-06-18 → Security and Trust & Safety → Key Principles → Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> In particular, descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server.

## P-consent-before-tool-invocation
source: MCP Specification 2025-06-18 → Security and Trust & Safety → Key Principles → Tool Safety — https://modelcontextprotocol.io/specification/2025-06-18
> Hosts must obtain explicit user consent before invoking any tool

## P-user-data-consent
source: MCP Specification 2025-06-18 → Security and Trust & Safety → Key Principles → Data Privacy — https://modelcontextprotocol.io/specification/2025-06-18
> Hosts must obtain explicit user consent before exposing user data to servers

## P-sampling-approval
source: MCP Specification 2025-06-18 → Security and Trust & Safety → Key Principles → LLM Sampling Controls — https://modelcontextprotocol.io/specification/2025-06-18
> Users must explicitly approve any LLM sampling requests
