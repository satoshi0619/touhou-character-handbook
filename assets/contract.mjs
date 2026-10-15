const text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
export function localResource(value) {
  const raw = typeof value === "string" ? value : value?.url;
  if (!text(raw)) return "";
  let path;
  try { path = decodeURIComponent(raw.trim()); } catch { return ""; }
  path = path.replace(/^\.\//, "");
  if (!path || /^[\/]/.test(path) || /[\\:#?\x00-\x1f]/.test(path) || path.split("/").some((part) => !part || part === ".." || part === ".")) return "";
  return path;
}
function unique(items) { return [...new Set(items)]; }
function fail(message) { throw new Error(`手册数据：${message}`); }
export function normalizeBook(input) {
  if (!input || typeof input !== "object") fail("缺少内容");
  const arrays = ["pages", "characters", "chapters", "works"];
  for (const key of arrays) if (!Array.isArray(input[key])) fail(`缺少 ${key} 数组`);
  const pages = input.pages.map((item) => ({ ...item, title: text(item.title), image: localResource(item.image) })).sort((a, b) => a.page - b.page);
  const pageIds = new Set();
  pages.forEach((item, index) => {
    if (item.page !== index + 1 || pageIds.has(item.page) || !item.image) fail("页码须连续且图片须为本站相对路径");
    pageIds.add(item.page);
  });
  const characterIds = new Set();
  const characters = input.characters.map((item) => {
    if (!text(item.id) || characterIds.has(item.id) || !text(item.name) || !pageIds.has(item.page)) fail("人物编号、姓名或档案页无效");
    characterIds.add(item.id);
    const page = pages[item.page - 1];
    if (page.characterId !== item.id || page.type !== "profile") fail(`人物 ${item.id} 与档案页不一致`);
    return { ...item, name: text(item.name), aliases: unique((item.aliases || []).filter((alias) => typeof alias === "string").map((alias) => alias.trim()).filter(Boolean)), works: [...new Map((item.works || []).map((work) => [work.id, { id: work.id, title: text(work.title) }])).values()] };
  });
  const chapterIds = new Set();
  const chapters = input.chapters.map((item) => {
    if (!text(item.id) || chapterIds.has(item.id) || !text(item.title) || !pageIds.has(item.page)) fail("卷章编号、标题或入口页无效");
    chapterIds.add(item.id);
    const profileIds = unique(item.profileIds || []);
    if (profileIds.some((id) => !characterIds.has(id))) fail(`卷章 ${item.id} 含无效人物`);
    return { ...item, title: text(item.title), subtitle: text(item.subtitle), profileIds };
  }).sort((a, b) => a.page - b.page);
  for (const character of characters) {
    if (!chapterIds.has(character.chapterId)) fail(`人物 ${character.id} 卷章无效`);
    if (!chapters.find((chapter) => chapter.id === character.chapterId).profileIds.includes(character.id)) fail(`人物 ${character.id} 未列入所属卷章`);
  }
  for (const page of pages) {
    if (page.chapterId && !chapterIds.has(page.chapterId)) fail(`第 ${page.page} 页卷章无效`);
    if (page.characterId && !characterIds.has(page.characterId)) fail(`第 ${page.page} 页人物无效`);
  }
  const workIds = new Set();
  const works = input.works.map((item) => {
    if (!text(item.id) || workIds.has(item.id) || !text(item.title)) fail("作品编号或标题无效");
    workIds.add(item.id);
    const ids = unique(item.characterIds || []);
    if (ids.some((id) => !characterIds.has(id))) fail(`作品 ${item.id} 含无效人物`);
    return { ...item, title: text(item.title), characterIds: ids };
  });
  for (const character of characters) {
    for (const work of character.works) {
      const indexed = works.find((item) => item.id === work.id);
      if (!indexed || !indexed.characterIds.includes(character.id)) fail(`人物 ${character.id} 与作品索引不一致`);
    }
  }
  for (const work of works) for (const id of work.characterIds) {
    if (!characters.find((character) => character.id === id).works.some((item) => item.id === work.id)) fail(`作品 ${work.id} 与人物入口不一致`);
  }
  const actual = { pages: pages.length, profiles: characters.length, chapters: chapters.length };
  for (const [key, count] of Object.entries(actual)) if (input.stats?.[key] !== undefined && input.stats[key] !== count) fail(`${key} 统计与实际内容不一致`);
  const downloads = {};
  for (const kind of ["pptx", "pdf"]) {
    const path = localResource(input.downloads?.[kind]);
    if (input.downloads?.[kind] && !path) fail(`${kind} 下载须为本站相对路径`);
    if (path && !path.toLowerCase().endsWith(`.${kind}`)) fail(`${kind} 下载扩展名不符`);
    downloads[kind] = path;
  }
  const scope = Array.isArray(input.scope) ? input.scope.filter((item) => typeof item === "string").join("；") : text(input.scope);
  return { ...input, title: text(input.title, "幻想乡博物志"), subtitle: text(input.subtitle), edition: text(input.edition), updatedAt: text(input.updatedAt), scope, copyright:text(input.copyright), pages, characters, chapters, works, downloads, stats: actual };
}
