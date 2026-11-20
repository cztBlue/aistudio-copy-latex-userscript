# AI Studio 复制 LaTeX

在 Google AI Studio 里选中带公式的回复，按 `Ctrl+C` 或 `⌘C`，即可把正文和公式一起复制为纯文本。脚本从网页的 KaTeX 标记中读取原始 LaTeX，保留下标、上标和分式命令，方便整理笔记。

例如，选中包含行内公式的一整句，可以得到下面的文本。

```text
函数值基函数（对应 f(x_k) ）
```

单独显示的公式会另起一行。只选中普通文字时，浏览器照常复制。

## 安装

1. 在浏览器中安装 [Tampermonkey（篡改猴）](https://www.tampermonkey.net/)。
2. 打开 [aistudio-copy-latex.user.js](./aistudio-copy-latex.user.js)，点 GitHub 文件页的 **Raw**，复制完整脚本。
3. 点击篡改猴图标，选择**添加新脚本**。用复制的代码替换默认内容并保存。
4. 刷新 [Google AI Studio](https://aistudio.google.com/)。

如果脚本没有运行，在 Chrome 中打开篡改猴的扩展详情，确认已开启 **允许用户脚本**，然后刷新网页。 [篡改猴官方说明](https://www.tampermonkey.net/faq.php?q=Q209)

## 使用

- **复制公式或段落**。选中公式或包含公式的正文，按 `Ctrl+C` 或 `⌘C`。
- **通过篡改猴菜单复制**。先选中文本，再点击 **复制选区中的 LaTeX**。

## 适用范围

脚本只在 `aistudio.google.com` 上运行。公式需要在网页中保留可读取的 LaTeX 源码，图片里的公式无法转换。复制操作在浏览器本地完成。
