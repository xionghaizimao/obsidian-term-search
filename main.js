const {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile
} = require("obsidian");

const VIEW_TYPE = "selected-text-search-results";
const TERM_PREVIEW_VIEW_TYPE = "term-preview-view";
const DEFAULT_SETTINGS = {
  caseSensitive: false,
  expandedGroups: {
    exact: true,
    current: true,
    other: true,
    body: true,
    low: false
  }
};
const QUICK_LIMIT = 10;
const GROUPS = [
  ["exact", "精确词条"],
  ["current", "当前模块相关词条"],
  ["other", "其他模块相关词条"],
  ["body", "课程正文"],
  ["low", "文件清单及其他"]
];

class SearchResultsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.searchTerm = "";
    this.results = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "名词解释搜索"; }
  getIcon() { return "book-open"; }

  async onOpen() { this.render(); }

  setResults(term, results) {
    this.searchTerm = term;
    this.results = results;
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("selected-text-search-view");

    const heading = root.createDiv({ cls: "sts-query" });
    heading.createSpan({ text: "搜索：", cls: "sts-query-label" });
    heading.createSpan({ text: this.searchTerm || "请选中文字后右键搜索" });
    if (!this.results) return;

    for (const [key, label] of GROUPS) {
      const items = this.results[key];
      const details = root.createEl("details", { cls: "sts-group" });
      details.open = this.plugin.settings.expandedGroups[key];
      details.createEl("summary", { text: `${label}（${items.length}）` });
      const list = details.createDiv({ cls: "sts-results" });
      if (!items.length) {
        list.createDiv({ text: "无结果", cls: "sts-empty" });
        continue;
      }
      for (const result of items) this.renderResult(list, result);
    }
  }

  renderResult(parent, result) {
    const row = parent.createDiv({ cls: "sts-result", attr: { tabindex: "0" } });
    row.createDiv({
      text: `${result.displayName}${result.module ? `｜${result.module}` : ""}`,
      cls: "sts-result-title"
    });
    row.createDiv({ text: result.path, cls: "sts-result-path" });
    row.createDiv({
      text: `匹配 ${result.count} 次｜${result.matchType}`,
      cls: "sts-result-meta"
    });
    const preview = () => this.plugin.showTermInRightSidebar(result.file);
    row.addEventListener("click", preview);
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.plugin.openOriginalInNewTab(result.file);
    });
    row.addEventListener("mouseenter", () => this.plugin.scheduleCompactPopover(row, result));
    row.addEventListener("mouseleave", () => this.plugin.scheduleHideCompactPopover());
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        this.plugin.openOriginalInNewTab(result.file);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        preview();
      }
    });
  }
}

class TermPreviewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
  }

  getViewType() { return TERM_PREVIEW_VIEW_TYPE; }
  getDisplayText() { return this.file?.basename || "名词解释预览"; }
  getIcon() { return "book-open"; }

  async onOpen() { this.renderEmpty(); }

  renderEmpty() {
    this.contentEl.empty();
    this.contentEl.addClass("sts-term-preview-view");
    this.contentEl.createDiv({ text: "请从搜索结果中选择一个名词解释", cls: "sts-empty" });
  }

  async setFile(file) {
    this.file = file;
    const root = this.contentEl;
    root.empty();
    root.addClass("sts-term-preview-view");
    const entry = this.plugin.index.get(file.path);
    const header = root.createDiv({ cls: "sts-preview-header" });
    header.createEl("h3", { text: entry?.title || file.basename });
    header.createDiv({
      text: `${entry?.module || "未标注模块"}｜${entry?.entryType || "名词解释"}`,
      cls: "sts-preview-meta"
    });
    const actions = header.createDiv({ cls: "sts-preview-actions" });
    const openButton = actions.createEl("button", { text: "在新标签页打开" });
    openButton.addEventListener("click", () => this.plugin.openOriginalInNewTab(file));
    const closeButton = actions.createEl("button", { text: "关闭侧栏" });
    closeButton.addEventListener("click", () => this.leaf.detach());

    const body = root.createDiv({ cls: "markdown-preview-view markdown-rendered sts-preview-body" });
    const content = await this.plugin.app.vault.cachedRead(file);
    if (this.file !== file) return;
    await MarkdownRenderer.render(this.app, content, body, file.path, this);
  }
}

class TermSearchService {
  constructor(plugin) { this.plugin = plugin; }

  search(query) {
    const plugin = this.plugin;
    const currentModule = plugin.currentModule();
    const groups = { exact: [], current: [], other: [], body: [], low: [] };
    for (const entry of plugin.index.values()) {
      const exactType = entry.isGlossary && !entry.isLow ? plugin.exactMatch(entry, query) : "";
      const related = entry.isGlossary ? plugin.relatedScore(entry, query) : 0;
      const count = plugin.countMatches(entry.content, query);
      if (entry.isLow) {
        if (related || count) groups.low.push(plugin.makeResult(entry, count, related ? "低优先级词条匹配" : "正文匹配", related));
      } else if (exactType) {
        groups.exact.push(plugin.makeResult(entry, count, exactType, 100));
      } else if (entry.isGlossary && related) {
        const key = currentModule && entry.module === currentModule ? "current" : "other";
        groups[key].push(plugin.makeResult(entry, count, "相关词条", related));
      } else if (!entry.isGlossary && count) {
        groups.body.push(plugin.makeResult(entry, count, "正文完整术语匹配", 10));
      }
    }
    for (const key of Object.keys(groups)) groups[key].sort((a, b) => plugin.compareResults(a, b, currentModule));
    return groups;
  }
}

class QuickSearchModal extends Modal {
  constructor(plugin, query, results) {
    super(plugin.app);
    this.plugin = plugin;
    this.query = query;
    this.results = results;
    this.items = [...results.exact, ...results.current, ...results.other].slice(0, QUICK_LIMIT);
    this.selectedIndex = this.items.length ? 0 : -1;
    this.rows = [];
    this.hoverTimer = null;
    this.hideTimer = null;
    this.clickTimer = null;
    this.hoverCard = null;
  }

  onOpen() {
    this.modalEl.addClass("sts-quick-modal");
    this.titleEl.setText(`快速查找：${this.query}`);
    const list = this.contentEl.createDiv({ cls: "sts-quick-list" });
    if (!this.items.length) list.createDiv({ text: "没有找到名词解释", cls: "sts-empty" });
    this.items.forEach((result, index) => this.renderRow(list, result, index));

    const total = Object.values(this.results).reduce((sum, group) => sum + group.length, 0);
    const footer = this.contentEl.createEl("button", {
      text: `在侧栏中查看全部 ${total} 条结果`,
      cls: "sts-quick-footer"
    });
    footer.addEventListener("click", () => {
      this.close();
      this.plugin.showSidebarResults(this.query, this.results);
    });
    this.modalEl.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.modalEl.tabIndex = -1;
    this.modalEl.focus();
    this.updateSelection();
  }

  renderRow(parent, result, index) {
    const row = parent.createDiv({ cls: "sts-quick-row" });
    row.createDiv({ text: result.displayName, cls: "sts-quick-name" });
    row.createSpan({ text: result.module || "未标注模块", cls: "sts-quick-module" });
    row.createSpan({ text: result.entryType, cls: "sts-quick-type" });
    row.createSpan({ text: result.matchType.includes("精确") ? "精确" : "相关", cls: "sts-quick-match" });
    row.addEventListener("click", (event) => {
      if (event.detail !== 1) return;
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => this.openResult(result), 180);
    });
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      clearTimeout(this.clickTimer);
      this.close();
      this.plugin.openOriginalInNewTab(result.file);
    });
    row.addEventListener("mouseenter", () => {
      this.selectedIndex = index;
      this.updateSelection();
      clearTimeout(this.hideTimer);
      this.hoverTimer = setTimeout(() => this.showHover(row, result), 250);
    });
    row.addEventListener("mouseleave", () => {
      clearTimeout(this.hoverTimer);
      this.hideTimer = setTimeout(() => this.hideHover(), 120);
    });
    this.rows.push(row);
  }

  onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && this.items.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.selectedIndex = (this.selectedIndex + step + this.items.length) % this.items.length;
      this.updateSelection();
      this.rows[this.selectedIndex].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && event.ctrlKey && this.selectedIndex >= 0) {
      event.preventDefault();
      const result = this.items[this.selectedIndex];
      this.close();
      this.plugin.openOriginalInNewTab(result.file);
    } else if (event.key === "Enter" && this.selectedIndex >= 0) {
      event.preventDefault();
      this.openResult(this.items[this.selectedIndex]);
    }
  }

  updateSelection() {
    this.rows.forEach((row, index) => row.toggleClass("is-selected", index === this.selectedIndex));
  }

  async openResult(result) {
    this.close();
    await this.plugin.showTermInRightSidebar(result.file);
  }

  showHover(row, result) {
    this.hideHover();
    const card = document.body.createDiv({ cls: "sts-quick-hover" });
    card.createDiv({ text: result.displayName, cls: "sts-hover-title" });
    card.createDiv({ text: `${result.entryType}｜${result.module || "未标注模块"}`, cls: "sts-hover-meta" });
    card.createDiv({ text: result.summary || "暂无简短定义", cls: "sts-hover-summary" });
    if (result.example) card.createDiv({ text: `示例：${result.example}`, cls: "sts-hover-example" });
    const rect = row.getBoundingClientRect();
    const width = 300;
    const left = rect.right + 10 + width <= window.innerWidth ? rect.right + 10 : rect.left - width - 10;
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.min(rect.top, window.innerHeight - card.offsetHeight - 8)}px`;
    this.hoverCard = card;
  }

  hideHover() {
    this.hoverCard?.remove();
    this.hoverCard = null;
  }

  onClose() {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.hideTimer);
    clearTimeout(this.clickTimer);
    this.hideHover();
    this.contentEl.empty();
  }
}

class SearchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("区分大小写")
      .setDesc("关闭时，英文大小写视为相同。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.caseSensitive)
        .onChange(async (value) => {
          this.plugin.settings.caseSensitive = value;
          await this.plugin.saveData(this.plugin.settings);
        }));

    this.containerEl.createEl("h3", { text: "结果分组默认状态" });
    for (const [key, label] of GROUPS) {
      new Setting(this.containerEl)
        .setName(label)
        .setDesc("控制每次搜索时该分组默认展开或折叠。")
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.expandedGroups[key])
          .onChange(async (value) => {
            this.plugin.settings.expandedGroups[key] = value;
            await this.plugin.saveData(this.plugin.settings);
          }));
    }
  }
}

module.exports = class SelectedTextSearchPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData() || {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      expandedGroups: {
        ...DEFAULT_SETTINGS.expandedGroups,
        ...(savedSettings.expandedGroups || {})
      }
    };
    this.index = new Map();
    this.searchService = new TermSearchService(this);
    this.registerView(VIEW_TYPE, (leaf) => new SearchResultsView(leaf, this));
    this.registerView(TERM_PREVIEW_VIEW_TYPE, (leaf) => new TermPreviewView(leaf, this));
    this.addSettingTab(new SearchSettingTab(this.app, this));
    this.addStyles();

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      const selectedText = this.cleanSelection(editor.getSelection());
      if (!selectedText) return;
      menu.addSeparator();
      this.addSearchItems(menu, selectedText);
    }));

    this.registerDomEvent(document, "contextmenu", (event) => {
      const selectedText = this.cleanSelection(window.getSelection()?.toString());
      if (!selectedText || !this.isInsideWorkspace(event.target)) return;
      if (event.target.closest(".markdown-source-view")) return;
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("复制所选内容").setIcon("copy")
        .onClick(() => this.copyText(selectedText)));
      menu.addSeparator();
      this.addSearchItems(menu, selectedText);
      menu.showAtMouseEvent(event);
    }, true);

    this.app.workspace.onLayoutReady(() => this.buildIndex());
    this.registerEvent(this.app.vault.on("create", (file) => this.updateIndex(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.updateIndex(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.index.delete(oldPath);
      this.updateIndex(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => this.index.delete(file.path)));
  }

  onunload() {
    this.hideCompactPopover();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TERM_PREVIEW_VIEW_TYPE);
  }

  addStyles() {
    const style = document.head.createEl("style", { attr: { "data-sts-style": "true" } });
    style.textContent = `
      .selected-text-search-view { padding: 12px; }
      .sts-query { font-size: var(--font-ui-medium); margin-bottom: 12px; overflow-wrap: anywhere; }
      .sts-query-label, .sts-group > summary, .sts-result-title { font-weight: 600; }
      .sts-group { margin: 6px 0; }
      .sts-group > summary { cursor: pointer; padding: 6px 2px; }
      .sts-results { padding: 2px 0 6px 12px; }
      .sts-result { border-radius: var(--radius-s); cursor: pointer; padding: 7px 8px; }
      .sts-result:hover, .sts-result:focus { background: var(--background-modifier-hover); outline: none; }
      .sts-result-path, .sts-result-meta { color: var(--text-muted); font-size: var(--font-ui-smaller); overflow-wrap: anywhere; }
      .sts-result-path { margin-top: 2px; }
      .sts-empty { color: var(--text-faint); padding: 5px 8px; }
      .sts-quick-modal { width: min(520px, calc(100vw - 32px)); }
      .sts-quick-modal .modal-content { padding-bottom: 12px; }
      .sts-quick-list { max-height: 300px; overflow-y: auto; }
      .sts-quick-row { border-radius: var(--radius-s); cursor: pointer; display: grid; gap: 2px 8px; grid-template-columns: 1fr auto auto auto; padding: 8px 10px; }
      .sts-quick-row:hover, .sts-quick-row.is-selected { background: var(--background-modifier-hover); }
      .sts-quick-name { font-weight: 600; grid-column: 1 / -1; }
      .sts-quick-module, .sts-quick-type { color: var(--text-muted); font-size: var(--font-ui-smaller); }
      .sts-quick-match { background: var(--background-modifier-border); border-radius: 10px; color: var(--text-muted); font-size: var(--font-ui-smaller); padding: 1px 7px; }
      .sts-quick-footer { margin-top: 10px; width: 100%; }
      .sts-quick-hover { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); box-shadow: var(--shadow-l); max-height: 400px; overflow: hidden; padding: 12px; pointer-events: none; position: fixed; width: 300px; z-index: var(--layer-popover); }
      .sts-hover-title { font-weight: 600; margin-bottom: 4px; }
      .sts-hover-meta { color: var(--text-muted); font-size: var(--font-ui-smaller); margin-bottom: 8px; }
      .sts-hover-summary, .sts-hover-example { display: -webkit-box; line-height: 1.45; overflow: hidden; -webkit-box-orient: vertical; }
      .sts-hover-summary { -webkit-line-clamp: 6; }
      .sts-hover-example { border-top: 1px solid var(--background-modifier-border); color: var(--text-muted); margin-top: 8px; padding-top: 8px; -webkit-line-clamp: 3; }
      .sts-term-preview-view { height: 100%; overflow-y: auto; padding: 12px; }
      .sts-preview-header { border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 12px; padding-bottom: 10px; }
      .sts-preview-header h3 { margin: 0 0 4px; }
      .sts-preview-meta { color: var(--text-muted); font-size: var(--font-ui-smaller); }
      .sts-preview-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .sts-preview-body { padding: 0; }
    `;
    this.register(() => style.remove());
  }

  addSearchItems(menu, selectedText) {
    menu.addItem((item) => item.setTitle("在侧栏中搜索名词解释").setIcon("book-open")
      .onClick(() => this.searchGlossary(selectedText)));
    menu.addItem((item) => item.setTitle("快速查找名词解释").setIcon("search")
      .onClick(() => this.quickSearchGlossary(selectedText)));
  }

  cleanSelection(text) {
    if (!text) return "";
    return text.replace(/\s+/g, " ").trim().replace(/^[`'\"“”‘’]+|[`'\"“”‘’]+$/g, "").trim();
  }

  normalize(text) {
    let value = String(text || "").normalize("NFKC").replace(/[‐‑‒–—−﹘﹣－]/g, "-");
    if (!this.settings.caseSensitive) value = value.toLocaleLowerCase();
    return value.trim();
  }

  equivalent(text) { return this.normalize(text).replace(/\(\)$/, ""); }

  isInsideWorkspace(target) {
    return target instanceof Element && Boolean(target.closest(".workspace"));
  }

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      new Notice("已复制所选内容");
    } catch (_) {
      new Notice("复制失败，请使用 Ctrl+C");
    }
  }

  async buildIndex() {
    const files = this.app.vault.getMarkdownFiles();
    await Promise.all(files.map((file) => this.updateIndex(file)));
  }

  async updateIndex(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    try {
      const content = await this.app.vault.cachedRead(file);
      this.index.set(file.path, this.makeEntry(file, content));
    } catch (_) {
      this.index.delete(file.path);
    }
  }

  makeEntry(file, content) {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || this.parseFrontmatter(content);
    const aliasesValue = frontmatter.aliases ?? frontmatter.alias ?? [];
    const aliases = Array.isArray(aliasesValue) ? aliasesValue : [aliasesValue];
    const firstHeading = cache?.headings?.find((heading) => heading.level === 1)?.heading
      || content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const module = this.extractModule(frontmatter.module)
      || this.extractModule(file.path)
      || this.extractModule(file.basename);
    const isGlossary = /(^|\/)名词解释(\/|$)|名词解释\//.test(file.path.replace(/\\/g, "/"));
    const isLow = (isGlossary && file.basename.startsWith("00 "))
      || /(总路线|总规范|规范|模板)/.test(file.basename);
    const summary = this.extractSummary(content, frontmatter);
    return {
      file,
      path: file.path,
      basename: file.basename,
      title: firstHeading,
      term: frontmatter.term == null ? "" : String(frontmatter.term),
      aliases: aliases.filter(Boolean).map(String),
      module,
      entryType: String(frontmatter.entry_type || frontmatter.type || "名词解释"),
      summary,
      example: this.cleanPreviewText(frontmatter.example || "", 100),
      isGlossary,
      isLow,
      content
    };
  }

  cleanPreviewText(text, limit = 160) {
    const cleaned = String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[\[([^\]]+)\]\]/g, "")
      .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
      .replace(/^>\s*\[![^\]]+\].*$/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}…` : cleaned;
  }

  extractSummary(content, frontmatter) {
    const direct = frontmatter.summary || frontmatter.description;
    if (direct) return this.cleanPreviewText(direct);
    let body = content.replace(/^---\s*\n[\s\S]*?\n---\s*/, "").replace(/```[\s\S]*?```/g, "");
    const section = body.match(/^#{1,6}\s*它是什么\s*$([\s\S]*?)(?=^#{1,6}\s|$)/m)?.[1];
    const source = section || body;
    const paragraph = source.split(/\n\s*\n/).map((part) => part.trim()).find((part) =>
      part && !/^#{1,6}\s/.test(part) && !/^>\s*\[!/.test(part) && !/^[-*+]\s*$/.test(part)
    );
    return this.cleanPreviewText(paragraph || "");
  }

  parseFrontmatter(content) {
    const block = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!block) return {};
    const result = {};
    for (const line of block[1].split("\n")) {
      const match = line.match(/^([\w-]+):\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim();
      result[match[1]] = value.startsWith("[") && value.endsWith("]")
        ? value.slice(1, -1).split(",").map((item) => item.trim().replace(/^['\"]|['\"]$/g, ""))
        : value.replace(/^['\"]|['\"]$/g, "");
    }
    return result;
  }

  extractModule(value) {
    const match = String(value || "").match(/模块\s*([0-9一二三四五六七八九十]+)/i);
    return match ? `模块${match[1]}` : "";
  }

  currentModule() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) return "";
    const frontmatterModule = this.app.metadataCache.getFileCache(file)?.frontmatter?.module;
    return this.extractModule(frontmatterModule)
      || this.extractModule(file.parent?.path)
      || this.extractModule(file.basename);
  }

  exactMatch(entry, query) {
    const q = this.normalize(query);
    const fields = [
      [entry.basename, "文件名精确匹配"],
      [entry.title, "一级标题精确匹配"],
      [entry.term, "term 精确匹配"],
      ...entry.aliases.map((alias) => [alias, "别名精确匹配"])
    ];
    return fields.find(([value]) => this.normalize(value) === q)?.[1] || "";
  }

  relatedScore(entry, query) {
    const q = this.equivalent(query);
    const fields = [entry.basename, entry.title, entry.term, ...entry.aliases]
      .map((value) => this.equivalent(value)).filter(Boolean);
    if (fields.some((value) => value === q)) return 90;
    if (fields.some((value) => value.startsWith(q))) return 70;
    if (fields.some((value) => value.includes(q))) return 50;
    if (fields.some((value) => q.includes(value))) return 30;
    return 0;
  }

  countMatches(content, query) {
    const text = this.normalize(content);
    const term = this.normalize(query);
    if (!term) return 0;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordLike = /^[A-Za-z0-9_.]+$/.test(term);
    const pattern = wordLike ? `(?<![A-Za-z0-9_.])${escaped}(?![A-Za-z0-9_.])` : escaped;
    try { return (text.match(new RegExp(pattern, "g")) || []).length; }
    catch (_) { return text.split(term).length - 1; }
  }

  makeResult(entry, count, matchType, score) {
    return {
      file: entry.file,
      path: entry.path,
      displayName: entry.title || entry.basename,
      module: entry.module,
      entryType: entry.entryType,
      summary: entry.summary,
      example: entry.example,
      count: Math.max(1, count),
      matchType,
      score
    };
  }

  compareResults(a, b, currentModule) {
    const current = (result) => currentModule && result.module === currentModule ? 1 : 0;
    return current(b) - current(a)
      || b.score - a.score
      || b.count - a.count
      || a.displayName.localeCompare(b.displayName, "zh-CN");
  }

  async searchGlossary(rawQuery) {
    const query = this.cleanSelection(rawQuery);
    if (!query) return;
    const results = this.searchService.search(query);
    await this.showSidebarResults(query, results);
  }

  quickSearchGlossary(rawQuery) {
    const query = this.cleanSelection(rawQuery);
    if (!query) return;
    const results = this.searchService.search(query);
    new QuickSearchModal(this, query, results).open();
  }

  async showSidebarResults(query, results) {
    const leaf = await this.getResultsLeaf();
    if (!leaf) {
      new Notice("无法打开左侧搜索视图");
      return;
    }
    const view = leaf.view;
    if (view instanceof SearchResultsView) view.setResults(query, results);
    this.app.workspace.revealLeaf(leaf);
  }

  async showTermInRightSidebar(file) {
    let leaf = this.app.workspace.getLeavesOfType(TERM_PREVIEW_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("无法打开右侧名词解释栏");
        return;
      }
      await leaf.setViewState({ type: TERM_PREVIEW_VIEW_TYPE, active: true });
    }
    if (leaf.view instanceof TermPreviewView) await leaf.view.setFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  async openOriginalInNewTab(file) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  scheduleCompactPopover(target, result) {
    clearTimeout(this.compactPopoverHideTimer);
    clearTimeout(this.compactPopoverTimer);
    this.compactPopoverTimer = setTimeout(() => this.showCompactPopover(target, result), 250);
  }

  scheduleHideCompactPopover() {
    clearTimeout(this.compactPopoverTimer);
    this.compactPopoverHideTimer = setTimeout(() => this.hideCompactPopover(), 120);
  }

  showCompactPopover(target, result) {
    this.hideCompactPopover();
    const card = document.body.createDiv({ cls: "sts-quick-hover" });
    card.createDiv({ text: result.displayName, cls: "sts-hover-title" });
    card.createDiv({ text: `${result.entryType}｜${result.module || "未标注模块"}`, cls: "sts-hover-meta" });
    card.createDiv({ text: result.summary || "暂无简短定义", cls: "sts-hover-summary" });
    if (result.example) card.createDiv({ text: `示例：${result.example}`, cls: "sts-hover-example" });
    const rect = target.getBoundingClientRect();
    const width = 300;
    const left = rect.right + 10 + width <= window.innerWidth ? rect.right + 10 : rect.left - width - 10;
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - card.offsetHeight - 8))}px`;
    this.compactPopover = card;
  }

  hideCompactPopover() {
    clearTimeout(this.compactPopoverTimer);
    clearTimeout(this.compactPopoverHideTimer);
    this.compactPopover?.remove();
    this.compactPopover = null;
  }

  async getResultsLeaf() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf) return leaf;
    leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    return leaf;
  }

  async openBuiltInSearch(query) {
    let leaf = this.app.workspace.getLeavesOfType("search")[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: "search", active: true });
    }
    if (typeof leaf.view?.setQuery === "function") leaf.view.setQuery(query);
    else if (typeof leaf.view?.setState === "function") await leaf.view.setState({ query }, { history: false });
    this.app.workspace.revealLeaf(leaf);
  }
};
