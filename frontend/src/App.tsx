import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  FolderOpen,
  LayoutDashboard,
  Moon,
  PencilLine,
  Search,
  Settings,
  Shuffle,
  Sun,
  Tags,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { API_BASE, readJson } from "./api";
import { DashboardView } from "./modules/DashboardView";
import { ExamGeneratorView } from "./modules/ExamGeneratorView";
import { MCQAddQuestionView } from "./modules/MCQAddQuestionView";
import { MCQExamGeneratorView } from "./modules/MCQExamGeneratorView";
import { MCQMetadataView } from "./modules/MCQMetadataView";
import { MCQQuestionBankView } from "./modules/MCQQuestionBankView";
import { QuestionBankView } from "./modules/QuestionBankView";
import { SettingsView } from "./modules/SettingsView";
import { SplitterView } from "./modules/SplitterView";
import type {
  AppSettingsPayload,
} from "./types";

const modules = [
  { name: "Dashboard", icon: LayoutDashboard, section: "Home" },
  { name: "Splitter", icon: FolderOpen, section: "Paper Library" },
  { name: "Question Bank", icon: BookOpen, section: "Paper Library" },
  { name: "Exam Generator", icon: Shuffle, section: "Paper Library" },
  { name: "MCQ Question Bank", icon: BookOpen, section: "MCQ Builder" },
  { name: "Add MCQ Question", icon: PencilLine, section: "MCQ Builder" },
  { name: "MCQ Exam Generator", icon: Shuffle, section: "MCQ Builder" },
  { name: "MCQ Metadata", icon: Tags, section: "MCQ Builder" },
  { name: "Settings", icon: Settings, section: "System" },
] as const;

type ModuleName = (typeof modules)[number]["name"];

export function App() {
  const [activeModule, setActiveModule] = useState<ModuleName>("Dashboard");
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [questionBankSearch, setQuestionBankSearch] = useState("");
  const [manualExamQuestionIds, setManualExamQuestionIds] = useState<number[]>([]);
  const [manualMcqExamQuestionIds, setManualMcqExamQuestionIds] = useState<number[]>([]);
  const [editingMcqQuestionId, setEditingMcqQuestionId] = useState<number | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("teacherdesk-theme") === "light" ? "light" : "dark"));
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const navSections = Array.from(new Set(modules.map((module) => module.section)));

  useEffect(() => {
    fetch(`${API_BASE}/api/libraries/settings/`)
      .then((response) => readJson<AppSettingsPayload>(response))
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    localStorage.setItem("teacherdesk-theme", theme);
  }, [theme]);

  function runGlobalSearch(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const query = globalSearch.trim();
    if (!query) return;
    setQuestionBankSearch(query);
    setActiveModule("Question Bank");
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BookOpen size={22} /></div>
          <div>
            <strong>TeacherDesk</strong>
            <span>Local library</span>
          </div>
        </div>

        <nav className="module-nav">
          {navSections.map((section) => {
            const sectionModules = modules.filter((module) => module.section === section);
            const sectionActive = sectionModules.some((module) => module.name === activeModule);
            const collapsed = collapsedSections[section] ?? false;
            return (
              <div className={`nav-section ${sectionActive ? "active-section" : ""}`} key={section}>
                <button
                  className="nav-section-toggle"
                  onClick={() => setCollapsedSections((current) => ({ ...current, [section]: !collapsed }))}
                  type="button"
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span>{section}</span>
                </button>
                {!collapsed ? (
                  <div className="nav-section-items">
                    {sectionModules.map((module) => {
                      const Icon = module.icon;
                      return (
                        <button className={activeModule === module.name ? "active" : ""} key={module.name} onClick={() => setActiveModule(module.name)}>
                          <Icon size={17} />
                          {module.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="local-mode-card">
          <Database size={18} />
          <div>
            <strong>Local Mode</strong>
            <span>All data stored on this device</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="library-select" onClick={() => setActiveModule("Settings")} title="Open library settings">
            {settings?.library.name ?? "Library settings"}
            <ChevronDown size={16} />
          </button>

          <label className="global-search">
            <Search size={17} />
            <input
              placeholder="Search exam code or topic, then press Enter"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              onKeyDown={runGlobalSearch}
            />
          </label>

          <div className="sync-status">
            <span className="dot" />
            <div>
              <strong>Local storage ready</strong>
              <small>All systems operational</small>
            </div>
          </div>

          <button className="icon-button theme-toggle" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {activeModule === "Dashboard" ? <DashboardView onOpenModule={setActiveModule} /> : null}
        {activeModule === "Splitter" ? <SplitterView /> : null}
        {activeModule === "Question Bank" ? (
          <QuestionBankView
            initialSearch={questionBankSearch}
            onAddToExam={(questionIds) => {
              setManualExamQuestionIds(questionIds);
              setActiveModule("Exam Generator");
            }}
          />
        ) : null}
        {activeModule === "Exam Generator" ? (
          <ExamGeneratorView
            manualQuestionIds={manualExamQuestionIds}
            onManualQuestionsConsumed={() => setManualExamQuestionIds([])}
            onOpenQuestionBank={() => setActiveModule("Question Bank")}
          />
        ) : null}
        {activeModule === "MCQ Question Bank" ? (
          <MCQQuestionBankView
            onAddQuestion={() => {
              setEditingMcqQuestionId(null);
              setActiveModule("Add MCQ Question");
            }}
            onEditQuestion={(questionId) => {
              setEditingMcqQuestionId(questionId);
              setActiveModule("Add MCQ Question");
            }}
            onAddToExam={(questionIds) => {
              setManualMcqExamQuestionIds((current) => [...new Set([...current, ...questionIds])]);
              setActiveModule("MCQ Exam Generator");
            }}
          />
        ) : null}
        {activeModule === "Add MCQ Question" ? (
          <MCQAddQuestionView
            questionId={editingMcqQuestionId}
            onSaved={() => {
              setEditingMcqQuestionId(null);
              setActiveModule("MCQ Question Bank");
            }}
          />
        ) : null}
        {activeModule === "MCQ Exam Generator" ? (
          <MCQExamGeneratorView
            manualQuestionIds={manualMcqExamQuestionIds}
            onManualQuestionsConsumed={() => setManualMcqExamQuestionIds([])}
            onOpenQuestionBank={() => setActiveModule("MCQ Question Bank")}
          />
        ) : null}
        {activeModule === "MCQ Metadata" ? <MCQMetadataView /> : null}
        {activeModule === "Settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}


