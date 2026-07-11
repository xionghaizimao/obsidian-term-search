# Obsidian Term Search

一个面向课程笔记与名词解释库的 Obsidian 插件。选中文字后，可通过右键菜单快速查找名词解释，并在侧栏中查看分组结果或完整词条。

## 功能

- 选中文字后右键搜索名词解释
- 左侧栏按精确词条、当前模块、其他模块、课程正文和低优先级文件分组
- 中央快速查找窗口，支持方向键、Enter、Esc 和 Ctrl+Enter
- 根据文件名、一级标题、`frontmatter.term` 与 `frontmatter.aliases` 匹配
- 自动识别当前课程模块
- 右侧固定预览完整 Markdown，不替换中央课程笔记
- 悬停显示紧凑摘要
- 支持中英文、代码符号、连字符归一化和大小写设置
- 启动时建立索引，文件变更时增量更新

## 右键菜单

- **在侧栏中搜索名词解释**：在左侧自定义视图中显示全部分组结果。
- **快速查找名词解释**：打开紧凑窗口，只显示名词解释候选。

普通单击结果会在右侧固定预览栏显示完整词条。双击或按 `Ctrl+Enter` 可在新标签页打开原始 Markdown 文件。

## 名词解释文件建议

插件会读取下列元数据：

```yaml
---
term: axis
aliases:
  - 轴
entry_type: Python 参数
module: 模块09
summary: 指定数组运算所沿用的维度。
example: axis=0 表示沿行方向聚合。
---
```

名词解释文件应放在路径中含有“名词解释”的目录内。当前模块按以下顺序识别：

1. 当前文件的 `frontmatter.module`
2. 当前文件路径中的“模块XX”
3. 当前文件名中的“模块XX”

## 手动安装

1. 下载 Release 中的 `main.js`、`manifest.json`。
2. 在 Obsidian 仓库中创建目录：
   `.obsidian/plugins/selected-text-search/`
3. 将两个文件放入该目录。
4. 重启 Obsidian。
5. 在“设置 → 第三方插件”中启用 **Selected Text Search**。

## 设置

- 搜索是否区分英文大小写
- 五个结果分组的默认展开或折叠状态

## 许可证

[MIT License](LICENSE)
