---
name: nsis-makensis-encoding
description: makensis 对无 BOM 脚本按系统 ANSI 代码页解码，UTF-8 中文可能报 Bad text encoding 中止；加 UTF-8 BOM 即解，不是「中文一律失败」
metadata:
  type: reference
---

2026-10-11 实测（makensis 3.0.4.1，electron-builder 缓存里的 `Bin/makensis.exe`）：NSIS 脚本里出现非 ASCII 时，**报不报错取决于具体字节序列**，不是「UTF-8 中文一律失败」。

**根因**：makensis 对**没有 BOM** 的脚本按**系统 ANSI 代码页**解码。UTF-8 中文字节在该代码页里若不构成合法序列，就 `Bad text encoding: <file>:<line>` 并中止创建。换一个字符（字节序列不同）可能就过了；换一台 ANSI 代码页不同的机器，同一个文件的结果也可能翻。

**解**：给脚本加 **UTF-8 BOM**（`EF BB BF`）——makensis 会按 UTF-8 解码，同样的中文完全正常。实测：同一个含中文注释的脚本，无 BOM 报 `Bad text encoding`，加 BOM 编译通过。

**实测矩阵**（`Unicode true`）：

| 脚本内容 | 无 BOM | 有 BOM |
| --- | --- | --- |
| 纯 ASCII | 通过 | 通过 |
| 只有中文注释 | 通过 | 通过 |
| 中文注释 + 中文字符串（某个字节序列） | **Bad text encoding** | 通过 |
| 另一组中文注释 + 中文字符串 | 通过 | 通过 |

**本仓现状**：`packages/desktop/build/installer.nsh` 是 **UTF-8 无 BOM**，含 7 行中文字符串字面量（`Abort` / `MessageBox` / `MUI_HEADER_TEXT` / `NSD_CreateLabel` 的文案，行 117/301/529/534/536/543/550）。当前能编译只是那些字节恰好合法——是**潜在隐患**，未改动（改它会引入与上游的差异）。`packages/desktop/test/fixtures/installer-nsh-smoke.nsi` 已把中文注释换成 ASCII 并在注释里记了真实原因。

**Why:** 遇到 `Bad text encoding` 时容易误判成「NSIS 不支持中文」，进而把文案改成英文——那是治症状，且会让真正的隐患（本仓 `installer.nsh`）继续潜伏。**How to apply:** 新增/修改 `.nsh` / `.nsi` 时优先保持 ASCII；必须写中文就加 UTF-8 BOM。排查时先用上面矩阵二分。相关：[[ycode-wiring-guardrails]]
