const fs = require('fs');
let code = fs.readFileSync('worker/index.ts', 'utf8');

code = code.replace(
  "import type { D1PreparedStatement, Env } from './env';",
  "import type { D1PreparedStatement, Env, D1Result } from './env';"
);

const helper = `
interface LoggedQueryContext {
  reqPath: string;
  totalRowsRead: number;
  queries: Array<{ name: string; rowsRead: number }>;
}

const logD1Query = <T extends D1Result<unknown>>(c: AppContext, queryName: string, result: T): T => {
  const rowsRead = result.meta?.rows_read ?? 0;
  console.log(\`[D1_METRICS] [\${c.req.path}] \${queryName}: \${rowsRead} rows_read\`);
  
  let ctx = c.get('d1Metrics');
  if (!ctx) {
    ctx = { reqPath: c.req.path, totalRowsRead: 0, queries: [] };
    c.set('d1Metrics', ctx);
  }
  ctx.totalRowsRead += rowsRead;
  ctx.queries.push({ name: queryName, rowsRead });
  c.header('X-D1-Rows-Read', String(ctx.totalRowsRead));
  
  return result;
};
`;

code = code.replace("const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();", helper + "\nconst app = new Hono<{ Bindings: Env; Variables: AppVariables }>();");

// /api/home
code = code.replace(
  "const windowRow = await c.env.DB.prepare(`\n    WITH recent_games AS (",
  "const windowRowRes = await c.env.DB.prepare(`\n    WITH recent_games AS ("
);
code = code.replace(
  "SELECT MIN(min_date) as window_start FROM recent_games;\n  `).first<{ window_start: string | null }>();\n\n  let startDateStr",
  "SELECT MIN(min_date) as window_start FROM recent_games;\n  `).all<{ window_start: string | null }>();\n  const windowRow = logD1Query(c, 'home:window-start', windowRowRes).results?.[0];\n\n  let startDateStr"
);

code = code.replace(
  "ORDER BY view_count DESC, MAX(created_at) DESC\n      LIMIT 6\n    `).all<{ game_id: string }>(),",
  "ORDER BY view_count DESC, MAX(created_at) DESC\n      LIMIT 6\n    `).all<{ game_id: string }>()).then(r => logD1Query(c, 'home:popular-games', r)),"
);

code = code.replace(
  "ORDER BY created_at DESC LIMIT 6\n    `).all<{ id: string }>(),\n  ]);",
  "ORDER BY created_at DESC LIMIT 6\n    `).all<{ id: string }>()).then(r => logD1Query(c, 'home:recent-rules', r)),\n  ]);"
);

code = code.replace(
  "ORDER BY g.updated_at DESC LIMIT 6\n    `).all<{ id: string }>();\n    const extraIds",
  "ORDER BY g.updated_at DESC LIMIT 6\n    `).all<{ id: string }>();\n    logD1Query(c, 'home:fallback-games', fallbackGameIdsResult);\n    const extraIds"
);

code = code.replace(
  "WHERE g.id IN (${placeholders}) AND g.merged_into_game_id IS NULL\n  \`).bind(...popularGameIds).all<GameRow>();",
  "WHERE g.id IN (${placeholders}) AND g.merged_into_game_id IS NULL\n  \`).bind(...popularGameIds).all<GameRow>();\n  logD1Query(c, 'home:games-meta', gamesResult);"
);

code = code.replace(
  "ORDER BY view_count DESC, MAX(created_at) DESC\n  \`).bind(...popularGameIds).all<{ game_id: string; rule_id: string }>();",
  "ORDER BY view_count DESC, MAX(created_at) DESC\n  \`).bind(...popularGameIds).all<{ game_id: string; rule_id: string }>();\n  logD1Query(c, 'home:featured-rule-ids', featuredRuleIdsResult);"
);

code = code.replace(
  "ORDER BY is_featured DESC, created_at DESC\n        LIMIT 1\n      `).bind(id).first<{ id: string }>();\n      ruleId = fallback?.id ?? '';",
  "ORDER BY is_featured DESC, created_at DESC\n        LIMIT 1\n      `).bind(id).all<{ id: string }>();\n      logD1Query(c, 'home:fallback-rule-id', fallback);\n      ruleId = fallback.results?.[0]?.id ?? '';"
);

// /api/rules/:id
code = code.replace(
  "WHERE r.id = ? AND r.status = 'published'\n    LIMIT 1\n  \`).bind(id).first<RuleRow & { game_name: string; game_slug: string }>();",
  "WHERE r.id = ? AND r.status = 'published'\n    LIMIT 1\n  \`).bind(id).all<RuleRow & { game_name: string; game_slug: string }>();\n  const row = logD1Query(c, 'rule:by-id', _row_res).results?.[0];"
);
code = code.replace(
  "const row = await c.env.DB.prepare(`\n    SELECT r.id,",
  "const _row_res = await c.env.DB.prepare(`\n    SELECT r.id,"
);

// /api/games/:identifier
code = code.replace(
  "WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL\n    LIMIT 1\n  \`).bind(identifier, identifier).first<GameRow>();",
  "WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL\n    LIMIT 1\n  \`).bind(identifier, identifier).all<GameRow>();\n  const game = logD1Query(c, 'game:detail-meta', _game_res).results?.[0];"
);
code = code.replace(
  "const game = await c.env.DB.prepare(`\n    SELECT g.id,",
  "const _game_res = await c.env.DB.prepare(`\n    SELECT g.id,"
);

code = code.replace(
  "c.env.DB.prepare('SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias')\n      .bind(game.id).all<{ alias: string }>(),",
  "c.env.DB.prepare('SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias')\n      .bind(game.id).all<{ alias: string }>().then(r => logD1Query(c, 'game:detail-aliases', r)),"
);

code = code.replace(
  "r.created_at DESC\n    \`).bind(game.id).all<RuleRow>(),\n  ]);",
  "r.created_at DESC\n    \`).bind(game.id).all<RuleRow>().then(r => logD1Query(c, 'game:detail-rules', r)),\n  ]);"
);

// /api/games/search
code = code.replace(
  "g.display_name\n    LIMIT 20\n  \`).bind(`%${query}%`, `%${query}%`, `%${query}%`, query).all<GameRow>();\n  setNoCache(c);",
  "g.display_name\n    LIMIT 20\n  \`).bind(`%${query}%`, `%${query}%`, `%${query}%`, query).all<GameRow>();\n  logD1Query(c, 'search:games', result);\n  setNoCache(c);"
);

// /api/games/resolve
code = code.replace(
  "AND (g.normalized_name = ? OR a.normalized_alias = ?)\n    GROUP BY g.id\n    LIMIT 1\n  \`).bind(name, name).first<GameRow>();",
  "AND (g.normalized_name = ? OR a.normalized_alias = ?)\n    GROUP BY g.id\n    LIMIT 1\n  \`).bind(name, name).all<GameRow>();\n  const exact = logD1Query(c, 'resolve:exact', _exact_res).results?.[0];"
);
code = code.replace(
  "const exact = await c.env.DB.prepare(`\n    SELECT g.id,",
  "const _exact_res = await c.env.DB.prepare(`\n    SELECT g.id,"
);

code = code.replace(
  "AND (g.normalized_name LIKE ? OR a.normalized_alias LIKE ?)\n    GROUP BY g.id\n    ORDER BY g.display_name\n    LIMIT 5\n  \`).bind(`%${name}%`, `%${name}%`).all<GameRow>();",
  "AND (g.normalized_name LIKE ? OR a.normalized_alias LIKE ?)\n    GROUP BY g.id\n    ORDER BY g.display_name\n    LIMIT 5\n  \`).bind(`%${name}%`, `%${name}%`).all<GameRow>();\n  logD1Query(c, 'resolve:fuzzy', result);"
);

fs.writeFileSync('worker/index.ts', code);
console.log('done');
