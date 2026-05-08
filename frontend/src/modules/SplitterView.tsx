import { CheckCircle2, Database, FileText, FolderOpen, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { AppSettingsPayload, SplitJob, SplitPlan, SplitReport, ValidationReport } from "../types";

const defaultPaths = {
  manifestPath: String.raw`D:\Programming\School Projects\CambridgeProjects\ExamGenerator\data\past_paper_info.xlsx`,
  sourceRoot: String.raw`D:\Programming\School Projects\CambridgeProjects\ExamGenerator\source_papers\9702`,
  outputRoot: String.raw`D:\Programming\School Projects\CambridgeProjects\TeacherDesk\local_library`,
};
export function SplitterView() {
  const [manifestPath, setManifestPath] = useState(defaultPaths.manifestPath);
  const [sourceRoot, setSourceRoot] = useState(defaultPaths.sourceRoot);
  const [outputRoot, setOutputRoot] = useState(defaultPaths.outputRoot);
  const [existingPdfStrategy, setExistingPdfStrategy] = useState<"skip" | "overwrite">("skip");
  const [changedPageStrategy, setChangedPageStrategy] = useState<"flag" | "overwrite" | "keep_both">("flag");
  const [metadataStrategy, setMetadataStrategy] = useState<"update" | "keep">("update");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [splitPlan, setSplitPlan] = useState<SplitPlan | null>(null);
  const [splitReport, setSplitReport] = useState<SplitReport | null>(null);
  const [splitJob, setSplitJob] = useState<SplitJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planSearch, setPlanSearch] = useState("");
  const [previewIsStale, setPreviewIsStale] = useState(false);
  const [splitterModal, setSplitterModal] = useState<"plan" | "notes" | null>(null);

  const isSplitting = splitJob?.status === "queued" || splitJob?.status === "running";
  const hasSplitStarted = Boolean(splitJob);
  const canStartSplit = Boolean(splitPlan?.ok && !previewIsStale && !isLoading && !isSplitting);
  const progressPercent =
    splitJob?.progress.total_files ? Math.round((splitJob.progress.processed_files / splitJob.progress.total_files) * 100) : 0;

  useEffect(() => {
    async function loadSplitterSettings() {
      const response = await fetch(`${API_BASE}/api/libraries/settings/`);
      const payload = await readJson<AppSettingsPayload>(response);
      if (payload.default_manifest_path) setManifestPath(payload.default_manifest_path);
      if (payload.default_source_root) setSourceRoot(payload.default_source_root);
      if (payload.default_output_root) setOutputRoot(payload.default_output_root);
      setExistingPdfStrategy(payload.app_preferences.splitter.existing_pdf_strategy);
      setChangedPageStrategy(payload.app_preferences.splitter.changed_page_strategy);
      setMetadataStrategy(payload.app_preferences.splitter.metadata_strategy);
    }
    loadSplitterSettings().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!splitJob || (splitJob.status !== "queued" && splitJob.status !== "running")) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/splitter/split-jobs/${splitJob.id}/`);
        if (!response.ok) {
          throw new Error(`Progress check failed with HTTP ${response.status}`);
        }
        const nextJob = await readJson<SplitJob>(response);
        setSplitJob(nextJob);
        if (nextJob.result) {
          setSplitReport(nextJob.result);
          setReport(nextJob.result.validation);
        }
        if (nextJob.error) {
          setError(nextJob.error);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not read split progress.");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [splitJob]);

  function pathParams() {
    const params = new URLSearchParams({
      manifest_path: manifestPath,
      source_root: sourceRoot,
      output_root: outputRoot,
      existing_pdf_strategy: existingPdfStrategy,
      changed_page_strategy: changedPageStrategy,
      metadata_strategy: metadataStrategy,
    });
    return params.toString();
  }

  function clearPreview() {
    setSplitReport(null);
    setSplitJob(null);
    if (report || splitPlan) {
      setPreviewIsStale(true);
    }
  }

  async function checkAndPreview() {
    setIsLoading(true);
    setError(null);
    setSplitReport(null);
    setSplitJob(null);

    try {
      const response = await fetch(`${API_BASE}/api/splitter/plan-split/?${pathParams()}`);
      if (!response.ok) {
        throw new Error(`Plan failed with HTTP ${response.status}`);
      }
      const nextPlan = await readJson<SplitPlan>(response);
      setSplitPlan(nextPlan);
      setReport(nextPlan.validation);
      setPreviewIsStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build split plan.");
    } finally {
      setIsLoading(false);
    }
  }

  async function startImportAndSplit() {
    setError(null);
    setSplitReport(null);

    try {
      const response = await fetch(`${API_BASE}/api/splitter/split-jobs/start/?${pathParams()}`);
      if (!response.ok) {
        throw new Error(`Split start failed with HTTP ${response.status}`);
      }
      setSplitJob(await readJson<SplitJob>(response));
      setPreviewIsStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import and split manifest.");
    }
  }

  async function browseManifest() {
    setError(null);
    const initialDir = manifestPath.split("\\").slice(0, -1).join("\\");
    try {
      const response = await fetch(`${API_BASE}/api/splitter/browse/manifest/?initial_dir=${encodeURIComponent(initialDir)}`);
      if (!response.ok) {
        throw new Error(`Browse failed with HTTP ${response.status}`);
      }
      const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
      if (!result.cancelled) {
        setManifestPath(result.selected_path);
        clearPreview();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open file dialog.");
    }
  }

  async function browseFolder(kind: "source" | "output") {
    setError(null);
    const currentPath = kind === "source" ? sourceRoot : outputRoot;
    const title = kind === "source" ? "Select source PDF folder" : "Select output library folder";
    try {
      const response = await fetch(
        `${API_BASE}/api/splitter/browse/folder/?initial_dir=${encodeURIComponent(currentPath)}&title=${encodeURIComponent(title)}`,
      );
      if (!response.ok) {
        throw new Error(`Browse failed with HTTP ${response.status}`);
      }
      const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
      if (!result.cancelled) {
        if (kind === "source") {
          setSourceRoot(result.selected_path);
        } else {
          setOutputRoot(result.selected_path);
        }
        clearPreview();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open folder dialog.");
    }
  }

  async function openSplitOutputFolder() {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/splitter/open-output-folder/?output_root=${encodeURIComponent(outputRoot)}`);
      const result = await readJson<{ ok: boolean; error?: string }>(response);
      if (!result.ok) {
        setError(result.error ?? "Could not open output folder.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open output folder.");
    }
  }

  const issues = report?.issues ?? [];
  const sortedIssues = [...issues].sort((first, second) => {
    const severityRank: Record<ValidationReport["issues"][number]["severity"], number> = { error: 0, warning: 1, info: 2 };
    const firstRank = severityRank[first.severity] ?? 3;
    const secondRank = severityRank[second.severity] ?? 3;
    if (firstRank !== secondRank) return firstRank - secondRank;
    return (first.row ?? 999999) - (second.row ?? 999999);
  });
  const plannedItems = splitPlan?.items ?? [];
  const visiblePlanItems = plannedItems.filter((item) => {
    const query = planSearch.trim().toLowerCase();
    if (!query) return true;
    return `${item.exam_code} ${item.paper} Q${item.question_number} ${item.qp_action} ${item.ms_action}`.toLowerCase().includes(query);
  });
  const sourcePdfCount = splitPlan ? Math.ceil(splitPlan.summary.files_total / 2) : 0;
  const manifestRows = report?.summary.rows ?? splitPlan?.summary.records ?? 0;
  const filesToProcess = splitPlan ? splitPlan.summary.files_to_create + splitPlan.summary.files_to_overwrite + splitPlan.summary.files_to_version : 0;
  const reviewItems = report?.summary.review_required_items ?? splitPlan?.summary.review_required_items ?? 0;
  const splitActionSummary = splitPlan
    ? [
        `${splitPlan.summary.files_to_create} create`,
        `${splitPlan.summary.files_to_overwrite} overwrite`,
        `${splitPlan.summary.files_to_version} version`,
        `${splitPlan.summary.files_to_skip_existing} skip`,
      ].join(", ")
    : "Create/overwrite/version";
  const existingPdfMessage = existingPdfStrategy === "overwrite" ? "Existing PDFs will be overwritten." : "Existing PDFs will be skipped.";
  const previewMetrics = splitPlan
    ? [
        { label: "Records", value: splitPlan.summary.records, tone: "neutral" as const },
        { label: "Files total", value: splitPlan.summary.files_total, tone: "neutral" as const },
        { label: "To process", value: filesToProcess, tone: filesToProcess ? "good" as const : "neutral" as const },
        { label: "Skip existing", value: splitPlan.summary.files_to_skip_existing, tone: splitPlan.summary.files_to_skip_existing ? "warn" as const : "neutral" as const },
        { label: "Review items", value: splitPlan.summary.review_required_items, tone: splitPlan.summary.review_required_items ? "warn" as const : "neutral" as const },
        { label: "Page changes", value: splitPlan.summary.page_range_changes, tone: splitPlan.summary.page_range_changes ? "warn" as const : "neutral" as const },
      ]
    : [];
  const validationMetrics = report
    ? [
        { label: "Rows read", value: report.summary.rows, tone: "neutral" as const },
        { label: "Errors", value: report.summary.errors, tone: report.summary.errors ? "bad" as const : "good" as const },
        { label: "Warnings", value: report.summary.warnings, tone: report.summary.warnings ? "warn" as const : "neutral" as const },
      ]
    : [];

  return (
    <>
      <section className="content-header splitter-header">
        <div>
          <h1>Splitter</h1>
          <span className="header-subtitle">Split source papers into question bank PDFs</span>
        </div>
      </section>

      <section className="splitter-workspace">
        <div className="splitter-stats-row">
          <SplitterStat icon={FileText} label="Manifest rows" value={manifestRows} caption={manifestRows ? "Rows read from Excel" : "Run Check & preview"} stale={previewIsStale} />
          <SplitterStat icon={FolderOpen} label="Source PDFs in plan" value={sourcePdfCount} caption={sourcePdfCount ? "QP/MS source files referenced" : "Run Check & preview"} tone="blue" stale={previewIsStale} />
          <SplitterStat icon={Database} label="Files to process" value={filesToProcess} caption={splitActionSummary} stale={previewIsStale} />
          <SplitterStat icon={TriangleAlert} label="Review required" value={reviewItems} caption={reviewItems ? "QP/MS items marked for review" : "No preview yet"} tone="warning" stale={previewIsStale} />
        </div>

        <section className="splitter-setup-panel">
          <div className="panel-title">
            <div>
              <strong>Split setup</strong>
              <span>Select the manifest, source PDFs, and output question bank folder.</span>
            </div>
          </div>

          <div className="splitter-paths">
            <label>
              <span>Manifest file</span>
              <div className="path-control">
                <input
                  value={manifestPath}
                  onChange={(event) => {
                    setManifestPath(event.target.value);
                    clearPreview();
                  }}
                />
                <button className="secondary-action" onClick={browseManifest}>
                  Browse
                </button>
              </div>
            </label>
            <label>
              <span>Source papers folder</span>
              <div className="path-control">
                <input
                  value={sourceRoot}
                  onChange={(event) => {
                    setSourceRoot(event.target.value);
                    clearPreview();
                  }}
                />
                <button className="secondary-action" onClick={() => browseFolder("source")}>
                  Browse
                </button>
              </div>
            </label>
            <label>
              <span>Output question bank folder</span>
              <div className="path-control">
                <input
                  value={outputRoot}
                  onChange={(event) => {
                    setOutputRoot(event.target.value);
                    clearPreview();
                  }}
                />
                <button className="secondary-action" onClick={() => browseFolder("output")}>
                  Browse
                </button>
              </div>
            </label>
          </div>

          <div className="split-behavior-panel">
            <strong>Split behavior settings</strong>
            <div className="split-behavior-grid">
              <div className="split-behavior-item">
              <div>
                  <span>When existing PDFs are found</span>
              </div>
              <div className="choice-toggle">
                <button className={existingPdfStrategy === "skip" ? "selected" : ""} onClick={() => { setExistingPdfStrategy("skip"); clearPreview(); }}>
                    Skip existing
                </button>
                <button className={existingPdfStrategy === "overwrite" ? "selected" : ""} onClick={() => { setExistingPdfStrategy("overwrite"); clearPreview(); }}>
                  Overwrite
                </button>
              </div>
                <p>Existing split PDFs are not overwritten when skip is selected.</p>
            </div>

              <div className="split-behavior-item">
              <div>
                  <span>If page numbers changed</span>
              </div>
              <div className="choice-toggle wide">
                <button className={changedPageStrategy === "flag" ? "selected" : ""} onClick={() => { setChangedPageStrategy("flag"); clearPreview(); }}>
                    Flag review
                </button>
                <button className={changedPageStrategy === "overwrite" ? "selected" : ""} onClick={() => { setChangedPageStrategy("overwrite"); clearPreview(); }}>
                  Regenerate
                </button>
                <button className={changedPageStrategy === "keep_both" ? "selected" : ""} onClick={() => { setChangedPageStrategy("keep_both"); clearPreview(); }}>
                  Keep both
                </button>
              </div>
                <p>Changed page ranges can be flagged, regenerated, or versioned.</p>
            </div>

              <div className="split-behavior-item">
              <div>
                  <span>Question metadata</span>
              </div>
              <div className="choice-toggle">
                <button className={metadataStrategy === "update" ? "selected" : ""} onClick={() => { setMetadataStrategy("update"); clearPreview(); }}>
                    Update from manifest
                </button>
                <button className={metadataStrategy === "keep" ? "selected" : ""} onClick={() => { setMetadataStrategy("keep"); clearPreview(); }}>
                    Keep existing
                </button>
              </div>
                <p>Updates marks, topics, page ranges, and review flags.</p>
              </div>
            </div>
          </div>
        </section>

        <aside className="splitter-progress-panel">
          <div className="panel-title">
            <div>
              <strong>Validation and progress</strong>
              <span>{splitPlan ? "Preview ready" : splitJob ? `Split job ${splitJob.status}` : "Ready for validation"}</span>
            </div>
          </div>
          <div className="splitter-action-row">
            <button className="secondary-action" onClick={checkAndPreview} disabled={isLoading || isSplitting}>
              <RefreshCw size={15} />
              {isLoading ? "Checking..." : "Check & preview"}
            </button>
            <button className="primary-action" onClick={startImportAndSplit} disabled={!canStartSplit}>
              <FolderOpen size={15} />
              {isSplitting ? "Splitting..." : "Start splitting"}
            </button>
          </div>
          {error ? <div className="callout error">{error}</div> : null}

          {isLoading ? (
            <div className="progress-card checking">
              <div className="progress-head">
                <strong>Checking manifest and source files</strong>
                <span>Working...</span>
              </div>
              <div className="progress-track indeterminate">
                <div />
              </div>
              <div className="progress-details">
                <span>Reading rows, checking page ranges, and building the split plan.</span>
              </div>
            </div>
          ) : splitJob ? (
            <div className="progress-card">
              <div className="progress-head">
                <strong>Split job: {splitJob.status}</strong>
                <span>{progressPercent}%</span>
              </div>
              <div className="progress-track">
                <div style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progress-details">
                <span>
                  {splitJob.progress.processed_files} / {splitJob.progress.total_files || "..."} files processed
                </span>
                <span>
                  QP {splitJob.progress.split_question_pdfs} / MS {splitJob.progress.split_markscheme_pdfs} / skipped{" "}
                  {splitJob.progress.skipped_existing_files}
                </span>
              </div>
              {splitJob.progress.current.output ? <p className="path-note">{splitJob.progress.current.output}</p> : null}
            </div>
          ) : (
            <div className="progress-card idle">
              <div className="progress-head">
                <strong>{splitPlan ? "Ready to split" : "Waiting for preview"}</strong>
                <span>{splitPlan ? "Not started" : "0%"}</span>
              </div>
              <div className="progress-track">
                <div style={{ width: "0%" }} />
              </div>
              <div className="progress-details">
                <span>{splitPlan ? `${splitPlan.summary.files_total} files planned` : "No plan built yet"}</span>
                <span>{splitPlan ? splitActionSummary : "Click Check & preview"}</span>
              </div>
            </div>
          )}

          {previewIsStale && splitPlan && !hasSplitStarted ? (
            <div className="split-result stale-preview">
              <strong>Preview needs refresh</strong>
              <p className="strategy-note">A path or split behavior setting changed. Click Check & preview to rebuild the plan before splitting.</p>
              <button className="primary-action" onClick={checkAndPreview} disabled={isLoading || isSplitting}>
                <RefreshCw size={15} />
                Refresh preview
              </button>
            </div>
          ) : splitPlan && !hasSplitStarted ? (
            <div className={splitPlan.ok ? "split-result success" : "split-result warning"}>
              <strong>Preview ready</strong>
              <p className="strategy-note">Split plan built. {existingPdfMessage}</p>
              <div className="metric-grid compact-metrics">
                {previewMetrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />)}
              </div>
              <p className="path-note">{splitPlan.summary.library_root}</p>
            </div>
          ) : null}

          {report && !hasSplitStarted && !previewIsStale ? (
            <>
              <div className="metric-grid">
                {validationMetrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />)}
              </div>

              <div className={report.ok ? "callout success" : "callout warning"}>
                {report.ok
                  ? "Validation passed. You can now import and split this manifest."
                  : "Validation found errors. Fix these before splitting so the app does not create broken files."}
              </div>

            </>
          ) : !hasSplitStarted ? (
            <div className="empty-state">
              <Database size={28} />
              <strong>No preview yet</strong>
              <span>Choose your files and split behavior, then click Check & preview.</span>
            </div>
          ) : null}

          {splitReport ? (
            <div className={splitReport.ok ? "split-result success" : "split-result warning"}>
              <strong>{splitReport.message}</strong>
              <div className="metric-grid compact-metrics">
                <Metric label="Created records" value={splitReport.summary.created_questions} />
                <Metric label="Updated records" value={splitReport.summary.updated_questions} />
                <Metric label="QP PDFs" value={splitReport.summary.split_question_pdfs} />
                <Metric label="MS PDFs" value={splitReport.summary.split_markscheme_pdfs} />
                <Metric label="Skipped existing" value={splitReport.summary.skipped_existing_files} />
                <Metric label="Review items" value={splitReport.summary.review_required_items} tone="warn" />
              </div>
              <p className="path-note">{splitReport.summary.library_root}</p>
              <button className="secondary-action split-open-folder" onClick={openSplitOutputFolder}>
                <FolderOpen size={15} />
                Open output folder
              </button>
            </div>
          ) : null}
        </aside>

        <section className="splitter-plan-panel">
          <div className="panel-title">
            <div>
              <strong>Planned split output</strong>
              <span>
                {previewIsStale && plannedItems.length
                  ? `Previous plan - refresh required (${visiblePlanItems.length} of ${plannedItems.length} files)`
                  : plannedItems.length
                    ? `${visiblePlanItems.length} of ${plannedItems.length} files`
                    : "Run Check & preview to build the plan"}
              </span>
            </div>
            <div className="splitter-table-actions">
              <label className="table-search compact-search">
                <Search size={14} />
                <input value={planSearch} onChange={(event) => setPlanSearch(event.target.value)} placeholder="Search in plan..." />
              </label>
            </div>
          </div>

          <div className="splitter-plan-brief">
            <div>
              <strong>Plan summary</strong>
              <span>
                {plannedItems.length
                  ? `${plannedItems.length} planned QP/MS actions. ${filesToProcess} will be processed and ${splitPlan?.summary.files_to_skip_existing ?? 0} skipped.`
                  : "No plan has been built yet."}
              </span>
              <button className="dashboard-link" disabled={!plannedItems.length} onClick={() => setSplitterModal("plan")}>See full plan</button>
            </div>
            <div>
              <strong>Important notes</strong>
              <span>
                {previewIsStale
                  ? "The plan is from previous settings. Refresh preview before splitting."
                  : issues.length
                    ? `${issues.length} validation or review note${issues.length === 1 ? "" : "s"} found.`
                    : plannedItems.length
                      ? "No blocking validation notes."
                      : "Run Check & preview to build the plan."}
              </span>
              <button className="dashboard-link" disabled={!issues.length && !previewIsStale} onClick={() => setSplitterModal("notes")}>See all notes</button>
            </div>
          </div>

          {!plannedItems.length ? (
            <div className="empty-state compact">
              <Database size={24} />
              <strong>No split plan yet</strong>
              <span>Choose files and click Check & preview.</span>
            </div>
          ) : null}
        </section>
      </section>

      {splitterModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="splitter-modal">
            <div className="modal-head">
              <div>
                <strong>{splitterModal === "plan" ? "Full split plan" : "Validation and review notes"}</strong>
                <span>{splitterModal === "plan" ? `${visiblePlanItems.length} visible / ${plannedItems.length} planned` : `${sortedIssues.length} notes`}</span>
              </div>
              <button className="icon-button" onClick={() => setSplitterModal(null)}>x</button>
            </div>
            {splitterModal === "plan" ? (
              <div className="modal-plan-list">
                {visiblePlanItems.map((item) => (
                  <div className="plan-card-row" key={`modal-${item.exam_code}-${item.question_number}`}>
                    <div>
                      <strong>{item.paper} Q{item.question_number}</strong>
                      <span className="mono">{item.exam_code}</span>
                    </div>
                    <div>
                      <span>Question PDF</span>
                      <b className={actionClass(item.qp_action)}>{formatAction(item.qp_action)}</b>
                    </div>
                    <div>
                      <span>Mark scheme</span>
                      <b className={actionClass(item.ms_action)}>{formatAction(item.ms_action)}</b>
                    </div>
                    <div>
                      <span>Review</span>
                      {item.qp_review_required || item.ms_review_required ? <b className="mini-status warn">Needed</b> : <b className="mini-status">Not needed</b>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="modal-issue-list">
                {previewIsStale ? (
                  <div className="issue issue-warning">
                    <div><strong>Preview needs refresh</strong><span>Settings changed</span></div>
                    <p>A path or split behavior setting changed. Run Check & preview again before splitting.</p>
                  </div>
                ) : null}
                {sortedIssues.length ? sortedIssues.map((issue, index) => (
                  <div className={`issue issue-${issue.severity}`} key={`modal-${issue.row}-${issue.exam_code}-${index}`}>
                    <div>
                      <strong>{issue.severity}</strong>
                      <span>Row {issue.row ?? "-"} {issue.exam_code ? `- ${issue.exam_code}` : ""}</span>
                    </div>
                    <p>{issue.message}</p>
                  </div>
                )) : !previewIsStale ? (
                  <div className="empty-state compact">
                    <CheckCircle2 size={24} />
                    <strong>No notes</strong>
                    <span>No validation or review notes are available for this plan.</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SplitterStat({ icon: Icon, label, value, caption, tone = "primary", stale = false }: { icon: typeof FileText; label: string; value: number; caption: string; tone?: "primary" | "blue" | "warning"; stale?: boolean }) {
  return (
    <div className={`splitter-stat ${tone}${stale ? " stale" : ""}`}>
      <span><Icon size={18} /></span>
      <div>
        <small>{label}{stale ? " (needs refresh)" : ""}</small>
        <strong>{value.toLocaleString()}</strong>
        <em>{caption}</em>
      </div>
    </div>
  );
}

function formatAction(action: string) {
  return action.replace(/_/g, " ");
}

function actionClass(action: string) {
  if (action.includes("create")) return "mini-status ok";
  if (action.includes("overwrite") || action.includes("version")) return "mini-status warn";
  return "mini-status";
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}



