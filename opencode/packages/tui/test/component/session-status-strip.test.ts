import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { getSessionStripStatus, type SessionStatusStripData } from "../../src/component/session-status-strip"

function data(overrides: Partial<SessionStatusStripData> = {}): SessionStatusStripData {
  return {
    session_status: {},
    permission: {},
    question: {},
    message: {},
    part: {},
    ...overrides,
  }
}

function message(id: string): Message {
  return { id } as Message
}

function runningTool(): Part {
  return {
    id: "prt_tool",
    sessionID: "ses_test",
    messageID: "msg_tool",
    type: "tool",
    callID: "call_tool",
    tool: "bash",
    state: { status: "running", input: {} },
  } as Part
}

describe("session status strip", () => {
  test("prioritizes blocked input over an active tool", () => {
    expect(
      getSessionStripStatus(
        data({
          session_status: { ses_test: { type: "busy" } },
          permission: { ses_test: [{}] },
          message: { ses_test: [message("msg_tool")] },
          part: { msg_tool: [runningTool()] },
        }),
        "ses_test",
      ),
    ).toBe("blocked_waiting_for_input")
  })

  test("reports tool activity before busy status", () => {
    expect(
      getSessionStripStatus(
        data({
          session_status: { ses_test: { type: "busy" } },
          message: { ses_test: [message("msg_tool")] },
          part: { msg_tool: [runningTool()] },
        }),
        "ses_test",
      ),
    ).toBe("tool_running")
  })

  test("falls through busy and idle states", () => {
    expect(getSessionStripStatus(data({ session_status: { ses_test: { type: "busy" } } }), "ses_test")).toBe("thinking")
    expect(getSessionStripStatus(data(), "ses_test")).toBe("idle")
  })
})
