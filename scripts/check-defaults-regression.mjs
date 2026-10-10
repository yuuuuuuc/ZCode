#!/usr/bin/env node
/**
 * Ycode 默认关闭项的回归检查。
 *
 * 路线是「保留上游代码、只关开关」+ 既有硬删除 fail-closed。
 * 同步上游时可能悄悄改回默认值或漏接策略；这里把不变量固化成断言。
 *
 * 用法：node scripts/check-defaults-regression.mjs
 * 退出码：0 全部通过；1 有断言失败
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  try {
    return readFileSync(join(repoRoot, relativePath), "utf8");
  } catch (error) {
    failures.push(`${relativePath}: 无法读取（${error.code ?? "unknown"}）`);
    return null;
  }
}

function expectContains(relativePath, snippet, reason) {
  const content = read(relativePath);
  if (content === null) return;
  if (!content.includes(snippet)) {
    failures.push(`${relativePath}: 缺少「${snippet}」—— ${reason}`);
  }
}

function expectAbsent(relativePath, snippet, reason) {
  const content = read(relativePath);
  if (content === null) return;
  if (content.includes(snippet)) {
    failures.push(`${relativePath}: 仍包含「${snippet}」—— ${reason}`);
  }
}

// ── 遥测：默认关闭 ──────────────────────────────────────────────────────────

expectContains(
  "packages/shared/src/env.ts",
  "process.env.ZCODE_TELEMETRY_ENABLED",
  "遥测总开关应读运行时环境变量，保持默认关闭、可显式开启",
);
expectAbsent(
  "packages/shared/src/env.ts",
  "export const ZCODE_TELEMETRY_ENABLED: boolean = true;",
  "遥测总开关又被写死为 true",
);

// ── 厂商服务：策略默认值必须逐项断言 ────────────────────────────────────────

const featuresPath = "packages/shared/src/ycode-features.ts";

const YCODE_VENDOR_SERVICE_DEFAULTS = {
  officialAccountLogin: false,
  conversationShare: false,
  feedback: false,
  codingPlanPurchase: false,
  pluginMarketplaceRemoteSource: false,
  selfHostedReleaseUpdates: true,
  vendorCommunityLinks: false,
  officialAccountCredentials: false,
};

function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function readObjectLiteralValues(sourceText, variableName) {
  const sourceFile = ts.createSourceFile(variableName, sourceText, ts.ScriptTarget.Latest, true);
  let literal = null;
  const findLiteral = (node) => {
    if (
      literal === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (initializer !== undefined && ts.isObjectLiteralExpression(initializer)) {
        literal = initializer;
      }
    }
    ts.forEachChild(node, findLiteral);
  };
  findLiteral(sourceFile);
  if (literal === null) return null;
  const values = new Map();
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText(sourceFile);
    const initializer = property.initializer;
    if (initializer.kind === ts.SyntaxKind.TrueKeyword) values.set(key, true);
    else if (initializer.kind === ts.SyntaxKind.FalseKeyword) values.set(key, false);
    else values.set(key, initializer.getText(sourceFile));
  }
  return values;
}

{
  const content = read(featuresPath);
  if (content !== null) {
    const defaults = readObjectLiteralValues(content, "YCODE_VENDOR_SERVICES");
    if (defaults === null) {
      failures.push(
        `${featuresPath}: 找不到 YCODE_VENDOR_SERVICES 对象字面量 —— 策略总表被改写或改名`,
      );
    } else {
      for (const [key, expected] of Object.entries(YCODE_VENDOR_SERVICE_DEFAULTS)) {
        const actual = defaults.get(key);
        if (!defaults.has(key)) {
          failures.push(`${featuresPath}: 缺少策略项 ${key}`);
        } else if (actual !== expected) {
          failures.push(
            `${featuresPath}: ${key} 的默认值是 ${String(actual)}，本分支要求 ${String(expected)}`,
          );
        }
      }
      for (const key of defaults.keys()) {
        if (!Object.hasOwn(YCODE_VENDOR_SERVICE_DEFAULTS, key)) {
          failures.push(
            `${featuresPath}: 新增策略项 ${key} 未登记 —— 请在 check-defaults-regression.mjs 里声明期望默认值`,
          );
        }
      }
    }
  }
}

for (const path of [
  "packages/ui/src/WorkspaceHelpMenuButton.tsx",
  "packages/ui/src/ChatErrorBanner.tsx",
  "packages/ui/src/quickpick/quickPickCommands.ts",
]) {
  expectContains(
    path,
    "YCODE_VENDOR_SERVICES.feedback",
    "反馈入口应受策略门禁，否则默认关闭状态下仍会暴露厂商反馈入口",
  );
}

for (const [path, reason] of [
  ["packages/services/src/credential/credentialService.ts", "Services 侧凭据存储未拦截官方账号派生凭据"],
  [
    "apps/zcode-cli/packages/adapters/src/auth/shared-credentials.ts",
    "CLI 侧凭据存储未拦截官方账号派生凭据",
  ],
]) {
  expectContains(path, "isOfficialAccountCredentialKey", reason);
}

expectContains(
  "packages/shared/src/plugin-marketplaces.ts",
  "YCODE_VENDOR_SERVICES.pluginMarketplaceRemoteSource",
  "插件市场远端源应受策略门禁",
);

expectContains(
  "packages/services/src/feedback/feedbackHttpClient.ts",
  'isVendorServiceEnabled("feedback")',
  "反馈 HTTP 客户端应在 request() 处统一截断",
);

expectContains(
  "packages/services/src/node.ts",
  'isVendorServiceEnabled("conversationShare")',
  "会话分享应受策略门禁",
);

// ── 应用内更新：只检测自有 Release ──────────────────────────────────────────

expectContains(
  "packages/desktop/src/main/githubReleaseUpdates.ts",
  "yuuuuuuc/ZCode",
  "自有 Release 检测应指向本仓库",
);
expectContains(
  "packages/desktop/src/main/autoUpdater.ts",
  "YCODE_VENDOR_SERVICES.selfHostedReleaseUpdates",
  "更新检查应保留自有 Release 分流，否则会回落到厂商 manifest",
);

{
  const content = read("packages/desktop/src/main/autoUpdater.ts");
  if (content !== null) {
    const guardIndex = content.indexOf("YCODE_VENDOR_SERVICES.selfHostedReleaseUpdates");
    const startupIndex = content.indexOf('triggerCheckForUpdates("startup")');
    if (guardIndex < 0) {
      failures.push("packages/desktop/src/main/autoUpdater.ts: 缺少自有 Release 分流判定");
    } else if (startupIndex >= 0 && startupIndex < guardIndex) {
      failures.push(
        "packages/desktop/src/main/autoUpdater.ts: 启动检查排在自有 Release 分流之前，会向厂商 manifest 发请求",
      );
    }
  }
}

// ── 关窗清理：不得再调用未定义的 clearOAuthRoutesForWindow ──────────────────

expectAbsent(
  "packages/desktop/src/main/desktopMainIpcRemote.ts",
  "clearOAuthRoutesForWindow(windowWebContentsId)",
  "关窗清理仍调用旧符号 clearOAuthRoutesForWindow（未导入时会在 Windows 上崩溃）",
);
expectContains(
  "packages/desktop/src/main/desktopMainIpcRemote.ts",
  "clearPendingRoutesForWindow(windowWebContentsId)",
  "关窗清理应调用 clearPendingRoutesForWindow",
);

// ── 产品身份 ────────────────────────────────────────────────────────────────

expectContains(
  "packages/desktop/scripts/desktop-product-identity.mjs",
  "dev.ycode.app",
  "应用标识应保持 Ycode appId",
);
expectContains(
  "packages/desktop/src/main/desktopRuntimeEnv.ts",
  '"Ycode"',
  "Electron userData / 运行时应用名应保持 Ycode，与官方 ZCode 隔离",
);
expectAbsent(
  "packages/desktop/scripts/desktop-product-identity.mjs",
  "dev.zcode.app",
  "应用标识回落到上游 appId",
);

if (failures.length > 0) {
  console.error("默认关闭项检查未通过：\n");
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  console.error(
    `\n共 ${failures.length} 项。这些不变量是分支的核心行为，修复后再提交；\n` +
      `若上游确实改变了实现方式，请同步更新本脚本与 UPSTREAM.md 的登记。`,
  );
  process.exit(1);
}

console.log(
  "默认关闭项检查通过：遥测、厂商服务、登录/凭据门禁、更新源、关窗清理与产品身份均保持 Ycode 约定。",
);
