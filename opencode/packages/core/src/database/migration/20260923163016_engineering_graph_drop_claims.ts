import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923163016_engineering_graph_drop_claims",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`engineering_graph\` DROP COLUMN \`tests\`;`)
      yield* tx.run(`ALTER TABLE \`engineering_graph\` DROP COLUMN \`evidence\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
