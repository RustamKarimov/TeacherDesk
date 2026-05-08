import { Plus, Save, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { API_BASE, readJson } from "../api";
import type { MCQMetadataPayload } from "../types";

export function MCQMetadataView() {
  const [metadata, setMetadata] = useState<MCQMetadataPayload | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [topicDraft, setTopicDraft] = useState({ name: "", description: "", color: "#14b8a6", is_active: true });
  const [subtopicName, setSubtopicName] = useState("");
  const [tagName, setTagName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const selectedTopic = metadata?.topics.find((topic) => topic.id === selectedTopicId) ?? metadata?.topics[0] ?? null;

  useEffect(() => {
    loadMetadata();
  }, []);

  useEffect(() => {
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
  }, [selectedTopic?.id]);

  async function loadMetadata() {
    const response = await fetch(`${API_BASE}/api/mcq/metadata/`);
    const payload = await readJson<MCQMetadataPayload>(response);
    setMetadata(payload);
  }

  async function saveTopic() {
    setMessage(null);
    const response = await fetch(`${API_BASE}/api/mcq/metadata/topics/save/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selectedTopic?.id, ...topicDraft }),
    });
    await readJson(response);
    setMessage("Topic saved.");
    await loadMetadata();
  }

  async function createTopic() {
    setSelectedTopicId(null);
    setTopicDraft({ name: "New topic", description: "", color: "#14b8a6", is_active: true });
  }

  async function deleteTopic() {
    if (!selectedTopic || !confirm(`Delete "${selectedTopic.name}"?`)) return;
    setMessage(null);
    const response = await fetch(`${API_BASE}/api/mcq/metadata/topics/${selectedTopic.id}/delete/`, { method: "POST" });
    await readJson(response);
    setMessage("Topic deleted.");
    setSelectedTopicId(null);
    await loadMetadata();
  }

  async function addSubtopic() {
    if (!selectedTopic || !subtopicName.trim()) return;
    const response = await fetch(`${API_BASE}/api/mcq/metadata/subtopics/save/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic_id: selectedTopic.id, name: subtopicName }),
    });
    await readJson(response);
    setSubtopicName("");
    setMessage("Subtopic added.");
    await loadMetadata();
  }

  async function addTag() {
    if (!tagName.trim()) return;
    const response = await fetch(`${API_BASE}/api/mcq/metadata/tags/save/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tagName }),
    });
    await readJson(response);
    setTagName("");
    setMessage("Tag saved.");
    await loadMetadata();
  }

  return (
    <>
      <section className="content-header">
        <div>
          <p className="eyebrow">MCQ Builder</p>
          <h1>MCQ Metadata</h1>
          <span className="header-subtitle">Manage topics, subtopics, tags, difficulty labels, and portable MCQ bank packaging.</span>
        </div>
      </section>
      <section className="dashboard-command">
        <div className="dashboard-widget metadata-manager">
          <div className="dashboard-widget-head">
            <div><strong>Topics</strong><span>Reusable metadata for MCQ generation and future analytics.</span></div>
            <button className="secondary-action" onClick={createTopic}><Plus size={16} />New topic</button>
          </div>
          {message ? <div className="callout success">{message}</div> : null}
          <div className="folder-table">
            {metadata?.topics.length ? metadata.topics.map((topic) => (
              <button className={`folder-table-row metadata-row ${selectedTopic?.id === topic.id ? "active" : ""}`} key={topic.id} onClick={() => setSelectedTopicId(topic.id)}>
                <strong>{topic.name}</strong><span>{topic.subtopics.length} subtopics</span><small className="ok">{topic.question_count} questions</small>
              </button>
            )) : <div className="empty-state"><Tags size={30} /><strong>No MCQ topics yet</strong><span>Topics can be created here when the full metadata editor is implemented.</span></div>}
          </div>
        </div>

        <div className="dashboard-widget metadata-detail">
          <div className="dashboard-widget-head"><div><strong>Topic details</strong><span>Edit the selected topic without leaving the page.</span></div></div>
          <label className="field-stack"><span>Topic name</span><input value={topicDraft.name} onChange={(event) => setTopicDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field-stack"><span>Description</span><textarea value={topicDraft.description} onChange={(event) => setTopicDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <div className="option-entry-grid">
            <label className="field-stack"><span>Colour</span><input type="color" value={topicDraft.color} onChange={(event) => setTopicDraft((current) => ({ ...current, color: event.target.value }))} /></label>
            <label className="field-stack"><span>Status</span><select value={topicDraft.is_active ? "active" : "archived"} onChange={(event) => setTopicDraft((current) => ({ ...current, is_active: event.target.value === "active" }))}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </div>
          <div className="builder-actions">
            <button className="primary-action" onClick={saveTopic}><Save size={16} />Save topic</button>
            <button className="secondary-action danger" disabled={!selectedTopic} onClick={deleteTopic}><Trash2 size={16} />Delete</button>
          </div>

          <div className="metadata-subsection">
            <strong>Subtopics</strong>
            <div className="chip-wrap">{selectedTopic?.subtopics.map((subtopic) => <em key={subtopic.id}>{subtopic.name}</em>)}</div>
            <div className="inline-add-row">
              <input value={subtopicName} onChange={(event) => setSubtopicName(event.target.value)} placeholder="New subtopic" />
              <button className="secondary-action" onClick={addSubtopic}>Add</button>
            </div>
          </div>
        </div>

        <div className="dashboard-widget metadata-tags">
          <div className="dashboard-widget-head"><div><strong>Tags</strong><span>Reusable labels such as graph, circuit, calculation, image-based.</span></div></div>
          <div className="chip-wrap">{metadata?.tags.map((tag) => <em key={tag.id}>{tag.name}</em>)}</div>
          <div className="inline-add-row">
            <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="New tag" />
            <button className="secondary-action" onClick={addTag}>Add tag</button>
          </div>
        </div>
      </section>
    </>
  );
}
