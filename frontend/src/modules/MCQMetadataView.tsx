import { CheckCircle2, ListTree, Plus, RefreshCw, Save, Tags, Trash2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQMetadataPayload } from "../types";

export function MCQMetadataView() {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState({ name: "", description: "", color: "#14b8a6", is_active: true });
  const [subtopicName, setSubtopicName] = useState("");
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedTopic = isCreatingTopic ? null : metadata?.topics.find((topic) => topic.id === selectedTopicId) ?? metadata?.topics[0] ?? null;

  useEffect(() => {
    loadMetadata();
  }, []);

  useEffect(() => {
    if (isCreatingTopic) return;
    if (!selectedTopic) {
      setTopicDraft({ name: "", description: "", color: "#14b8a6", is_active: true });
      return;
    }
    setSelectedTopicId(selectedTopic.id);
    setTopicDraft({
      name: selectedTopic.name,
      description: selectedTopic.description,
      color: selectedTopic.color || "#14b8a6",
      is_active: selectedTopic.is_active,
    });
  }, [isCreatingTopic, selectedTopic?.id]);

  async function loadMetadata() {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/`);
      const payload = await readJson<MCQMetadataPayload>(response);
      setMetadata(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load MCQ metadata.");
    }
  }

  async function saveTopic() {
    setMessage(null);
    setError(null);
    if (!topicDraft.name.trim()) {
      setError("Topic name is required.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/topics/save/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selectedTopic?.id, ...topicDraft }),
      });
      const saved = await readJson<{ id: number }>(response);
      setSelectedTopicId(saved.id);
      setIsCreatingTopic(false);
      setMessage(isCreatingTopic ? "Topic created." : "Topic saved.");
      await loadMetadata();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save topic.");
    }
  }

  async function createTopic() {
    setIsCreatingTopic(true);
    setSelectedTopicId(null);
    setTopicDraft({ name: "", description: "", color: "#14b8a6", is_active: true });
    setMessage(null);
    setError(null);
  }

  async function deleteTopic() {
    if (!selectedTopic || !confirm(`Delete "${selectedTopic.name}"?`)) return;
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/topics/${selectedTopic.id}/delete/`, { method: "POST" });
      await readJson(response);
      setMessage("Topic deleted.");
      setSelectedTopicId(null);
      await loadMetadata();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete topic.");
    }
  }

  async function addSubtopic() {
    if (isCreatingTopic) {
      setError("Save the new topic before adding subtopics.");
      return;
    }
    if (!selectedTopic || !subtopicName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/subtopics/save/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic_id: selectedTopic.id, name: subtopicName }),
      });
      await readJson(response);
      setSubtopicName("");
      setMessage("Subtopic added.");
      await loadMetadata();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add subtopic.");
    }
  }

  async function addTag() {
    if (!tagName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/mcq/metadata/tags/save/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tagName }),
      });
      await readJson(response);
      setTagName("");
      setMessage("Tag saved.");
      await loadMetadata();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add tag.");
    }
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Metadata</h1>
          <span className="header-subtitle">Manage the reusable topics, subtopics, and tags used by the MCQ bank and generator.</span>
        </div>
        <button className="secondary-action" onClick={loadMetadata}><RefreshCw size={16} />Refresh</button>
      </section>

      <section className="metadata-shell">
        {error ? <div className="callout error">{error}</div> : null}
        {message ? <div className="callout success">{message}</div> : null}

        <div className="metadata-summary-row">
          <article><Workflow size={18} /><span>Topics</span><strong>{metadata?.topics.length ?? 0}</strong></article>
          <article><Tags size={18} /><span>Tags</span><strong>{metadata?.tags.length ?? 0}</strong></article>
          <article><ListTree size={18} /><span>Subtopics</span><strong>{metadata?.topics.reduce((sum, topic) => sum + topic.subtopics.length, 0) ?? 0}</strong></article>
        </div>

        <div className="mcq-metadata-grid">
        <div className="dashboard-widget metadata-manager">
          <div className="dashboard-widget-head">
            <div><strong>Topics</strong><span>Reusable metadata for MCQ generation and future analytics.</span></div>
            <button className="secondary-action compact-action metadata-new-topic" onClick={createTopic}><Plus size={14} />New topic</button>
          </div>
          <div className="metadata-list">
            {metadata?.topics.length ? metadata.topics.map((topic) => (
              <button className={`metadata-topic-row ${selectedTopic?.id === topic.id ? "active" : ""}`} key={topic.id} onClick={() => { setIsCreatingTopic(false); setSelectedTopicId(topic.id); }}>
                <span className="topic-color-dot" style={{ background: topic.color || "#14b8a6" }} />
                <span><strong>{topic.name}</strong><small>{topic.subtopics.length} subtopics</small></span>
                <em>{topic.question_count} questions</em>
              </button>
            )) : <div className="empty-state"><Tags size={30} /><strong>No MCQ topics yet</strong><span>Create a topic to start organising MCQ questions.</span></div>}
          </div>
        </div>

        <div className="dashboard-widget metadata-detail">
          <div className="dashboard-widget-head">
            <div>
              <strong>{isCreatingTopic ? "Create topic" : "Topic details"}</strong>
              <span>{isCreatingTopic ? "Add a new topic for future filters and exam generation." : selectedTopic ? selectedTopic.name : "Select a topic to edit."}</span>
            </div>
            <span className={`metadata-state-pill ${topicDraft.is_active ? "active" : ""}`}>{topicDraft.is_active ? "Active" : "Archived"}</span>
          </div>
          <div className="metadata-editor-state">
            {isCreatingTopic ? <Plus size={18} /> : <CheckCircle2 size={18} />}
            <div>
              <strong>{isCreatingTopic ? "New topic draft" : selectedTopic ? "Selected topic" : "No topic selected"}</strong>
              <span>{isCreatingTopic ? "This will become available in MCQ filters after saving." : selectedTopic ? `${selectedTopic.question_count} questions currently use this topic.` : "Choose a topic from the list or create one."}</span>
            </div>
          </div>
          <label className="field-stack"><span>Topic name</span><input value={topicDraft.name} onChange={(event) => setTopicDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Electricity" /></label>
          <label className="field-stack"><span>Description</span><textarea value={topicDraft.description} onChange={(event) => setTopicDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <div className="option-entry-grid">
            <label className="field-stack"><span>Colour</span><input type="color" value={topicDraft.color} onChange={(event) => setTopicDraft((current) => ({ ...current, color: event.target.value }))} /></label>
            <label className="field-stack"><span>Status</span><select value={topicDraft.is_active ? "active" : "archived"} onChange={(event) => setTopicDraft((current) => ({ ...current, is_active: event.target.value === "active" }))}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </div>
          <div className="builder-actions">
            <button className="primary-action" disabled={!topicDraft.name.trim()} onClick={saveTopic}><Save size={16} />{isCreatingTopic ? "Create topic" : "Save topic"}</button>
            <button className="secondary-action danger" disabled={!selectedTopic || isCreatingTopic} onClick={deleteTopic}><Trash2 size={16} />Delete</button>
          </div>

          <div className="metadata-subsection">
            <div className="metadata-subsection-head"><strong>Subtopics</strong><span>{selectedTopic?.subtopics.length ?? 0}</span></div>
            <div className="chip-wrap compact-chip-list">{selectedTopic?.subtopics.map((subtopic) => <em key={subtopic.id}>{subtopic.name}</em>)}</div>
            <div className="inline-add-row">
              <input disabled={!selectedTopic || isCreatingTopic} value={subtopicName} onChange={(event) => setSubtopicName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addSubtopic(); }} placeholder={selectedTopic && !isCreatingTopic ? "New subtopic" : "Save or select a topic first"} />
              <button className="secondary-action" disabled={!selectedTopic || isCreatingTopic || !subtopicName.trim()} onClick={addSubtopic}>Add</button>
            </div>
          </div>
        </div>

        <div className="dashboard-widget metadata-tags">
          <div className="dashboard-widget-head"><div><strong>Tags</strong><span>Reusable labels such as graph, circuit, calculation, image-based.</span></div></div>
          <div className="chip-wrap compact-chip-list metadata-chip-cloud">{metadata?.tags.map((tag) => <em key={tag.id}>{tag.name}</em>)}</div>
          <div className="inline-add-row">
            <input value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addTag(); }} placeholder="New tag" />
            <button className="secondary-action" disabled={!tagName.trim()} onClick={addTag}>Add tag</button>
          </div>
        </div>
        </div>
      </section>
    </>
  );
}
