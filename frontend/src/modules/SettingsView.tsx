import { Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import { MaskSettingRow } from "../components/MaskSettingRow";
import type { AppSettingsPayload, ExamMode } from "../types";

export function SettingsView() {
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [draft, setDraft] = useState<AppSettingsPayload | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSettings() {
    setError(null);
    const response = await fetch(`${API_BASE}/api/libraries/settings/`);
    const payload = await readJson<AppSettingsPayload>(response);
    setSettings(payload);
    setDraft(payload);
  }

  useEffect(() => {
    loadSettings().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load settings."));
  }, []);

  function updateField(field: keyof AppSettingsPayload, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  function updateLibraryField(field: "name" | "root_path", value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      library: {
        ...draft.library,
        [field]: value,
      },
    });
  }

  function updatePaperMark(paper: string, value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      paper_marks: {
        ...draft.paper_marks,
        [paper]: Number(value),
      },
    });
  }

  function updateMaskSetting(key: keyof AppSettingsPayload["pdf_mask_settings"], value: boolean | number) {
    if (!draft) return;
    setDraft({
      ...draft,
      pdf_mask_settings: {
        ...draft.pdf_mask_settings,
        [key]: value,
      },
    });
  }

  function updatePreference<
    Section extends keyof AppSettingsPayload["app_preferences"],
    Key extends keyof AppSettingsPayload["app_preferences"][Section],
  >(section: Section, key: Key, value: AppSettingsPayload["app_preferences"][Section][Key]) {
    if (!draft) return;
    setDraft({
      ...draft,
      app_preferences: {
        ...draft.app_preferences,
        [section]: {
          ...draft.app_preferences[section],
          [key]: value,
        },
      },
    });
  }

  async function browseSettingsFolder(field: "default_source_root" | "default_output_root" | "default_generated_exams_root") {
    if (!draft) return;
    const response = await fetch(
      `${API_BASE}/api/splitter/browse/folder/?initial_dir=${encodeURIComponent(String(draft[field] || ""))}&title=${encodeURIComponent("Select folder")}`,
    );
    const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
    if (!result.cancelled) {
      updateField(field, result.selected_path);
    }
  }

  async function browseLibraryRoot() {
    if (!draft) return;
    const response = await fetch(
      `${API_BASE}/api/splitter/browse/folder/?initial_dir=${encodeURIComponent(String(draft.library.root_path || ""))}&title=${encodeURIComponent("Select library root folder")}`,
    );
    const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
    if (!result.cancelled) {
      updateLibraryField("root_path", result.selected_path);
    }
  }

  async function browseSettingsManifest() {
    if (!draft) return;
    const response = await fetch(
      `${API_BASE}/api/splitter/browse/manifest/?initial_dir=${encodeURIComponent(String(draft.default_manifest_path || ""))}`,
    );
    const result = await readJson<{ selected_path: string; cancelled: boolean }>(response);
    if (!result.cancelled) {
      updateField("default_manifest_path", result.selected_path);
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/libraries/settings/save/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          library: {
            name: draft.library.name,
            root_path: draft.library.root_path,
          },
          default_manifest_path: draft.default_manifest_path,
          default_source_root: draft.default_source_root,
          default_output_root: draft.default_output_root,
          default_generated_exams_root: draft.default_generated_exams_root,
          paper_marks: draft.paper_marks,
          pdf_mask_settings: draft.pdf_mask_settings,
          app_preferences: draft.app_preferences,
        }),
      });
      const result = await readJson<{ ok: boolean; settings: AppSettingsPayload }>(response);
      setSettings(result.settings);
      setDraft(result.settings);
      setMessage("Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!draft) {
    return (
      <section className="placeholder-view">
        <div className="empty-state">
          <Settings size={30} />
          <strong>Loading settings</strong>
          <span>{error ?? "Reading local defaults."}</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Local defaults</h1>
        </div>
        <button className="primary-action" onClick={saveSettings} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save settings"}
        </button>
      </section>

      <section className="settings-modules-page">
        <section className="table-panel settings-module-card">
          <div className="panel-title">
            <div>
              <strong>Library</strong>
              <span>Name and local root for this TeacherDesk library.</span>
            </div>
          </div>
          {message ? <div className="callout success">{message}</div> : null}
          {error ? <div className="callout error">{error}</div> : null}
          <div className="settings-form">
            <label className="field-block">
              <span>Library name</span>
              <input value={draft.library.name} onChange={(event) => updateLibraryField("name", event.target.value)} />
            </label>
            <SettingsPathField label="Library root folder" value={draft.library.root_path} onChange={(value) => updateLibraryField("root_path", value)} onBrowse={browseLibraryRoot} />
          </div>
        </section>

        <section className="table-panel settings-module-card">
          <div className="panel-title">
            <div>
              <strong>Splitter</strong>
              <span>Default folders and split behavior. You can still change them inside Splitter for a specific run.</span>
            </div>
          </div>
          <div className="settings-form">
            <SettingsPathField label="Manifest file" value={draft.default_manifest_path} onChange={(value) => updateField("default_manifest_path", value)} onBrowse={browseSettingsManifest} />
            <SettingsPathField label="Source papers folder" value={draft.default_source_root} onChange={(value) => updateField("default_source_root", value)} onBrowse={() => browseSettingsFolder("default_source_root")} />
            <SettingsPathField label="Question bank output folder" value={draft.default_output_root} onChange={(value) => updateField("default_output_root", value)} onBrowse={() => browseSettingsFolder("default_output_root")} />
            <div className="settings-three-col">
              <label className="field-block">
                <span>Existing split PDFs</span>
                <select value={draft.app_preferences.splitter.existing_pdf_strategy} onChange={(event) => updatePreference("splitter", "existing_pdf_strategy", event.target.value as "skip" | "overwrite")}>
                  <option value="skip">Skip existing</option>
                  <option value="overwrite">Overwrite existing</option>
                </select>
              </label>
              <label className="field-block">
                <span>If page numbers changed</span>
                <select value={draft.app_preferences.splitter.changed_page_strategy} onChange={(event) => updatePreference("splitter", "changed_page_strategy", event.target.value as "flag" | "overwrite" | "keep_both")}>
                  <option value="flag">Keep old, flag review</option>
                  <option value="overwrite">Regenerate changed</option>
                  <option value="keep_both">Keep both versions</option>
                </select>
              </label>
              <label className="field-block">
                <span>Question metadata</span>
                <select value={draft.app_preferences.splitter.metadata_strategy} onChange={(event) => updatePreference("splitter", "metadata_strategy", event.target.value as "update" | "keep")}>
                  <option value="update">Update from manifest</option>
                  <option value="keep">Keep existing metadata</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="table-panel settings-module-card">
          <div className="panel-title">
            <div>
              <strong>Question Bank</strong>
              <span>Default browsing behavior. Filters can still be changed while using the bank.</span>
            </div>
          </div>
          <div className="settings-form compact-settings-form">
            <div className="settings-two-col">
              <label className="field-block">
                <span>Rows per page</span>
                <select value={draft.app_preferences.question_bank.page_size} onChange={(event) => updatePreference("question_bank", "page_size", Number(event.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <label className="field-block">
                <span>Topic filter matching</span>
                <select value={draft.app_preferences.question_bank.topic_match_mode} onChange={(event) => updatePreference("question_bank", "topic_match_mode", event.target.value as "any" | "all")}>
                  <option value="any">Match any selected topic</option>
                  <option value="all">Match all selected topics</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="table-panel settings-module-card">
          <div className="panel-title">
            <div>
              <strong>Exam Generator</strong>
              <span>Defaults for new drafts. Each draft can still override output folder, masks, mode, and paper.</span>
            </div>
          </div>
          <div className="settings-form">
            <SettingsPathField label="Generated exams folder" value={draft.default_generated_exams_root} onChange={(value) => updateField("default_generated_exams_root", value)} onBrowse={() => browseSettingsFolder("default_generated_exams_root")} />
            <div className="settings-three-col">
              <label className="field-block">
                <span>Generation mode</span>
                <select value={draft.app_preferences.exam_generator.default_mode} onChange={(event) => updatePreference("exam_generator", "default_mode", event.target.value as ExamMode)}>
                  <option value="full_paper">Full paper</option>
                  <option value="question_numbers">Question numbers</option>
                  <option value="topics">By topic</option>
                  <option value="manual">From Question Bank</option>
                </select>
              </label>
              <label className="field-block">
                <span>Paper</span>
                <select value={draft.app_preferences.exam_generator.default_paper} onChange={(event) => updatePreference("exam_generator", "default_paper", event.target.value)}>
                  {[1, 2, 3, 4, 5].map((paper) => <option key={paper} value={paper}>Paper {paper}</option>)}
                </select>
              </label>
              <label className="field-block">
                <span>Allowed over target</span>
                <input type="number" min="0" value={draft.app_preferences.exam_generator.allowed_over_target} onChange={(event) => updatePreference("exam_generator", "allowed_over_target", Number(event.target.value))} />
              </label>
            </div>
            <label className="settings-toggle-row">
              <input type="checkbox" checked={draft.app_preferences.exam_generator.include_markscheme} onChange={(event) => updatePreference("exam_generator", "include_markscheme", event.target.checked)} />
              <span>Include mark scheme PDF by default</span>
            </label>
            <div className="paper-mark-list inline-paper-marks">
              {["1", "2", "3", "4", "5"].map((paper) => (
                <label className="field-block" key={paper}>
                  <span>Paper {paper} marks</span>
                  <input type="number" min="1" value={draft.paper_marks?.[paper] ?? ""} onChange={(event) => updatePaperMark(paper, event.target.value)} />
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="table-panel settings-module-card mask-settings-panel">
          <div className="panel-title">
            <div>
              <strong>PDF output</strong>
              <span>Optional white masks applied when generating exams. These can also be adjusted per exam.</span>
            </div>
          </div>
          <div className="mask-settings-grid">
            <MaskSettingRow
              label="Question paper header"
              enabled={draft.pdf_mask_settings.qp_header_enabled}
              value={draft.pdf_mask_settings.qp_header_mm}
              onEnabled={(value) => updateMaskSetting("qp_header_enabled", value)}
              onValue={(value) => updateMaskSetting("qp_header_mm", value)}
            />
            <MaskSettingRow
              label="Question paper footer"
              enabled={draft.pdf_mask_settings.qp_footer_enabled}
              value={draft.pdf_mask_settings.qp_footer_mm}
              onEnabled={(value) => updateMaskSetting("qp_footer_enabled", value)}
              onValue={(value) => updateMaskSetting("qp_footer_mm", value)}
            />
            <MaskSettingRow
              label="Mark scheme header"
              enabled={draft.pdf_mask_settings.ms_header_enabled}
              value={draft.pdf_mask_settings.ms_header_mm}
              onEnabled={(value) => updateMaskSetting("ms_header_enabled", value)}
              onValue={(value) => updateMaskSetting("ms_header_mm", value)}
            />
            <MaskSettingRow
              label="Mark scheme footer"
              enabled={draft.pdf_mask_settings.ms_footer_enabled}
              value={draft.pdf_mask_settings.ms_footer_mm}
              onEnabled={(value) => updateMaskSetting("ms_footer_enabled", value)}
              onValue={(value) => updateMaskSetting("ms_footer_mm", value)}
            />
          </div>
        </section>
      </section>
    </>
  );
}

function SettingsPathField({ label, value, onChange, onBrowse }: { label: string; value: string; onChange: (value: string) => void; onBrowse: () => void }) {
  return (
    <label className="field-block settings-path-field">
      <span>{label}</span>
      <div>
        <input value={value} onChange={(event) => onChange(event.target.value)} />
        <button className="secondary-action" type="button" onClick={onBrowse}>
          Browse
        </button>
      </div>
    </label>
  );
}
