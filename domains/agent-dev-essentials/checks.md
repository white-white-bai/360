## C-1
prompt: 某团队接入了一个第三方 MCP 服务器，该服务器在工具描述里写着“本工具只读、无副作用、可放心调用”。工程师认为既然描述是服务器随工具一起发布的元数据，就按它说的省掉调用前的确认环节。这个判断错在哪？
expected: 错在把工具行为的描述（如注解）当成可信声明，除非它来自可信服务器；同时省掉确认也违反了宿主在调用任何工具前必须获得用户显式同意的要求。
grounding:
  - P-mcp-untrusted-annotations
  - P-mcp-tool-consent
diagnoses:
  - 服务器在描述里写了只读无副作用，所以可以放心直接调用 => M-annotation-trusted
  - 用户已经点了这个工具，就不用再单独征求同意了 => M-consent-implicit

## C-2
prompt: 某宿主产品在用户打开会话后就自动执行模型请求的任意工具，产品经理解释说用户启动应用本身就等于同意了所有后续工具调用。请判断该做法是否符合规范。
expected: 不符合。规范要求宿主在调用任何工具之前必须获得用户显式同意，启动或使用应用不构成对具体工具调用的显式同意。
grounding:
  - P-mcp-tool-consent
diagnoses:
  - 启动应用就等于默认同意了所有工具调用 => M-consent-implicit

## C-3
prompt: 团队把“已通过 MCP 接入”写进安全评审结论，认为接入方式标准化之后，工具调用环节的风险就已经被协议消化掉了。依据语料评估该结论。
expected: 结论不成立。MCP 只是让 LLM 应用与外部数据源和工具无缝集成的开放协议；规范同时指出工具代表任意代码执行、必须谨慎对待，安全性并不由接入方式本身背书。
grounding:
  - P-mcp-open-protocol
  - P-mcp-tool-safety
diagnoses:
  - 用了 MCP 接入，工具调用就安全了 => M-mcp-equals-safety
  - 工具只是读数据，不用按高危能力对待 => M-tool-harmless-data

## C-4
prompt: 一位工程师打算这样实现 Agent：先跑一轮思维链，把整条行动计划一次性生成完，然后把计划交给单独的模块逐步执行，执行期间不再回到推理。语料对这种设计有什么意见？
expected: 这与交错进行的做法相悖。语料中的做法是让模型交错生成推理轨迹与任务特定行动：推理轨迹帮助模型归纳、跟踪、更新行动计划并处理异常，行动则去知识库或环境等外部来源收集额外信息，二者互相反哺，而不是一次性规划后与推理脱钩。
grounding:
  - P-react-interleaved
  - P-react-separate-topics
diagnoses:
  - 先把计划一次性想完，再进入单独的执行阶段 => M-react-two-phases

## C-5
prompt: 预算评审时有人提出：要让 Agent 具备推理加行动能力，必须先用模仿学习或强化学习训练模型，或至少准备大规模示例集。语料中哪一项结果直接反驳这一说法？
expected: 在 ALFWorld 与 WebShop 两个交互式决策基准上，用一到两个上下文示例提示的 ReAct 就分别以 34% 和 10% 的绝对成功率超过模仿学习和强化学习方法，说明无需训练即可取得更好效果。
grounding:
  - P-react-alfworld
diagnoses:
  - 必须先做模仿学习或强化学习训练才能用起来 => M-react-needs-training
  - 至少得准备大量示例才行 => M-react-needs-training

## C-6
prompt: 某团队为了压缩日志体积，把链路中的推理轨迹全部丢弃，只保留工具调用与返回结果，理由是推理轨迹对正确性和可排查性都没有贡献。语料如何评价这一取舍？
expected: 该理由不成立。推理轨迹帮助模型归纳、跟踪和更新行动计划并处理异常；在 HotpotQA 与 Fever 上，借助与简单 Wikipedia API 的交互，带推理轨迹产生的任务求解轨迹更可解释，并克服了思维链推理中常见的幻觉与错误传播问题。
grounding:
  - P-react-interleaved
  - P-react-hotpotqa
diagnoses:
  - 推理轨迹只是装饰，去掉照样能解决问题 => M-trace-cosmetic
  - 留不留推理轨迹对排查问题没有区别 => M-trace-cosmetic

## C-7
prompt: 一位工程师说 JSON Schema 只负责判断数据合法与否，自己在做工具入参约定时只打算用它做校验，不打算写任何描述性内容，也不考虑链接跳转和交互行为。语料是否支持这种用法定位？
expected: 不支持这种窄化定位。JSON Schema 是用于定义 JSON 数据结构的 JSON 媒体类型，其意图涵盖校验、文档说明、超链接导航和交互控制；它断言 JSON 文档必须长什么样、如何从中提取信息以及如何与之交互。
grounding:
  - P-jsonschema-purpose
  - P-jsonschema-asserts
diagnoses:
  - JSON Schema 只用来判断数据是否合法 => M-schema-validation-only
  - 描述、链接、交互这些跟 JSON Schema 没关系 => M-schema-validation-only

## C-8
prompt: 为了减小体积、加快冷启动，一个团队在自研 JSON Schema 实现里决定只支持自己用到的那几个关键字，其余核心部分选择不实现。语料允许这样做吗？
expected: 不允许。语料定义了一个核心词汇表，任何实现都必须支持且不能禁用；实现可以在此基础上用关键字对 JSON 实例施加约束或为其标注附加信息，但不能把核心词汇表裁掉。
grounding:
  - P-jsonschema-core-vocabulary
  - P-jsonschema-keywords
diagnoses:
  - 只实现用到的关键字，核心部分可以不实现 => M-core-vocab-optional
  - 为了轻量可以把核心词汇表关掉 => M-core-vocab-optional

## C-9
prompt: 有同事把 OpenTelemetry 仓库中的生成式 AI 语义约定页面作为当前权威来源，准备照抄其中内容来给 Agent 链路定语义约定字段。语料对此有什么提示？
expected: 该页面已经迁移，不再在此仓库维护；照抄它作为当前权威来源并不可靠。
grounding:
  - P-genai-moved-notice
diagnoses:
  - 那个语义约定页面就是现在维护中的权威列表，直接照它抄 => M-semconv-page-current
