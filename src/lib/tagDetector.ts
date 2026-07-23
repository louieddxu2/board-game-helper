export interface TagItem {
  name: string;
  aliases?: string[];
}

export interface DetectionContext {
  // 該遊戲既有的 Tag 列表 (包含歷史出現過的標籤與別名)
  gameTags: Array<string | TagItem>;
  // 脈絡繼承標籤 (例如從特定擴充頁面點擊新增時傳入)
  inheritedTags?: string[];
}

export interface DetectionInput {
  statement?: string | null;
  commonMistake?: string | null;
  details?: string | null;
}

/**
 * 確定性標籤比對引擎
 * 規則：100% 純文字客觀比對 (Exact Substring Match)，絕不盲目猜測未出現於文字中的關鍵字。
 */
export const detectDeterministicTags = (
  input: DetectionInput,
  context: DetectionContext,
  currentSelectedTags: string[] = []
): string[] => {
  const detected = new Set<string>();

  // 1. 脈絡繼承 (100% 確定)
  if (context.inheritedTags) {
    context.inheritedTags.forEach((tag) => {
      if (tag.trim()) detected.add(tag.trim().replace(/^#/, ''));
    });
  }

  // 2. 合併所有輸入內容
  const statement = input.statement ?? '';
  const commonMistake = input.commonMistake ?? '';
  const details = input.details ?? '';
  const combinedText = `${statement} ${commonMistake} ${details}`.toLocaleLowerCase();

  if (!combinedText.trim()) {
    const selectedSet = new Set(currentSelectedTags.map((t) => t.toLocaleLowerCase()));
    return Array.from(detected).filter((tag) => !selectedSet.has(tag.toLocaleLowerCase()));
  }

  // 3. 客觀比對 (Exact Substring Match)
  for (const tag of context.gameTags) {
    const tagNameClean = (typeof tag === 'string' ? tag : tag.name).trim().replace(/^#/, '');
    if (!tagNameClean) continue;

    const tagNameLower = tagNameClean.toLocaleLowerCase();

    // 條件 A：主要名稱出現在文字中
    if (combinedText.includes(tagNameLower)) {
      detected.add(tagNameClean);
      continue;
    }

    // 條件 B：別名出現在文字中
    if (typeof tag !== 'string' && tag.aliases) {
      for (const alias of tag.aliases) {
        const aliasClean = alias.trim().replace(/^#/, '');
        if (aliasClean && combinedText.includes(aliasClean.toLocaleLowerCase())) {
          detected.add(tagNameClean);
          break;
        }
      }
    }
  }

  // 4. 剔除使用者目前已選擇的標籤
  const selectedSet = new Set(currentSelectedTags.map((t) => t.toLocaleLowerCase()));
  return Array.from(detected).filter((tag) => !selectedSet.has(tag.toLocaleLowerCase()));
};
