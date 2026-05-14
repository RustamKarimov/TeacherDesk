import { BadgeCheck, CheckSquare2, ChevronDown, ClipboardList, FileQuestion, GraduationCap, Pencil, Plus, Search, Square, Trash2, UserCheck, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { API_BASE, readJson } from "../api";
import type { MCQAsset, MCQMetadataPayload, MCQQuestionListPayload, MCQQuestionRow, MCQReviewStatus } from "../types";

type MCQContentBlock = {
  id: number;
  block_type: string;
  text: string;
  asset_id: number | null;
  asset: MCQAsset | null;
  table_data?: { rows?: string[][] };
  order: number;
  settings?: {
    width?: number;
    height?: number;
    fit?: "contain" | "cover";
    align?: "left" | "center" | "right";
    offset_x?: number;
    offset_y?: number;
  };
};

type MCQOptionDetail = {
  id: number;
  label: string;
  is_correct: boolean;
  order: number;
  content_json?: JSONContent;
  content_text?: string;
  layout_settings: { table_headers?: string[]; table_cells?: string[] };
  blocks: MCQContentBlock[];
};

type MCQQuestionDetailPayload = MCQQuestionRow & {
  notes: string;
  teacher_notes: string;
  content_json?: JSONContent;
  content_text?: string;
  layout_settings: {
    rich_content?: JSONContent;
    option_image_layout?: {
      placement?: "top" | "middle" | "bottom";
      sizing?: "individual" | "same_height" | "same_width" | "same_size";
      label_placement?: "inline" | "above";
      content_align?: "left" | "center" | "right";
    };
  };
  blocks: MCQContentBlock[];
  options: MCQOptionDetail[];
};

function renderLatexToHtml(latex: string, displayMode = false) {
  return katex.renderToString(latex || "\\square", {
    displayMode,
    throwOnError: false,
    strict: "warn",
    trust: false,
    output: "html",
  });
}

function LatexMath({ latex, displayMode = false }: { latex: string; displayMode?: boolean }) {
  return <span className={displayMode ? "math-render display" : "math-render"} dangerouslySetInnerHTML={{ __html: renderLatexToHtml(latex, displayMode) }} />;
}

function renderMathText(text: string): ReactNode[] {
  const pieces = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    const display = piece.startsWith("$$") && piece.endsWith("$$");
    const inline = piece.startsWith("$") && piece.endsWith("$");
    if (!display && !inline) return <span key={index}>{piece}</span>;
    return <LatexMath latex={piece.replace(/^\${1,2}|\${1,2}$/g, "")} displayMode={display} key={index} />;
  });
}

function renderRichNode(node: JSONContent, key = "node"): ReactNode {
  const children = node.content?.map((child, index) => renderRichNode(child, `${key}-${index}`));
  const textAlign = typeof node.attrs?.textAlign === "string" ? node.attrs.textAlign as CSSProperties["textAlign"] : undefined;
  if (node.type === "doc") return <>{children}</>;
  if (node.type === "paragraph") return <p key={key} style={textAlign ? { textAlign } : undefined}>{children}</p>;
  if (node.type === "heading") {
    const level = Math.min(Number(node.attrs?.level || 2), 3);
    return level === 1 ? <h1 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h1> : level === 2 ? <h2 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h2> : <h3 key={key} style={textAlign ? { textAlign } : undefined}>{children}</h3>;
  }
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") {
    const listType = node.attrs?.type === "a" ? "lower-alpha" : node.attrs?.type === "A" ? "upper-alpha" : node.attrs?.type === "i" ? "lower-roman" : node.attrs?.type === "I" ? "upper-roman" : "decimal";
    return <ol key={key} style={{ listStyleType: listType }}>{children}</ol>;
  }
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "image") {
    const width = typeof node.attrs?.width === "number" ? `${node.attrs.width}%` : typeof node.attrs?.width === "string" ? node.attrs.width : "100%";
    const fit = node.attrs?.["data-fit"] === "cover" ? "cover" : "contain";
    const align = node.attrs?.["data-align"] === "left" || node.attrs?.["data-align"] === "right" ? node.attrs["data-align"] : "center";
    return <img className={`a4-question-image fit-${fit} align-${align}`} key={key} src={String(node.attrs?.src || "")} alt={String(node.attrs?.alt || "Question image")} style={{ width }} />;
  }
  if (node.type === "table") return <table className="mcq-preview-table rich-table" key={key}><tbody>{children}</tbody></table>;
  if (node.type === "tableRow") return <tr key={key}>{children}</tr>;
  if (node.type === "tableHeader") return <th key={key}>{children}</th>;
  if (node.type === "tableCell") return <td key={key}>{children}</td>;
  if (node.type === "text") {
    let rendered: ReactNode = renderMathText(node.text || "");
    if (node.marks?.some((mark) => mark.type === "bold")) rendered = <strong key={key}>{rendered}</strong>;
    if (node.marks?.some((mark) => mark.type === "italic")) rendered = <em key={key}>{rendered}</em>;
    if (node.marks?.some((mark) => mark.type === "underline")) rendered = <u key={key}>{rendered}</u>;
    return <span key={key}>{rendered}</span>;
  }
  return <span key={key}>{children}</span>;
}

function blockHasContent(block: MCQContentBlock) {
  return Boolean(block.text?.trim() || block.asset || block.table_data?.rows?.length);
}

function renderBlock(block: MCQContentBlock) {
  if (block.block_type === "image" && block.asset) {
    const width = block.settings?.width ? `${block.settings.width}%` : undefined;
    const fit = block.settings?.fit === "cover" ? "cover" : "contain";
    return <img className={`a4-question-image fit-${fit}`} src={`${API_BASE}${block.asset.preview_url}`} alt={block.asset.original_name} style={width ? { width } : undefined} />;
  }
  if (block.block_type === "equation") return <LatexMath latex={block.text || "F = ma"} displayMode />;
  if (block.block_type === "table") {
    const rows = block.table_data?.rows ?? [];
    return rows.length ? <table className="mcq-preview-table"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderMathText(cell)}</td>)}</tr>)}</tbody></table> : null;
  }
  if (block.block_type === "note") return <p className="mcq-note-preview">{renderMathText(block.text || "")}</p>;
  return block.text ? <p>{renderMathText(block.text)}</p> : null;
}

function renderOptionContent(option: MCQOptionDetail, placement: "top" | "middle" | "bottom") {
  const orderedBlocks = [...option.blocks].sort((left, right) => left.order - right.order);
  const images = orderedBlocks.filter((block) => block.block_type === "image" && block.asset);
  const textBlocks = orderedBlocks.filter((block) => block.block_type !== "image" && blockHasContent(block));
  const imageNodes = images.map((block) => {
    const width = block.settings?.width ? `${block.settings.width}%` : undefined;
    const height = block.settings?.height ? `${block.settings.height}px` : undefined;
    const fit = block.settings?.fit === "cover" ? "cover" : "contain";
    const align = block.settings?.align === "left" || block.settings?.align === "right" ? block.settings.align : "center";
    const offsetX = Number(block.settings?.offset_x ?? 0);
    const offsetY = Number(block.settings?.offset_y ?? 0);
    const style: CSSProperties = {};
    if (width) style.width = width;
    if (height) style.height = height;
    if (offsetX || offsetY) style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    return <img className={`a4-option-image fit-${fit} align-${align}`} src={`${API_BASE}${block.asset?.preview_url}`} alt={block.asset?.original_name || `${option.label} image`} style={style} key={block.id} />;
  });
  const textNodes = textBlocks.map((block) => block.block_type === "equation" ? <LatexMath latex={block.text} key={block.id} /> : <span className="option-text-fragment" key={block.id}>{renderMathText(block.text)}</span>);
  if (!imageNodes.length && !textNodes.length) return <span className="option-text-fragment">Answer option</span>;
  if (placement === "middle" && imageNodes.length) return <span className="option-media-middle">{imageNodes}<span>{textNodes}</span></span>;
  return <>{placement === "top" ? imageNodes : null}{textNodes}{placement === "bottom" ? imageNodes : null}</>;
}

function renderTableOptions(question: MCQQuestionDetailPayload, isTeacherView: boolean) {
  const firstOptionWithCells = question.options.find((option) => option.layout_settings?.table_cells?.length);
  const headers = firstOptionWithCells?.layout_settings?.table_headers ?? [];
  return (
    <table className="mcq-answer-table-preview">
      <thead>
        <tr>
          <th />
          {headers.map((header, index) => <th key={index}>{renderMathText(header)}</th>)}
        </tr>
      </thead>
      <tbody>
        {[...question.options].sort((left, right) => left.order - right.order).map((option) => (
          <tr className={isTeacherView && option.is_correct ? "correct" : ""} key={option.id}>
            <th>{option.label}</th>
            {(option.layout_settings?.table_cells ?? []).map((cell, index) => <td key={index}>{renderMathText(cell)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function hasRichContent(question: MCQQuestionDetailPayload) {
  return Boolean(question.layout_settings?.rich_content?.content?.length || question.content_json?.content?.length);
}

function MultiSelectFilter({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: Array<{ id: number; name: string }>;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedNames = options.filter((item) => selectedIds.includes(item.id)).map((item) => item.name);
  const summary = selectedNames.length ? `${selectedNames.length} selected` : label;
  const filteredOptions = options.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    function closeIfOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", closeIfOutside);
    return () => document.removeEventListener("mousedown", closeIfOutside);
  }, []);

  function toggle(id: number) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return (
    <div className={`multi-filter ${isOpen ? "open" : ""}`} ref={wrapperRef}>
      <button className="multi-filter-trigger" onClick={() => setIsOpen((current) => !current)} type="button">
        <span>{label}</span>
        <strong>{summary}</strong>
      </button>
      {isOpen ? (
        <div className="multi-filter-menu">
          <label className="multi-filter-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} /></label>
          <div className="multi-filter-selected">
            {selectedNames.length ? selectedNames.slice(0, 4).map((name) => <em key={name}>{name}</em>) : <span>No {label.toLowerCase()} selected</span>}
            {selectedNames.length > 4 ? <em>+{selectedNames.length - 4}</em> : null}
          </div>
          <div className="multi-filter-actions">
            <button type="button" onClick={() => onChange(options.map((item) => item.id))}>Select all</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="multi-filter-list">
            {filteredOptions.length ? filteredOptions.map((item) => (
              <label key={item.id}>
                <input checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
                <span>{item.name}</span>
              </label>
            )) : <div className="multi-filter-empty">No matches</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SingleSelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = options.find((item) => item.value === value)?.label ?? label;

  useEffect(() => {
    function closeIfOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", closeIfOutside);
    return () => document.removeEventListener("mousedown", closeIfOutside);
  }, []);

  return (
    <div className={`multi-filter single-filter ${isOpen ? "open" : ""}`} ref={wrapperRef}>
      <button className="multi-filter-trigger" onClick={() => setIsOpen((current) => !current)} type="button">
        <span>{label}</span>
        <strong>{selectedLabel}</strong>
      </button>
      {isOpen ? (
        <div className="multi-filter-menu single-filter-menu">
          {options.map((item) => (
            <button
              className={item.value === value ? "selected" : ""}
              key={item.value || "any"}
              onClick={() => {
                onChange(item.value);
                setIsOpen(false);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineSelectControl({
  ariaLabel,
  disabled = false,
  options,
  tone,
  value,
  onChange,
}: {
  ariaLabel: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  tone?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = options.find((item) => item.value === value)?.label ?? options[0]?.label ?? "";

  useEffect(() => {
    function closeIfOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", closeIfOutside);
    return () => document.removeEventListener("mousedown", closeIfOutside);
  }, []);

  return (
    <div className={`inline-select-control ${isOpen ? "open" : ""} ${tone ? `tone-${tone}` : ""}`} ref={wrapperRef}>
      <button
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="inline-select-button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={15} />
      </button>
      {isOpen ? (
        <div className="inline-select-menu">
          {options.map((item) => (
            <button
              className={item.value === value ? "selected" : ""}
              key={item.value || "empty"}
              onClick={() => {
                onChange(item.value);
                setIsOpen(false);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MCQQuestionBankView({
  onAddQuestion,
  onEditQuestion,
  onAddToExam,
}: {
  onAddQuestion: () => void;
  onEditQuestion: (questionId: number) => void;
  onAddToExam?: (questionIds: number[]) => void;
}) {
  const [rows, setRows] = useState<MCQQuestionRow[]>([]);
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [difficulty, setDifficulty] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [contentType, setContentType] = useState("");
  const [year, setYear] = useState("");
  const [session, setSession] = useState("");
  const [examCode, setExamCode] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [examBasketIds, setExamBasketIds] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageCount, setPageCount] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<MCQQuestionDetailPayload | null>(null);
  const [isTeacherView, setIsTeacherView] = useState(false);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const tableSummary = useMemo(() => {
    const start = count ? (page - 1) * pageSize + 1 : 0;
    const end = Math.min(page * pageSize, count);
    return `${start}-${end} of ${count}`;
  }, [count, page, pageSize]);

  useEffect(() => {
    fetch(`${API_BASE}/api/mcq/metadata/`)
      .then((response) => readJson<MCQMetadataPayload>(response))
      .then(setMetadata)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ metadata."));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    topicIds.forEach((id) => params.append("topic_id", String(id)));
    tagIds.forEach((id) => params.append("tag_id", String(id)));
    if (difficulty) params.set("difficulty", difficulty);
    if (reviewStatus) params.set("review_status", reviewStatus);
    if (contentType) params.set("content_type", contentType);
    if (year) params.set("year", year);
    if (session) params.set("session", session);
    if (examCode) params.set("exam_code", examCode);
    fetch(`${API_BASE}/api/mcq/questions/?${params.toString()}`)
      .then((response) => readJson<MCQQuestionListPayload>(response))
      .then((payload) => {
        setRows(payload.results);
        setCount(payload.count);
        setPageCount(payload.page_count);
        setSelectedId((current) => payload.results.some((item) => item.id === current) ? current : payload.results[0]?.id ?? null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ questions."));
  }, [search, topicIds, tagIds, difficulty, reviewStatus, contentType, year, session, examCode, page, pageSize, reloadToken]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedDetail(null);
      return;
    }
    fetch(`${API_BASE}/api/mcq/questions/${selected.id}/`)
      .then((response) => readJson<MCQQuestionDetailPayload>(response))
      .then(setSelectedDetail)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load MCQ preview."));
  }, [selected?.id, reloadToken]);

  function resetFilters() {
    setSearch("");
    setTopicIds([]);
    setTagIds([]);
    setDifficulty("");
    setReviewStatus("");
    setContentType("");
    setYear("");
    setSession("");
    setExamCode("");
    setPage(1);
  }

  function toggleSelectedQuestion(questionId: number) {
    setSelectedQuestionIds((current) => current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId]);
  }

  function togglePageSelection() {
    const pageIds = rows.map((row) => row.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedQuestionIds.includes(id));
    setSelectedQuestionIds((current) => allSelected ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]);
  }

  function addSelectedToExam() {
    const ids = selectedQuestionIds.length ? selectedQuestionIds : selected ? [selected.id] : [];
    setExamBasketIds((current) => [...new Set([...current, ...ids])]);
    onAddToExam?.(ids);
    setNotice(`${ids.length} question${ids.length === 1 ? "" : "s"} added to the MCQ exam basket.`);
  }

  async function deleteSelectedQuestions() {
    if (!selectedQuestionIds.length) return;
    if (!confirm(`Delete ${selectedQuestionIds.length} selected MCQ question(s)?`)) return;
    setError(null);
    try {
      for (const questionId of selectedQuestionIds) {
        const response = await fetch(`${API_BASE}/api/mcq/questions/${questionId}/delete/`, { method: "POST" });
        await readJson(response);
      }
      setSelectedQuestionIds([]);
      setSelectedId(null);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete selected MCQ questions.");
    }
  }

  function replaceRow(updated: MCQQuestionRow) {
    setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setSelectedDetail((current) => (current?.id === updated.id ? { ...current, ...updated } as MCQQuestionDetailPayload : current));
  }

  async function quickUpdateQuestion(questionId: number, patch: { marks?: number; review_status?: MCQReviewStatus; topic_ids?: number[] }) {
    setError(null);
    setSavingRowId(questionId);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/questions/${questionId}/quick-update/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const updated = await readJson<MCQQuestionDetailPayload>(response);
      replaceRow(updated);
      setNotice("Question metadata updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update question metadata.");
      setReloadToken((current) => current + 1);
    } finally {
      setSavingRowId(null);
    }
  }

  function updateRowTopic(question: MCQQuestionRow, topicId: string) {
    const currentTopicIds = question.topics.map((topic) => topic.id);
    const nextTopicIds = topicId ? [Number(topicId), ...currentTopicIds.filter((id) => id !== Number(topicId))] : [];
    void quickUpdateQuestion(question.id, { topic_ids: nextTopicIds });
  }

  function renderSelectedQuestionPreview() {
    if (!selected || !selectedDetail) return null;
    const optionImageLayout = selectedDetail.layout_settings?.option_image_layout ?? {};
    const placement = optionImageLayout.placement ?? "top";
    const sizing = optionImageLayout.sizing ?? "individual";
    const labelPlacement = optionImageLayout.label_placement ?? "inline";
    const contentAlign = optionImageLayout.content_align ?? "left";
    const richContent = selectedDetail.layout_settings?.rich_content ?? selectedDetail.content_json;
    return (
      <>
        <div className="a4-preview-viewport bank-preview-viewport">
          <div className="a4-scale-shell bank-a4-scale">
            <div className={`a4-preview-card mcq-layout-${selectedDetail.layout_preset}`}>
              <div className="paper-question-row">
                <span className="paper-question-number">1</span>
                <div className="paper-question-body">
                  <div className="question-block-preview rich-preview-content">
                    {hasRichContent(selectedDetail) && richContent ? renderRichNode(richContent) : (
                      selectedDetail.blocks.length ? selectedDetail.blocks.slice().sort((left, right) => left.order - right.order).map((block) => <div className={`preview-content-block ${block.block_type}`} key={block.id}>{renderBlock(block)}</div>) : <p className="muted-preview">No question content saved.</p>
                    )}
                  </div>
                  {selectedDetail.option_layout === "table" ? renderTableOptions(selectedDetail, isTeacherView) : (
                    <div className={`option-preview-grid layout-${selectedDetail.option_layout} option-images-${sizing} label-${labelPlacement} align-${contentAlign} image-place-${placement}`}>
                      {[...selectedDetail.options].sort((left, right) => left.order - right.order).map((option) => (
                        <span className={isTeacherView && option.is_correct ? "correct" : ""} key={option.id}>
                          <b>{option.label}{labelPlacement === "inline" ? "." : ""}</b>
                          {renderOptionContent(option, placement)}
                        </span>
                      ))}
                    </div>
                  )}
                  {isTeacherView ? <div className="teacher-preview-note">Correct answer: {selected.correct_option || "not set"}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="metadata-mini">
          <span><BadgeCheck size={15} />{selected.review_status_label}</span>
          <span>{selected.marks} mark{selected.marks === 1 ? "" : "s"}</span>
          <span>{selected.option_layout_label}</span>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Question Bank</h1>
          <span className="header-subtitle">Browse, filter, edit, duplicate, delete, and preview structured MCQ questions.</span>
        </div>
        <button className="primary-action" onClick={onAddQuestion}><Plus size={17} />Add question</button>
      </section>

      <section className="workbench mcq-bank-workbench">
        <div className="panel mcq-bank-panel">
          {error ? <div className="callout error">{error}</div> : null}
          {notice ? <div className="callout success mcq-bank-notice"><span>{notice}</span><button className="icon-button" type="button" onClick={() => setNotice(null)}><X size={14} /></button></div> : null}
          <div className="filters-toolbar mcq-bank-filters">
            <label className="search-field mcq-bank-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search question text, exam code, source, topic, or tag" /></label>
            <div className="mcq-filter-row mcq-filter-row-main">
              <MultiSelectFilter label="Topics" options={metadata?.topics ?? []} selectedIds={topicIds} onChange={(ids) => { setTopicIds(ids); setPage(1); }} />
              <MultiSelectFilter label="Tags" options={metadata?.tags ?? []} selectedIds={tagIds} onChange={(ids) => { setTagIds(ids); setPage(1); }} />
            </div>
            <div className="mcq-filter-row mcq-filter-row-secondary">
              <SingleSelectFilter
                label="Difficulty"
                value={difficulty}
                onChange={(next) => { setDifficulty(next); setPage(1); }}
                options={[{ value: "", label: "Any difficulty" }, ...["Easy", "Medium", "Hard", ...(metadata?.difficulties ?? []).filter((item) => !["Easy", "Medium", "Hard"].includes(item))].map((item) => ({ value: item, label: item }))]}
              />
              <SingleSelectFilter
                label="Content"
                value={contentType}
                onChange={(next) => { setContentType(next); setPage(1); }}
                options={[
                  { value: "", label: "Any content" },
                  { value: "image", label: "Has image" },
                  { value: "table", label: "Has table" },
                  { value: "equation", label: "Has equation" },
                ]}
              />
              <SingleSelectFilter
                label="Review"
                value={reviewStatus}
                onChange={(next) => { setReviewStatus(next as MCQReviewStatus | ""); setPage(1); }}
                options={[{ value: "", label: "Any review status" }, ...(metadata?.review_statuses ?? []).map((item) => ({ value: item.value, label: item.label }))]}
              />
              <button className="secondary-action compact-action" type="button" onClick={resetFilters}>Clear</button>
            </div>
            <div className="mcq-filter-row mcq-filter-row-tertiary">
              <SingleSelectFilter
                label="Year"
                value={year}
                onChange={(next) => { setYear(next); setPage(1); }}
                options={[{ value: "", label: "Any year" }, ...(metadata?.years ?? []).map((item) => ({ value: String(item), label: String(item) }))]}
              />
              <SingleSelectFilter
                label="Session"
                value={session}
                onChange={(next) => { setSession(next); setPage(1); }}
                options={[{ value: "", label: "Any session" }, ...(metadata?.sessions ?? []).map((item) => ({ value: item, label: item }))]}
              />
              <SingleSelectFilter
                label="Exam code"
                value={examCode}
                onChange={(next) => { setExamCode(next); setPage(1); }}
                options={[{ value: "", label: "Any exam code" }, ...(metadata?.exam_codes ?? []).map((item) => ({ value: item, label: item }))]}
              />
            </div>
          </div>

          <div className="results-head">
            <div className="library-title">
              <strong>Question Library <span>({count} questions found / showing {tableSummary})</span></strong>
            </div>
            <div className="library-action-row">
              <div className="library-action-left">
                <span><CheckSquare2 size={15} />{selectedQuestionIds.length} selected</span>
                <span><ClipboardList size={15} />{examBasketIds.length} in basket</span>
                <button className="secondary-action compact-action" disabled={!selectedQuestionIds.length && !selected} onClick={addSelectedToExam}><ClipboardList size={15} />Add to exam</button>
              </div>
              <div className="library-action-right">
                <button className="toolbar-icon-button" disabled={!selected} onClick={() => selected && onEditQuestion(selected.id)} title="Edit selected question" type="button"><Pencil size={17} /></button>
                <button className="toolbar-icon-button danger-icon" disabled={!selectedQuestionIds.length} onClick={deleteSelectedQuestions} title="Delete selected questions" type="button"><Trash2 size={17} /></button>
              </div>
            </div>
          </div>

          <div className="mcq-table">
            <div className="mcq-table-head">
              <button className="table-check" onClick={togglePageSelection} type="button" title="Select all visible questions">{rows.length > 0 && rows.every((row) => selectedQuestionIds.includes(row.id)) ? <CheckSquare2 size={17} /> : <Square size={17} />}</button>
              <span>Question</span><span>Topic</span><span>Mark</span><span>Status</span>
            </div>
            {rows.length ? rows.map((row) => (
              <div className={`mcq-table-row ${selected?.id === row.id ? "active" : ""}`} key={row.id} onClick={() => setSelectedId(row.id)} role="button" tabIndex={0}>
                <button className="table-check" onClick={(event) => { event.stopPropagation(); toggleSelectedQuestion(row.id); }} type="button" title="Select question">{selectedQuestionIds.includes(row.id) ? <CheckSquare2 size={17} /> : <Square size={17} />}</button>
                <span><strong>{row.title || `MCQ #${row.id}`}</strong><small>{row.exam_code || row.source || "Manual question"} {row.source_question_number ? `/ ${row.source_question_number}` : ""}</small></span>
                <span className="mcq-inline-topic-cell" onClick={(event) => event.stopPropagation()}>
                  <InlineSelectControl
                    ariaLabel={`Change topic for ${row.title || `MCQ #${row.id}`}`}
                    disabled={savingRowId === row.id}
                    onChange={(value) => updateRowTopic(row, value)}
                    options={[
                      { value: "", label: "No topic" },
                      ...(metadata?.topics ?? []).map((topic) => ({ value: String(topic.id), label: topic.name })),
                    ]}
                    value={row.topics[0]?.id ? String(row.topics[0].id) : ""}
                  />
                  {row.topics.length > 1 ? <small>+{row.topics.length - 1}</small> : null}
                </span>
                <span className="mcq-mark-cell" onClick={(event) => event.stopPropagation()}>
                  <input
                    disabled={savingRowId === row.id}
                    min={0}
                    type="number"
                    value={row.marks}
                    onChange={(event) => replaceRow({ ...row, marks: Number(event.target.value || 0) })}
                    onBlur={(event) => quickUpdateQuestion(row.id, { marks: Number(event.target.value || 0) })}
                  />
                </span>
                <span className="mcq-status-cell" onClick={(event) => event.stopPropagation()}>
                  <InlineSelectControl
                    ariaLabel={`Change review status for ${row.title || `MCQ #${row.id}`}`}
                    disabled={savingRowId === row.id}
                    onChange={(value) => quickUpdateQuestion(row.id, { review_status: value as MCQReviewStatus })}
                    options={(metadata?.review_statuses ?? []).map((status) => ({ value: status.value, label: status.label }))}
                    tone={row.review_status}
                    value={row.review_status}
                  />
                </span>
              </div>
            )) : <div className="dashboard-empty">No MCQ questions match these filters.</div>}
          </div>

          <div className="pagination-bar">
            <button className="ghost-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))}>Previous</button>
            <span>Page {page} of {pageCount}</span>
            <label className="rows-select">Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
            <button className="ghost-button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(current + 1, pageCount))}>Next</button>
          </div>
        </div>

        <aside className="panel mcq-preview-panel sticky-preview">
          <div className="dashboard-widget-head">
            <div><strong>A4 Preview</strong><span>{isTeacherView ? "Teacher mode shows the correct answer." : "Student mode hides the correct answer."}</span></div>
            <div className="preview-actions">
              <div className="preview-mode-toggle icon-only" role="group" aria-label="Preview mode">
                <button className={!isTeacherView ? "active" : ""} onClick={() => setIsTeacherView(false)} title="Student view" type="button"><GraduationCap size={17} /></button>
                <button className={isTeacherView ? "active" : ""} onClick={() => setIsTeacherView(true)} title="Teacher view" type="button"><UserCheck size={17} /></button>
              </div>
              <button className="toolbar-icon-button" disabled={!selected} onClick={() => selected && onEditQuestion(selected.id)} title="Edit selected question" type="button"><Pencil size={17} /></button>
            </div>
          </div>
          {selected && selectedDetail ? renderSelectedQuestionPreview() : selected ? <div className="empty-state"><FileQuestion size={30} /><strong>Loading preview</strong><span>Fetching the selected question blocks.</span></div> : <div className="empty-state"><FileQuestion size={30} /><strong>No question selected</strong><span>Select or create an MCQ question to preview it.</span></div>}
        </aside>
      </section>
    </>
  );
}
