package main

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestMockStreamRenders(t *testing.T) {
	m := initialModel()
	mod, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m = mod.(model)

	view := m.View()
	if !strings.Contains(view, appName) {
		t.Fatalf("header missing app name; view:\n%s", view)
	}
	if !strings.Contains(view, "mocked stream") {
		t.Fatalf("expected step-1 subtitle; view:\n%s", view)
	}

	for i := 0; i < len(mockStream); i++ {
		mod, _ = m.Update(tickMsg(time.Now()))
		m = mod.(model)
	}

	view = m.View()
	if !strings.Contains(view, "[thinking]") {
		t.Fatalf("expected streamed thinking line; view:\n%s", view)
	}
	if !strings.Contains(view, "[tool]") {
		t.Fatalf("expected streamed tool line; view:\n%s", view)
	}
	if !strings.Contains(view, "idle") {
		t.Fatalf("expected idle status after mock stream; view:\n%s", view)
	}
}
