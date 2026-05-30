package brain

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type CADModel struct {
	UpdatedAt  time.Time     `json:"updatedAt"`
	Name       string        `json:"name"`
	Units      string        `json:"units"`
	Material   string        `json:"material"`
	Color      string        `json:"color"`
	Dimensions CADDimensions `json:"dimensions"`
	Features   []CADFeature  `json:"features"`
	Notes      []string      `json:"notes"`
}

type CADDimensions struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Depth  float64 `json:"depth"`
}

type CADFeature struct {
	ID     string  `json:"id"`
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Label  string  `json:"label"`
	Color  string  `json:"color"`
}

type CADChatResult struct {
	Answer string   `json:"answer"`
	CAD    CADModel `json:"cad"`
}

type CADConstraints struct {
	ForbiddenColors []string `json:"forbiddenColors"`
	Notes           []string `json:"notes"`
}

var colorNames = []string{"blue", "red", "green", "yellow", "black", "white", "orange", "purple", "gray", "grey", "silver"}

const CADChatSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["answer", "cad"],
  "properties": {
    "answer": { "type": "string" },
    "cad": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "units", "material", "color", "dimensions", "features", "notes"],
      "properties": {
        "name": { "type": "string" },
        "units": { "type": "string" },
        "material": { "type": "string" },
        "color": { "type": "string" },
        "dimensions": {
          "type": "object",
          "additionalProperties": false,
          "required": ["width", "height", "depth"],
          "properties": {
            "width": { "type": "number" },
            "height": { "type": "number" },
            "depth": { "type": "number" }
          }
        },
        "features": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "type", "x", "y", "width", "height", "label", "color"],
            "properties": {
              "id": { "type": "string" },
              "type": { "type": "string" },
              "x": { "type": "number" },
              "y": { "type": "number" },
              "width": { "type": "number" },
              "height": { "type": "number" },
              "label": { "type": "string" },
              "color": { "type": "string" }
            }
          }
        },
        "notes": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  }
}`

func DefaultCADModel() CADModel {
	return CADModel{
		UpdatedAt: time.Now(),
		Name:      "Factory Part",
		Units:     "mm",
		Material:  "aluminum",
		Color:     "gray",
		Dimensions: CADDimensions{
			Width:  120,
			Height: 70,
			Depth:  18,
		},
		Features: []CADFeature{
			{ID: "base", Type: "plate", X: 0, Y: 0, Width: 120, Height: 70, Label: "base plate", Color: "gray"},
			{ID: "mount-a", Type: "hole", X: 20, Y: 18, Width: 12, Height: 12, Label: "M6", Color: "white"},
			{ID: "mount-b", Type: "hole", X: 100, Y: 18, Width: 12, Height: 12, Label: "M6", Color: "white"},
			{ID: "channel", Type: "slot", X: 35, Y: 44, Width: 50, Height: 10, Label: "cable slot", Color: "silver"},
		},
		Notes: []string{"Starter CAD model. Ask chat to change dimensions, material, color, or features."},
	}
}

func BuildCADChatPrompt(question string, snippets []SourceSnippet, hub DocumentationHub, cad CADModel) string {
	cadJSON, _ := json.MarshalIndent(cad, "", "  ")
	var b strings.Builder
	b.WriteString("You are a company brain and CAD assistant.\n")
	b.WriteString("Answer the user and update the CAD model only when the user asks for a CAD/product/design change.\n")
	b.WriteString("Treat uploaded docs and documentation hub as a BLOCKLIST, not an allowlist.\n")
	b.WriteString("Only explicit prohibitions block CAD changes: cannot, unsupported, forbidden, unavailable, no X, do not use X.\n")
	b.WriteString("If docs do not mention a requested color/material/feature, it is allowed. Never refuse because something is absent from known supported options.\n")
	b.WriteString("Example: if docs say factory cannot do blue, do not set model or feature color to blue; explain refusal and keep/use an allowed previous color.\n")
	b.WriteString("Return JSON only, matching schema. Always include full CAD model.\n\n")
	b.WriteString("Current CAD model:\n")
	b.WriteString(string(cadJSON))
	b.WriteString("\n\nDocumentation hub constraints/context:\n")
	b.WriteString(CompactHub(hub, 9000))
	b.WriteString("\n\nRelevant source snippets:\n")
	if len(snippets) == 0 {
		b.WriteString("(No matching snippets found.)\n")
	}
	for i, snippet := range snippets {
		fmt.Fprintf(&b, "\n[%d] %s\n%s\n", i+1, snippet.Name, snippet.Excerpt)
	}
	b.WriteString("\nUser request:\n")
	b.WriteString(question)
	b.WriteString("\n")
	return b.String()
}

func ParseCADChatResult(raw string) (CADChatResult, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(raw, "```")
		raw = strings.TrimSpace(raw)
	}

	var result CADChatResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return CADChatResult{}, err
	}
	result.CAD = NormalizeCAD(result.CAD)
	if strings.TrimSpace(result.Answer) == "" {
		result.Answer = "CAD updated."
	}
	return result, nil
}

func NormalizeCAD(cad CADModel) CADModel {
	if strings.TrimSpace(cad.Name) == "" {
		cad.Name = "Factory Part"
	}
	if strings.TrimSpace(cad.Units) == "" {
		cad.Units = "mm"
	}
	if strings.TrimSpace(cad.Material) == "" {
		cad.Material = "aluminum"
	}
	if strings.TrimSpace(cad.Color) == "" {
		cad.Color = "gray"
	}
	if cad.Dimensions.Width <= 0 {
		cad.Dimensions.Width = 120
	}
	if cad.Dimensions.Height <= 0 {
		cad.Dimensions.Height = 70
	}
	if cad.Dimensions.Depth <= 0 {
		cad.Dimensions.Depth = 18
	}
	if len(cad.Features) == 0 {
		cad.Features = DefaultCADModel().Features
	}
	if cad.Notes == nil {
		cad.Notes = []string{}
	}
	cad.UpdatedAt = time.Now()
	return cad
}

func ValidateCAD(cad CADModel, previous CADModel, hub DocumentationHub) (CADModel, []string) {
	cad = NormalizeCAD(cad)
	constraints := ExtractCADConstraints(hub)
	var notes []string
	for _, color := range constraints.ForbiddenColors {
		if sameColor(cad.Color, color) {
			cad.Color = previous.Color
			notes = append(notes, fmt.Sprintf("Rejected color %q because documentation hub marks it unavailable.", color))
		}
		for i := range cad.Features {
			if sameColor(cad.Features[i].Color, color) {
				cad.Features[i].Color = previousFeatureColor(previous, cad.Features[i].ID, cad.Color)
				notes = append(notes, fmt.Sprintf("Rejected feature color %q because documentation hub marks it unavailable.", color))
			}
		}
	}
	cad.Notes = append(cad.Notes, notes...)
	return cad, notes
}

func ExtractCADConstraints(hub DocumentationHub) CADConstraints {
	text := strings.ToLower(CompactHub(hub, 20000))
	var forbidden []string
	var notes []string
	for _, color := range colorNames {
		patterns := []string{
			`cannot[^.]{0,80}` + regexp.QuoteMeta(color),
			`can't[^.]{0,80}` + regexp.QuoteMeta(color),
			`cant[^.]{0,80}` + regexp.QuoteMeta(color),
			`can not[^.]{0,80}` + regexp.QuoteMeta(color),
			`no[^.]{0,40}` + regexp.QuoteMeta(color),
			regexp.QuoteMeta(color) + `[^.]{0,40}(unavailable|not available|forbidden|unsupported|not supported)`,
		}
		for _, pattern := range patterns {
			if regexp.MustCompile(pattern).MatchString(text) {
				forbidden = appendUnique(forbidden, color)
				notes = append(notes, "Documentation hub restricts "+color)
				break
			}
		}
	}
	return CADConstraints{ForbiddenColors: forbidden, Notes: notes}
}

func CompactHub(hub DocumentationHub, limit int) string {
	var b strings.Builder
	if strings.TrimSpace(hub.Summary) != "" {
		b.WriteString("Summary: ")
		b.WriteString(hub.Summary)
		b.WriteString("\n")
	}
	for _, section := range hub.Sections {
		fmt.Fprintf(&b, "\nSection: %s\n%s\n", section.Title, section.Description)
		for _, page := range section.Pages {
			fmt.Fprintf(&b, "- %s: %s Source: %s Tags: %s\n", page.Title, page.Body, page.Source, strings.Join(page.Tags, ", "))
			if b.Len() > limit {
				return b.String()[:limit]
			}
		}
	}
	if b.Len() == 0 {
		return "(No documentation hub content yet.)"
	}
	return b.String()
}

func previousFeatureColor(previous CADModel, id, fallback string) string {
	for _, feature := range previous.Features {
		if feature.ID == id && strings.TrimSpace(feature.Color) != "" {
			return feature.Color
		}
	}
	return fallback
}

func sameColor(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
