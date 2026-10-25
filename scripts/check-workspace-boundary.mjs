import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceFiles = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx|js|mjs)$/u.test(file) && !/\.test\./u.test(file) ? [file] : [];
}) : [];

/** Follow shared helpers and dynamic imports as well as the entire maintained Workspace source tree. */
export const auditWorkspaceBoundary = (root = process.cwd()) => {
  const violations = [];
  const queue = [...sourceFiles(path.join(root, 'src/workspace')), ...[
    'src/pages/WorkspacePage.tsx', 'src/App.tsx', 'src/main.tsx',
  ].map(file => path.join(root, file)).filter(file => fs.existsSync(file))];
  const visited = new Set();
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const options = config.error ? { moduleResolution: ts.ModuleResolutionKind.Bundler }
    : ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (/^worker\//u.test(relative) || /^src\/(?:lib\/(?:api|pendingSync)|context\/SessionContext)\.[jt]sx?$/u.test(relative)) {
      violations.push(`${relative}: Workspace must not load website database/session services`);
      continue;
    }
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const inspect = node => {
      if (ts.isIdentifier(node) && /^(?:D1(?:Database|PreparedStatement|Result)|KVNamespace|DurableObject(?:Namespace|Storage|State))$/u.test(node.text)) {
        violations.push(`${relative}: D1 types and APIs, KV, and Durable Objects are forbidden in Workspace`);
      }
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) {
        let pathname = node.text;
        if (/^https?:\/\//u.test(pathname)) {
          try { pathname = new URL(pathname).pathname; } catch { /* Incomplete template URLs are checked by their literal path. */ }
        }
        if (/^\/api(?:\/|$)/u.test(pathname)
          && (relative !== 'src/workspace/googleDriveBackup/workspaceConfig.ts' || node.text !== '/api/workspace-config')) {
          violations.push(`${relative}: Workspace cannot request the site's API (${node.text})`);
        }
      }
      const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const commonJs = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : dynamic || commonJs ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        // Other route chunks are selected by React Router only after leaving Workspace.
        const otherRoute = relative === 'src/App.tsx' && dynamic && specifier.text !== './pages/WorkspacePage';
        if (!otherRoute) {
          const resolved = ts.resolveModuleName(specifier.text, file, options, ts.sys).resolvedModule?.resolvedFileName;
          if (resolved && !resolved.replaceAll('\\', '/').includes('/node_modules/') && /\.[cm]?[jt]sx?$/u.test(resolved)) queue.push(path.resolve(resolved));
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  return [...new Set(violations)];
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = auditWorkspaceBoundary();
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else console.log('Workspace boundary passed: no website database, session, or data API dependency.');
}
