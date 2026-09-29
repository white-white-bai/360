## M-complexity-first
name: 越复杂越自主越好
wrongModel: 只要用 LLM 做应用，就应该尽早引入 Agent、多 Agent 和复杂编排；最简方案只是能力不足时的临时做法。
refutation: 语料建议先找最简可行方案，只在需要时增加复杂度；并且 agentic 系统常用延迟和成本换更好任务性能，这个权衡需要单独判断。

## M-workflow-is-agent
name: Workflow 与 Agent 不分
wrongModel: Workflow 和 Agent 只是叫法不同；只要系统里有 LLM 和工具，就可以叫 Agent。
refutation: 语料区分二者：workflow 由预定义代码路径编排 LLM 和工具；agent 则由 LLM 动态主导自身流程和工具使用。名称不能混用。

## M-framework-first
name: 框架先行
wrongModel: 实现路由、提示链、评估器-优化器等模式必须先引入编排框架，直接调 LLM API 难以落地。
refutation: 语料建议开发者从直接使用 LLM API 开始；许多模式只需几行代码即可实现。

## M-bare-llm-enough
name: 裸 LLM 就够
wrongModel: 构建 Agent 只需要裸 LLM，检索、工具和记忆是可选的后期优化。
refutation: 语料指出 agentic 系统的基本构建块是经过增强的 LLM，增强包括检索、工具和记忆。

## M-chaining-is-single-call
name: 提示链等于单次调用
wrongModel: Prompt chaining 就是让一个 LLM 一次生成完整的多步结果。
refutation: 语料说 prompt chaining 把任务分解为步骤序列，每一次 LLM 调用处理上一次调用的输出。

## M-routing-is-random
name: 路由等于随机分流
wrongModel: Routing 是把输入随机或并行分发给多个链，不需要先做分类。
refutation: 语料说 routing 先对输入进行分类，再把它导向专用后续任务。

## M-evaluator-single-pass
name: 评估器-优化器只评一次
wrongModel: Evaluator-optimizer 是生成模型自己检查一次，不需要独立评估者或循环。
refutation: 语料说 evaluator-optimizer 中一次 LLM 调用生成响应，另一次提供评估和反馈，并在循环中迭代。

## M-agent-no-cost
name: Agent 没有额外代价
wrongModel: Agentic 系统只会提升任务表现，不会额外增加延迟和成本。
refutation: 语料明确说 agentic 系统常用延迟和成本换取更好的任务表现，需要判断该权衡何时合理。

## M-tool-not-code
name: 工具调用不执行代码
wrongModel: 工具调用只是返回数据，不涉及任意代码执行，所以不必按代码执行来防护。
refutation: 语料说工具代表任意代码执行，必须被相应安全地对待。

## M-trust-annotations
name: 工具注解可信
wrongModel: MCP 工具注解是可信元数据；只要注解声称安全，客户端就可以自动调用。
refutation: 语料说工具行为描述如注解应视为不可信，除非来自受信任服务器；而且宿主调用任何工具前必须获得显式用户同意。

## M-no-consent-tool
name: 一次授权覆盖所有工具
wrongModel: 宿主调用 MCP 工具不需要逐个取得用户同意，接入时一次授权即可。
refutation: 语料说宿主在调用任何工具前必须获得显式用户同意。

## M-data-auto-share
name: 服务器承诺保密即可共享数据
wrongModel: 把用户数据发给 MCP 服务器，只要服务器承诺保密就可以直接发送。
refutation: 语料说宿主在把用户数据暴露给服务器前必须获得显式用户同意。

## M-sampling-auto
name: 采样无需用户批准
wrongModel: MCP 服务器可以自行请求宿主 LLM 做采样，用户批准不是必要条件。
refutation: 语料说用户必须显式批准任何 LLM 采样请求。
