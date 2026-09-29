## C-two-clients-one-toolset
prompt: 一家公司同时维护一个 AI 驱动的 IDE 和一个内部聊天客户端，两边都要接同一批内部工具。工程师原计划为每个客户端各写一套对接代码，并为每个工具单独约定调用格式。若改用 MCP，这个方案会变成什么样？
expected: 不必逐客户端、逐工具自定义：MCP 是开放协议，提供把 LLM 与它们所需上下文连接起来的标准化方式；它借鉴 Language Server Protocol 对编程语言支持的做法，标准化把额外上下文与工具集成进 AI 应用生态。
grounding:
  - P-mcp-open-protocol
  - P-mcp-connect-llms-with-context
  - P-mcp-language-server-protocol
  - P-mcp-standardizes-context-and-tools
diagnoses:
  - MCP 是一种模型或训练方法，模型本身就带工具能力 => M-mcp-is-a-model
  - 接工具必须逐客户端定制，MCP 只是某家厂商的私有封装 => M-mcp-vendor-private

## C-annotation-autorun
prompt: 某服务器在工具清单里写了一条注解：“该工具只读取公开数据，不会修改任何文件。”宿主想据此让模型在无人值守的情况下直接调用它。可以吗？
expected: 不可以。注解这类工具行为描述应被视为不可信，除非来自可信服务器；工具代表任意代码执行，必须谨慎对待；宿主必须在调用任何工具前获得用户的显式同意。
grounding:
  - P-mcp-untrusted-annotations
  - P-mcp-tool-safety
  - P-mcp-consent-before-tool
diagnoses:
  - 注解说这工具安全，所以可以自动放行 => M-annotations-trusted

## C-sampling-and-tool-consent
prompt: 某个服务器端应用想在后台自行发起 LLM 采样请求，同时调用一个工具，理由是“用户已经把会话交给它了”。按规范，用户在这两件事上分别扮演什么角色？
expected: 两件事都必须由用户显式批准：宿主必须在调用任何工具前获得用户的显式同意，任何 LLM 采样请求也必须得到用户的显式批准。
grounding:
  - P-mcp-consent-before-tool
  - P-mcp-sampling-approval
diagnoses:
  - 工具调用和采样是模型或服务器的内部行为，用户无需介入 => M-no-consent-needed

## C-schema-scope
prompt: 有人为工具参数写 schema 时说：JSON Schema 只能声明字段和类型，没法表达“怎样从 JSON 文档中取信息、怎样与之交互”。这个说法成立吗？
expected: 不成立。JSON Schema 既断言 JSON 文档必须是什么样，也说明从中提取信息的方式以及与之交互的方式；它本身是一种基于 JSON 的格式，媒体类型是 application/schema+json。
grounding:
  - P-json-schema-asserts
  - P-json-schema-media-type
diagnoses:
  - JSON Schema 只能描述结构，提取和交互是别的东西的事 => M-schema-only-structure

## C-core-vocabulary
prompt: 一个团队做了个精简 JSON Schema 校验器，决定不实现核心词汇表，理由是“词汇表都是可选插件，方言可以随便组合”。这个决定错在哪里？
expected: 错在核心词汇表是任何实现都必须支持的，且不能被禁用；而方言是一组词汇表，它们各自的必需支持在元模式中标识，并非随意组合。
grounding:
  - P-json-schema-core-vocabulary
  - P-json-schema-vocabularies
diagnoses:
  - 词汇表可以自由取舍，核心词汇表也能不实现或关掉 => M-vocabularies-optional

## C-uppercase-keywords
prompt: 某实现的说明文档里用全小写写着：“实现 must 在调用工具前询问用户。”有同事据此认为这条与规范里大写的 MUST 具有同等效力。按规范应当怎么理解？
expected: 只有以全大写形式出现的那些关键字，才按 BCP 14（RFC2119、RFC8174）解释；全小写的写法不自动获得这种解释。
grounding:
  - P-mcp-bcp14-keywords
diagnoses:
  - 小写的 must／should 与大写关键字效力相同 => M-keyword-case

## C-internal-still-needs-trust
prompt: 一个团队说：“我们的服务器全是自研的，只连内部系统，所以不必再操心安全与信任问题。”这个判断能成立吗？
expected: 不能成立。MCP 通过任意数据访问和代码执行路径提供强大能力，随之而来的安全与信任考量是所有实现者都必须认真处理的；工具代表任意代码执行，必须谨慎对待。
grounding:
  - P-mcp-power-and-trust
  - P-mcp-tool-safety
diagnoses:
  - 自研服务器、只连内部系统，就不涉及安全与信任 => M-internal-means-safe
