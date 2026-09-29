---
id: agent-dev-essentials
name: LLM Agent 开发基础：工具调用闭环
owner: baiyang
corpusReviewedBy: baiyang
corpusReviewedOn: 2026-09-29
deliveryLanguage: zh
sources:
  - https://modelcontextprotocol.io/specification/2025-06-18
  - https://arxiv.org/abs/2210.03629
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/
  - https://json-schema.org/draft/2020-12/json-schema-core
---

边界：只教以 LLM 为核心的单体 Agent 最小闭环——工具/函数的声明与结构化调用协议、MCP 式工具接入标准、ReAct 式“推理—行动—观察”循环，以及用语义约定做链路可观测；不教模型训练与微调、多智能体编排框架选型、RAG 向量库调优、生产部署与成本治理。
