# Graph Report - tui  (2026-09-08)

## Corpus Check
- Corpus is ~728 words - fits in a single context window. You may not need a graph.

## Summary
- 21 nodes · 31 edges · 4 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App & Logging Helpers
- Bubbletea Update Loop
- Viewport Rendering
- Testing

## God Nodes (most connected - your core abstractions)
1. `model` - 8 edges
2. `tick()` - 5 edges
3. `initialModel()` - 4 edges
4. `TestMockStreamRenders()` - 4 edges
5. `tickMsg` - 3 edges
6. `formatLog()` - 3 edges
7. `colorizeLine()` - 2 edges
8. `main()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `TestMockStreamRenders()` --calls--> `initialModel()`  [INFERRED]
  main_test.go → main.go
- `TestMockStreamRenders()` --calls--> `tickMsg`  [INFERRED]
  main_test.go → main.go

## Import Cycles
- None detected.

## Communities (4 total, 0 thin omitted)

### Community 0 - "App & Logging Helpers"
Cohesion: 0.38
Nodes (4): colorizeLine(), formatLog(), initialModel(), main()

### Community 1 - "Bubbletea Update Loop"
Cohesion: 0.47
Nodes (4): github.com/charmbracelet/bubbletea.Cmd, github.com/charmbracelet/bubbletea.Model, github.com/charmbracelet/bubbletea.Msg, tick()

### Community 2 - "Viewport Rendering"
Cohesion: 0.50
Nodes (3): github.com/charmbracelet/bubbles/viewport.Model, time.Time, model

### Community 3 - "Testing"
Cohesion: 0.50
Nodes (3): testing.T, TestMockStreamRenders(), tickMsg

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `model` connect `Viewport Rendering` to `App & Logging Helpers`, `Bubbletea Update Loop`?**
  _High betweenness centrality (0.429) - this node is a cross-community bridge._
- **Why does `TestMockStreamRenders()` connect `Testing` to `App & Logging Helpers`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **Why does `initialModel()` connect `App & Logging Helpers` to `Viewport Rendering`, `Testing`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `TestMockStreamRenders()` (e.g. with `initialModel()` and `tickMsg`) actually correct?**
  _`TestMockStreamRenders()` has 2 INFERRED edges - model-reasoned connections that need verification._