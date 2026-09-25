import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, isIdentifier, unwrapExpression } from "../utils.ts";

// A failure that vanishes without a user-visible outcome or a logged cause is
// the classic silent-swallow: the erasure tenet demands catches with meaning.
const SWALLOWERS = new Set(["ignore", "ignoreCause"]);

const CATCHERS = new Set([
  "catch",
  "catchCause",
  "catchDefect",
  "catchIf",
  "catchFilter",
  "catchTag",
  "catchTags",
  "catchReason",
  "catchReasons",
]);

const effectMember = (node: ESTree.Node | null | undefined): Option.Option<string> => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression) || expression.value.type !== "MemberExpression") {
    return Option.none();
  }
  const object = unwrapExpression(expression.value.object);
  if (!isIdentifier(object, "Effect")) return Option.none();
  return getPropertyName(expression.value.property);
};

const isEffectVoid = (node: ESTree.Node | null | undefined): boolean =>
  Option.exists(effectMember(node), (name) => name === "void");

const returnsEffectVoid = (node: ESTree.Node | null | undefined): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return false;
  const fn = expression.value;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const body = fn.body;
  if (body === null) return false;
  if (body.type !== "BlockStatement") return isEffectVoid(body);

  const statements = body.body.filter((statement) => statement.type !== "EmptyStatement");
  const only = statements[0];
  return statements.length === 1 && only?.type === "ReturnStatement" && isEffectVoid(only.argument);
};

const swallowMessage = (name: string) =>
  `Effect.${name} erases the failure without a trace. Recover with a user-visible outcome, log the cause, or let it fail.`;

const voidCatchMessage = (name: string) =>
  `This Effect.${name} handler returns Effect.void: the failure disappears silently. Recover with a user-visible outcome, log the cause, or let it fail.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow silently swallowing Effect failures (Effect.ignore and catch handlers that return Effect.void).",
    },
  },
  createOnce(context) {
    return {
      MemberExpression(node) {
        const name = effectMember(node);
        if (Option.isSome(name) && SWALLOWERS.has(name.value)) {
          context.report({ node, message: swallowMessage(name.value) });
        }
      },
      CallExpression(node) {
        const name = effectMember(node.callee);
        if (Option.isNone(name) || !CATCHERS.has(name.value)) return;

        for (const argument of node.arguments) {
          if (returnsEffectVoid(argument)) {
            context.report({ node: argument, message: voidCatchMessage(name.value) });
            continue;
          }
          const expression = unwrapExpression(argument);
          if (Option.isNone(expression) || expression.value.type !== "ObjectExpression") continue;
          for (const property of expression.value.properties) {
            if (property.type === "Property" && returnsEffectVoid(property.value)) {
              context.report({ node: property.value, message: voidCatchMessage(name.value) });
            }
          }
        }
      },
    };
  },
});
