package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Step 1 scaffold: a single-pane TUI that streams mocked agent log lines.
// No real agent, WebSocket, or tools yet.

const (
	tickInterval = 450 * time.Millisecond
	appName      = "brainrot-ide"
)

var mockStream = []string{
	"[idle] waiting for prompt…",
	"[thinking] parsing request: scaffold a Go TUI",
	"[thinking] choosing layout: single pane, streaming log",
	"[tool] bash · go version",
	"        go version go1.24 darwin/arm64",
	"[tool] fs_write · tui/main.go",
	"        created Bubble Tea model + viewport",
	"[thinking] next: stream fake agent lines into the pane",
	"[tool] bash · go run ./tui",
	"        compiling…",
	"[done] mock stream complete — press q to quit, r to replay",
}

// Distinct from OpenCode: teal accent, double-line borders, custom footer.
var (
	accent     = lipgloss.Color("#2EE6A6")
	muted      = lipgloss.Color("#6B7280")
	fg         = lipgloss.Color("#E5E7EB")
	bgSubtle   = lipgloss.Color("#111827")
	warn       = lipgloss.Color("#F59E0B")
	borderCol  = lipgloss.Color("#1F3D36")

	titleStyle = lipgloss.NewStyle().
			Foreground(accent).
			Bold(true)

	mutedStyle = lipgloss.NewStyle().Foreground(muted)

	logStyle = lipgloss.NewStyle().Foreground(fg)

	paneStyle = lipgloss.NewStyle().
			Border(lipgloss.DoubleBorder()).
			BorderForeground(borderCol).
			Padding(0, 1)

	statusStyle = lipgloss.NewStyle().
			Foreground(bgSubtle).
			Background(accent).
			Padding(0, 1)

	hintStyle = lipgloss.NewStyle().Foreground(muted)
)

type tickMsg time.Time

type model struct {
	vp        viewport.Model
	lines     []string
	nextIdx   int
	width     int
	height    int
	ready     bool
	done      bool
	startedAt time.Time
}

func initialModel() model {
	return model{
		lines:     []string{},
		startedAt: time.Now(),
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(tick(), tea.EnterAltScreen)
}

func tick() tea.Cmd {
	return tea.Tick(tickInterval, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c", "esc":
			return m, tea.Quit
		case "r":
			m.lines = nil
			m.nextIdx = 0
			m.done = false
			m.startedAt = time.Now()
			m.syncViewport()
			return m, tick()
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		headerH := 1
		footerH := 1
		borderH := 2
		vpH := max(1, msg.Height-headerH-footerH-borderH)
		vpW := max(1, msg.Width-4) // pane padding + border
		if !m.ready {
			m.vp = viewport.New(vpW, vpH)
			m.vp.YPosition = headerH + 1
			m.ready = true
		} else {
			m.vp.Width = vpW
			m.vp.Height = vpH
		}
		m.syncViewport()

	case tickMsg:
		if !m.done && m.nextIdx < len(mockStream) {
			m.lines = append(m.lines, mockStream[m.nextIdx])
			m.nextIdx++
			if m.nextIdx >= len(mockStream) {
				m.done = true
			}
			m.syncViewport()
		}
		if !m.done {
			cmds = append(cmds, tick())
		}
	}

	if m.ready {
		m.vp, cmd = m.vp.Update(msg)
		cmds = append(cmds, cmd)
	}
	return m, tea.Batch(cmds...)
}

func (m *model) syncViewport() {
	if !m.ready {
		return
	}
	m.vp.SetContent(formatLog(m.lines))
	m.vp.GotoBottom()
}

func formatLog(lines []string) string {
	if len(lines) == 0 {
		return mutedStyle.Render("· waiting for mocked agent stream…")
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, colorizeLine(line))
	}
	return strings.Join(out, "\n")
}

func colorizeLine(line string) string {
	switch {
	case strings.HasPrefix(line, "[thinking]"):
		return lipgloss.NewStyle().Foreground(accent).Render(line)
	case strings.HasPrefix(line, "[tool]"):
		return lipgloss.NewStyle().Foreground(warn).Render(line)
	case strings.HasPrefix(line, "[done]"):
		return lipgloss.NewStyle().Foreground(accent).Bold(true).Render(line)
	case strings.HasPrefix(line, "[idle]"):
		return mutedStyle.Render(line)
	default:
		return logStyle.Render(line)
	}
}

func (m model) View() string {
	if !m.ready {
		return "initializing…"
	}

	header := lipgloss.JoinHorizontal(lipgloss.Top,
		titleStyle.Render(appName),
		mutedStyle.Render("  step 1 · mocked stream  "),
		mutedStyle.Render(fmt.Sprintf("%dx%d", m.width, m.height)),
	)

	innerW := max(1, m.width-4)
	innerH := max(1, m.height-4)
	m.vp.Width = innerW
	m.vp.Height = innerH

	pane := paneStyle.Width(innerW).Height(innerH).Render(m.vp.View())

	status := "streaming"
	if m.done {
		status = "idle"
	} else if len(m.lines) == 0 {
		status = "starting"
	}
	left := statusStyle.Render(fmt.Sprintf(" %s ", status))
	right := hintStyle.Render("q quit  r replay  ↑↓ scroll")
	gap := max(0, m.width-lipgloss.Width(left)-lipgloss.Width(right))
	footer := left + strings.Repeat(" ", gap) + right

	return header + "\n" + pane + "\n" + footer
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", appName, err)
		os.Exit(1)
	}
}
