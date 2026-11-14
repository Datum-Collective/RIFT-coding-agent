import { describe, expect, test } from "bun:test"
import { RiftScope } from "../../src/plugin/rift-verify/scope.js"

describe("edits outside the verified folder", () => {
  test("a file inside the root, by relative or absolute path, is not outside", () => {
    expect(RiftScope.outside("/work/app", ["src/a.ts", "/work/app/b.ts", "./c.ts", "src/../d.ts"])).toEqual([])
  })

  test("a file in another folder, a parent, or a sibling with the same prefix is outside", () => {
    expect(RiftScope.outside("/work/app", ["/Users/me/Desktop/tests/cart.ts", "../other/x.ts", "/work/app-two/y.ts", "/work/z.ts"])).toEqual([
      "/Users/me/Desktop/tests/cart.ts",
      "/work/other/x.ts",
      "/work/app-two/y.ts",
      "/work/z.ts",
    ])
  })

  test("each file is named once", () => {
    expect(RiftScope.outside("/work/app", ["/x/a.ts", "/x/a.ts"])).toEqual(["/x/a.ts"])
  })

  test("only the newest few are kept, and a file edited again moves to the end", () => {
    const many = ["/a", "/b", "/c", "/d", "/e", "/f"]
    expect(RiftScope.remember([], many)).toEqual(["/b", "/c", "/d", "/e", "/f"])
    expect(RiftScope.remember(["/a", "/b"], ["/a"])).toEqual(["/b", "/a"])
  })
})

describe("the files a finished tool call changed", () => {
  test("a write names its file in the result's output, where the tool puts it", () => {
    expect(RiftScope.edited("write", { path: "x" }, { output: { resource: "/p/a.ts" }, content: [] })).toEqual(["/p/a.ts"])
  })

  test("an edit names its file in its input", () => {
    expect(RiftScope.edited("edit", { path: "src/a.ts" }, { output: {} })).toEqual(["src/a.ts"])
  })

  test("a patch names every file it applied", () => {
    expect(RiftScope.edited("patch", {}, { output: { applied: [{ resource: "a.ts" }, { resource: "b.ts" }] } })).toEqual(["a.ts", "b.ts"])
  })

  test("anything else, or a result of an unknown shape, names nothing", () => {
    expect(RiftScope.edited("shell", {}, { output: { resource: "a" } })).toEqual([])
    expect(RiftScope.edited("write", {}, undefined)).toEqual([])
    expect(RiftScope.edited("patch", {}, { output: { applied: "x" } })).toEqual([])
  })
})
