# OoFR 2.0（开发中）

把法语文本变成可朗读、可跟读、可复习的磁带课程。2.0 按设计稿重做界面和代码结构：
手机优先的 PWA（iPhone / 安卓 / 电脑浏览器都能装到主屏幕、离线使用），之后再打包 Mac 版。
只用免费方式：系统自带朗读声音、本机 AI，不用云端 API Key，不收费。

## 运行

需要 Node 22 以上。

```sh
cd v2
npm ci
npm run dev          # 本机打开 http://localhost:5173
npm run dev:phone    # 同一 Wi-Fi 下用手机打开终端里显示的 Network 地址
npm test             # 单元测试
npm run build        # 类型检查 + 生成 dist/（含离线 service worker）
npm run preview      # 用生成的 dist/ 试离线和更新提示
```

## 结构

| 目录 | 内容 |
|---|---|
| `src/pages/` | 今日、磁带、课程听读、新建素材、词句本、我的 |
| `src/ui/` | 底部导航、磁带封面/转盘等磁带元素、弹层、图标 |
| `src/app/` | 路由（`#/lesson/…`）、主题（夜读/日间/跟随系统）、播放衔接、迁移入口、更新提示 |
| `src/db/` | 数据表（Dexie / IndexedDB，库名 `oofr2`）、读写操作、首次示例内容 |
| `src/migrate/` | 从 1.0 搬数据：读取（只读）、转换、导入 |
| `src/speech/` | 系统朗读：逐句播放引擎、自动挑选最好的法语声音 |
| `src/text/` | 分句、对话识别（规则和 1.0 一致） |
| `src/styles/` | 设计规范里的颜色和字号（`tokens.css`）与组件样式 |
| `plugins/` | 生成 `dist/sw.js` 的构建插件和模板 |
| `tests/` | Vitest 测试；`tests/fixtures/v1-state.json` 由真实 1.0 代码生成（`node scripts/make-v1-fixture.cjs`） |

## 数据安全

- 2.0 的数据只存在自己的 IndexedDB 库 `oofr2` 里。
- 1.0 的数据（localStorage `oofr.app.v1`、IndexedDB `oofr-state` 和 `oofr-audio`）只读不写：搬运是复制，1.0 随时还能照常使用。
- 读取 1.0 数据库前先确认它存在，不会意外建出空库影响 1.0。
- 重复搬运只补新内容，不会覆盖 2.0 里改过的东西。
- Service worker 只缓存程序文件（缓存名以 `oofr2-shell-` 开头，和 1.0 的 `oofr-` 缓存互不清理），更新时不碰学习数据。
- 启动时请求持久存储，减少手机空间紧张时被系统清理的可能。
