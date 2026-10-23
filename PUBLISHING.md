# 发布

## 网页 / 手机版

推送到 `main` 后，GitHub Actions（`.github/workflows/pages.yml`）自动安装依赖、跑测试、构建 `v2/`，发布到 <https://aarynyan-cell.github.io/OoFR/>。

- 发版前改版本号：`v2/package.json`、`v2/package-lock.json`（`cd v2 && npm version X.Y.Z --no-git-tag-version`）；Mac 应用一起发时再改 `v2/desktop/src-tauri/tauri.conf.json`、`Cargo.toml`、`Cargo.lock`。
- 离线壳的缓存名由构建出的文件内容决定，内容一变用户就会收到“刷新”提示。
- 同一个网站（`aarynyan-cell.github.io`）下的旧地址：`/OoFR-online/` 只做跳转，不要再往那里发布应用，否则两个地址的离线缓存会互相清理。

## Mac 应用

```sh
cd v2 && npm run build
cd desktop && ../../desktop/node_modules/.bin/tauri build --target universal-apple-darwin --bundles dmg
```

- 不要设置 `VITE_PHONE_URL`：发布版的二维码指向 <https://aarynyan-cell.github.io/OoFR/>（测试版才设成本机测试地址）。
- 安装包在 `v2/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/`，用 `gh release create vX.Y.Z --target main` 发布并上传。
- 应用是 ad-hoc 签名，没有 Apple 开发者签名和公证，用户第一次打开需要在“隐私与安全性”里点“仍要打开”。

## 发布前检查

- `cd v2 && npm test`、`npx tsc --noEmit -p tsconfig.json`、`npm run build`；`cd v2/desktop/src-tauri && cargo test`。
- 涉及播放、配对或手机界面的改动，先在真手机上测（`npm run dev:phone-https`，手机上的事件写到 `v2/devlog.log`）。
- 检查 `dist/` 里没有：任何真实密钥、本机局域网地址、`__oofr_dev_keys`、`__oofr_log`、“测试版”标记。
- 不要提交 `v2/.env.local`、个人备份、学习包、证书或私钥。

## 旧版本

1.0（含浏览器插件打包）和 2.0 的发布说明在存档仓库 [OoFR-archive](https://github.com/aarynyan-cell/OoFR-archive) 的 `PUBLISHING.md`。
