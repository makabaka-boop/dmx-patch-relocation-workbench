import { ChangeEvent, useState } from "react";
import {
  ConflictGroup,
  Fixture,
  INVALID_PATCH,
  MAX_CHANNEL,
  MAX_UNIVERSE,
  MIN_UNIVERSE,
  PatchEngine,
  TrialResult,
  endOf,
  parsePatch,
} from "./lib/dmx";

interface Notice {
  kind: "ok" | "warn" | "error";
  text: string;
}

/** 确定性演示补丁：链式组、端点相接、嵌套、孤立灯具各若干。 */
function demoPatch(): Fixture[] {
  const fixtures: Fixture[] = [];
  let n = 0;
  const add = (universe: number, start: number, footprint: number) => {
    n += 1;
    fixtures.push({
      id: `demo-${String(n).padStart(3, "0")}`,
      universe,
      start,
      footprint,
    });
  };
  add(1, 1, 10); // [1,10]  ─┐
  add(1, 5, 11); // [5,15]   ├ 链式冲突组
  add(1, 12, 9); // [12,20] ─┘
  add(2, 10, 6); // [10,15] ─┐ 端点相接于 15
  add(2, 15, 5); // [15,19] ─┘
  add(3, 1, 512); // [1,512] ─┐
  add(3, 100, 100); // [100,199] ├ 嵌套冲突组
  add(3, 120, 20); // [120,139] ─┘
  add(4, 1, 1); // 孤立
  add(4, 100, 10); // 孤立
  add(5, 200, 50); // 孤立
  return fixtures;
}

function IdList({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  if (ids.length === 0) return <p className="muted">（空）</p>;
  return (
    <div className="chips">
      {ids.map((id) => (
        <button key={id} className="chip" onClick={() => onSelect(id)}>
          {id}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [engine, setEngine] = useState<PatchEngine | null>(null);
  const [groups, setGroups] = useState<ConflictGroup[]>([]);
  const [fixtureCount, setFixtureCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uniInput, setUniInput] = useState("1");
  const [startInput, setStartInput] = useState("1");
  const [trial, setTrial] = useState<TrialResult | null>(null);
  const [lookup, setLookup] = useState("");
  const [cap, setCap] = useState(200);

  const selected: Fixture | null =
    engine && selectedId ? engine.getFixture(selectedId) ?? null : null;

  function loadPatch(fixtures: Fixture[]) {
    const eng = new PatchEngine(fixtures);
    const g = eng.getGroups();
    setEngine(eng);
    setGroups(g);
    setFixtureCount(eng.size);
    setImportError(null);
    setNotice({ kind: "ok", text: `已导入 ${eng.size} 具灯具，检出 ${g.length} 个冲突组。` });
    setSelectedId(null);
    setTrial(null);
    setLookup("");
    setCap(200);
  }

  function failImport() {
    // 契约：非法补丁显示 INVALID_PATCH 并保留旧补丁（不清空 engine/groups）
    setImportError(INVALID_PATCH);
    setNotice(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parsePatch(JSON.parse(await file.text()));
      if (!parsed) {
        failImport();
        return;
      }
      loadPatch(parsed);
    } catch {
      failImport();
    }
  }

  function selectFixture(id: string) {
    if (!engine) return;
    const f = engine.getFixture(id);
    if (!f) {
      setNotice({ kind: "warn", text: `未找到灯具 “${id}”。` });
      return;
    }
    setSelectedId(id);
    setUniInput(String(f.universe));
    setStartInput(String(f.start));
    // 选中即在当前位置试移一次，直接展示原位冲突
    setTrial(engine.trialMove(id, f.universe, f.start));
    setNotice(null);
  }

  function runTrial() {
    if (!engine || !selectedId) return;
    const r = engine.trialMove(selectedId, Number(uniInput), Number(startInput));
    if (!r) {
      setTrial(null);
      setNotice({
        kind: "error",
        text: `输入不合法：universe 须为 ${MIN_UNIVERSE}–${MAX_UNIVERSE} 的整数，start 须为 1–${MAX_CHANNEL} 的整数且 start+footprint ≤ 513。`,
      });
      return;
    }
    setTrial(r);
    setNotice(null);
  }

  function commitTrial() {
    if (!engine || !selectedId || !trial || !trial.canCommit) return;
    const r = engine.commit(selectedId, trial.targetUniverse, trial.targetStart);
    if (!r || !r.canCommit) {
      setNotice({ kind: "warn", text: "目标位存在冲突，提交被拒绝，补丁保持不变。" });
      return;
    }
    setGroups(engine.getGroups());
    setUniInput(String(r.targetUniverse));
    setStartInput(String(r.targetStart));
    setTrial(engine.trialMove(selectedId, r.targetUniverse, r.targetStart));
    setNotice({
      kind: "ok",
      text: `已提交：${selectedId} → universe ${r.targetUniverse} 起始 ${r.targetStart}，冲突组已重算。`,
    });
  }

  return (
    <div className="app">
      <header className="top">
        <h1>DMX 补丁冲突台</h1>
        <div className="actions">
          <label className="file-btn">
            导入 JSON 补丁
            <input type="file" accept="application/json,.json" onChange={onFile} hidden />
          </label>
          <button onClick={() => loadPatch(demoPatch())}>载入演示补丁</button>
        </div>
        <p className="stats">
          {engine
            ? `${fixtureCount} 具灯具 · ${groups.length} 个冲突组`
            : "空补丁台 — 请导入 1–200000 项的 JSON 数组"}
        </p>
      </header>

      {importError ? (
        <div className="banner error" role="alert">
          {importError} — 导入被拒绝，已保留旧补丁。
        </div>
      ) : null}
      {notice ? <div className={`banner ${notice.kind}`}>{notice.text}</div> : null}

      <main className="layout">
        <section className="panel">
          <h2>冲突组（{groups.length}）</h2>
          {groups.length === 0 ? (
            <p className="muted">{engine ? "无冲突。" : "尚未导入补丁。"}</p>
          ) : null}
          <ol className="group-list">
            {groups.slice(0, cap).map((g) => (
              <li key={`${g.universe}:${g.minStart}:${g.ids[0]}`} className="group">
                <header>
                  universe {g.universe} · 起始 {g.minStart} · {g.ids.length} 具
                </header>
                <div className="chips">
                  {g.ids.map((id) => (
                    <button
                      key={id}
                      className={id === selectedId ? "chip selected" : "chip"}
                      onClick={() => selectFixture(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {groups.length > cap ? (
            <button className="more" onClick={() => setCap((c) => c * 5)}>
              显示更多（{Math.min(cap, groups.length)} / {groups.length}）
            </button>
          ) : null}
        </section>

        <section className="panel">
          <h2>试移灯具</h2>
          <div className="lookup">
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="按 id 查找灯具"
            />
            <button onClick={() => selectFixture(lookup.trim())} disabled={!engine}>
              选择
            </button>
          </div>
          {selected ? (
            <>
              <dl className="fixture">
                <div>
                  <dt>id</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>universe</dt>
                  <dd>{selected.universe}</dd>
                </div>
                <div>
                  <dt>start</dt>
                  <dd>{selected.start}</dd>
                </div>
                <div>
                  <dt>footprint</dt>
                  <dd>{selected.footprint}</dd>
                </div>
                <div>
                  <dt>占用区间</dt>
                  <dd>
                    [{selected.start}, {endOf(selected)}]
                  </dd>
                </div>
              </dl>
              <div className="inputs">
                <label>
                  新 universe（{MIN_UNIVERSE}–{MAX_UNIVERSE}）
                  <input
                    value={uniInput}
                    inputMode="numeric"
                    onChange={(e) => {
                      setUniInput(e.target.value);
                      setTrial(null);
                    }}
                  />
                </label>
                <label>
                  新 start（1–{MAX_CHANNEL + 1 - selected.footprint}）
                  <input
                    value={startInput}
                    inputMode="numeric"
                    onChange={(e) => {
                      setStartInput(e.target.value);
                      setTrial(null);
                    }}
                  />
                </label>
                <button onClick={runTrial}>试移</button>
              </div>
              {trial ? (
                <div className="trial">
                  <div className="lists">
                    <div>
                      <h3>原位直接冲突（{trial.origin.length}）</h3>
                      <IdList ids={trial.origin} onSelect={selectFixture} />
                    </div>
                    <div>
                      <h3>目标位直接冲突（{trial.target.length}）</h3>
                      <IdList ids={trial.target} onSelect={selectFixture} />
                    </div>
                  </div>
                  {trial.canCommit ? (
                    <>
                      <p className="ok-text">目标位无冲突，可提交。</p>
                      <button className="commit" onClick={commitTrial}>
                        提交移动
                      </button>
                    </>
                  ) : (
                    <p className="warn-text">
                      目标位被 {trial.target.length} 具灯具阻挡，提交已禁止，补丁保持不变。
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">调整目标后点击“试移”。</p>
              )}
            </>
          ) : (
            <p className="muted">
              {engine ? "从冲突组或查找框选择一具灯具。" : "请先导入补丁。"}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
