import { expect, test } from "bun:test"
import type { Rift } from "@opencode/schema/rift"
import { tree } from "../../src/feature-plugins/sidebar/rift"

const node = (id: string, parent?: string): Rift.Node => ({ id, parent, title: id, verdict: "unproven", because: [] })
const shape = (nodes: Rift.Node[]) => tree(nodes).map((line) => [line.node.id, line.depth])

test("children sit under their parents, whatever order they arrive in", () => {
  expect(shape([node("b", "a"), node("c", "b"), node("a")])).toEqual([["a", 0], ["b", 1], ["c", 2]])
})

test("a node whose parent is missing is still shown", () => {
  expect(shape([node("a", "ghost")])).toEqual([["a", 0]])
})

test("a cycle is shown once, without hanging", () => {
  expect(shape([node("a", "b"), node("b", "a")])).toEqual([["a", 0], ["b", 1]])
})
