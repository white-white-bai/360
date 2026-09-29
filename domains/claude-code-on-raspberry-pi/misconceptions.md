## M-1
name: 只能在 IDE 里用
wrongModel: Claude Code 是编辑器插件，只有在图形界面的 IDE 里才能用，树莓派的终端里根本跑不了。
refutation: 文档说 Claude Code 运行在终端、IDE 扩展、桌面应用和 Web 等多个表面，并且它本身就是可读代码、改文件、跑命令的代理式编码工具。

## M-2
name: 免费 claude.ai 账号也能用
wrongModel: 我有免费的 claude.ai 账号，装完 Claude Code 登录一下就能用。
refutation: Claude Code 需要 Pro、Max、Team、Enterprise 或 Console 账户；免费的 claude.ai 方案不包含 Claude Code 访问权限。

## M-3
name: 装完即用，无需登录
wrongModel: 安装完 Claude Code 就可以直接开始工作，登录只是可选步骤。
refutation: 文档要求在安装后运行 claude 并按浏览器提示完成登录。

## M-4
name: claude doctor 会启动会话
wrongModel: claude doctor 会启动一个会话，在会话里做环境和安装检查。
refutation: claude doctor 打印只读的安装与设置诊断，不启动会话。

## M-5
name: claude doctor 会顺手改配置
wrongModel: claude doctor 会把设置文件里的问题直接修复。
refutation: 诊断是只读的，只报告设置文件校验错误和带建议修复的警告。

## M-6
name: 原生安装要手动更新
wrongModel: 用原生安装方式装的 Claude Code，得自己定期手动更新。
refutation: 原生安装会在后台自动更新，让用户保持最新版本。

## M-7
name: CLAUDE.md 不会被自动读取
wrongModel: CLAUDE.md 只是写给人看的说明，Claude Code 不会自动读，每次都要手动加载。
refutation: CLAUDE.md 是放在项目根目录的 markdown 文件，Claude Code 在每次会话开始时都会读取。

## M-8
name: CLAUDE.md 放哪里都行
wrongModel: CLAUDE.md 放在用户主目录或个人文件夹里就会生效。
refutation: 文档明确说 CLAUDE.md 是加到项目根目录的文件。

## M-9
name: 拼错子命令会照常启动会话
wrongModel: 子命令拼错时 Claude Code 会照常启动会话，然后在会话里报错。
refutation: 拼错子命令时 Claude Code 会提示最接近的匹配，然后退出，不启动会话。

## M-10
name: MCP 是私有协议
wrongModel: MCP 是 Anthropic 自家的私有接口，只有 Claude Code 能用。
refutation: MCP 是连接 AI 工具与外部数据源的开放标准。

## M-11
name: 并行代理要人工合并
wrongModel: 同时跑多个代理就是各干各的，最后得我自己把结果拼起来。
refutation: 一个主导代理负责协调工作、分配子任务并合并结果。

## M-12
name: 只会聊天给建议
wrongModel: Claude Code 就是个聊天式问答助手，只会给建议，不会读代码、改文件或运行命令。
refutation: 它是代理式编码工具，会读取代码库、编辑文件、运行命令，并能跨多个文件和工具工作。

## M-13
name: Windows 没装 Git 就跑不了
wrongModel: 在原生 Windows 上没装 Git for Windows，Claude Code 就完全没法执行 shell 命令，等于不能用。
refutation: 没装 Git for Windows 时它会改用 PowerShell 作为 shell 工具；推荐装 Git for Windows 是为了让它能使用 Bash 工具。

## M-14
name: 没有官方命令行参考
wrongModel: Claude Code 的命令和标志没有完整官方文档，只能靠猜。
refutation: CLI 参考页面完整列出 Claude Code 命令行界面的命令和标志。
