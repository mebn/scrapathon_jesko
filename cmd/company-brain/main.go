package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"company-brain/internal/brain"
)

const maxUploadBytes = 25 << 20

type server struct {
	store      string
	hubPath    string
	cadPath    string
	codexPath  string
	staticRoot string
}

type documentDTO struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

type uploadResponse struct {
	Documents []documentDTO           `json:"documents"`
	Hub       *brain.DocumentationHub `json:"hub,omitempty"`
	HubError  string                  `json:"hubError,omitempty"`
	CAD       *brain.CADModel         `json:"cad,omitempty"`
	Impacts   []brain.FileCADImpact   `json:"impacts"`
}

type chatRequest struct {
	Message string   `json:"message"`
	DocIDs  []string `json:"docIds"`
}

type chatResponse struct {
	Answer  string                `json:"answer"`
	Sources []brain.SourceSnippet `json:"sources"`
	CAD     brain.CADModel        `json:"cad"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	store := env("BRAIN_STORE", filepath.Join("data", "uploads"))
	hubPath := env("DOCUMENTATION_HUB_PATH", filepath.Join(filepath.Dir(store), "documentation-hub.json"))
	cadPath := env("CAD_STATE_PATH", filepath.Join(filepath.Dir(store), "cad-state.json"))
	codexPath := env("CODEX_BIN", "codex")
	staticRoot := env("STATIC_ROOT", filepath.Join("web", "dist"))

	if err := os.MkdirAll(store, 0o755); err != nil {
		log.Fatalf("create store: %v", err)
	}

	s := &server{store: store, hubPath: hubPath, cadPath: cadPath, codexPath: codexPath, staticRoot: staticRoot}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/cad/impacts", s.cadImpacts)
	mux.HandleFunc("/api/cad", s.cad)
	mux.HandleFunc("/api/documents", s.documents)
	mux.HandleFunc("/api/documents/", s.documentByID)
	mux.HandleFunc("/api/library/rebuild", s.rebuildHubEndpoint)
	mux.HandleFunc("/api/library", s.hub)
	mux.HandleFunc("/api/upload", s.upload)
	mux.HandleFunc("/api/chat", s.chat)
	mux.HandleFunc("/", s.static)

	addr := env("ADDR", ":8080")
	log.Printf("company brain listening on %s", addr)
	log.Printf("upload store: %s", store)
	log.Printf("documentation hub: %s", hubPath)
	log.Printf("cad state: %s", cadPath)
	log.Fatal(http.ListenAndServe(addr, withCORS(mux)))
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) documents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

	docs, err := s.listDocuments()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, docs)
}

func (s *server) cad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

	cad, _, err := s.effectiveCAD()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, cad)
}

func (s *server) cadImpacts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

	_, impacts, err := s.effectiveCAD()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, impacts)
}

// effectiveCAD returns the base CAD with every uploaded document's CAD directive
// applied on top, along with the per-file impact log. The base model (chat
// edits) is stored on disk; document directives are layered on at read time so
// removing a directive file reverts its effect.
func (s *server) effectiveCAD() (brain.CADModel, []brain.FileCADImpact, error) {
	base, err := s.readCAD()
	if err != nil {
		return brain.CADModel{}, nil, err
	}
	docs, err := brain.LoadCorpus(s.store, nil)
	if err != nil {
		return brain.CADModel{}, nil, err
	}
	effective, impacts := brain.ApplyDocumentCADDirectives(base, docs)
	return effective, impacts, nil
}

func (s *server) documentByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/documents/")
	path, err := s.safePath(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := os.Remove(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, fmt.Errorf("document not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if _, err := s.rebuildHub(r.Context()); err != nil {
		log.Printf("rebuild documentation hub after delete: %v", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) hub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

	hub, err := s.readHub()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, hub)
}

func (s *server) rebuildHubEndpoint(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}

	hub, err := s.rebuildHub(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, hub)
}

func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("upload too large or invalid multipart body"))
		return
	}
	defer r.MultipartForm.RemoveAll()

	var saved []documentDTO
	for _, files := range r.MultipartForm.File {
		for _, header := range files {
			doc, err := s.saveUpload(header)
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			saved = append(saved, doc)
		}
	}
	if len(saved) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("no files uploaded"))
		return
	}

	res := uploadResponse{Documents: saved, Impacts: []brain.FileCADImpact{}}
	hub, err := s.rebuildHub(r.Context())
	if err != nil {
		res.HubError = err.Error()
	} else {
		res.Hub = hub
	}

	if cad, impacts, err := s.effectiveCAD(); err != nil {
		log.Printf("compute cad impacts after upload: %v", err)
	} else {
		res.CAD = &cad
		res.Impacts = impacts
	}

	writeJSON(w, http.StatusCreated, res)
}

func (s *server) chat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON body"))
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("message required"))
		return
	}

	corpus, err := brain.LoadCorpus(s.store, req.DocIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	hub, err := s.readHub()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	currentCAD, _, err := s.effectiveCAD()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	snippets := brain.RankSnippets(corpus, req.Message, 8)
	if snippets == nil {
		snippets = []brain.SourceSnippet{}
	}
	prompt := brain.BuildCADChatPrompt(req.Message, snippets, hub, currentCAD)
	answer, err := runCodexJSON(r.Context(), s.codexPath, s.store, prompt, brain.CADChatSchema)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	result, err := brain.ParseCADChatResult(answer)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("parse cad chat result: %w", err))
		return
	}
	nextCAD, validationNotes := brain.ValidateCAD(result.CAD, currentCAD, hub)
	if len(validationNotes) > 0 {
		result.Answer = strings.TrimSpace(result.Answer + "\n\n" + strings.Join(validationNotes, "\n"))
	}
	if err := s.writeCAD(nextCAD); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	effectiveCAD, _, err := s.effectiveCAD()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, chatResponse{
		Answer:  strings.TrimSpace(result.Answer),
		Sources: snippets,
		CAD:     effectiveCAD,
	})
}

func (s *server) saveUpload(header *multipart.FileHeader) (documentDTO, error) {
	name := sanitizeFilename(header.Filename)
	if name == "" {
		return documentDTO{}, fmt.Errorf("invalid filename")
	}

	src, err := header.Open()
	if err != nil {
		return documentDTO{}, err
	}
	defer src.Close()

	id := fmt.Sprintf("%d-%s", time.Now().UnixNano(), name)
	path, err := s.safePath(id)
	if err != nil {
		return documentDTO{}, err
	}

	dst, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return documentDTO{}, err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return documentDTO{}, err
	}

	info, err := dst.Stat()
	if err != nil {
		return documentDTO{}, err
	}
	return documentDTO{ID: id, Name: displayName(id), Size: info.Size(), Modified: info.ModTime()}, nil
}

func (s *server) listDocuments() ([]documentDTO, error) {
	entries, err := os.ReadDir(s.store)
	if err != nil {
		return nil, err
	}

	docs := make([]documentDTO, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		docs = append(docs, documentDTO{
			ID:       entry.Name(),
			Name:     displayName(entry.Name()),
			Size:     info.Size(),
			Modified: info.ModTime(),
		})
	}

	sort.Slice(docs, func(i, j int) bool {
		return docs[i].Modified.After(docs[j].Modified)
	})
	return docs, nil
}

func (s *server) readHub() (brain.DocumentationHub, error) {
	data, err := os.ReadFile(s.hubPath)
	if errors.Is(err, os.ErrNotExist) {
		return brain.DocumentationHub{Sections: []brain.DocumentationSection{}}, nil
	}
	if err != nil {
		return brain.DocumentationHub{}, err
	}

	var hub brain.DocumentationHub
	if err := json.Unmarshal(data, &hub); err != nil {
		return brain.DocumentationHub{}, err
	}
	if hub.Sections == nil {
		hub.Sections = []brain.DocumentationSection{}
	}
	return hub, nil
}

func (s *server) rebuildHub(ctx context.Context) (*brain.DocumentationHub, error) {
	corpus, err := brain.LoadCorpus(s.store, nil)
	if err != nil {
		return nil, err
	}
	if len(corpus) == 0 {
		hub := brain.DocumentationHub{UpdatedAt: time.Now(), Sections: []brain.DocumentationSection{}}
		return &hub, s.writeHub(hub)
	}

	prompt := brain.BuildDocumentationHubPrompt(corpus)
	answer, err := runCodexJSON(ctx, s.codexPath, s.store, prompt, brain.DocumentationHubSchema)
	if err != nil {
		return nil, err
	}

	hub, err := brain.ParseDocumentationHub(answer)
	if err != nil {
		return nil, err
	}
	hub.UpdatedAt = time.Now()
	if err := s.writeHub(hub); err != nil {
		return nil, err
	}
	return &hub, nil
}

func (s *server) writeHub(hub brain.DocumentationHub) error {
	if err := os.MkdirAll(filepath.Dir(s.hubPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(hub, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.hubPath, data, 0o644)
}

func (s *server) readCAD() (brain.CADModel, error) {
	data, err := os.ReadFile(s.cadPath)
	if errors.Is(err, os.ErrNotExist) {
		cad := brain.DefaultCADModel()
		return cad, s.writeCAD(cad)
	}
	if err != nil {
		return brain.CADModel{}, err
	}

	var cad brain.CADModel
	if err := json.Unmarshal(data, &cad); err != nil {
		return brain.CADModel{}, err
	}
	return brain.NormalizeCAD(cad), nil
}

func (s *server) writeCAD(cad brain.CADModel) error {
	if err := os.MkdirAll(filepath.Dir(s.cadPath), 0o755); err != nil {
		return err
	}
	cad = brain.NormalizeCAD(cad)
	data, err := json.MarshalIndent(cad, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.cadPath, data, 0o644)
}

func (s *server) safePath(id string) (string, error) {
	if id == "" || strings.Contains(id, string(filepath.Separator)) || strings.Contains(id, "..") {
		return "", fmt.Errorf("invalid document id")
	}
	return filepath.Join(s.store, id), nil
}

func (s *server) static(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	requested := filepath.Join(s.staticRoot, filepath.FromSlash(strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")))
	if info, err := os.Stat(requested); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requested)
		return
	}

	index := filepath.Join(s.staticRoot, "index.html")
	if _, err := os.Stat(index); err == nil {
		http.ServeFile(w, r, index)
		return
	}
	http.NotFound(w, r)
}

func runCodex(ctx context.Context, codexPath, workdir, prompt string) (string, error) {
	return runCodexInternal(ctx, codexPath, workdir, prompt, "")
}

func runCodexJSON(ctx context.Context, codexPath, workdir, prompt, schema string) (string, error) {
	schemaFile, err := os.CreateTemp("", "company-brain-schema-*.json")
	if err != nil {
		return "", err
	}
	schemaPath := schemaFile.Name()
	if _, err := schemaFile.WriteString(schema); err != nil {
		schemaFile.Close()
		os.Remove(schemaPath)
		return "", err
	}
	schemaFile.Close()
	defer os.Remove(schemaPath)

	return runCodexInternal(ctx, codexPath, workdir, prompt, schemaPath)
}

func runCodexInternal(ctx context.Context, codexPath, workdir, prompt, schemaPath string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	outFile, err := os.CreateTemp("", "company-brain-answer-*.txt")
	if err != nil {
		return "", err
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	args := []string{
		"--ask-for-approval", "never",
		"--sandbox", "read-only",
		"--cd", workdir,
		"exec",
		"--ephemeral",
		"--ignore-rules",
		"--output-last-message", outPath,
	}
	if schemaPath != "" {
		args = append(args, "--output-schema", schemaPath)
	}
	args = append(args, "-")

	cmd := exec.CommandContext(ctx, codexPath, args...)
	cmd.Stdin = strings.NewReader(prompt)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("codex failed: %v\n%s", err, strings.TrimSpace(string(output)))
	}
	if answer, err := os.ReadFile(outPath); err == nil && strings.TrimSpace(string(answer)) != "" {
		return string(answer), nil
	}
	return stripCodexNoise(string(output)), nil
}

func stripCodexNoise(output string) string {
	lines := strings.Split(output, "\n")
	filtered := lines[:0]
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "Codex ") || strings.HasPrefix(trimmed, "Reading prompt") {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.TrimSpace(strings.Join(filtered, "\n"))
}

func sanitizeFilename(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, " ", "_")
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), ".-_")
}

func displayName(id string) string {
	parts := strings.SplitN(id, "-", 2)
	if len(parts) == 2 {
		return strings.ReplaceAll(parts[1], "_", " ")
	}
	return strings.ReplaceAll(id, "_", " ")
}

func methodNotAllowed(w http.ResponseWriter, allowed ...string) {
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, errorResponse{Error: err.Error()})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", env("CORS_ORIGIN", "http://localhost:5173"))
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
