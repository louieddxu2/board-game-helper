const { execSync } = require('child_process');
const fs = require('fs');

const updates = [
  // 名稱變更 (中英文皆更新)
  { matchSlug: 'factor-funner%', display: '工廠樂翻天', english: 'Factory Funner', norm: '工廠樂翻天' },
  { matchSlug: 'imperial-steam%', display: '蒸汽帝國', english: 'Imperial Steam', norm: '蒸汽帝國' },
  { matchSlug: 'planta-nubo%', display: '天空植物園', english: 'Planta Nubo', norm: '天空植物園' },
  { matchSlug: 'park%', display: 'PARKS 國家公園', english: 'PARKS', norm: 'parks國家公園' },
  
  // 英文大小寫修訂
  { matchSlug: 'race-to-the-raft%', display: 'Race to the Raft', english: 'Race to the Raft', norm: 'racetotheraft' },
  { matchSlug: 'voyages%', display: 'Voyages', english: 'Voyages', norm: 'voyages' },

  // 純補充英文原名
  { matchDisplay: '兵馬俑', english: 'Terracotta Army' },
  { matchDisplay: '天堂與麥酒', english: 'Heaven & Ale' },
  { matchDisplay: '手機帝國2：商戰', english: 'Mobile Markets: A Smartphone Inc. Game' },
  { matchDisplay: '斯凱島', english: 'Isle of Skye: From Chieftain to King' },
  { matchDisplay: '殖民火星', english: 'Terraforming Mars' },
  { matchDisplay: '熊熊公園', english: 'Bärenpark' },
  { matchDisplay: '璀璨寶石：對決', english: 'Splendor Duel' },
  { matchDisplay: '甲蟲相撲', english: 'Kabuto Sumo' },
  { matchDisplay: '聖瓦西里大教堂', english: 'The Red Cathedral' },
  { matchDisplay: '船廠', english: 'Shipyard' },
  { matchDisplay: '諾亞星球', english: 'Ktizo: An Ecosystem Building Cardgame' },
  { matchDisplay: '達爾文之旅', english: "Darwin's Journey" },
  { matchDisplay: '領國者', english: 'Hegemony: Lead Your Class to Victory' },

  // 無繁中原名遊戲補充 english_name 避免 NULL
  { matchDisplay: 'Bus', english: 'Bus' },
  { matchDisplay: 'Carson City', english: 'Carson City' },
  { matchDisplay: 'Cascadero', english: 'Cascadero' },
  { matchDisplay: 'Dokojong', english: 'Dokojong' },
  { matchDisplay: 'Emberleaf', english: 'Emberleaf' },
  { matchDisplay: 'Keyper', english: 'Keyper' },
  { matchDisplay: 'Loot of Lima', english: 'Loot of Lima' },
  { matchDisplay: 'Lovelace & Babbage', english: 'Lovelace & Babbage' },
  { matchDisplay: 'Railroad Ink Challenge', english: 'Railroad Ink Challenge' },
  { matchDisplay: 'Sonora', english: 'Sonora' },
  { matchDisplay: 'Taxi Derby', english: 'Taxi Derby' },
  { matchDisplay: 'Tiletum', english: 'Tiletum' }
];

const now = Date.now();
const sqlStatements = [];

updates.forEach(u => {
  const escDisplay = u.display ? u.display.replace(/'/g, "''") : null;
  const escEnglish = u.english ? u.english.replace(/'/g, "''") : null;
  const escNorm = u.norm ? u.norm.replace(/'/g, "''") : null;

  if (u.matchSlug) {
    sqlStatements.push(`UPDATE games SET ${escDisplay ? `display_name = '${escDisplay}', ` : ''}${escNorm ? `normalized_name = '${escNorm}', ` : ''}english_name = '${escEnglish}', updated_at = ${now} WHERE slug LIKE '${u.matchSlug}' AND merged_into_game_id IS NULL;`);
  } else if (u.matchDisplay) {
    const escMatch = u.matchDisplay.replace(/'/g, "''");
    sqlStatements.push(`UPDATE games SET ${escDisplay ? `display_name = '${escDisplay}', ` : ''}${escNorm ? `normalized_name = '${escNorm}', ` : ''}english_name = '${escEnglish}', updated_at = ${now} WHERE display_name = '${escMatch}' AND merged_into_game_id IS NULL;`);
  }
});

const sqlFile = 'scratch/update_games.sql';
fs.writeFileSync(sqlFile, sqlStatements.join('\n'), 'utf8');
console.log(`Generated ${sqlStatements.length} SQL statements in ${sqlFile}`);
