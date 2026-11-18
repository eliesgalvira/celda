import type { Context, ESTree } from "@oxlint/plugins";
import * as Schema from "effect/Schema";

export const allowlistSchema = [
  {
    type: "object" as const,
    properties: {
      allow: {
        type: "object" as const,
        additionalProperties: { type: "integer" as const, minimum: 1 },
      },
    },
    additionalProperties: false,
  },
];

const allowlistOptions = Schema.Union([
  Schema.Tuple([
    Schema.Struct({
      allow: Schema.Record(
        Schema.String,
        Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
      ),
    }),
  ]),
  Schema.Tuple([]),
]);

function allowance(context: Context) {
  const filename = context.physicalFilename.replaceAll("\\", "/");
  const [options] = Schema.decodeUnknownSync(allowlistOptions)(context.options);

  return Object.entries(options?.allow ?? {}).find(
    ([path]) => filename === path || filename.endsWith(`/${path}`),
  );
}

export function reportAllowed(
  context: Context,
  program: ESTree.Program,
  violations: readonly ESTree.Node[],
  messageId: string,
) {
  const [path, count] = allowance(context) ?? ["", 0];

  if (violations.length < count) {
    context.report({
      node: program,
      messageId: "stale",
      data: { path, count: String(violations.length) },
    });

    return;
  }

  if (violations.length === count) {
    return;
  }

  for (const node of violations) {
    context.report({ node, messageId });
  }
}
