import {
  BookOpen,
  ChevronDown,
  Database,
  FolderOpen,
  LayoutDashboard,
  Moon,
  Search,
  Settings,
  Shuffle,
  Sun,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { API_BASE, readJson } from "./api";
import { DashboardView } from "./modules/DashboardView";
import { ExamGeneratorView } from "./modules/ExamGeneratorView";
import { QuestionBankView } from "./modules/QuestionBankView";
import { SettingsView } from "./modules/SettingsView";
import { SplitterView } from "./modules/SplitterView";
import type {
  AppSettingsPayload,
} from "./types";

const modules = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Splitter", icon: FolderOpen },
  { name: "Question Bank", icon: BookOpen },
  { name: "Exam Generator", icon: Shuffle },
  { name: "Settings", icon: Settings },
] as const;

type ModuleName = (typeof modules)[number]["name"];

export function App() {
  const [activeModule, setActiveModule] = useState<ModuleName>("Dashboard");
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [questionBankSearch, setQuestionBankSearch] = useState("");
  const [manualExamQuestionIds, setManualExamQuestionIds] = useState<number[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("teacherdesk-theme") === "light" ? "light" : "dark"));

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
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button className={activeModule === module.name ? "active" : ""} key={module.name} onClick={() => setActiveModule(module.name)}>
                <Icon size={18} />
                {module.name}
              </button>
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
        {activeModule === "Settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}


