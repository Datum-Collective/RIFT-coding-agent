import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923162951_engineering_graph_add_checks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`engineering_graph\` ADD \`checks\` text DEFAULT '[]' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
