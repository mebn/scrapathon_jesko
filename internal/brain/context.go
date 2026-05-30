package brain

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	maxDocumentBytes = 1 << 20
	maxSnippetChars  = 2200
)

var tokenRe = regexp.MustCompile(`[A-Za-z0-9_]{3,}`)

type Document struct {
	ID   string
	Name string
	Text string
}

type SourceSnippet struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Excerpt string `json:"excerpt"`
	Score   int    `json:"score"`
}

func LoadCorpus(store string, ids []string) ([]Document, error) {
	want := map[string]bool{}
	for _, id := range ids {
		if cleanID(id) != id {
			continue
		}
		want[id] = true
	}

	entries, err := os.ReadDir(store)
	if err != nil {
		return nil, err
	}

	var docs []Document
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		id := entry.Name()
		if len(want) > 0 && !want[id] {
			continue
		}
		text, err := readText(filepath.Join(store, id))
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		docs = append(docs, Document{
			ID:   id,
			Name: displayName(id),
			Text: text,
		})
	}
	return docs, nil
}

func RankSnippets(docs []Document, query string, limit int) []SourceSnippet {
	queryTerms := terms(query)
	if len(queryTerms) == 0 {
		queryTerms = map[string]bool{}
	}

	var snippets []SourceSnippet
	for _, doc := range docs {
		for _, chunk := range chunkText(doc.Text, maxSnippetChars) {
			score := scoreText(chunk, queryTerms)
			if score == 0 && len(queryTerms) > 0 {
				continue
			}
			snippets = append(snippets, SourceSnippet{
				ID:      doc.ID,
				Name:    doc.Name,
				Excerpt: strings.TrimSpace(chunk),
				Score:   score,
			})
		}
	}

	sort.SliceStable(snippets, func(i, j int) bool {
		if snippets[i].Score == snippets[j].Score {
			return snippets[i].Name < snippets[j].Name
		}
		return snippets[i].Score > snippets[j].Score
	})

	if len(snippets) > limit {
		snippets = snippets[:limit]
	}
	return snippets
}

func BuildPrompt(question string, snippets []SourceSnippet) string {
	var b strings.Builder
	b.WriteString("You are the company brain. Answer the user's question using only the provided company documents.\n")
	b.WriteString("If the documents do not contain the answer, say what is missing. Cite sources by filename in the answer.\n")
	b.WriteString("Keep answers concise and specific.\n\n")
	b.WriteString("Company document snippets:\n")
	if len(snippets) == 0 {
		b.WriteString("(No matching snippets found.)\n")
	}
	for i, snippet := range snippets {
		fmt.Fprintf(&b, "\n[%d] %s\n%s\n", i+1, snippet.Name, snippet.Excerpt)
	}
	b.WriteString("\nUser question:\n")
	b.WriteString(question)
	b.WriteString("\n")
	return b.String()
}

func readText(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(data) > maxDocumentBytes {
		data = data[:maxDocumentBytes]
	}
	if !utf8.Valid(data) {
		return "", nil
	}
	return string(data), nil
}

func chunkText(text string, size int) []string {
	text = strings.TrimSpace(text)
	if len(text) <= size {
		return []string{text}
	}

	var chunks []string
	for len(text) > 0 {
		end := size
		if end > len(text) {
			end = len(text)
		}
		cut := strings.LastIndexAny(text[:end], "\n.")
		if cut > size/2 {
			end = cut + 1
		}
		chunks = append(chunks, text[:end])
		text = strings.TrimSpace(text[end:])
	}
	return chunks
}

func scoreText(text string, queryTerms map[string]bool) int {
	if len(queryTerms) == 0 {
		return 1
	}
	score := 0
	for _, token := range tokenRe.FindAllString(strings.ToLower(text), -1) {
		if queryTerms[token] {
			score++
		}
	}
	return score
}

func terms(text string) map[string]bool {
	out := map[string]bool{}
	for _, token := range tokenRe.FindAllString(strings.ToLower(text), -1) {
		out[token] = true
	}
	return out
}

func cleanID(id string) string {
	if strings.Contains(id, "/") || strings.Contains(id, "\\") || strings.Contains(id, "..") {
		return ""
	}
	return id
}

func displayName(id string) string {
	parts := strings.SplitN(id, "-", 2)
	if len(parts) == 2 {
		return strings.ReplaceAll(parts[1], "_", " ")
	}
	return strings.ReplaceAll(id, "_", " ")
}
