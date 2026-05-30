import React from "react";
import ReactDOM from "react-dom/client";
import * as THREE from "three";
import {
  BookOpenText,
  Box,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Textarea } from "./components/ui/textarea";
import "./styles.css";

type DocumentItem = {
  id: string;
  name: string;
  size: number;
  modified: string;
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

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  answer: string;
  sources: { id: string; name: string; excerpt: string; score: number }[];
  cad: CADModel;
};

type UploadResponse = {
  documents: DocumentItem[];
  hub?: DocumentationHub;
  hubError?: string;
};

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
  async listDocuments() {
    const res = await fetch("/api/documents");
    return readJSON<DocumentItem[]>(res);
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

function App() {
  const [documents, setDocuments] = React.useState<DocumentItem[]>([]);
  const [hub, setHub] = React.useState<DocumentationHub>(emptyHub);
  const [cad, setCAD] = React.useState<CADModel>(emptyCAD);
  const [messages, setMessages] = React.useState<Message[]>([
    { role: "assistant", content: "Upload docs, then ask. I answer from stored files and cite names." },
  ]);
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const pageCount = React.useMemo(() => hub.sections.reduce((total, section) => total + section.pages.length, 0), [hub.sections]);

  React.useEffect(() => {
    Promise.all([api.listDocuments(), api.listHub(), api.getCAD()])
      .then(([docs, documentationHub, cadModel]) => {
        setDocuments(docs);
        setHub(normalizeHub(documentationHub));
        setCAD(normalizeCAD(cadModel));
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
      setHub(normalizeHub(await api.listHub()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRebuilding(false);
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

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1540px] flex-col gap-5 px-4 py-5 md:px-6">
        <header className="shrink-0 flex flex-col gap-2 border-b pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Company Brain</h1>
            <p className="text-sm text-muted-foreground">Upload fragments, generate docs, ask against local files.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>{documents.length} documents</span>
            <span>{pageCount} pages</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[330px_minmax(420px,1fr)_440px]">
          <section className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <Card className="shrink-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UploadCloud className="size-4" />
                  Upload
                </CardTitle>
              </CardHeader>
              <CardContent>
                <button
                  className="flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input bg-muted/30 px-4 text-center transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={() => fileInput.current?.click()}
                  type="button"
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
                  <span className="text-sm font-medium">
                    {uploading ? "Structuring uploaded files" : "Choose text documents"}
                  </span>
                  <span className="text-xs text-muted-foreground">TXT, Markdown, CSV, JSON, logs, code, HTML, XML</span>
                </button>
                <input
                  ref={fileInput}
                  className="hidden"
                  type="file"
                  multiple
                  onChange={(event) => handleUpload(event.target.files)}
                />
              </CardContent>
            </Card>

            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4" />
                  Documents
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-hidden">
                <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto pr-1">
                  {documents.length === 0 ? (
                    <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">No uploads yet.</div>
                  ) : (
                    documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{doc.name}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(doc.size)}</div>
                        </div>
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
              </CardContent>
            </Card>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b p-4">
              <div className="flex items-center gap-2">
                <FolderKanban className="size-4" />
                <h2 className="text-base font-semibold tracking-normal">Documentation Hub</h2>
              </div>
              <Button variant="outline" size="sm" onClick={handleRebuild} disabled={rebuilding || uploading || documents.length === 0}>
                {rebuilding ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Rebuild
              </Button>
            </div>
            <div className="shrink-0 border-b p-4">
              <CADPreview cad={cad} />
            </div>
            <div className="shrink-0 border-b px-4 py-3 text-sm text-muted-foreground">
              {rebuilding || uploading ? "Codex is reading uploaded files and generating documentation." : hub.summary}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {hub.sections.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  No documentation generated from uploaded files.
                </div>
              ) : (
                <div className="space-y-5">
                  {hub.sections.map((section) => (
                    <div key={section.title} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <BookOpenText className="size-4 text-muted-foreground" />
                            {section.title}
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                              {section.pages.length}
                            </span>
                          </div>
                          {section.description && (
                            <div className="mt-1 text-sm text-muted-foreground">{section.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-2 2xl:grid-cols-2">
                        {section.pages.map((page) => (
                          <article key={`${section.title}-${page.title}-${page.source}`} className="rounded-lg border bg-background p-3">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">{page.title}</div>
                              </div>
                            </div>
                            <p className="mt-2 whitespace-pre-line text-sm leading-5">{page.body}</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {page.tags.map((tag) => (
                                <span key={tag} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                  {tag}
                                </span>
                              ))}
                            </div>
                            {page.related.length > 0 && (
                              <div className="mt-2 text-xs text-muted-foreground">Related: {page.related.join(", ")}</div>
                            )}
                            {page.source && <div className="mt-2 text-xs text-muted-foreground">Source: {page.source}</div>}
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
            <div className="shrink-0 flex items-center gap-2 border-b p-4">
              <MessageSquareText className="size-4" />
              <h2 className="text-base font-semibold tracking-normal">Ask</h2>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === "user" ? "ml-auto max-w-[82%]" : "mr-auto max-w-[86%]"}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground"
                        : "rounded-lg border bg-background px-4 py-3 text-sm leading-6"
                    }
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="mr-auto flex max-w-[86%] items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Codex reading uploaded docs
                </div>
              )}
            </div>
            <form className="shrink-0 border-t p-4" onSubmit={handleAsk}>
              {error && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">{error}</div>}
              <div className="flex gap-3">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about docs or modify the CAD..."
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
      </div>
    </main>
  );
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
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
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
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

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
      renderer.dispose();
      disposeObject(scene);
    };
  }, [cad]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">{cad.name}</div>
            <div className="text-xs text-muted-foreground">
              {cad.dimensions.width} x {cad.dimensions.height} x {cad.dimensions.depth} {cad.units} · {cad.material} · {cad.color}
            </div>
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">Live CAD</div>
      </div>
      <div className="rounded-lg border bg-background p-2">
        <canvas ref={canvasRef} className="h-[280px] w-full cursor-grab rounded-md active:cursor-grabbing" />
      </div>
      {cad.notes.length > 0 && (
        <div className="line-clamp-2 text-xs text-muted-foreground">{cad.notes[cad.notes.length - 1]}</div>
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
