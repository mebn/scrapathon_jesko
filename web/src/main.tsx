import React from "react";
import ReactDOM from "react-dom/client";
import * as THREE from "three";
import {
  Activity,
  BookOpenText,
  Box,
  Braces,
  ChevronLeft,
  CircleCheck,
  Clock3,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Wand2,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Network,
  Plus,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Smile,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import "./styles.css";

type DocumentItem = {
  id: string;
  name: string;
  size: number;
  modified: string;
};

type DocumentContent = {
  id: string;
  name: string;
  content: string;
};

type DocumentationPage = {
  title: string;
  body: string;
  source: string;
  tags: string[];
  related: string[];
};

type DocumentationSection = {
  title: string;
  description: string;
  pages: DocumentationPage[];
};

type DocumentationHub = {
  updatedAt?: string;
  summary: string;
  sections: DocumentationSection[];
};

type CADFeature = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
};

type CADModel = {
  updatedAt?: string;
  name: string;
  units: string;
  material: string;
  color: string;
  dimensions: { width: number; height: number; depth: number };
  features: CADFeature[];
  notes: string[];
};

type CADSelection = {
  id: string;
  label: string;
  type: string;
  color: string;
  material: string;
  dimensions: { width: number; height: number; depth?: number };
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  answer: string;
  sources: { id: string; name: string; excerpt: string; score: number }[];
  cad: CADModel;
};

type FileCADImpact = {
  source: string;
  changes: string[];
};

type UploadResponse = {
  documents: DocumentItem[];
  hub?: DocumentationHub;
  hubError?: string;
  cad?: CADModel;
  impacts?: FileCADImpact[];
};

type AppTab = "dashboard" | "docs" | "workspace" | "changes";

type AppRoute =
  | { page: "home" }
  | { page: "project"; projectId: string; tab: AppTab; documentationSection?: string }
  | { page: "not-found" };

const emptyHub: DocumentationHub = { summary: "No documentation generated yet.", sections: [] };
const emptyCAD: CADModel = {
  name: "Factory Part",
  units: "mm",
  material: "aluminum",
  color: "gray",
  dimensions: { width: 120, height: 70, depth: 18 },
  features: [],
  notes: [],
};

const api = {
  async getCAD() {
    const res = await fetch("/api/cad");
    return readJSON<CADModel>(res);
  },
  async listImpacts() {
    const res = await fetch("/api/cad/impacts");
    return readJSON<FileCADImpact[]>(res);
  },
  async listDocuments() {
    const res = await fetch("/api/documents");
    return readJSON<DocumentItem[]>(res);
  },
  async getDocument(id: string) {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`);
    return readJSON<DocumentContent>(res);
  },
  async listHub() {
    const res = await fetch("/api/library");
    return readJSON<DocumentationHub>(res);
  },
  async rebuildHub() {
    const res = await fetch("/api/library/rebuild", { method: "POST" });
    return readJSON<DocumentationHub>(res);
  },
  async upload(files: FileList) {
    const body = new FormData();
    Array.from(files).forEach((file) => body.append("files", file));
    const res = await fetch("/api/upload", { method: "POST", body });
    return readJSON<UploadResponse>(res);
  },
  async deleteDocument(id: string) {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res));
  },
  async chat(message: string) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return readJSON<ChatResponse>(res);
  },
};

async function readJSON<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

async function readError(res: Response) {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

function App({
  tab,
  documentationSection,
  onHome,
  onTabChange,
  onDocumentationSectionChange,
}: {
  tab: AppTab;
  documentationSection?: string;
  onHome: () => void;
  onTabChange: (tab: AppTab) => void;
  onDocumentationSectionChange: (section?: string) => void;
}) {
  const [documents, setDocuments] = React.useState<DocumentItem[]>([]);
  const [hub, setHub] = React.useState<DocumentationHub>(emptyHub);
  const [cad, setCAD] = React.useState<CADModel>(emptyCAD);
  const [impacts, setImpacts] = React.useState<FileCADImpact[]>([]);
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: "assistant",
      content: "Ingest source artifacts, then query indexed context or issue CAD changes. Responses cite filenames and CAD outputs pass documentation constraints.",
    },
  ]);
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewDocument, setPreviewDocument] = React.useState<DocumentContent | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const pageCount = React.useMemo(() => hub.sections.reduce((total, section) => total + section.pages.length, 0), [hub.sections]);
  const featureCount = React.useMemo(() => cad.features.filter((feature) => feature.type !== "plate").length, [cad.features]);
  const active = React.useMemo(
    () => hub.sections.find((section) => sectionSlug(section.title) === documentationSection) ?? null,
    [hub.sections, documentationSection],
  );
  const impactedSources = React.useMemo(() => new Set(impacts.map((impact) => impact.source)), [impacts]);
  const aiChanges = React.useMemo(() => {
    const modifiedByName = new Map(documents.map((document) => [document.name, document.modified]));
    return impacts
      .flatMap((impact) =>
        impact.changes.map((change, index) => ({
          id: `${impact.source}-${index}-${change}`,
          source: impact.source,
          description: change,
          happenedAt: modifiedByName.get(impact.source),
        })),
      )
      .sort((a, b) => (b.happenedAt ? Date.parse(b.happenedAt) : 0) - (a.happenedAt ? Date.parse(a.happenedAt) : 0));
  }, [documents, impacts]);

  React.useEffect(() => {
    Promise.all([api.listDocuments(), api.listHub(), api.getCAD(), api.listImpacts().catch(() => [])])
      .then(([docs, documentationHub, cadModel, cadImpacts]) => {
        setDocuments(docs);
        setHub(normalizeHub(documentationHub));
        setCAD(normalizeCAD(cadModel));
        setImpacts(cadImpacts ?? []);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload(files);
      setDocuments(await api.listDocuments());
      if (res.hub) setHub(normalizeHub(res.hub));
      if (res.cad) setCAD(normalizeCAD(res.cad));
      setImpacts(res.impacts ?? []);
      if (res.hubError) setError(`Files uploaded. Documentation hub failed: ${res.hubError}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setRebuilding(true);
    try {
      await api.deleteDocument(id);
      setDocuments((items) => items.filter((item) => item.id !== id));
      const [documentationHub, cadModel, cadImpacts] = await Promise.all([
        api.listHub(),
        api.getCAD(),
        api.listImpacts().catch(() => []),
      ]);
      setHub(normalizeHub(documentationHub));
      setCAD(normalizeCAD(cadModel));
      setImpacts(cadImpacts ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  async function handlePreview(id: string) {
    setPreviewing(true);
    setError(null);
    try {
      setPreviewDocument(await api.getDocument(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRebuild() {
    setError(null);
    setRebuilding(true);
    try {
      setHub(normalizeHub(await api.rebuildHub()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setQuestion("");
    setBusy(true);
    setError(null);
    setMessages((items) => [...items, { role: "user", content: text }]);
    try {
      const res = await api.chat(text);
      setCAD(normalizeCAD(res.cad));
      api.listImpacts().then((cadImpacts) => setImpacts(cadImpacts ?? [])).catch(() => undefined);
      const responseSources = Array.isArray(res.sources) ? res.sources : [];
      const sources =
        responseSources.length > 0
          ? "\n\nSources: " + Array.from(new Set(responseSources.map((source) => source.name))).join(", ")
          : "";
      setMessages((items) => [...items, { role: "assistant", content: res.answer + sources }]);
    } catch (err) {
      setError((err as Error).message);
      setMessages((items) => [...items, { role: "assistant", content: "Answer failed. Check backend Codex CLI output." }]);
    } finally {
      setBusy(false);
    }
  }

  const navItems = [
    { id: "dashboard" as const, label: "Control Overview", icon: LayoutDashboard, badge: 0 },
    { id: "docs" as const, label: "Knowledge Index", icon: FolderKanban, badge: 0 },
    { id: "workspace" as const, label: "CAD Copilot", icon: Box, badge: 0 },
    { id: "changes" as const, label: "Directive Audit", icon: Wand2, badge: impacts.length },
  ];

  return (
    <main className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-48 shrink-0 flex-col bg-muted/40 px-3 py-4 xl:w-56">
        <button type="button" onClick={onHome} className="flex flex-col rounded-md px-2 py-1 text-left transition-colors hover:bg-muted">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronLeft className="size-3.5" />
            Projects
          </span>
          <span className="text-lg font-semibold tracking-tight">Smiley</span>
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">ENG-MFG / SMY-01</span>
        </button>
        <nav className="mt-5 flex flex-col gap-1">
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors " +
                  (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                <item.icon className="size-4" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge > 0 && (
                  <span
                    className={
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
                      (active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground")
                    }
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            <span className="font-mono text-[10px] uppercase tracking-wider">System nominal</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wide">
            <span>Artifacts</span>
            <span className="text-right text-foreground">{documents.length}</span>
            <span>Index pages</span>
            <span className="text-right text-foreground">{pageCount}</span>
            <span>CAD features</span>
            <span className="text-right text-foreground">{featureCount}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="shrink-0 bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground/90">{error}</div>
        )}

        {tab === "dashboard" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
            <div className="shrink-0 pb-4">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold tracking-normal">Engineering Control Overview</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Source-grounded knowledge ingestion, constraint-aware CAD state, and directive traceability.
              </p>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 pb-4 xl:grid-cols-4">
              <div className="rounded-lg bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  Source artifacts
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">{documents.length}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">filesystem corpus</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Database className="size-3.5" />
                  Indexed pages
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">{pageCount}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">structured knowledge hub</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Braces className="size-3.5" />
                  CAD features
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">{featureCount}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">state-driven geometry</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="size-3.5" />
                  Applied directives
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">{aiChanges.length}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">document overlay events</div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="flex min-h-52 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center gap-2 pb-3">
                <Wand2 className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">CAD directive event stream</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-auto pr-1">
                {aiChanges.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                    No document-layer CAD directives applied.
                  </div>
                ) : (
                  <div className="divide-y rounded-lg bg-muted/40">
                    {aiChanges.map((change) => (
                      <div key={change.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Wand2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <span className="truncate text-sm">{change.description}</span>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="size-3" />
                          {formatTimestamp(change.happenedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
              <section className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-muted/40 p-4">
                <div className="flex items-center gap-2">
                  <Network className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Runtime pipeline</h3>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Local artifact processing path for knowledge and CAD operations.</p>
                <div className="mt-4 space-y-3">
                  <PipelineStage icon={UploadCloud} label="01 / INGEST" detail="Multipart artifact upload" />
                  <PipelineStage icon={ScanSearch} label="02 / INDEX" detail="Structured hub extraction" />
                  <PipelineStage icon={Cpu} label="03 / RETRIEVE" detail="Token-ranked source context" />
                  <PipelineStage icon={ShieldCheck} label="04 / VALIDATE" detail="Constraint-aware CAD output" />
                </div>
                <div className="mt-auto border-t pt-3">
                  <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>Model state</span>
                    <span className="text-foreground">{cad.updatedAt ? formatTimestamp(cad.updatedAt) : "Initialized"}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : tab === "docs" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 xl:flex-row xl:overflow-hidden">
            <section className="flex max-h-96 w-full shrink-0 flex-col gap-3 overflow-hidden xl:max-h-none xl:w-72">
              <button
                className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 px-4 text-center transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                onClick={() => fileInput.current?.click()}
                type="button"
                disabled={uploading}
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
                <span className="text-sm font-medium">{uploading ? "Extracting knowledge graph" : "Ingest technical artifacts"}</span>
                <span className="text-xs text-muted-foreground">TXT · Markdown · CSV · JSON · code · HTML</span>
              </button>
              <input
                ref={fileInput}
                className="hidden"
                type="file"
                multiple
                onChange={(event) => handleUpload(event.target.files)}
              />
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pr-1">
                {documents.length === 0 ? (
                  <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">No source artifacts ingested.</div>
                ) : (
                  documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-1 rounded-md bg-muted/40 px-1 py-1">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent"
                        onClick={() => handlePreview(doc.id)}
                        disabled={previewing}
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{doc.name}</span>
                            {impactedSources.has(doc.name) && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                <Wand2 className="size-2.5" />
                                CAD
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            {formatBytes(doc.size)} · {formatTimestamp(doc.modified)}
                          </div>
                        </div>
                      </button>
                      <Button
                        aria-label={`Delete ${doc.name}`}
                        title={`Delete ${doc.name}`}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(doc.id)}
                        disabled={rebuilding || uploading}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold tracking-normal">Technical Knowledge Index</h2>
                </div>
                <Button variant="outline" size="sm" onClick={handleRebuild} disabled={rebuilding || uploading || documents.length === 0}>
                  {rebuilding ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Re-index
                </Button>
              </div>
              <div className="shrink-0 pb-3 text-sm text-muted-foreground">
                {rebuilding || uploading ? "Codex extraction pass active: rebuilding structured index from local source artifacts." : hub.summary}
              </div>
              <div className="min-h-0 flex-1 overflow-auto pr-1">
                {hub.sections.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                    No structured index generated from ingested artifacts.
                  </div>
                ) : active ? (
                  <article className="space-y-4">
                    <button
                      type="button"
                      onClick={() => onDocumentationSectionChange()}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="size-4" />
                      Index sections
                    </button>
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight">{active.title}</h3>
                      {active.description && <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>}
                    </div>
                    <div className="space-y-5">
                      {active.pages.map((page) => (
                        <section key={`${active.title}-${page.title}-${page.source}`} className="space-y-2">
                          <h4 className="text-sm font-semibold">{page.title}</h4>
                          <p className="whitespace-pre-line text-sm leading-6">{page.body}</p>
                          {page.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {page.tags.map((tag) => (
                                <span key={tag} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {page.related.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              Related:
                              {page.related.map((rel) => {
                                const target = sectionForPage(hub, rel);
                                return target ? (
                                  <button
                                    key={rel}
                                    type="button"
                                    onClick={() => onDocumentationSectionChange(target)}
                                    className="text-primary hover:underline"
                                  >
                                    [[{rel}]]
                                  </button>
                                ) : (
                                  <span key={rel} className="text-muted-foreground">[[{rel}]]</span>
                                );
                              })}
                            </div>
                          )}
                          {page.source && <div className="text-xs text-muted-foreground">Source: {page.source}</div>}
                        </section>
                      ))}
                    </div>
                  </article>
                ) : (
                  <nav className="flex flex-col gap-1">
                    {hub.sections.map((section) => (
                      <button
                        key={section.title}
                        type="button"
                        onClick={() => onDocumentationSectionChange(section.title)}
                        className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium text-primary">{section.title}</span>
                        <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                          {section.pages.length}
                        </span>
                      </button>
                    ))}
                  </nav>
                )}
              </div>
            </section>
          </div>
        ) : tab === "workspace" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 xl:flex-row xl:overflow-hidden">
            <section className="flex min-h-[26rem] basis-3/5 flex-col overflow-hidden">
              <CADPreview cad={cad} />
            </section>

            <section className="flex min-h-[20rem] basis-2/5 flex-col overflow-hidden rounded-lg bg-muted/40">
              <div className="flex shrink-0 items-center gap-2 px-4 py-3">
                <MessageSquareText className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold tracking-normal">Engineering Copilot</h2>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={message.role === "user" ? "ml-auto max-w-[82%]" : "mr-auto max-w-[86%]"}
                  >
                    <div
                      className={
                        message.role === "user"
                          ? "rounded-lg bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground"
                          : "rounded-lg bg-background px-4 py-2.5 text-sm leading-6"
                      }
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="mr-auto flex max-w-[86%] items-center gap-2 rounded-lg bg-background px-4 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Retrieving source context and validating CAD state
                  </div>
                )}
              </div>
              <form className="shrink-0 p-3" onSubmit={handleAsk}>
                <div className="flex gap-2">
                  <Textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Query indexed artifacts or issue a CAD modification..."
                    className="min-h-14 resize-none"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <Button className="h-14 w-14 shrink-0" size="icon" type="submit" disabled={busy || !question.trim()}>
                    {busy ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="flex shrink-0 items-center gap-2 pb-1">
              <Wand2 className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold tracking-normal">CAD Directive Audit Log</h2>
            </div>
            <p className="shrink-0 pb-3 text-sm text-muted-foreground">
              Read-time document overlays applied to base CAD state. Remove source artifact to revert associated overlay.
            </p>
            <div className="min-h-0 flex-1 overflow-auto pr-1">
              {impacts.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                  No source artifact applies CAD overlay directives. Ingest artifact containing instruction such as
                  <br />
                  "no red allowed, change all red to blue".
                </div>
              ) : (
                <div className="space-y-2">
                  {impacts.map((impact) => (
                    <div key={impact.source} className="rounded-lg bg-muted/40 p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{impact.source}</span>
                        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                          {impact.changes.length} {impact.changes.length === 1 ? "change" : "changes"}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {impact.changes.map((change, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm">
                            <Wand2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <span>{change}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {previewDocument && (
        <DocumentPreview document={previewDocument} onClose={() => setPreviewDocument(null)} />
      )}
    </main>
  );
}

function DocumentPreview({ document, onClose }: { document: DocumentContent; onClose: () => void }) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-border">
        <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 id="document-preview-title" className="truncate text-sm font-semibold">
              {document.name}
            </h2>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Source artifact preview · UTF-8 text · read-only
            </div>
          </div>
          <button
            type="button"
            aria-label="Close document preview"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted/30 p-4 font-mono text-xs leading-6 text-foreground">
          {document.content}
        </pre>
      </article>
    </div>
  );
}

function PipelineStage({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-primary">
        <Icon className="size-3.5" />
      </div>
      <div>
        <div className="font-mono text-[10px] font-semibold tracking-wider text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function sectionForPage(hub: DocumentationHub, pageTitle: string): string | null {
  const needle = pageTitle.trim().toLowerCase();
  const match = hub.sections.find(
    (section) =>
      section.title.trim().toLowerCase() === needle ||
      section.pages.some((page) => page.title.trim().toLowerCase() === needle),
  );
  return match ? match.title : null;
}

function sectionSlug(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeHub(hub: DocumentationHub): DocumentationHub {
  return {
    summary: hub.summary || "No documentation generated yet.",
    updatedAt: hub.updatedAt,
    sections: Array.isArray(hub.sections) ? hub.sections : [],
  };
}

function normalizeCAD(cad: CADModel): CADModel {
  return {
    name: cad.name || "Factory Part",
    units: cad.units || "mm",
    material: cad.material || "aluminum",
    color: cad.color || "gray",
    dimensions: cad.dimensions || emptyCAD.dimensions,
    features: Array.isArray(cad.features) ? cad.features : [],
    notes: Array.isArray(cad.notes) ? cad.notes : [],
    updatedAt: cad.updatedAt,
  };
}

function CADPreview({ cad }: { cad: CADModel }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const clearHighlightRef = React.useRef<() => void>(() => undefined);
  const [selectedComponent, setSelectedComponent] = React.useState<CADSelection | null>(null);

  React.useEffect(() => setSelectedComponent(null), [cad]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 5.6);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(3, -4, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.45);
    fillLight.position.set(-4, 3, 4);
    scene.add(fillLight);

    let dragging = false;
    let dragged = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastX = 0;
    let lastY = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let highlightedMesh: THREE.Mesh | null = null;
    const highlightStates = new Map<THREE.MeshStandardMaterial, { emissive: number; intensity: number }>();
    const setMeshHighlight = (mesh: THREE.Mesh | null, highlighted: boolean) => {
      if (!mesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (highlighted) {
          highlightStates.set(material, {
            emissive: material.emissive.getHex(),
            intensity: material.emissiveIntensity,
          });
          material.emissive.setHex(0x2563eb);
          material.emissiveIntensity = 0.85;
        } else {
          const previous = highlightStates.get(material);
          if (!previous) return;
          material.emissive.setHex(previous.emissive);
          material.emissiveIntensity = previous.intensity;
          highlightStates.delete(material);
        }
      });
    };
    const highlightMesh = (mesh: THREE.Mesh | null) => {
      setMeshHighlight(highlightedMesh, false);
      highlightedMesh = mesh;
      setMeshHighlight(highlightedMesh, true);
    };
    clearHighlightRef.current = () => highlightMesh(null);
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      dragged = false;
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(event.clientX - pointerDownX) + Math.abs(event.clientY - pointerDownY) > 3) dragged = true;
      group.rotation.z += dx * 0.008;
      group.rotation.x = clamp(group.rotation.x + dy * 0.006, -1.15, 1.15);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (dragged) return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster
        .intersectObjects(group.children, true)
        .find((intersection) => intersection.object.userData.cadSelection);
      highlightMesh(hit?.object instanceof THREE.Mesh ? hit.object : null);
      setSelectedComponent((hit?.object.userData.cadSelection as CADSelection | undefined) ?? null);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.0015);
      camera.position.z = clamp(camera.position.z * factor, 1.6, 16);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };

    buildCADScene(group, cad);
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      clearHighlightRef.current = () => undefined;
      renderer.dispose();
      disposeObject(scene);
    };
  }, [cad]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-muted-foreground" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">CAD state / assembly preview</div>
            <div className="text-sm font-semibold">{cad.name}</div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              envelope {cad.dimensions.width} x {cad.dimensions.height} x {cad.dimensions.depth} {cad.units} · {cad.material} · finish {cad.color}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {cad.features.filter((feature) => feature.type !== "plate").length} features
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-primary">
            <CircleCheck className="size-3" />
            Validated state
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 rounded-lg bg-muted/40 p-2">
        <canvas ref={canvasRef} className="h-full w-full cursor-grab rounded-md active:cursor-grabbing" />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>Interactive geometry viewport</span>
          <span>Drag orbit · scroll zoom · select feature</span>
        </div>
        {selectedComponent && (
          <div className="absolute bottom-4 right-4 w-64 rounded-lg bg-background/95 p-3 shadow-lg ring-1 ring-border backdrop-blur">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{selectedComponent.label}</div>
                <div className="text-xs capitalize text-muted-foreground">{selectedComponent.type}</div>
              </div>
              <button
                type="button"
                aria-label="Close component details"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  clearHighlightRef.current();
                  setSelectedComponent(null);
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Component ID</dt>
              <dd className="truncate text-right font-mono text-[10px] uppercase">{selectedComponent.id}</dd>
              <dt className="text-muted-foreground">Feature class</dt>
              <dd className="text-right capitalize">{selectedComponent.type}</dd>
              <dt className="text-muted-foreground">Color</dt>
              <dd className="text-right">{selectedComponent.color}</dd>
              <dt className="text-muted-foreground">Envelope</dt>
              <dd className="text-right">
                {selectedComponent.dimensions.width} x {selectedComponent.dimensions.height}
                {selectedComponent.dimensions.depth !== undefined ? ` x ${selectedComponent.dimensions.depth}` : ""} {cad.units}
              </dd>
              <dt className="text-muted-foreground">Material</dt>
              <dd className="text-right">{selectedComponent.material}</dd>
            </dl>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Three.js WebGL renderer · document constraints enabled</span>
        <span>{cad.updatedAt ? `State updated ${formatTimestamp(cad.updatedAt)}` : "State initialized"}</span>
      </div>
      {cad.notes.length > 0 && (
        <div className="line-clamp-2 shrink-0 text-xs text-muted-foreground">{cad.notes[cad.notes.length - 1]}</div>
      )}
    </div>
  );
}

function buildCADScene(group: THREE.Group, cad: CADModel) {
  clearGroup(group);
  const dims = cad.dimensions;
  const maxDim = Math.max(dims.width, dims.height, dims.depth, 1);
  const scale = 3.3 / maxDim;
  const width = dims.width * scale;
  const height = dims.height * scale;
  const depth = Math.max(dims.depth * scale, 0.12);
  const topZ = depth / 2;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: cadColor(cad.color),
      metalness: materialMetalness(cad.material),
      roughness: 0.42,
    }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.cadSelection = {
    id: "body",
    label: cad.name,
    type: "body",
    color: cad.color,
    material: cad.material,
    dimensions: cad.dimensions,
  } satisfies CADSelection;
  group.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x1f2937, linewidth: 1 }),
  );
  group.add(edges);

  cad.features
    .filter((feature) => feature.type !== "plate")
    .forEach((feature) => {
      const shape = featureMesh(feature, cad, scale, width, height, topZ);
      shape.castShadow = true;
      shape.receiveShadow = true;
      shape.userData.cadSelection = {
        id: feature.id,
        label: feature.label || feature.id,
        type: feature.type,
        color: feature.color,
        material: cad.material,
        dimensions: { width: feature.width, height: feature.height },
      } satisfies CADSelection;
      group.add(shape);
    });

  const axisZ = topZ + 0.015;
  group.add(axisLine(-width / 2 - 0.28, -height / 2 - 0.18, width / 2 + 0.28, -height / 2 - 0.18, axisZ, 0x2563eb));
  group.add(axisLine(-width / 2 - 0.28, -height / 2 - 0.18, -width / 2 - 0.28, height / 2 + 0.18, axisZ, 0x16a34a));

  group.rotation.x = -0.5;
  group.rotation.z = -0.35;
}

function axisLine(x1: number, y1: number, x2: number, y2: number, z: number, color: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, y1, z), new THREE.Vector3(x2, y2, z)]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

function featureMesh(feature: CADFeature, cad: CADModel, scale: number, bodyWidth: number, bodyHeight: number, topZ: number) {
  const featureWidth = Math.max(feature.width * scale, 0.05);
  const featureHeight = Math.max(feature.height * scale, 0.05);
  const center = featureCenter(feature, cad, scale, bodyWidth, bodyHeight);
  const color = cadColor(feature.color);

  if (feature.type === "hole") {
    const radius = Math.max(featureWidth / 2, 0.04);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.035, 36),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.05, roughness: 0.7 }),
    );
    mesh.position.set(center.x, center.y, topZ + 0.02);
    return mesh;
  }

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(featureWidth, featureHeight, feature.type === "slot" ? 0.045 : 0.08),
    new THREE.MeshStandardMaterial({ color, metalness: 0.18, roughness: 0.5 }),
  );
  mesh.position.set(center.x, center.y, topZ + (feature.type === "slot" ? 0.025 : 0.045));
  return mesh;
}

function featureCenter(feature: CADFeature, cad: CADModel, scale: number, bodyWidth: number, bodyHeight: number) {
  const xIsCenter = feature.type === "hole";
  const yIsCenter = feature.type === "hole";
  const x = (feature.x + (xIsCenter ? 0 : feature.width / 2)) * scale - bodyWidth / 2;
  const y = bodyHeight / 2 - (feature.y + (yIsCenter ? 0 : feature.height / 2)) * scale;
  return { x, y };
}

function cadColor(color: string) {
  const map: Record<string, string> = {
    black: "#1f2937",
    blue: "#2563eb",
    gray: "#9ca3af",
    grey: "#9ca3af",
    green: "#16a34a",
    orange: "#f97316",
    purple: "#7c3aed",
    red: "#dc2626",
    silver: "#cbd5e1",
    white: "#f8fafc",
    yellow: "#facc15",
  };
  return map[color.toLowerCase()] ?? color;
}

function materialMetalness(material: string) {
  const value = material.toLowerCase();
  if (value.includes("steel") || value.includes("aluminum") || value.includes("metal")) return 0.62;
  if (value.includes("plastic")) return 0.05;
  return 0.24;
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (child) disposeObject(child);
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry) geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

type Project = {
  id: string;
  name: string;
  description: string;
};

const projects: Project[] = [
  { id: "smiley", name: "Smiley", description: "Constraint-aware manufacturing knowledge index with live, state-driven CAD workspace." },
];

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">Engineering Knowledge Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">Open manufacturing workspace for indexed artifacts, CAD state, and directive traceability.</p>
        </header>

        <div className="grid grid-cols-3 gap-4">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpen(project.id)}
              className="flex h-44 flex-col justify-between rounded-lg bg-muted/40 p-5 text-left transition-colors hover:bg-muted"
            >
              <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Smile className="size-5" />
              </div>
              <div>
                <div className="text-base font-semibold">{project.name}</div>
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.description}</div>
                <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-primary">ENG-MFG / Active</div>
              </div>
            </button>
          ))}

          <button
            type="button"
            className="flex h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-6" />
            <span className="text-sm font-medium">Provision workspace</span>
          </button>
        </div>
      </div>
    </main>
  );
}

function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This workspace path does not exist.</p>
        <Button className="mt-5" onClick={onHome}>
          Back to projects
        </Button>
      </div>
    </main>
  );
}

const tabPath: Record<AppTab, string> = {
  dashboard: "dashboard",
  docs: "documentation",
  workspace: "cad-chat",
  changes: "cad-changes",
};

function projectPath(projectId: string, tab: AppTab, documentationSection?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/${tabPath[tab]}`;
  if (tab !== "docs" || !documentationSection) return base;
  return `${base}/${encodeURIComponent(sectionSlug(documentationSection))}`;
}

function parseRoute(pathname: string): AppRoute {
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { page: "not-found" };
  }
  if (segments.length === 0) return { page: "home" };
  if (segments[0] !== "projects" || segments.length < 3 || segments.length > 4) return { page: "not-found" };
  if (!projects.some((project) => project.id === segments[1])) return { page: "not-found" };

  const tab = (Object.entries(tabPath).find(([, path]) => path === segments[2])?.[0] ?? null) as AppTab | null;
  if (!tab || (segments.length === 4 && tab !== "docs")) return { page: "not-found" };
  return { page: "project", projectId: segments[1], tab, documentationSection: segments[3] };
}

function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function usePathname() {
  const [pathname, setPathname] = React.useState(window.location.pathname);
  React.useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  return pathname;
}

function Root() {
  const route = parseRoute(usePathname());

  if (route.page === "home") {
    return <Home onOpen={(projectId) => navigate(projectPath(projectId, "dashboard"))} />;
  }
  if (route.page === "not-found") {
    return <NotFound onHome={() => navigate("/")} />;
  }
  return (
    <App
      tab={route.tab}
      documentationSection={route.documentationSection}
      onHome={() => navigate("/")}
      onTabChange={(tab) => navigate(projectPath(route.projectId, tab))}
      onDocumentationSectionChange={(section) => navigate(projectPath(route.projectId, "docs", section))}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
