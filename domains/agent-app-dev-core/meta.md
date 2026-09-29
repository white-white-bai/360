---
id: agent-app-dev-core
name: Agent 应用开发核心机制
owner: baiyang
corpusReviewedBy: baiyang
corpusReviewedOn: 2026-09-29
deliveryLanguage: zh
sources:
  - https://claude.com/app-unavailable-in-region
  - https://modelcontextprotocol.io/specification/2025-06-18
  - https://openai.github.io/openai-agents-python/
  - https://langchain-ai.github.io/langgraph/
  - https://arxiv.org/abs/2210.03629
---

边界：只教「用现成 LLM API 搭出一个能调用工具的 Agent 应用」这条最小闭环——工具/函数调用协议、Agent 循环与控制流、上下文与记忆的取舍、以 MCP 接入外部工具、以及一个轻量编排框架的用法；不教模型训练与微调、不教 RAG 检索内部实现、不教多 Agent 群体协作与生产级部署运维。
