---
id: llm-agent-tool-calling
name: Agent 工具调用循环与工具接口
owner: baiyang
corpusReviewedBy: baiyang
corpusReviewedOn: 2026-09-29
deliveryLanguage: zh
sources:
  - https://modelcontextprotocol.io/specification/2025-06-18
  - https://json-schema.org/draft/2020-12/json-schema-core
  - https://openai.github.io/openai-agents-python/
---

边界：只教 LLM Agent 的“工具调用”这一层：工具如何用 JSON Schema 声明、模型如何发起调用、宿主如何执行并回传结果、循环的终止条件，以及 MCP 如何把工具接口标准化；不教模型训练与微调、RAG 检索、提示词工程技巧、多智能体编排框架选型与生产部署运维。
