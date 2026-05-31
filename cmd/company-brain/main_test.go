package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticServesSPAFallbackForDeepLinks(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("spa index"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("app asset"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &server{staticRoot: root}

	tests := []struct {
		path       string
		statusCode int
		body       string
	}{
		{path: "/projects/smiley/dashboard", statusCode: http.StatusOK, body: "spa index"},
		{path: "/app.js", statusCode: http.StatusOK, body: "app asset"},
		{path: "/api/missing", statusCode: http.StatusNotFound, body: "404 page not found"},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, test.path, nil)
			recorder := httptest.NewRecorder()
			s.static(recorder, req)

			if recorder.Code != test.statusCode {
				t.Fatalf("status = %d, want %d", recorder.Code, test.statusCode)
			}
			if body := strings.TrimSpace(recorder.Body.String()); body != test.body {
				t.Fatalf("body = %q, want %q", body, test.body)
			}
		})
	}
}
