package brain

import (
	"fmt"
	"regexp"
	"strings"
)

// FileCADImpact records that a single uploaded document changed the CAD model,
// and what it changed. It powers the "CAD Changes" tab in the UI.
type FileCADImpact struct {
	Source  string   `json:"source"`
	Changes []string `json:"changes"`
}

// colorRule is a single color directive parsed from a document. When to is
// empty the rule is a prohibition (recolor the source color to a safe fallback).
type colorRule struct {
	from string
	to   string
}

var colorAlternation = func() string {
	// Longest-first so "grey" never partially matches before "green", etc.
	parts := make([]string, len(colorNames))
	copy(parts, colorNames)
	for i := 0; i < len(parts); i++ {
		for j := i + 1; j < len(parts); j++ {
			if len(parts[j]) > len(parts[i]) {
				parts[i], parts[j] = parts[j], parts[i]
			}
		}
	}
	return strings.Join(parts, "|")
}()

var (
	reColorReplace = regexp.MustCompile(`(?:change|replace|switch|swap|convert|recolor|recolour|turn|repaint|paint)\s+(?:all\s+|the\s+|any\s+|every\s+)*(` + colorAlternation + `)\s+(?:to|with|into|for)\s+(` + colorAlternation + `)`)
	reColorArrow   = regexp.MustCompile(`(` + colorAlternation + `)\s*(?:->|=>|→)\s*(` + colorAlternation + `)`)
	reColorBecome  = regexp.MustCompile(`(` + colorAlternation + `)\s+(?:should\s+be|shall\s+be|must\s+be|to\s+be|becomes?)\s+(` + colorAlternation + `)`)
)

// ApplyDocumentCADDirectives applies every CAD directive found in docs on top of
// the base model and returns the resulting model plus the per-file impact log.
func ApplyDocumentCADDirectives(base CADModel, docs []Document) (CADModel, []FileCADImpact) {
	effective := cloneCAD(base)
	impacts := make([]FileCADImpact, 0)
	for _, doc := range docs {
		rules := detectColorRules(doc.Text)
		if len(rules) == 0 {
			continue
		}
		changes := applyColorRules(&effective, rules)
		if len(changes) > 0 {
			impacts = append(impacts, FileCADImpact{Source: doc.Name, Changes: changes})
		}
	}
	return NormalizeCAD(effective), impacts
}

func detectColorRules(text string) []colorRule {
	lower := strings.ToLower(text)
	var rules []colorRule
	seen := map[string]bool{}
	add := func(from, to string) {
		from = canonColor(from)
		to = canonColor(to)
		if from == "" || from == to {
			return
		}
		key := from + "->" + to
		if seen[key] {
			return
		}
		seen[key] = true
		rules = append(rules, colorRule{from: from, to: to})
	}

	for _, re := range []*regexp.Regexp{reColorReplace, reColorArrow, reColorBecome} {
		for _, m := range re.FindAllStringSubmatch(lower, -1) {
			add(m[1], m[2])
		}
	}

	for _, color := range colorNames {
		q := regexp.QuoteMeta(color)
		patterns := []string{
			`\bno\s+(?:more\s+)?` + q + `\b`,
			q + `\s+(?:is\s+|are\s+|color\s+is\s+)?(?:not\s+allowed|forbidden|banned|prohibited|unavailable|not\s+available|not\s+permitted|disallowed)`,
			`(?:cannot|can't|cant|can\s*not|do\s*not\s*use|don't\s*use|avoid|never\s+use)\b[^.\n]{0,40}` + q,
		}
		for _, p := range patterns {
			if regexp.MustCompile(p).MatchString(lower) {
				add(color, "")
				break
			}
		}
	}
	return rules
}

// applyColorRules mutates cad and returns a human-readable list of the changes
// it made. Replacement rules run before prohibitions so "change red to blue"
// satisfies a co-located "no red" without a second recolor.
func applyColorRules(cad *CADModel, rules []colorRule) []string {
	var changes []string

	recolor := func(from, to, reason string) {
		if sameColor(cad.Color, from) {
			cad.Color = to
			changes = append(changes, fmt.Sprintf("Body color %s → %s%s", from, to, reason))
		}
		for i := range cad.Features {
			if sameColor(cad.Features[i].Color, from) {
				label := featureLabel(cad.Features[i])
				cad.Features[i].Color = to
				changes = append(changes, fmt.Sprintf("%s color %s → %s%s", label, from, to, reason))
			}
		}
	}

	for _, rule := range rules {
		if rule.to == "" {
			continue
		}
		recolor(rule.from, rule.to, "")
	}
	for _, rule := range rules {
		if rule.to != "" {
			continue
		}
		fallback := "gray"
		if sameColor(fallback, rule.from) {
			fallback = "silver"
		}
		recolor(rule.from, fallback, " (not allowed)")
	}
	return changes
}

func canonColor(color string) string {
	color = strings.TrimSpace(strings.ToLower(color))
	if color == "grey" {
		return "gray"
	}
	return color
}

func featureLabel(feature CADFeature) string {
	if label := strings.TrimSpace(feature.Label); label != "" {
		return label
	}
	if id := strings.TrimSpace(feature.ID); id != "" {
		return id
	}
	return "feature"
}

func cloneCAD(cad CADModel) CADModel {
	clone := cad
	clone.Features = make([]CADFeature, len(cad.Features))
	copy(clone.Features, cad.Features)
	clone.Notes = make([]string, len(cad.Notes))
	copy(clone.Notes, cad.Notes)
	return clone
}
