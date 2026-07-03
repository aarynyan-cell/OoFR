# OoFR 法语发音练习器

OoFR 是一个纯前端的法语发音练习 PWA，也可以作为 Microsoft Edge / Google Chrome 插件使用。它保留了 v0.0 的输入朗读体验，并新增专辑、磁带、学习段落记录和单词本。

## 当前能力

- 输入法语文本，按全文、句子或单词播放。
- 把练习过的段落保存到专辑下的磁带里。
- 新增、编辑、删除专辑、磁带和段落条目。
- 点击单词加入单词本；生词显示橙色，标为 `got` 后显示绿色。
- 单词本按词条归并：`prend / prends / prennent` 会归到 `prendre`，`jours` 会归到 `jour`。
- 单词本支持法语音标、中文释义、状态编辑、见过的词形记录和搜索。
- 内置法中词库、IPA 数据和法语词形索引会自动填充音标、释义和词条归并，未命中时可手动补充。
- 数据保存在本机浏览器，并支持 JSON 导入/导出。
- 支持 PWA：通过 HTTP/HTTPS 访问时可离线缓存并添加到手机桌面。
- 支持 Chrome / Edge Manifest V3 插件：点击插件图标打开完整 OoFR 页面。

## 本地使用

直接打开：

```text
index.html
```

本地文件方式可以使用主要功能。若要测试 PWA 离线缓存，请在项目目录启动一个本地 HTTP 服务：

```sh
python3 -m http.server 4173
```

然后访问：

```text
http://localhost:4173/
```

## GitHub Pages 发布

1. 在 GitHub 新建一个仓库。
2. 把本项目推送到仓库的 `main` 分支。
3. 打开仓库 `Settings` → `Pages`。
4. `Source` 选择 `Deploy from a branch`。
5. `Branch` 选择 `main` 和 `/root`。
6. 保存后等待 Pages 生成网址。

应用使用相对路径，可以部署在 GitHub Pages 的仓库子路径下。

## Chrome / Edge 插件使用

本项目根目录已经包含 Manifest V3 插件配置。开发阶段可以用“加载已解压的扩展程序”的方式安装：

### Chrome

1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目文件夹。
5. 点击 OoFR 插件图标，打开完整练习页面。

### Microsoft Edge

1. 打开 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目文件夹。
5. 点击 OoFR 插件图标，打开完整练习页面。

插件版使用 `chrome.storage.local` 保存完整个人数据，并用 `chrome.storage.sync` 同步少量播放设置。完整专辑、磁带、朗读记录和单词本建议用“导出 / 导入”迁移。

## 版本

- `v0.0` 已用 git tag 保留为原始版本。
- `v0.1` 已用 git tag 保留为第一版专辑/磁带/单词本。
- `v0.2` 已用 git tag 保留为第一版插件和扩充词库。
- 当前实现为 `v0.3`。

## 数据

网页/PWA 版数据默认保存在浏览器 `localStorage` 中。插件版完整数据保存在 `chrome.storage.local` 中。

换设备、换浏览器或从 PWA 迁移到插件时，在旧设备点击“导出”，在新设备打开 OoFR 后点击“导入”即可恢复。浏览器同步只用于小设置，不作为完整学习数据备份。

## 词库来源

`lexicon.js` 由 `scripts/build_lexicon.py` 生成，主要来源为 FreeDict `French - Chinese`、open-dict-data `ipa-dict` 和 LEFFF。详见 `THIRD_PARTY_NOTICES.md`。
