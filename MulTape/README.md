# MulTape 外语磁带

MulTape 是基于 OoFR 法语磁带重新拆分的新项目。旧版文件不被修改；这个目录里的实现面向 v1.0 的多语言形态。

## 设计边界

- 首页只加载应用外壳，不默认下载词库。
- 用户在“我的”里选择母语和想学的语言。
- 当前主线是中文用户学习多门外语，架构预留任意语言对。
- 学习数据按“学习语言 + 母语”隔离，避免法语、德语、日语等词本混在一起。
- 每种语言都可以单独选择默认系统语音；学习语言用于朗读文本，母语语音为后续双语朗读预留。
- 词库通过 `scripts/build_lexicons.py` 从公开源生成，不手工维护小样例词表。

## 已配置语言

- 中文母语界面：`zh`
- 英文备用界面：`en`
- 学习语言：`fr`、`de`、`sv`、`es`、`it`、`ja`、`ko`

## 词库构建

词库包位于 `lexicons/*.json`，发布前需要生成。默认 manifest 里是 `build-required`，应用会显示“未生成”，不会假装已经有完整词库。

```sh
./scripts/build_lexicons.py --pair all
```

单独构建某一对：

```sh
./scripts/build_lexicons.py --pair fr-zh
```

调试时可以临时限制解析行数，但不能用于正式发布：

```sh
./scripts/build_lexicons.py --pair de-zh --max-entries 20000
```

构建脚本默认不设条目上限。每个包写出：

- `entries`: 词条、展示词、音标、中文释义、词性
- `forms`: 词形到词元的映射
- `sources`: 实际参与构建的来源
- `entries/forms/bytes/builtAt`: 写回 `lexicons/manifest.json`

## 本地运行

```sh
python3 -m http.server 4174
```

然后打开：

```text
http://localhost:4174/MulTape/
```

PWA service worker 只缓存核心文件和词库清单，不预缓存 `lexicons/*.json`。词库只有用户点击下载后才进入本机 IndexedDB。

## 发布形态

- Safari / 手机端：通过 GitHub Pages 作为 PWA 使用，地址为 `https://aarynyan-cell.github.io/OoFR/MulTape/`。
- Chrome / Microsoft Edge：可以直接加载 `MulTape/` 作为 Manifest V3 unpacked extension，也可以运行 `./scripts/package_extension.sh` 打包。
- 更完整的发布步骤见 `PUBLISHING.md`。
