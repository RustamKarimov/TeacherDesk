import { type CSSProperties, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { API_BASE } from "../api";
import type { MCQAsset } from "../types";

export type MCQOptionImagePlacement = "top" | "middle" | "bottom";
export type MCQOptionImageSizing = "individual" | "same_height" | "same_width" | "same_size";
export type MCQOptionLabelPlacement = "inline" | "above";
export type MCQOptionContentAlign = "left" | "center" | "right";
export type MCQOptionLabelAlign = "left" | "center" | "right";

export type MCQRenderBlock = {
  id?: string | number;
  block_type: string;
  text?: string;
  asset?: MCQAsset | null;
  table_data?: { rows?: string[][] };
  order?: number;
  settings?: {
    width?: number;
    height?: number;
    fit?: "contain" | "cover";
    align?: "left" | "center" | "right";
    offset_x?: number;
    offset_y?: number;
  };
};

export type MCQRenderOption = {
  id?: string | number;
  label: string;
  is_correct?: boolean;
  order?: number;
  content_text?: string;
  layout_settings?: {
    table_headers?: string[];
    table_cells?: string[];
    table_cell_assets?: Array<MCQAsset | null>;
  };
  blocks?: MCQRenderBlock[];
};

export type MCQOptionImageLayout = {
  placement?: MCQOptionImagePlacement;
  sizing?: MCQOptionImageSizing;
  label_placement?: MCQOptionLabelPlacement;
  label_align?: MCQOptionLabelAlign;
  content_align?: MCQOptionContentAlign;
  table_borders?: boolean;
  table_headers?: boolean;
};

export type MCQPaperStyle = {
  font_size_pt?: number;
  font_family?: string;
  equation_scale?: number;
  option_gap_px?: number;
  question_number_weight?: number;
};

export type MCQA4QuestionProps = {
  questionNumber?: number | string;
  layoutPreset?: string;
  richContent?: JSONContent | null;
  blocks?: MCQRenderBlock[];
  options: MCQRenderOption[];
  optionLayout?: string;
  optionImageLayout?: MCQOptionImageLayout;
  paperStyle?: MCQPaperStyle;
  teacherView?: boolean;
  emptyText?: string;
};

export function renderLatexToHtml(latex: string, displayMode = false) {
  return katex.renderToString(latex || "\\square", {
    displayMode,
    throwOnError: false,
    strict: "warn",
    trust: false,
    output: "html",
  });
}

export function LatexMath({ latex, displayMode = false }: { latex: string; displayMode?: boolean }) {
  return <span className={displayMode ? "math-render display" : "math-render"} dangerouslySetInnerHTML={{ __html: renderLatexToHtml(latex, displayMode) }} />;
}

export function renderMathText(text: string): ReactNode[] {
  const pieces = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    const display = piece.startsWith("$$") && piece.endsWith("$$");
    const inline = piece.startsWith("$") && piece.endsWith("$");
    if (!display && !inline) return <span key={index}>{piece}</span>;
    return <LatexMath latex={piece.replace(/^\${1,2}|\${1,2}$/g, "")} displayMode={display} key={index} />;
  });
}

function hasRichContent(content?: JSONContent | null) {
  return Boolean(content?.content?.length);
}

function blockHasContent(block: MCQRenderBlock) {
  return Boolean(block.text?.trim() || block.asset || block.table_data?.rows?.length);
}

function assetUrl(asset?: MCQAsset | null) {
  if (!asset?.preview_url) return "";
  return asset.preview_url.startsWith("http") ? asset.preview_url : `${API_BASE}${asset.preview_url}`;
}

export function renderRichNode(node: JSONContent, key = "node"): ReactNode {
  const children = node.content?.map((child, index) => renderRichNode(child, `${key}-${index}`));
  if (node.type === "doc") return <>{children}</>;
  const textAlign = typeof node.attrs?.textAlign === "string" ? node.attrs.textAlign as CSSProperties["textAlign"] : undefined;
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

function renderBlock(block: MCQRenderBlock) {
  if (block.block_type === "image" && block.asset) {
    const width = block.settings?.width ? `${block.settings.width}%` : undefined;
    const fit = block.settings?.fit === "cover" ? "cover" : "contain";
    const align = block.settings?.align === "left" || block.settings?.align === "right" ? block.settings.align : "center";
    return <img className={`a4-question-image fit-${fit} align-${align}`} src={assetUrl(block.asset)} alt={block.asset.original_name} style={width ? { width } : undefined} />;
  }
  if (block.block_type === "equation") return <LatexMath latex={block.text || "F = ma"} displayMode />;
  if (block.block_type === "table") {
    const rows = block.table_data?.rows ?? [];
    return rows.length ? <table className="mcq-preview-table"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderMathText(cell)}</td>)}</tr>)}</tbody></table> : null;
  }
  if (block.block_type === "note") return <p className="mcq-note-preview">{renderMathText(block.text || "")}</p>;
  return block.text ? <p>{renderMathText(block.text)}</p> : null;
}

function renderOptionContent(option: MCQRenderOption, placement: MCQOptionImagePlacement) {
  const orderedBlocks = [...(option.blocks ?? [])].sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
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
    return <img className={`a4-option-image fit-${fit} align-${align}`} src={assetUrl(block.asset)} alt={block.asset?.original_name || `${option.label} image`} style={style} key={block.id ?? `${option.label}-image`} />;
  });
  const textNodes = textBlocks.map((block) => block.block_type === "equation" ? <LatexMath latex={block.text || ""} key={block.id} /> : <span className="option-text-fragment" key={block.id}>{renderMathText(block.text || "")}</span>);
  if (!imageNodes.length && !textNodes.length && option.content_text) textNodes.push(<span className="option-text-fragment" key="content-text">{renderMathText(option.content_text)}</span>);
  if (!imageNodes.length && !textNodes.length) return <span className="option-text-fragment">Answer option</span>;
  if (placement === "middle" && imageNodes.length) return <span className="option-media-middle">{imageNodes}<span>{textNodes}</span></span>;
  return <>{placement === "top" ? imageNodes : null}{textNodes}{placement === "bottom" ? imageNodes : null}</>;
}

function renderTableOptions(options: MCQRenderOption[], teacherView: boolean, layout: MCQOptionImageLayout) {
  const firstOptionWithCells = options.find((option) => option.layout_settings?.table_cells?.length);
  const headers = firstOptionWithCells?.layout_settings?.table_headers ?? [];
  const showHeaders = layout.table_headers ?? true;
  const showBorders = layout.table_borders ?? true;
  return (
    <table className={`mcq-answer-table-preview ${showBorders ? "" : "no-borders"} ${showHeaders ? "" : "hide-headers"}`}>
      {showHeaders ? <thead>
        <tr>
          <th />
          {headers.map((header, index) => <th key={index}>{renderMathText(header)}</th>)}
        </tr>
      </thead> : null}
      <tbody>
        {[...options].sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)).map((option) => (
          <tr className={teacherView && option.is_correct ? "correct" : ""} key={option.id ?? option.label}>
            <th>{option.label}</th>
            {(option.layout_settings?.table_cells ?? []).map((cell, index) => (
              <td key={index}>
                <span className="mcq-table-cell-content">
                  {cell ? <span>{renderMathText(cell)}</span> : null}
                  {option.layout_settings?.table_cell_assets?.[index] ? <img src={assetUrl(option.layout_settings.table_cell_assets[index])} alt={`${option.label} table cell`} /> : null}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MCQA4Question({
  questionNumber = 1,
  layoutPreset = "standard",
  richContent,
  blocks = [],
  options,
  optionLayout = "single",
  optionImageLayout = {},
  paperStyle = {},
  teacherView = false,
  emptyText = "No question content saved.",
}: MCQA4QuestionProps) {
  const placement = optionImageLayout.placement ?? "top";
  const sizing = optionImageLayout.sizing ?? "individual";
  const labelPlacement = optionImageLayout.label_placement ?? "inline";
  const labelAlign = optionImageLayout.label_align ?? "center";
  const contentAlign = optionImageLayout.content_align ?? "left";
  const cardStyle = {
    "--mcq-paper-font-size": `${Number(paperStyle.font_size_pt ?? 11) * 1.333}px`,
    "--mcq-paper-font-family": paperStyle.font_family || "Calibri, Segoe UI, Arial, sans-serif",
    "--mcq-equation-scale": `${Number(paperStyle.equation_scale ?? 1)}`,
    "--mcq-option-gap": `${Number(paperStyle.option_gap_px ?? 6)}px`,
    "--mcq-question-number-font-weight": Number(paperStyle.question_number_weight ?? 700),
  } as CSSProperties;
  const sortedOptions = [...options].sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
  return (
    <div className={`a4-preview-card mcq-layout-${layoutPreset}`} style={cardStyle}>
      <div className="paper-question-row">
        <span className="paper-question-number">{questionNumber}</span>
        <div className="paper-question-body">
          <div className="question-block-preview rich-preview-content">
            {hasRichContent(richContent) && richContent ? renderRichNode(richContent) : (
              blocks.length ? blocks.slice().sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)).map((block) => <div className={`preview-content-block ${block.block_type}`} key={block.id ?? `${block.block_type}-${block.order}`}>{renderBlock(block)}</div>) : <p className="muted-preview">{emptyText}</p>
            )}
          </div>
          {optionLayout === "table" ? renderTableOptions(sortedOptions, teacherView, optionImageLayout) : (
            <div className={`option-preview-grid layout-${optionLayout} option-images-${sizing} label-${labelPlacement} label-align-${labelAlign} align-${contentAlign} image-place-${placement}`}>
              {sortedOptions.map((option) => (
                <span className={teacherView && option.is_correct ? "correct" : ""} key={option.id ?? option.label}>
                  <b>{option.label}{labelPlacement === "inline" ? "." : ""}</b>
                  <span className="option-body">{renderOptionContent(option, placement)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
