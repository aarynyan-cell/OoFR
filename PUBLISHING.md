# OoFR 法语磁带发布说明

## GitHub 发布前

- 公开仓库会公开源代码、图标、词库和静态资源；不要提交个人导出的学习数据、私钥、证书或未授权素材。
- 当前项目没有后端密钥，也没有账号系统；个人学习数据只在用户自己的浏览器或插件本地保存。
- 如果只想让别人用网页/PWA，发布到 GitHub Pages 即可。
- 如果要上架浏览器插件商店，需要生成插件 zip 包并提交审核。

## 源码可见性

OoFR 法语磁带是纯前端应用。只要用户能在网页或插件里运行它，就能在一定程度上查看 HTML、CSS、JavaScript 和词库文件。GitHub 发布清理能避免泄漏个人数据、密钥、证书、构建产物和开发临时文件，但不能把前端源码真正隐藏起来。

如果希望“能用但尽量不公开开发仓库”，可以选择：

- 用私有仓库存放开发历史，只把发布需要的静态文件或插件 zip 发到公开位置。
- 插件上架时只提交 `release/oofr-french-tape-extension.zip`，不要把开发仓库地址写成必须公开的项目主页。
- 不在前端代码里放任何密钥、付费接口 token、私人数据或未授权资源。

## GitHub Pages

GitHub Pages 可以直接托管这个静态项目。推荐用 `main` 分支的 `/root` 作为发布源。应用使用相对路径，因此可以部署在仓库子路径。

注意：即使 Pages 站点来自私有仓库，发布后的网页本身仍可能被公开访问。不要把个人备份 JSON、私钥或未授权素材放进仓库。

## 插件商店

当前 Edge 和 Chrome 都作为正式支持的插件目标。Edge 默认使用 `Microsoft Henri Online (Natural) - French (France)`，Chrome 默认使用 `Google français`。

开发者模式只适合自己测试“已解压扩展”。普通用户从 Chrome Web Store 或 Microsoft Edge Add-ons 安装时，不需要打开开发者模式。

Chrome Web Store 和 Microsoft Edge Add-ons 都要求上传插件 zip 包，不是直接上传整个 GitHub 仓库。生成审核包：

```sh
./scripts/package_extension.sh
```

生成文件：

```text
release/oofr-french-tape-extension.zip
```

zip 包只包含运行插件需要的文件：`manifest.json`、HTML/CSS/JS、词库、service worker、PWA manifest 和图标。不会包含 `.git`、README、发布说明、脚本或本地导出数据。

## 上架材料

提交插件商店前通常需要准备：

- 插件名称：`OoFR 法语磁带`
- 简短描述和详细描述。
- 图标、宣传截图或截图。
- 隐私政策页面，可以使用 GitHub Pages 发布 `PRIVACY.md` 对应页面，或在仓库中公开该文件链接。
- 支持/反馈邮箱：`aaaaaaryn@outlook.com`
- 权限说明：当前插件只申请 `storage`，用于保存用户自己的学习数据和播放设置。

## 发布前检查

```sh
node --check app.js
node --check lexicon.js
node --check extension-service-worker.js
node --check sw.js
python3 -m json.tool manifest.json >/dev/null
python3 -m json.tool manifest.webmanifest >/dev/null
bash -n scripts/package_extension.sh
./scripts/package_extension.sh
git status --short
```

## 官方文档

- GitHub Pages: `https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages`
- Chrome Web Store 发布：`https://developer.chrome.com/docs/webstore/publish`
- Microsoft Edge Add-ons 发布：`https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension`
