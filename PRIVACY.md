# MulTape 外语磁带隐私说明

最后更新：2026-10-30（1.2）

MulTape 不需要账号。学习数据只保存在你自己的设备上。MulTape 只有一个小小的中转服务（运行在 Cloudflare 上），用来转发 AI 请求、核对 Pro 激活码、匿名计数；它不保存你的句子和学习内容。

## 保存在你设备上的数据

- 磁带、素材、译文和讲解、词句本（单词、句子、语法）、复习进度、学习记录、录音和设置，保存在浏览器本机的 IndexedDB 里。
- 语音包文件、读过的句子音频、词典分片和语法库，保存在本机的缓存里。
- 你填写的在线 AI 密钥只保存在本机，不会上传，也不会进入备份或分享文件。
- MulTape Pro 的激活码、这台设备给 AI 用的随机编号、匿名统计用的随机编号，也只在本机，不进备份或分享文件。

## 会发到网络上的内容

只有在下面这些情况下才会联网。除了 MulTape 提供的 AI 经过 MulTape 的中转以外，都是你的设备直接连对方：

- **MulTape 提供的 AI**：没填自己密钥时，翻译、讲解、查词的相关句子或单词会经 MulTape 的中转（运行在 Cloudflare 上，只转发、不保存内容）发给 Anthropic 的 Claude 处理，按 Anthropic 的隐私政策处理。中转只看到这台设备随机生成的编号，用来公平分配用量。
- **每天的免费 AI 次数**：中转按“这台设备的随机编号（再加密一次）+ 日期 + 请求类型（讲解 / 查词 / 翻译）”数次数，用来给每台设备每天一定的免费次数。这些计数只保留到第二天，之后只留下当天的总数（例如“这天一共讲解了多少次”），不再对应任何设备。
- **匿名使用统计**（可以关）：App 每天最多一次告诉中转“这个 App 今天打开过”，带上：版本号、正在学的语言、界面语言、设备类型（如 iPhone、安卓、Mac）、打开方式（主屏幕 / 浏览器）、有没有 Pro、有没有填自己的密钥，以及统计编号是哪天生成的。用的是一个专门的随机统计编号（不是 AI 用的那个），中转再加密一次才保存，每年自动换一个；记录保存 13 个月。不含名字、邮箱、网络地址、句子或学习内容，只用来知道有多少人在用、用几天，不给任何第三方。在“我的 → 关于 MulTape → 匿名使用统计”关掉后，不再发送，编号也会删掉。
- **MulTape Pro**：购买在 Creem 的付款页面上完成（Creem 是销售方，按它的隐私政策处理你的付款信息和邮箱），MulTape 收不到你的银行卡信息。你在 App 里填激活码时，激活码和这台设备的随机编号经中转发给 Creem 核对，之后每天核对一次；中转本身不保存激活码。
- **精品磁带**：下载一盘磁带时，只向中转要这盘磁带的内容（Pro 磁带带上这台设备的 Pro 凭证）。
- **查词时词典里没有的词**：用 MulTape 提供的 AI 查一个离线词典里没有的词时，这个词本身和它的语言（例如“法语 → 中文：pomme”）会被匿名计数，用来补充大家共用的离线词典。不记录句子、设备编号和网络地址，只有“这个词被查过几次”。
- **你自己的密钥**（可选）：填了自己的密钥时，相关句子或单词直接发给对应的服务商（Groq、硅基流动、智谱）处理，按各服务商的隐私政策处理。
- **跟读识别**：浏览器自己的语音识别不能用时，你这一遍的录音会发给你填了密钥的服务商（Groq 或硅基流动）转成文字。用浏览器自己的识别时，按浏览器厂商的规则处理（Chrome / Edge / Safari 可能把声音发到各自的服务器）。
- **Gemini 在线声音**（可选）：选了 Gemini 的声音时，要朗读的课文句子会发给 Google 生成语音。
- **下载语音包**：从本网站（英语、法语、西语、日语、韩语）或 Hugging Face（中文）下载声音文件，之后朗读完全在设备上进行。
- **应用本身**：网页、词典分片和语法库从 GitHub Pages 下载。

## 从 OoFR 复制数据

“从 OoFR 复制过来”只在你的设备上读取同一网站下 OoFR（现在的备份地址是 `/OoFR-3/`）的本机数据，不联网，也不改动 OoFR 的数据。

## 导入与导出

只有你主动点导入、导出或分享时，应用才会读取或生成文件。完整备份可能包含你的学习文本、词句本和录音；分享文件只含你选的磁带和素材，不含学习进度，录音要你勾选才会带上。

## Cloudflare 和 Anthropic

中转运行在 Cloudflare 上，替 MulTape 处理上面这些数据；AI 请求的句子由 Anthropic（Claude）处理。它们按各自的隐私政策和数据处理条款处理，不用你的数据做别的事。

## 问题反馈与联系

开发者：run

邮箱：`aaaaaaryn@outlook.com`（通过邮件反馈时，邮箱地址和内容由双方的邮件服务商处理）

## English summary

MulTape needs no account; learning data stays on your device. A small relay (on Cloudflare) forwards AI requests to Anthropic (Claude) without keeping sentences, counts each device's daily free AI requests under a hashed random id (kept until the next day, then only daily totals), checks MulTape Pro licence keys with Creem (the seller; it handles payment details and your email under its own privacy policy), and receives an anonymous daily “this app was opened” ping (version, language learnt, interface language, kind of device, whether Pro or own keys are used) under a separate random statistics id that is renewed every year and kept 13 months. The ping can be turned off in Me → About MulTape → Anonymous usage statistics. Nothing is sold or shared with third parties. Contact: `aaaaaaryn@outlook.com`.
