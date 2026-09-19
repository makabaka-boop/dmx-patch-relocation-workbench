# DMX 补丁冲突台

巡演换台前的灯光补丁工具：导入本地 DMX 补丁（JSON），全网核验冲突并分组，对单具灯具做**试移**（trial move），目标位无冲突时才提交并重算。

技术栈：React + TypeScript + Vite，纯前端，**不调用任何外部服务**。核心逻辑在 `src/lib/dmx.ts`，UI 与验收测试共用同一实现。

## 快速开始

```bash
npm ci
npm run dev       # 本地开发
npm run verify    # Vitest 验收（含 20 万灯具性能用例）
npm run build     # 类型检查 + 静态构建到 dist/
```

## Docker

```bash
# 发布 web（默认 8080，WEB_PORT 可覆盖）
docker compose up --build web
WEB_PORT=9000 docker compose up --build web

# 验收服务：构建镜像并运行 Vitest，失败即非零退出
docker compose run --rm verify
```

`web` 为 nginx 静态站点（`Dockerfile` 多阶段构建）；`verify` 在同一仓库依赖上执行 `npm run verify`。

## 数据契约

### 导入补丁

请求体为一个 JSON 数组，**1–200000 项**，每项：

| 字段 | 约束 |
| --- | --- |
| `id` | 1–32 位可打印 ASCII（U+0020–U+007E），全补丁唯一 |
| `universe` | 整数，1–32768 |
| `start` | 整数，1–512 |
| `footprint` | 整数，1–512，且 `start + footprint ≤ 513` |

灯具占用通道为**闭区间** `[start, start + footprint − 1]`。

任何一项非法（含 JSON 解析失败、非数组、空数组、超上限、id 重复），导入整体拒绝：界面显示 **`INVALID_PATCH`**，**保留旧补丁**不变。合法导入则整体替换旧补丁。

### 冲突与分组

- 两灯具**冲突** ⟺ 同 `universe` 且闭区间相交（端点相接即相交）。
- 全网核验把相交关系的**连通分量**列为组；仅列出 **≥2 具**灯具的组（孤立灯具无冲突，不成组）。
- 组内 `id` 按 **UTF-8 字节序**排列（注意：与 JS 默认 UTF-16 码元序不同）。
- 组排序：`universe` 升序 → 组内最小 `start` 升序 → 组内首 `id` 的 UTF-8 字节序。

### 试移与提交

1. 选定灯具，输入合法的新 `universe`（1–32768）与 `start`（1–512 且 `start + footprint ≤ 513`，`footprint` 不变）。
2. 试移分别列出**原位**与**目标位**的直接冲突 `id`（各按 UTF-8 字节序；不计灯具自身）。
3. **仅当目标位列表为空**才可提交；提交后立即重算冲突组（移出/移入的 universe 各自重扫，组可能被拆开）。
4. 目标位非空时提交被拒绝，**补丁保持不变**；原位列表仍可见当前阻挡的灯具。

### 性能契约

20 万具灯具的全网核验 + 2000 次试移（含可提交时的提交与重算）须在 **4 秒**内完成；验收场景中试移命中（原位+目标位列表长度之和）总数 **≤ 10000**。实现上：按 universe 分桶有序数组 + 二分定位相交窗口，试移复杂度 O(log n + 命中数)；提交仅重算受影响 universe 的分组。验收用例同时断言增量结果与全量重算一致。

## 验收测试

`npm run verify`（Vitest）覆盖：

- **朴素两两预言机**：随机补丁与随机试移/提交序列下，扫描式分组与增量引擎结果逐一对比 O(n²) 并查集预言机。
- **端点相接**（含通道 512 边界）、**嵌套**区间、**组拆分**（移走桥接灯具后组被拆开）等显式用例。
- 校验边界：id 长度/字符集、universe/start/footprint 边界、`start + footprint = 513`、200000/200001 项。
- 性能契约用例（固定种子，确定性）。

## 项目结构

```
src/lib/dmx.ts        核心：校验、UTF-8 字节序、分组扫描、试移/提交引擎
src/lib/dmx.test.ts   单元 + 朴素两两预言机测试
src/lib/perf.test.ts  20 万灯具性能验收
src/App.tsx           界面：导入、冲突组、试移/提交
Dockerfile            deps → verify / build → web（nginx）
docker-compose.yml    web（WEB_PORT 可覆盖）+ verify 验收服务
```
