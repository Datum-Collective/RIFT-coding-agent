import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260922215314_add_engineering_graph",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`engineering_graph\` (
          \`session_id\` text NOT NULL,
          \`node_id\` text NOT NULL,
          \`parent_id\` text,
          \`title\` text NOT NULL,
          \`status\` text NOT NULL,
          \`owner\` text NOT NULL,
          \`dependencies\` text NOT NULL,
          \`files\` text NOT NULL,
          \`tests\` text NOT NULL,
          \`decisions\` text NOT NULL,
          \`evidence\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`engineering_graph_pk\` PRIMARY KEY(\`session_id\`, \`node_id\`),
          CONSTRAINT \`fk_engineering_graph_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`engineering_graph_session_idx\` ON \`engineering_graph\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
