# City Film Studio · 城市短片工作室

把你熟悉的一条城市路线拍成可编辑的 Three.js 短片。它从真实建筑轮廓和当地人的记忆出发，把远处能认出的地标、走近才看清的店面，以及连接两者的运镜，做在同一套空间里。

这个工作流来自一支 24.95 秒的纽约上湾雨夜循环短片。纽约的天际线、下船进街的空间连续性，以及配乐尾段接回开头时的取舍，都写进了案例。换一座城时，先从当地人会走的路线开始。[纽约制作复盘](skills/city-film-studio/references/new-york.md)

## 安装

下载发布附件 **city-film-studio.zip**。在本地使用时，将包内的 `city-film-studio` 文件夹整个放入下表目录。`SKILL.md` 应当就在这个文件夹下。Claude 网页版直接上传原 ZIP。[下载技能包](https://github.com/Haao-sys/city-film-studio/releases/latest/download/city-film-studio.zip)

| 平台 | 安装位置 | 在哪里使用 |
|---|---|---|
| Claude Code | 项目内的 `.claude/skills/`，或个人目录 `~/.claude/skills/` | 在项目中输入 `/city-film-studio` 和你的委托 |
| Google Antigravity | 项目内的 `.agents/skills/`，或个人目录 `~/.gemini/config/skills/` | App 和 CLI 支持 `/city-film-studio`。独立 IDE 可在 Customizations 确认技能已加载，再用自然语言描述委托 |
| Claude 网页版 | 在 **Customize → Skills** 上传 ZIP 并启用 | 在新对话里描述城市、街区和想拍的场景。可在网页端准备分镜与工程文件，将工程带到具备图形和编码环境的机器上渲染 |
| Codex | 项目内的 `.agents/skills/` | 在项目中输入 `$city-film-studio` 和你的委托 |

例如，在一个新建的城市项目根目录中，把下载的 ZIP 放到当前目录，按所用客户端执行一条命令即可。Windows、macOS 和 Linux 均可使用 Python 3 的 `zipfile` 模块。系统命令名为 `python3` 时使用该名称。

```sh
# Claude Code
python -m zipfile -e city-film-studio.zip .claude/skills

# Antigravity 或 Codex
python -m zipfile -e city-film-studio.zip .agents/skills
```

也可以从源码直接复制 [技能文件夹](skills/city-film-studio/)。各客户端的发现规则和上传说明见官方文档。[Claude Code](https://code.claude.com/docs/en/skills) · [Claude 网页版](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) · [Google Antigravity](https://antigravity.google/docs/skills)

## 第一条委托

> 帮我拍重庆。我记得雨停后从坡顶望见轻轨，沿台阶走到桥下，街灯还映在湿地上。做一支 20 秒横屏短片。先给我一段原速灰模，以及坡顶、台阶、桥下三个机位。我要看从高处就能认出来的那座桥，走到街面时是不是还在同一个方向。

没有自己的数据时，可以先让助手“使用随包的虚构站前街区，按运行手册导出 4 秒无声预览，并检查相机有没有穿过建筑”。包内已有院落、站前路线和多部件建筑，可以直接练习从体块到成片的流程。[练习数据](skills/city-film-studio/assets/practice/) · [运行手册](skills/city-film-studio/references/run.md)

## 建模与成片

| 想做的事 | 可以从这里开始 |
|---|---|
| 选地标、路线与代表机位，安排每一轮看什么 | [制作工作流](skills/city-film-studio/references/production.md) |
| 对齐天际线和街景，修正穿模、雨水、材质与视角过渡 | [建模与运镜](skills/city-film-studio/references/craft.md) |
| 导入 GeoJSON、布置地标、逐帧渲染静帧和视频 | [Three.js 工程底板](skills/city-film-studio/assets/starter/) · [运行手册](skills/city-film-studio/references/run.md) |
| 剪循环配乐、验片、交付可重新打开的工程 | [渲染、声音与交付](skills/city-film-studio/references/finish.md) |

制作环境使用 Python 3.10+、Node.js 22+、npm、可用 WebGL 2 的 Chromium、FFmpeg 和 ffprobe。导入城市轮廓只需 Python 标准库。正式出片前先渲一个目标画质的短段，检查时间、磁盘和运动；芝加哥样段曾以 3840 × 2160、60 fps、10 位 HEVC 导出 180 帧。

原创工作流、脚本和工程底板采用 MIT 许可证。自行添加的城市数据、模型、贴图与录音依各自授权使用。[MIT License](LICENSE)
