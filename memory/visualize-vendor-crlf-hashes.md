---
name: visualize-vendor-crlf-hashes
description: Windows autocrlf 把 visualize 插件 vendor 资源换成 CRLF，导致 vendor.py 的 sha256 校验失败；已在 .gitattributes 强制 LF
metadata:
  type: project
---

`apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/vendor/` 下 4 个 `.js`（d3 / floating-ui core / floating-ui dom / lucide）与 4 个 `.js.LICENSE` 的哈希由同目录 `manifest.json` 记录（`sha256` / `licenseSha256`），基准是 LF 字节。`scripts/vendor.py` 的 `embed_vendor_scripts` 对 `.js` 逐字节校验，失配抛 `bundled resource hash mismatch: <file>`，独立 HTML 导出失败。宿主内联渲染不校验哈希（`packages/desktop/src/main/pluginSandbox/genUiVendor.ts` 的 schema 只读 url/file），所以这个故障只影响独立导出。

2026-10-11 现场：本机 `core.autocrlf=true`，`.gitattributes` 未给该目录声明 eol，检出时 LF→CRLF。判定方法——`git show HEAD:<file>` 的 blob 哈希与 manifest 四个全部一致，工作树文件 LF 归一化后也全部一致：内容没错，只是换行被换（lucide 一个文件就换了 19522 行）。

修复：`.gitattributes` 加 `apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/vendor/** text eol=lf`，然后 `rm` 掉工作树文件再 `git checkout -- <dir>` 强制按新属性重检出（只跑 `git checkout` 可能因 stat cache 判定「未修改」而跳过）。`git add --renormalize` 对 blob 是空操作——索引里本来就是 LF。

**Why:** 「vendored 字节必须原样」的资源只要没有 eol/binary 声明，Windows 上就会被 autocrlf 破坏；而报错文案是 hash mismatch，容易误判成内容错误、去改内容或改 manifest。

**How to apply:** 新增按哈希校验的 vendored 资源时同步在 `.gitattributes` 声明 `text eol=lf`（或 `-text`）；排查 hash mismatch 先用 `git show HEAD:<file>` 对比 blob 哈希与 LF 归一化哈希，先分清「内容错」还是「换行被换」。相关：[[ycode-opensource-audit]]
