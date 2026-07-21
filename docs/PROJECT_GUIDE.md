# virFactory 项目群说明与快速开始指南

> 面向项目使用者和部署人员，不要求阅读或修改源码。
> 更新日期：2026-07-21
> 已验证版本：openVirFactory v0.2.1、EvolutionSandbox v0.5.0、Luanti 5.16.0-dev
>
> 本文件的正式版本维护在 EvolutionSandbox 仓库；其他仓库只链接到这里，避免多份指南不同步。

## 1. 这套项目能做什么

这套项目由三个彼此独立、可以组合使用的 GitHub 仓库构成：

| 组件 | 面向使用者的作用 | 是否可以单独使用 |
| --- | --- | --- |
| [`Evolution-`](https://github.com/GIT-HPW/Evolution-) | 宇宙世界观、章节和剧情原典 | 可以阅读，但不是可执行程序 |
| [`EvolutionSandbox`](https://github.com/GIT-HPW/EvolutionSandbox) | 将世界观转化为浏览器试玩和 Luanti 沙盒玩法 | 可以 |
| [`openVirFactory`](https://github.com/GIT-HPW/openVirFactory) | 用自然语言在 Luanti 世界中创建和控制虚拟工厂 | 可以 |
| [Luanti](https://www.luanti.org/) | 开源 3D 沙盒引擎和多人世界运行底座 | 由两个应用项目调用 |

推荐把整套系统理解为两条应用路径：

```text
Evolution 剧情原典
        ↓ 内容包和确定性规则
EvolutionSandbox ──→ 浏览器即时试玩
        └──────────→ Luanti 完整沙盒世界

用户自然语言
        ↓
openVirFactory Agent
        ↓ 经过认证和校验的结构化命令
同一个 Luanti 世界中的工厂节点与 EvolutionSandbox 节点
```

如果只是想立即体验，先使用浏览器版；如果想体验完整 3D 世界，使用 Luanti；如果想用自然语言创建产线，再启动 openVirFactory。

## 2. 使用前准备

### 2.1 获取项目

只体验一个应用时，单独克隆对应仓库即可。需要组合运行时，建议把三个仓库放在同一个工作目录：

```powershell
mkdir virFactory-workspace
cd .\virFactory-workspace
git clone https://github.com/GIT-HPW/Evolution-.git Evolution
git clone https://github.com/GIT-HPW/EvolutionSandbox.git
git clone https://github.com/GIT-HPW/openVirFactory.git
```

后续命令默认从这个公共工作目录开始。已经使用其他目录布局时，只需调整 `cd` 和共享世界路径。

### 2.2 最低环境

- Windows 10/11 或常见 Linux 发行版；
- Node.js 20 或更高版本；
- npm；
- 运行 3D 世界时需要 Luanti 5.10 或更高版本；
- 推荐在 Luanti 中安装 Mineclonia，游戏 ID 为 `mineclonia`；
- 使用本地 AI 时需要 Ollama 和一个支持工具调用的模型。

检查 Node.js：

```powershell
node --version
npm --version
```

本指南以 Windows PowerShell 为主。Linux 用户可以使用同名 npm 命令，并把 `$env:名称 = "值"` 改为 `名称="值"`。

### 2.3 目录边界

三个项目目录各自拥有独立的 `.git` 和 GitHub 仓库：

- `openVirFactory/`
- `EvolutionSandbox/`
- `Evolution/`

执行 `git pull`、查看版本或发布更新时，必须先进入对应目录。外层仓库和外层 `sync.sh` 不会自动同步这三个仓库的完整源码。

世界存档、玩家数据、令牌、模型和本地运行配置也不属于源码同步范围，应单独备份。

## 3. 最快体验：EvolutionSandbox 浏览器版

### 3.1 直接在线体验

轻量版：<https://git-hpw.github.io/EvolutionSandbox/>

Babylon 动漫化高精度版：<https://git-hpw.github.io/EvolutionSandbox/babylon/>

两个客户端不需要账号、Luanti、模型或 API 密钥，并共用当前站点的 `localStorage` 存档。高精度版适合支持硬件加速的桌面和移动浏览器；轻量版保留为加载更快、兼容性更好的入口。清理站点数据或换浏览器后，不会自动恢复原进度。

### 3.2 在本机浏览器运行

在项目根目录打开 PowerShell：

```powershell
cd .\EvolutionSandbox
npm ci
npm run build:web
python -m http.server 4173 --directory dist/site
```

然后打开：<http://127.0.0.1:4173/>

高精度版地址：<http://127.0.0.1:4173/babylon/>

停止本地网页服务时，在 PowerShell 中按 `Ctrl+C`。

不要直接双击 `dist/site/index.html`；页面使用 ES 模块和内容包请求，需要通过本地 HTTP 服务访问。

### 3.3 基本玩法

- 观察混沌，提高对当前状态的认知；
- 使用撕裂产生碎片并增加熵；
- 使用融合改善局部稳定性；
- 达到阈值后触发大爆炸，进入首个三维领域；
- 创建或加入时间线，体验分支状态。

WebGL 不可用时页面会降级显示静态景观，但规则和操作仍然可用。

## 4. 在 Luanti 中运行 EvolutionSandbox

### 4.1 首次准备

```powershell
cd .\EvolutionSandbox
npm ci
$env:LUANTI_SERVER_BIN = 'C:\Luanti\bin\luanti.exe'
npm run runtime:prepare
npm run dev
```

把示例路径替换为本机实际的 `luanti.exe` 或 `luantiserver.exe`。指定 `luanti.exe` 时，启动脚本会自动使用服务端模式。

### 4.2 连接游戏

打开 Luanti 客户端并连接：

- 地址：`127.0.0.1`
- 端口：`30000`
- 玩家名：任意本地测试名

进入世界后：

- 右键紫色核心：观察混沌；
- 右键红色撕裂场：产生碎片与熵；
- 右键绿色融合场：局部自我更新；
- 右键黄色维度门：条件满足时触发大爆炸；
- 输入 `/evo`：打开可点击操作面板；
- 输入 `/evo identity`：查看本地匿名 actor ID；
- 输入 `/evo timelines`：查看世界时间线。

按 `Ctrl+C` 停止服务端。玩家状态保存在 Luanti 世界中，正常停止后再次启动可以继续。

### 4.3 使用已有世界

操作前先完整备份世界目录，然后在 PowerShell 中设置：

```powershell
cd .\EvolutionSandbox
$env:EVOLUTION_WORLD_DIR = 'D:\LuantiData\worlds\my_world'
$env:LUANTI_SERVER_BIN = 'C:\Luanti\bin\luanti.exe'
npm run runtime:prepare
npm run dev
```

外部世界会使用 `integrated` 模式。脚本只管理本项目的 world mod 和必要配置，不应手工删除世界中的 SQLite、metadata 或 mod storage 文件。

## 5. 使用 openVirFactory 创建虚拟工厂

### 5.1 首次准备

```powershell
cd .\openVirFactory
npm ci
npm run smoke
npm run prepare
```

`npm run smoke` 不需要 Luanti 或 AI 模型，用来确认“命令校验 → 认证队列 → 模拟执行结果”的基础链路可用。

`npm run prepare` 会创建：

- `agent/.env`：本机 AI 和运行配置；
- `runtime/minetest.conf`：Luanti 本地运行配置；
- `runtime/world`：默认测试世界；
- 随机 Bridge Token；
- `factory_ai` 和 `factory_core` world mods。

这些运行数据和密钥不应提交到 Git。

### 5.2 选择 AI

#### 方案 A：Ollama 本地模型

安装并启动 Ollama，然后执行：

```powershell
ollama pull qwen2.5-coder:7b
```

确认 `openVirFactory/agent/.env` 中包含：

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=qwen2.5-coder:7b
```

这种方式不需要云端 API key。

#### 方案 B：在线模型

使用在线 provider 时，在 `agent/.env` 中配置 provider、模型和对应 API key。不要把 `.env`、终端日志或密钥上传到 GitHub。

### 5.3 启动应用

```powershell
cd .\openVirFactory
$env:LUANTI_SERVER_BIN = 'C:\Luanti\bin\luanti.exe'
npm run dev
```

该命令会同时启动 AI Agent 和 Luanti 服务端。再使用 Luanti 客户端连接：

- 地址：`127.0.0.1`
- 端口：`30000`

在 Agent 终端输入自然语言，例如：

```text
从 (0,10,0) 开始沿 +X 建一条产线：物料源、三个传送带、加工机和出料口。
```

当前可用设备包括物料源、传送带、加工机、缓冲区、出料口、路由器和传感器。Agent 只能执行白名单中的结构化操作，不能执行任意 Lua、Shell 或文件命令。

停止运行时，在启动终端按 `Ctrl+C`。

### 5.4 接入已有世界

先完整备份世界，然后编辑 `openVirFactory/agent/.env`：

```dotenv
VIRFACTORY_WORLD_DIR=D:\LuantiData\worlds\my_factory_world
LUANTI_SERVER_BIN=C:\Luanti\bin\luanti.exe
```

`LUANTI_GAME_ID` 通常留空，让脚本读取已有世界的 `gameid`。然后执行：

```powershell
npm run prepare
npm run dev
```

不要把外部世界复制进源码仓库，也不要提交 `map.sqlite`、`players.sqlite`、`auth.sqlite` 或日志。

## 6. 组合运行：EvolutionSandbox + openVirFactory

这个模式让两个项目共享同一个 Luanti 世界。当前稳定用途是：同时使用 EvolutionSandbox 玩法与 openVirFactory 工厂节点，并允许 AI 放置白名单中的 EvolutionSandbox 节点。AI 导演和完整跨平台叙事控制仍属于后续版本范围。

### 6.1 创建共享运行目录

先准备 openVirFactory：

```powershell
cd .\openVirFactory
npm ci
npm run prepare
cd ..
```

再把 EvolutionSandbox 安装到同一个运行目录和世界：

```powershell
cd .\EvolutionSandbox
npm ci
$env:EVOLUTION_RUNTIME_DIR = (Resolve-Path ..\openVirFactory\runtime).Path
$env:EVOLUTION_WORLD_DIR = (Resolve-Path ..\openVirFactory\runtime\world).Path
$env:EVOLUTION_MODE = 'integrated'
npm run runtime:prepare
cd ..
```

### 6.2 扩展 AI 节点白名单

编辑 `openVirFactory/agent/.env`：

```dotenv
VIRFACTORY_ALLOWED_NODE_PREFIXES=factory_core:,evolution_core:
```

然后重新准备并启动：

```powershell
cd .\openVirFactory
$env:LUANTI_SERVER_BIN = 'C:\Luanti\bin\luanti.exe'
npm run prepare
npm run dev
```

`npm run prepare` 会保留共享配置中的 EvolutionSandbox 设置，并重新同步 openVirFactory 自己管理的 mods。

## 7. 日常更新与功能同步

### 7.1 更新前

1. 使用 `Ctrl+C` 正常停止 Agent、sidecar 和 Luanti；
2. 完整备份正在使用的世界目录；
3. 进入准备更新的独立项目目录；
4. 运行 `git status --short`，确认没有未处理的本地改动；
5. 不要使用 `git reset --hard` 清理本地文件。

### 7.2 更新 openVirFactory

```powershell
cd .\openVirFactory
git status --short
git pull --ff-only
npm ci
npm run smoke
npm run prepare
```

高风险或正式部署前可以执行完整验证：

```powershell
npm run verify
```

重新运行 `prepare` 很重要：它负责把更新后的 `factory_ai` 和 `factory_core` 同步到实际 world mods。

### 7.3 更新 EvolutionSandbox

独立运行时：

```powershell
cd .\EvolutionSandbox
git status --short
git pull --ff-only
npm ci
npm run verify
npm run runtime:prepare
```

组合运行时，拉取和验证完成后，需要再次使用第 6.1 节中的三个 `EVOLUTION_*` 环境变量，把更新后的 mods 同步到 `openVirFactory/runtime/world`。

### 7.4 更新 Evolution 剧情原典

```powershell
cd .\Evolution
git status --short
git pull --ff-only
```

剧情仓库更新不会自动改变游戏规则。只有经过内容适配并更新 `EvolutionSandbox/content/chapters/*.json` 后，才会进入浏览器和 Luanti 玩法。

### 7.5 推荐的组合更新顺序

```text
停止服务并备份世界
        ↓
更新 openVirFactory、npm ci、smoke
        ↓
更新 EvolutionSandbox、npm ci、verify
        ↓
openVirFactory npm run prepare
        ↓
EvolutionSandbox 以共享 runtime/world 再执行 runtime:prepare
        ↓
确认 openVirFactory 节点白名单
        ↓
从 openVirFactory 执行 npm run dev
```

## 8. 数据、备份与迁移

### 8.1 必须备份的内容

根据实际使用方式备份：

- Luanti 世界目录；
- `openVirFactory/agent/.env`；
- 自定义但未提交的配置和内容包；
- 需要保留的外部世界备份；
- 浏览器版需要长期保存时，记录所用站点和浏览器配置。

### 8.2 不应提交或公开的内容

- `.env` 和 API key；
- Bridge Token、ESIP Token；
- `map.sqlite`、`players.sqlite`、`auth.sqlite`；
- Luanti 日志、Agent 日志；
- 模型权重；
- 含真实玩家信息的截图或导出文件。

### 8.3 本地一体化工作区和 `sync.sh` 的边界

部分内部一体化工作区还包含 `engine/luanti`、早期原型世界和外层 `sync.sh`。这些内容不属于三个公开应用仓库。外层 `sync.sh` 是用于 U 盘 Git 仓库的 Bash 脚本，只同步外层 Git 仓库已经提交的内容：

- 不会自动更新三个独立子仓库；
- 不会同步被 Git 忽略的世界和密钥；
- Windows PowerShell 不能直接运行该 Bash 脚本；
- 不应把它当作世界存档备份工具。

跨机器使用时，推荐分别同步三个 Git 仓库，并用文件级备份工具单独复制世界目录。

## 9. 常见问题

### 找不到 Luanti 可执行文件

确认路径指向真实存在的 `luanti.exe` 或 `luantiserver.exe`：

```powershell
$env:LUANTI_SERVER_BIN = 'C:\实际路径\Luanti\bin\luanti.exe'
```

### 提示找不到 `mineclonia`

先通过 Luanti 内容页面安装 Mineclonia，并确认世界使用的游戏 ID 是 `mineclonia`。使用已有世界时，通常不要手工设置 `LUANTI_GAME_ID`。

### openVirFactory 显示 Luanti 未连接

1. 确认通过 `npm run dev` 启动，而不是手工使用其他配置启动 Luanti；
2. 重新执行 `npm run prepare`；
3. 检查 `factory_ai` 是否成功加载；
4. 确认 Agent 和 Luanti 使用同一次 prepare 生成的 Bridge Token。

### 浏览器页面空白或内容包加载失败

不要直接双击 HTML。重新执行：

```powershell
cd .\EvolutionSandbox
npm run build:web
python -m http.server 4173 --directory dist/site
```

然后访问 <http://127.0.0.1:4173/>。

### 更新后世界中没有新功能

源码更新后还必须重新执行对应的准备命令：

- openVirFactory：`npm run prepare`
- EvolutionSandbox：`npm run runtime:prepare`
- 组合运行：两个命令都执行，并确保 EvolutionSandbox 指向共享 runtime/world

### 端口冲突

默认端口：

| 服务 | 默认地址或端口 |
| --- | --- |
| Luanti | UDP `30000` |
| openVirFactory Agent Bridge | `127.0.0.1:3000` |
| Evolution ESIP sidecar | 回环地址上的本地端口，按配置确定 |
| 本地浏览器试玩 | `127.0.0.1:4173` |

修改端口时，确保调用方、服务端和本地防火墙配置一致。默认 Bridge 和 sidecar 仅供本机使用，不要直接暴露到公网。

## 10. 深入资料

- `openVirFactory/README.md`：AI 工厂控制层完整说明；
- `EvolutionSandbox/README.md`：浏览器和 Luanti 玩法说明；
- `EvolutionSandbox/docs/architecture.md`：状态权威与平台架构；
- `EvolutionSandbox/docs/interop.md`：ESIP sidecar 操作；
- `EvolutionSandbox/docs/roadmap.md`：后续版本计划；
- `Evolution/README.md`：世界观与创作方式；

正常使用只需要本指南第 3 至第 7 节；需要排错、二次集成或发布时，再阅读各子项目的完整文档。
