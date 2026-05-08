import { FileText, Image, Plus, Save, Sigma, Table2 } from "lucide-react";
import { useState } from "react";

import { API_BASE, readJson } from "../api";

export function MCQAddQuestionView({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [correctOption, setCorrectOption] = useState("A");
  const [marks, setMarks] = useState(1);
  const [optionTexts, setOptionTexts] = useState<Record<string, string>>({ A: "", B: "", C: "", D: "" });
  const [status, setStatus] = useState<string | null>(null);

  async function saveQuestion() {
    setStatus(null);
    const response = await fetch(`${API_BASE}/api/mcq/questions/create/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, question_text: questionText, correct_option: correctOption, marks, option_texts: optionTexts }),
    });
    await readJson(response);
    setStatus("Question saved.");
    onSaved();
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>Add MCQ Question</h1>
          <span className="header-subtitle">Build one printable A4-width multiple-choice question.</span>
        </div>
        <button className="primary-action" onClick={saveQuestion}><Save size={17} />Save question</button>
      </section>

      <section className="mcq-editor-grid">
        <div className="panel mcq-editor-panel">
          <div className="step-tabs">
            <button className="active">Question</button><button>Options</button><button>Layout</button><button>Metadata</button><button>Preview</button>
          </div>
          {status ? <div className="callout success">{status}</div> : null}
          <label className="field-stack"><span>Question title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short internal title" /></label>
          <label className="field-stack"><span>Question text</span><textarea value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Type text here. Use $v = u + at$ for inline equations or $$E = hf$$ for display equations." /></label>
          <div className="builder-actions">
            <button className="secondary-action"><FileText size={16} />Add text block</button>
            <button className="secondary-action"><Image size={16} />Add image block</button>
            <button className="secondary-action"><Table2 size={16} />Add table block</button>
            <button className="secondary-action"><Sigma size={16} />Insert equation</button>
          </div>

          <div className="option-entry-grid">
            {(["A", "B", "C", "D"] as const).map((label) => (
              <label className="field-stack" key={label}>
                <span>Option {label}</span>
                <input value={optionTexts[label]} onChange={(event) => setOptionTexts((current) => ({ ...current, [label]: event.target.value }))} placeholder={`${label}. answer text, image can be added later`} />
              </label>
            ))}
          </div>

          <div className="mcq-bottom-controls">
            <label className="field-stack compact"><span>Correct answer</span><select value={correctOption} onChange={(event) => setCorrectOption(event.target.value)}>{["A", "B", "C", "D"].map((label) => <option key={label}>{label}</option>)}</select></label>
            <label className="field-stack compact"><span>Marks</span><input type="number" min={0} value={marks} onChange={(event) => setMarks(Number(event.target.value || 1))} /></label>
            <button className="secondary-action"><Plus size={16} />Save and add another</button>
          </div>
        </div>

        <aside className="panel mcq-preview-panel">
          <div className="dashboard-widget-head"><div><strong>A4-width live preview</strong><span>Exam font size is controlled during generation.</span></div></div>
          <div className="a4-preview-card">
            <div className="paper-question-number">1</div>
            <strong>{title || "Untitled MCQ question"}</strong>
            <p>{questionText || "Question text, diagrams, tables, or image-only content will preview here."}</p>
            <div className="option-preview-grid">
              {(["A", "B", "C", "D"] as const).map((label) => (
                <span className={correctOption === label ? "correct" : ""} key={label}>{label}. {optionTexts[label] || "Answer option"}</span>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
