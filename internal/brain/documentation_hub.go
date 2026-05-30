package brain

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const maxHubContextChars = 42000

type DocumentationHub struct {
	UpdatedAt time.Time              `json:"updatedAt"`
	Summary   string                 `json:"summary"`
	Sections  []DocumentationSection `json:"sections"`
}

type DocumentationSection struct {
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Pages       []DocumentationPage `json:"pages"`
}

type DocumentationPage struct {
	Title   string   `json:"title"`
	Body    string   `json:"body"`
	Source  string   `json:"source"`
	Tags    []string `json:"tags"`
	Related []string `json:"related"`
}

const DocumentationHubSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "sections"],
  "properties": {
    "summary": {
      "type": "string",
      "description": "One sentence summary of the documentation hub built from uploaded files."
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "description", "pages"],
        "properties": {
          "title": { "type": "string" },
          "description": { "type": "string" },
          "pages": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["title", "body", "source", "tags", "related"],
              "properties": {
                "title": { "type": "string" },
                "body": { "type": "string" },
                "source": { "type": "string" },
                "tags": {
                  "type": "array",
                  "items": { "type": "string" }
                },
                "related": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              }
            }
          }
        }
      }
    }
  }
}`

func BuildDocumentationHubPrompt(docs []Document) string {
	var b strings.Builder
	b.WriteString("You are building an internal company documentation hub from uploaded text documents.\n")
	b.WriteString("Do not create a URL/link directory. Create readable documentation pages that centralize fragmented information.\n")
	b.WriteString("Extract durable facts, decisions, procedures, project notes, customer context, ownership, timelines, glossary terms, and open questions.\n")
	b.WriteString("Organize pages into human-friendly sections such as Projects, Customers, People, Operations, Engineering, Sales, Legal, Finance, or Reference.\n")
	b.WriteString("Each page body should be 2-6 concise sentences or bullets. Include source filename. Use only facts in uploaded files. If evidence is thin, say what is known and what is missing.\n\n")
	b.WriteString("Uploaded documents:\n")

	written := 0
	for _, doc := range docs {
		text := strings.TrimSpace(doc.Text)
		if text == "" {
			continue
		}
		if len(text) > 9000 {
			text = text[:9000]
		}
		block := fmt.Sprintf("\nSOURCE: %s\n%s\n", doc.Name, text)
		if written+len(block) > maxHubContextChars {
			break
		}
		b.WriteString(block)
		written += len(block)
	}
	if written == 0 {
		b.WriteString("\nNo usable text found in uploaded documents.\n")
	}
	return b.String()
}

func ParseDocumentationHub(raw string) (DocumentationHub, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(raw, "```")
		raw = strings.TrimSpace(raw)
	}

	var hub DocumentationHub
	if err := json.Unmarshal([]byte(raw), &hub); err != nil {
		return DocumentationHub{}, err
	}

	hub.Sections = normalizeSections(hub.Sections)
	if hub.Sections == nil {
		hub.Sections = []DocumentationSection{}
	}
	if strings.TrimSpace(hub.Summary) == "" {
		hub.Summary = fmt.Sprintf("%d sections generated from uploaded documents.", len(hub.Sections))
	}
	return hub, nil
}

func normalizeSections(sections []DocumentationSection) []DocumentationSection {
	out := make([]DocumentationSection, 0, len(sections))
	for _, section := range sections {
		section.Title = fallback(section.Title, "Reference")
		section.Description = strings.TrimSpace(section.Description)
		section.Pages = normalizePages(section.Pages)
		if len(section.Pages) == 0 {
			continue
		}
		out = append(out, section)
	}

	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Title < out[j].Title
	})
	return out
}

func normalizePages(pages []DocumentationPage) []DocumentationPage {
	out := make([]DocumentationPage, 0, len(pages))
	seen := map[string]bool{}
	for _, page := range pages {
		page.Title = fallback(page.Title, "Untitled")
		page.Body = strings.TrimSpace(page.Body)
		if page.Body == "" || seen[strings.ToLower(page.Title)] {
			continue
		}
		seen[strings.ToLower(page.Title)] = true
		page.Source = strings.TrimSpace(page.Source)
		page.Tags = cleanLabels(page.Tags, 6)
		page.Related = cleanLabels(page.Related, 6)
		out = append(out, page)
	}

	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Title < out[j].Title
	})
	return out
}

func cleanLabels(values []string, limit int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
		if len(out) == limit {
			break
		}
	}
	return out
}

func fallback(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
