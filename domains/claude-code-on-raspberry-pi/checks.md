## C-1
prompt: 你在树莓派上把仓库 clone 到某个目录，仓库根目录里有一份 CLAUDE.md。你在这个目录的终端里运行 claude 开一个新会话——这份文件什么时候起作用？
expected: 它在每次会话开始时被 Claude Code 读取，用来设定编码规范、架构决策、首选库和审查清单。
grounding:
  - P-overview-claude-md
diagnoses:
  - CLAUDE.md 只是写给人看的，不会被自动读取，要手动加载 => M-7
  - CLAUDE.md 放在用户主目录里才会生效，放项目根目录没用 => M-8

## C-2
prompt: 你的 claude.ai 账号用的是免费方案。你在树莓派上装好 Claude Code，准备登录开始用。按文档这一步会怎样？
expected: 登录无法让你使用 Claude Code：免费 claude.ai 方案不包含 Claude Code 访问权限，需要 Pro、Max、Team、Enterprise 或 Console 账户。
grounding:
  - P-setup-authenticate-account
diagnoses:
  - 免费 claude.ai 账号登录后就能直接用 Claude Code => M-2

## C-3
prompt: 你在新装好的树莓派上已经把 Claude Code 安装完了，现在想让它进入可用状态。文档说的下一步操作是什么？
expected: 运行 claude 并按浏览器提示完成登录。
grounding:
  - P-setup-login
diagnoses:
  - 装完就已经可用，登录不是必须的步骤 => M-3

## C-4
prompt: 你怀疑树莓派上的安装有问题，于是在终端运行 claude doctor。这个命令会不会打开一个会话来让你排查？
expected: 不会启动会话；它打印只读的安装与设置诊断，包括安装健康状况、设置文件校验错误，以及带建议修复的警告。
grounding:
  - P-setup-doctor
diagnoses:
  - claude doctor 会启动一个会话，在会话里检查环境 => M-4

## C-5
prompt: 你运行 claude doctor 后看到设置文件存在校验错误。这个命令会帮你把设置文件改对吗？
expected: 不会修改设置文件；诊断是只读的，只报告校验错误和带建议修复的警告。
grounding:
  - P-setup-doctor
diagnoses:
  - claude doctor 会直接修改设置文件，把问题修好 => M-5

## C-6
prompt: 你用原生安装方式在树莓派上装了 Claude Code，想知道半年后该怎么让它保持最新版本。
expected: 不需要手动操作：原生安装会在后台自动更新，让你始终处于最新版本。
grounding:
  - P-setup-native-autoupdate
diagnoses:
  - 原生安装需要自己定期手动更新 => M-6

## C-7
prompt: 你在树莓派终端里手滑，把一个 Claude Code 子命令的名字敲错了。接下来会发生什么？
expected: Claude Code 会提示最接近的匹配子命令，然后退出，不会启动会话。
grounding:
  - P-cli-mistyped-subcommand
diagnoses:
  - 它会照常启动会话，然后才在会话里提示错误 => M-9

## C-8
prompt: 朋友说在树莓派上只能在图形界面的编辑器插件里用 Claude Code，纯终端里没戏。按文档这是对的吗？
expected: 不对：Claude Code 运行在终端、IDE 扩展、桌面应用和 Web 等表面，终端本身就是它的运行表面之一。
grounding:
  - P-overview-surfaces
  - P-overview-agentic-tool
diagnoses:
  - Claude Code 只能在 IDE 里用，终端里跑不了 => M-1

## C-9
prompt: 同事想接入一个外部数据源，有人提议用 MCP，并说这是 Anthropic 自家私有的接线方式。按文档 MCP 是什么？
expected: MCP 是连接 AI 工具与外部数据源的开放标准。
grounding:
  - P-overview-mcp
diagnoses:
  - MCP 是 Anthropic 私有的、非开放的协议 => M-10

## C-10
prompt: 你要让多个 Claude Code 代理同时处理同一个任务的不同部分。跑完之后，由谁负责协调、分配子任务并合并结果？
expected: 一个主导代理负责协调工作、分配子任务并合并结果。
grounding:
  - P-overview-parallel-agents
diagnoses:
  - 多个代理各做各的，最后结果要我自己手动合并 => M-11

## C-11
prompt: 你打算让 Claude Code 在一个仓库上修缺陷、加功能。有人提醒你它只是聊天机器人，不会读你的代码也不会动文件。按文档它实际能做什么？
expected: 它是代理式编码工具，会读取代码库、编辑文件、运行命令，并跨多个文件和开发工具工作。
grounding:
  - P-overview-agentic-tool
  - P-overview-ai-coding-assistant
diagnoses:
  - 它只会给建议，不会读代码、改文件或运行命令 => M-12

## C-12
prompt: 在一台原生 Windows 机器上（先不谈树莓派），你没装 Git for Windows，就让 Claude Code 执行一条 shell 命令。它会怎样？
expected: 它会改用 PowerShell 作为 shell 工具；推荐安装 Git for Windows 是为了让它能使用 Bash 工具。
grounding:
  - P-setup-windows-bash-tool
diagnoses:
  - 没装 Git for Windows 就没法执行 shell 命令，Claude Code 等于不能用 => M-13

## C-13
prompt: 你想查 Claude Code 支持哪些命令和标志，问：官方有没有一份完整的命令行参考？
expected: 有：CLI 参考页面完整列出 Claude Code 命令行界面的命令和标志。
grounding:
  - P-cli-reference-scope
diagnoses:
  - Claude Code 没有官方命令行参考，命令和标志只能靠猜 => M-14
