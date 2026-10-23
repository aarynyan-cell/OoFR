# OoFR 应用代码（3.x 在线版）

把法语文本变成可朗读、可跟读、可复习的磁带课程。手机优先的 PWA（iPhone / 安卓 / 电脑浏览器都能装到主屏幕、离线使用），加上 `desktop/` 里的 Mac 应用（Tauri 2）。只用免费方式：AI 用学习者自己的免费密钥，朗读用手机本地语音、系统声音或可选的在线声音。

## 运行

需要 Node 22 以上。

```sh
cd v2
npm ci
npm run dev                # 本机打开 http://localhost:5173
npm run dev:phone          # 同一 Wi-Fi 下用手机打开终端里显示的 Network 地址
npm run dev:phone-https    # 手机录音、语音识别需要 https（自签证书放在 .dev-cert/，不提交）
npm test                   # 单元测试（Vitest）
npm run build              # 类型检查 + 生成 dist/（含离线 service worker）
npm run preview            # 用生成的 dist/ 试离线和更新提示
```

测试密钥：本机测试时可以把密钥写进 `v2/.env.local`（`GROQ_KEY_1=`、`SILICONFLOW_KEY_1=`、`ZHIPU_KEY_1=`、`GEMINI_KEY_1=`），测试版的“我的 → AI 翻译与讲解”里会出现“读取测试密钥（这台电脑）”。这个文件被 `.gitignore` 排除，只有本机回环地址能读取，发布构建里没有这个功能。

Mac 应用：

```sh
cd v2/desktop/src-tauri && cargo test     # Mac 端测试
# 打包：先 npm run build，再用 Tauri CLI（根目录 desktop/ 里装着 @tauri-apps/cli）
cd v2/desktop && ../../desktop/node_modules/.bin/tauri build --target universal-apple-darwin --bundles dmg
```

## 结构

| 目录 | 内容 |
|---|---|
| `src/pages/` | 今日、磁带、课程（听读 / 跟读 / 练习）、新建和编辑素材、词句本、复习、我的 |
| `src/ui/` | 底部导航、磁带元素、弹层、密钥设置（`OnlineKeys.tsx`）、配对二维码、图标 |
| `src/app/` | 路由（`#/lesson/…`）、主题、播放衔接、迁移入口、更新提示、学习记录 |
| `src/ai/` | AI：在线服务商与路由（`online.ts`：Groq → 硅基流动 → 智谱）、状态（`state.ts`）、任务与提示词（`tasks.ts`）、整课排队生成（`enrich.ts`）、配对的电脑（`paired.ts`）、Mac 应用里的本机 Ollama（`backend.ts`） |
| `src/speech/` | 朗读与播放：`player.ts` 逐句播放、`remote.ts` 手机上的声音来源（本地语音 → Gemini → 电脑 → 系统声音）、`piper/` 手机本地语音（worker 里跑 Piper）、`gemini.ts` 在线声音、`track.ts` 后台播放整课音频、跟读录音和语音识别 |
| `src/sync/` | 手机和电脑之间的同步（经配对直连） |
| `src/db/` | 数据表（Dexie / IndexedDB，库名 `oofr3`）、读写操作、首次示例内容、从 2.0 复制数据（`fromV2.ts`） |
| `src/migrate/` | 从 1.0 搬数据：读取（只读）、转换、导入 |
| `src/text/` | 分句和对话识别、可点击的单词、跟读对比、法语标点空格、数字读法 |
| `src/dict/` | 离线词典查词（人工校订层、原形、词形、按上下文区分同形词） |
| `src/review/` | FSRS-5 间隔复习 |
| `src/practice/` | 课程练习题：听音选句、选词填空、连词成句 |
| `src/backup/` | 备份导出导入、学习包、导入前暂存与撤回 |
| `src/styles/` | 颜色和字号（`tokens.css`）与组件样式 |
| `plugins/` | 构建插件：生成 `dist/sw.js`；提供并拷入共用的 `../dictionary/` 和本地语音引擎文件（`voice-engine/`）；测试版的日志和测试密钥 |
| `desktop/` | Mac 应用（Tauri 2，Rust）：系统朗读、配对（WebRTC 直连）、本机 Ollama |
| `tests/` | Vitest 测试 |
| `docs/` | 模型选择记录、已知问题 |

## 数据安全

- 3.x 的数据存在自己的 IndexedDB 库 `oofr3` 里。第一次启动时，如果同一个浏览器里有 2.0 的库 `oofr2`，会只读地复制一份（不复制配对信息），2.0 的库保持原样。
- 1.0 的数据（localStorage `oofr.app.v1`、IndexedDB `oofr-state` 和 `oofr-audio`）只读不写：搬运是复制。
- 在线 AI 的密钥只存在本机（`kv` 里的 `online.keys`），不进备份、不同步、不写进构建；唯一的转交方式是手机通过配对直连从电脑导入。
- Service worker 只缓存程序文件（缓存名以 `oofr3-shell-` 开头，只清理自己的旧版本），更新时不碰学习数据。词典分片缓存 `oofr3-dictionary`、本地语音文件缓存 `oofr3-piper`、读过的句子音频缓存 `oofr2-voices` 都跨版本保留。
- 本地语音的引擎和声音文件（约 100 MB）不在离线壳里预下载，只有点了“下载”的人才会下载。
- 启动时请求持久存储，减少手机空间紧张时被系统清理的可能。
- 导入备份或学习包只添加或补全，不删除；导入前自动暂存，可在“我的”里一键撤回。
- 词典分块按需下载，地址带词典版本号，离线时用缓存。
