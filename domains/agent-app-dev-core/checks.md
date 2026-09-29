## C-1
prompt: 同事说：『MCP 是一种把公司数据库微调进模型的新训练方法。』你查 MCP 规范概述，发现 MCP 实际被定义为什么？
expected: MCP 是开放协议，用于在 LLM 应用与外部数据源和工具之间实现无缝集成；它不是训练或微调方法。
grounding:
  - mcp-definition
diagnoses:
  - 把 MCP 当成训练或微调方法 => M-3

## C-2
prompt: 某 Agent 安装时让用户勾选一次『允许访问所有数据』，之后运行中每次调用工具都不再询问。按 MCP 工具安全原则，这个流程缺了什么？
expected: 宿主必须在调用任何工具前获得显式用户同意；首次一次性总同意不能替代逐次调用前的显式同意。
grounding:
  - mcp-tool-invocation-consent
  - mcp-user-consent-data
diagnoses:
  - 一次同意覆盖后续所有工具调用 => M-4

## C-3
prompt: 一个第三方工具在描述里写『本工具只读，不会执行危险操作』。开发同学据此直接自动调用。按 MCP 安全原则，这个描述本身应被当作什么？
expected: 工具行为描述和注解应视为不受信任，除非来自受信任服务器；同时工具代表任意代码执行，必须谨慎对待。
grounding:
  - mcp-tool-descriptions-untrusted
  - mcp-tool-safety-caution
diagnoses:
  - 工具描述或注解天然可信 => M-2
  - 工具只是取数据，不是执行代码 => M-5

## C-4
prompt: 有人总结 ReAct：『就是让模型在提示里写出思考过程，也就是思维链提示，不涉及真的调用外部工具。』这个总结漏掉了 ReAct 摘要强调的哪种交错生成？
expected: ReAct 交错生成推理轨迹和任务特定动作，让推理帮助制定、跟踪、更新行动计划并处理异常，让行动与外部来源交互获取信息。
grounding:
  - react-separate-topics
  - react-interleaved-synergy
diagnoses:
  - ReAct 等于思维链提示，不涉及行动 => M-1

## C-5
prompt: 在 HotpotQA 上，一个模型只靠内部思维链作答，中间一步出错后继续错下去。ReAct 论文说它通过与什么交互来缓解这类幻觉和错误传播？
expected: 与简单的 Wikipedia API 交互。
grounding:
  - react-hallucination-mitigation
diagnoses:
  - 幻觉和错误传播只能靠更好模型或训练解决，外部工具交互无关 => M-8

## C-6
prompt: 在 ALFWorld 和 WebShop 上，ReAct 相比模仿学习和强化学习方法分别高出多少绝对成功率？论文说它用了多少上下文示例？
expected: ALFWorld 上高 34%，WebShop 上高 10%；仅用一两个上下文示例进行提示。
grounding:
  - react-interactive-benchmarks
diagnoses:
  - ReAct 需要大量示例或训练数据 => M-9
  - ReAct 在交互式任务上只赢在可解释性，成功率不及训练方法 => M-12

## C-7
prompt: 团队想向新人解释 MCP 与 LSP 的关系。按 MCP 规范概述，LSP 标准化的是哪一类生态支持，MCP 又类比标准化什么？
expected: LSP 标准化如何在整个开发工具生态中添加对编程语言的支持；MCP 类似地标准化如何把额外上下文和工具集成到 AI 应用生态。
grounding:
  - mcp-lsp-inspiration
diagnoses:
  - MCP 标准化模型或编程语言支持 => M-7

## C-8
prompt: 某 Agent 已经在推理轨迹里写了『下一步要查订单状态』，但只输出推理文本、没有触发工具调用，于是卡住。ReAct 摘要说推理轨迹对行动计划具体有哪三类作用？
expected: 帮助模型诱导、跟踪和更新行动计划，并处理异常。
grounding:
  - react-interleaved-synergy
diagnoses:
  - 推理轨迹只是给人看的，不影响下一步行动 => M-6

## C-9
prompt: 有人主张『MCP 只负责把 LLM 接到外部数据和工具，安全信任是应用自己的事，协议本身不讨论。』MCP 概述在 Security and Trust & Safety 开头怎么反驳？
expected: MCP 通过任意数据访问和代码执行路径带来强大能力，随之带来所有实现者必须认真处理的安全与信任考量。
grounding:
  - mcp-security-intro
diagnoses:
  - MCP 只是连接协议，安全与协议无关 => M-10

## C-10
prompt: 用户点了『我同意这个 Agent 使用所有数据』。按 MCP 用户同意与控制原则，除了显式同意，还必须满足什么？
expected: 用户还必须理解所有数据访问和操作。
grounding:
  - mcp-user-consent-data
diagnoses:
  - 只要点了同意，是否理解不重要 => M-11

## C-11
prompt: 一个团队在 ALFWorld 上对比 ReAct 和强化学习，预期 ReAct 只是轨迹更好看、成功率大概持平。根据 ReAct 论文摘要，这个预期错在哪里？
expected: ReAct 在 ALFWorld 上绝对成功率高出 34%，在 WebShop 上高出 10%，并非只赢在可解释性。
grounding:
  - react-interactive-benchmarks
diagnoses:
  - ReAct 只提升可解释性，成功率不及或持平训练方法 => M-12
