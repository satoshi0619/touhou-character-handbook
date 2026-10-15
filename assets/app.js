import { normalizeBook, localResource } from "./contract.mjs";

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(Object.entries({ search:"character-search", navigation:"navigation-list", navigationLabel:"navigation-label", navigationCount:"navigation-count", feedback:"search-feedback", workContext:"work-context", workTitle:"selected-work", reader:"reader", stage:"page-stage", wrap:"page-wrap", image:"page-image", message:"reader-message", messageText:"reader-message-text", retry:"retry-button", imageLoading:"image-loading", title:"current-title", kind:"page-kind", input:"page-input", total:"page-total", previous:"previous-page", next:"next-page", zoomOut:"zoom-out", zoomIn:"zoom-in", zoomReset:"zoom-reset", fullscreen:"fullscreen-button", status:"reader-status", downloads:"download-links", sidebar:"sidebar", backdrop:"drawer-backdrop", contentsToggle:"contents-toggle", drawerClose:"drawer-close" }).map(([key,id]) => [key,$(id)]));
const state = { book:null, page:1, zoom:1, view:"chapters", workId:null, token:0, drawerOpen:false, prefetched:new Set() };
const zoomSteps = [1,1.25,1.5,1.75,2,2.5];
const smallScreen = matchMedia("(max-width:900px)");
const normalize = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ").trim();
let searchTimer, returnFocus, touchStart, prefetchFrame;
const pageFor = (page) => state.book?.pages[Number(page)-1];
const chapterFor = (id) => state.book?.chapters.find((item) => item.id === id);
const currentWork = () => state.book?.works.find((item) => item.id === state.workId);
const announce = (message) => { ui.status.textContent = message; };
const safeURL = (path) => { const local = localResource(path); return local ? new URL(local,document.baseURI).href : ""; };

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  return { hasPage:params.has("page"), page:Number(params.get("page")) || 1, view:params.get("view") === "works" ? "works" : "chapters", workId:params.get("work") || null };
}
function writeHash() {
  const params = new URLSearchParams({ page:String(state.page) });
  if (state.view === "works") params.set("view","works");
  if (state.workId) params.set("work",currentWork()?.title || "");
  const next = `#${params}`;
  if (location.hash !== next) history.replaceState(null,"",next);
}
function savedPage() {
  try { return Number(localStorage.getItem(`touhou-handbook:${state.book.edition}:${state.book.updatedAt}:page`)) || 1; } catch { return 1; }
}
function savePage() {
  try { localStorage.setItem(`touhou-handbook:${state.book.edition}:${state.book.updatedAt}:page`,String(state.page)); } catch { /* Reading remains available without local storage. */ }
}
function showMessage(message, retry=false) {
  ui.messageText.textContent = message;
  ui.message.hidden = false;
  ui.retry.hidden = !retry;
  ui.imageLoading.hidden = true;
  ui.stage.setAttribute("aria-busy","false");
}
function setView(view,workId=null,{hash=true}={}) {
  state.view = view === "works" ? "works" : "chapters";
  state.workId = state.view === "works" ? state.book?.works.find((work) => work.id === workId || work.title === workId)?.id || null : null;
  for (const button of document.querySelectorAll("button[data-view]")) {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active",active);
    button.setAttribute("aria-pressed",String(active));
  }
  renderNavigation();
  if (hash && state.book?.pages.length) writeHash();
}
function navigationButton({title,subtitle,page,character,number,work}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = character ? "character-button" : work ? "work-button" : "chapter-button";
  if (page) button.dataset.page = page;
  if (character) button.dataset.character = character.id;
  if (work) button.dataset.work = work.id;
  const marker = document.createElement("span");
  marker.className = "navigation-marker";
  marker.setAttribute("aria-hidden","true");
  marker.textContent = character ? [...title][0] : work ? "巻" : String(number).padStart(2,"0");
  const copy = document.createElement("span");
  copy.className = "navigation-copy";
  const strong = document.createElement("strong"), small = document.createElement("small");
  strong.textContent = title; small.textContent = subtitle; copy.append(strong,small);
  const arrow = document.createElement("span");
  arrow.className = "navigation-arrow"; arrow.setAttribute("aria-hidden","true"); arrow.textContent = "›";
  button.append(marker,copy,arrow);
  button.addEventListener("click",() => {
    if (work) { setView("works",work.id); return; }
    navigate(page); setDrawer(false);
  });
  return button;
}
function renderNavigation() {
  if (!state.book) return;
  const query = normalize(ui.search.value), work = currentWork(), fragment = document.createDocumentFragment();
  const tokens = query.split(" ").filter(Boolean);
  ui.workContext.hidden = !work;
  ui.workTitle.textContent = work?.title || "";
  let count = 0;
  if (query || work) {
    const allowed = work ? new Set(work.characterIds) : null;
    const results = state.book.characters.filter((character) => {
      const haystack = normalize([character.name,...character.aliases,chapterFor(character.chapterId)?.title,...character.works.map((item) => item.title)].join(" "));
      return (!allowed || allowed.has(character.id)) && tokens.every((token) => haystack.includes(token));
    });
    count = results.length;
    for (const character of results) {
      const subtitle = [chapterFor(character.chapterId)?.title,`第 ${character.page} 页`].filter(Boolean).join(" · ");
      fragment.append(navigationButton({ title:character.name,subtitle,page:character.page,character }));
    }
    ui.navigationLabel.textContent = work ? "本作人物 · 每人一份档案" : "人物搜索结果";
    ui.feedback.textContent = count ? `找到 ${count} 位人物。${work ? `范围：${work.title}。` : ""}` : "没有找到匹配人物。试试姓名、别名或其他作品。";
  } else if (state.view === "works") {
    count = state.book.works.length;
    for (const work of state.book.works) fragment.append(navigationButton({ title:work.title,subtitle:`${work.characterIds.length} 位本册人物`,work }));
    ui.navigationLabel.textContent = "作品索引";
    ui.feedback.textContent = `${count} 个作品入口。同一人物可从多个作品进入。`;
  } else {
    count = state.book.chapters.length;
    state.book.chapters.forEach((chapter,index) => fragment.append(navigationButton({ title:chapter.title,subtitle:[chapter.subtitle,`${chapter.profileIds.length} 人物 · 第 ${chapter.page} 页`].filter(Boolean).join(" · "),page:chapter.page,number:index+1 })));
    ui.navigationLabel.textContent = "八卷目录";
    ui.feedback.textContent = `${count} 个卷章入口。`;
  }
  if (!count) {
    const empty = document.createElement("p"); empty.className = "empty-search";
    empty.textContent = state.book.pages.length ? "没有找到匹配人物。试试更短的名字、别名，或返回全部作品。" : "本版目录与作品索引正在接入。";
    fragment.append(empty);
  }
  ui.navigation.replaceChildren(fragment);
  ui.navigationCount.textContent = count;
  markCurrentNavigation();
}
function markCurrentNavigation() {
  const page = pageFor(state.page);
  for (const button of ui.navigation.querySelectorAll("button[data-page]")) {
    const active = button.dataset.character ? button.dataset.character === page?.characterId : Number(button.dataset.page) === chapterFor(page?.chapterId)?.page;
    button.classList.toggle("is-current",active);
    if (active) button.setAttribute("aria-current","page"); else button.removeAttribute("aria-current");
  }
}
function setZoom(value) {
  state.zoom = Math.max(1,Math.min(2.5,value));
  ui.wrap.style.width = state.zoom === 1 ? "" : `${state.zoom*100}%`;
  ui.stage.classList.toggle("is-zoomed",state.zoom>1);
  ui.zoomReset.textContent = `${Math.round(state.zoom*100)}%`;
  ui.zoomOut.disabled = state.zoom <= 1;
  ui.zoomIn.disabled = !state.book?.pages.length || state.zoom >= 2.5;
  if (state.zoom === 1) ui.stage.scrollTo({top:0,left:0,behavior:"instant"});
}
function shiftZoom(direction) { setZoom(zoomSteps[Math.max(0,Math.min(zoomSteps.length-1,zoomSteps.indexOf(state.zoom)+direction))]); }
function prefetchNext(page,token) {
  const connection = navigator.connection;
  if (connection?.saveData || ["slow-2g","2g"].includes(connection?.effectiveType)) return;
  cancelAnimationFrame(prefetchFrame);
  prefetchFrame = requestAnimationFrame(() => {
    const source = safeURL(pageFor(page+1)?.image);
    if (token !== state.token || !source || state.prefetched.has(source)) return;
    state.prefetched.add(source);
    const image = new Image(); image.decoding="async"; image.fetchPriority="low"; image.src=source;
    image.onerror=()=>state.prefetched.delete(source);
  });
}
function navigate(value,{hash=true,persist=true}={}) {
  const page = Number(value), item = Number.isInteger(page) ? pageFor(page) : null;
  if (!item) { ui.input.value=state.page; announce(`请输入 1 到 ${state.book?.pages.length || 0} 之间的整数页码。`); return false; }
  state.page=page; const token=++state.token;
  ui.input.value=page; ui.previous.disabled=page===1; ui.next.disabled=page===state.book.pages.length;
  ui.title.textContent=item.title || `第 ${page} 页`;
  ui.kind.textContent=({cover:"手册封面",catalog:"卷章目录",section:"卷章扉页",chapter:"卷章扉页",profile:"人物档案",sources:"阅读说明",source:"阅读说明",index:"作品索引"})[item.type] || "手册页面";
  ui.zoomReset.disabled=false; setZoom(1);
  if (hash) writeHash(); if (persist) savePage(); markCurrentNavigation();
  ui.stage.setAttribute("aria-busy","true"); ui.stage.classList.remove("is-loaded"); ui.message.hidden=true; ui.imageLoading.hidden=false; ui.image.hidden=true;
  ui.image.removeAttribute("src"); ui.image.alt=`${ui.title.textContent}，第 ${page} 页，共 ${state.book.pages.length} 页`;
  ui.image.onload=()=>{
    if (token!==state.token) return;
    ui.image.hidden=false; ui.imageLoading.hidden=true; ui.stage.setAttribute("aria-busy","false"); ui.stage.classList.add("is-loaded");
    announce(`第 ${page} 页，共 ${state.book.pages.length} 页。${ui.title.textContent}`); prefetchNext(page,token);
  };
  ui.image.onerror=()=>{ if(token!==state.token)return; ui.image.hidden=true; showMessage("这一页暂时未能打开，可以重试或继续翻阅。",true); announce(`第 ${page} 页暂时未能打开。`); };
  ui.image.src=safeURL(item.image); return true;
}
function renderDownloads() {
  ui.downloads.replaceChildren();
  for (const kind of ["pptx","pdf"]) {
    const path=state.book.downloads[kind]; if(!path)continue;
    const link=document.createElement("a"); link.className="download-link"; link.href=safeURL(path); link.download=path.split("/").pop(); link.dataset.download=kind;
    const copy=document.createElement("span"),title=document.createElement("strong"),info=document.createElement("small"),arrow=document.createElement("span");
    title.textContent=`下载 ${kind.toUpperCase()}`; info.textContent=kind==="pptx"?"可编辑手册 · 免费下载":"阅读完整版 · 免费下载";
    arrow.textContent="↓"; arrow.setAttribute("aria-hidden","true"); copy.append(title,info); link.append(copy,arrow); ui.downloads.append(link);
  }
  if(!ui.downloads.childElementCount){const pending=document.createElement("p");pending.className="download-pending";pending.textContent="完整文件接入后开放下载。";ui.downloads.append(pending);}
}
async function loadBook() {
  showMessage("正在打开手册…"); ui.stage.setAttribute("aria-busy","true");
  try {
    const response=await fetch("handbook.json",{cache:"no-cache"}); if(!response.ok)throw Error("数据无法读取");
    state.book=normalizeBook(await response.json()); state.prefetched.clear();
    for(const[key,id]of Object.entries({profiles:"character-count",chapters:"chapter-count",pages:"page-count"})) $(id).textContent=state.book.stats[key] || "—";
    $("book-title").textContent=state.book.title; $("book-subtitle").textContent=state.book.subtitle || "沿着名字，走进幻想乡。";
    $("edition-label").textContent=[state.book.edition,state.book.updatedAt].filter(Boolean).join(" · ") || "本版手册正在接入";
    $("scope-note").textContent=state.book.scope || "收录范围与版本信息以本版手册为准。";
    if(state.book.copyright)$("copyright-note").textContent=state.book.copyright;
    document.title=`${state.book.title} · 东方Project角色手册`;
    renderDownloads(); const hash=readHash(); setView(hash.view,hash.workId,{hash:false});
    if(!state.book.pages.length){ui.input.disabled=true;ui.total.textContent="—";showMessage("本版手册正在接入。页面、目录与完整下载文件准备好后，会在这里开放阅读。");announce("本版手册正在接入。");return;}
    ui.input.disabled=false;ui.input.max=state.book.pages.length;ui.total.textContent=state.book.pages.length;
    const initial=hash.hasPage?pageFor(hash.page)?hash.page:1:pageFor(savedPage())?savedPage():1;
    navigate(initial);
  }catch(error){state.book=null;ui.previous.disabled=true;ui.next.disabled=true;ui.input.disabled=true;ui.zoomIn.disabled=true;ui.zoomOut.disabled=true;ui.zoomReset.disabled=true;showMessage("暂时未能载入手册，请刷新或重新打开。",true);announce("暂时未能载入手册。");console.error(error);}
}
function setDrawer(open) {
  open=Boolean(open&&smallScreen.matches);state.drawerOpen=open;ui.sidebar.classList.toggle("is-open",open);ui.backdrop.hidden=!open;ui.contentsToggle.setAttribute("aria-expanded",String(open));
  for(const id of["reading-column","masthead","introduction","edition-strip","publication-note"])$(id).inert=open;
  document.body.style.overflow=open?"hidden":"";
  if(open){returnFocus=document.activeElement;ui.sidebar.setAttribute("role","dialog");ui.sidebar.setAttribute("aria-modal","true");ui.search.focus();}
  else{ui.sidebar.removeAttribute("role");ui.sidebar.removeAttribute("aria-modal");if(returnFocus?.isConnected&&smallScreen.matches)returnFocus.focus();returnFocus=null;}
}
ui.previous.addEventListener("click",()=>navigate(state.page-1));ui.next.addEventListener("click",()=>navigate(state.page+1));
$("page-jump").addEventListener("submit",event=>{event.preventDefault();navigate(ui.input.value);});
ui.zoomIn.addEventListener("click",()=>shiftZoom(1));ui.zoomOut.addEventListener("click",()=>shiftZoom(-1));ui.zoomReset.addEventListener("click",()=>setZoom(1));
ui.retry.addEventListener("click",()=>state.book?navigate(state.page):loadBook());
ui.search.addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderNavigation,90);});
for(const button of document.querySelectorAll("button[data-view]"))button.addEventListener("click",()=>setView(button.dataset.view));
$("all-works").addEventListener("click",()=>setView("works"));
ui.contentsToggle.addEventListener("click",()=>setDrawer(!state.drawerOpen));ui.drawerClose.addEventListener("click",()=>setDrawer(false));ui.backdrop.addEventListener("click",()=>setDrawer(false));smallScreen.addEventListener("change",()=>setDrawer(false));
ui.fullscreen.hidden=!document.fullscreenEnabled;
ui.fullscreen.addEventListener("click",async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await ui.reader.requestFullscreen();}catch{announce("当前浏览器无法进入全屏，可以放大页面阅读。");}});
document.addEventListener("fullscreenchange",()=>{const full=document.fullscreenElement===ui.reader;ui.fullscreen.setAttribute("aria-label",full?"退出全屏阅读":"全屏阅读");ui.fullscreen.setAttribute("aria-pressed",String(full));});
window.addEventListener("hashchange",()=>{if(!state.book?.pages.length)return;const hash=readHash();if(!hash.hasPage)return;setView(hash.view,hash.workId,{hash:false});if(pageFor(hash.page))navigate(hash.page,{hash:false});else writeHash();});
document.addEventListener("keydown",event=>{
  if(state.drawerOpen){
    if(event.key==="Escape"){event.preventDefault();setDrawer(false);return;}
    if(event.key==="Tab"){const elements=[...ui.sidebar.querySelectorAll("button:not(:disabled),input,a[href]")].filter(item=>item.getClientRects().length),first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    return;
  }
  if(!state.book?.pages.length||event.altKey||event.ctrlKey||event.metaKey||event.target.closest("input,textarea,select,[contenteditable='true']"))return;
  if(["ArrowRight","ArrowLeft"].includes(event.key)){event.preventDefault();const next=state.page+(event.key==="ArrowRight"?1:-1);if(pageFor(next))navigate(next);}
  else if(["Home","End"].includes(event.key)&&(document.activeElement===ui.reader||document.fullscreenElement===ui.reader)){event.preventDefault();navigate(event.key==="Home"?1:state.book.pages.length);}
});
ui.stage.addEventListener("touchstart",event=>{touchStart=state.zoom===1&&event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY,time:performance.now()}:null;},{passive:true});
ui.stage.addEventListener("touchmove",event=>{if(event.touches.length!==1)touchStart=null;},{passive:true});ui.stage.addEventListener("touchcancel",()=>{touchStart=null;},{passive:true});
ui.stage.addEventListener("touchend",event=>{if(!touchStart||event.changedTouches.length!==1||state.zoom!==1)return;const x=event.changedTouches[0].clientX-touchStart.x,y=event.changedTouches[0].clientY-touchStart.y,elapsed=performance.now()-touchStart.time;touchStart=null;if(elapsed>700||Math.abs(x)<55||Math.abs(x)<Math.abs(y)*1.5)return;const next=state.page+(x<0?1:-1);if(pageFor(next))navigate(next);},{passive:true});
loadBook();
