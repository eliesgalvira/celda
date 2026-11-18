import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { allowlistSchema, reportAllowed } from "../lib/allowlist.ts";

const testCallees = new Set([
  "test",
  "it",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

const timerModules = new Set(["node:timers/promises", "timers/promises"]);

function isMember(node: ESTree.Node, object: string, property: string) {
  return (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === object &&
    node.property.type === "Identifier" &&
    !node.computed &&
    node.property.name === property
  );
}

function isSetTimeout(node: ESTree.Node) {
  return (
    (node.type === "Identifier" && node.name === "setTimeout") ||
    isMember(node, "globalThis", "setTimeout") ||
    isMember(node, "window", "setTimeout")
  );
}

const calleeRoot: (node: ESTree.Node) => string | undefined = (node) => {
  if (node.type === "CallExpression") {
    return calleeRoot(node.callee);
  }

  if (node.type === "MemberExpression") {
    return calleeRoot(node.object);
  }

  if (node.type === "TaggedTemplateExpression") {
    return calleeRoot(node.tag);
  }

  return node.type === "Identifier" ? node.name : undefined;
};

function inTestBody(node: ESTree.Node) {
  let current: ESTree.Node | null = node.parent;

  while (
    current &&
    current.type !== "ArrowFunctionExpression" &&
    current.type !== "FunctionExpression" &&
    current.type !== "FunctionDeclaration"
  ) {
    current = current.parent;
  }

  const call = current?.parent;

  return (
    call?.type === "CallExpression" &&
    testCallees.has(calleeRoot(call.callee) ?? "")
  );
}

function inLiveTest(node: ESTree.Node) {
  let current: ESTree.Node | null = node.parent;

  while (current) {
    if (current.type === "CallExpression") {
      let callee: ESTree.Node = current.callee;

      while (callee.type === "MemberExpression" || callee.type === "CallExpression") {
        if (isMember(callee, "it", "live") || isMember(callee, "it", "scopedLive")) {
          return true;
        }

        callee = callee.type === "MemberExpression" ? callee.object : callee.callee;
      }
    }

    current = current.parent;
  }

  return false;
}

function scheduled(body: ESTree.Node | null) {
  if (body?.type !== "BlockStatement") {
    return body;
  }

  const [statement, ...rest] = body.body;

  return statement?.type === "ExpressionStatement" && rest.length === 0
    ? statement.expression
    : null;
}

function resolvesAfterTimeout(node: ESTree.NewExpression) {
  const [executor] = node.arguments;

  if (
    !executor ||
    (executor.type !== "ArrowFunctionExpression" &&
      executor.type !== "FunctionExpression")
  ) {
    return false;
  }

  const [resolve] = executor.params;

  if (resolve?.type !== "Identifier") {
    return false;
  }

  const call = scheduled(executor.body);

  if (call?.type !== "CallExpression" || !isSetTimeout(call.callee)) {
    return false;
  }

  const [handler] = call.arguments;

  if (handler?.type === "Identifier") {
    return handler.name === resolve.name;
  }

  return (
    handler?.type === "ArrowFunctionExpression" &&
    handler.body.type === "CallExpression" &&
    handler.body.callee.type === "Identifier" &&
    handler.body.callee.name === resolve.name
  );
}

export const noFixedSleep = defineRule({
  meta: {
    type: "problem",
    schema: allowlistSchema,
    docs: {
      description:
        "Disallow awaiting a fixed real-time sleep in a test or hook body.",
    },
    messages: {
      sleep:
        "Replace this fixed sleep with a signal: await the operation itself or a promise its handler resolves. To move time, use vi.useFakeTimers() and advance it. A sleep guesses how long real work takes and fails under CPU load.",
      stale:
        "This file now has {{count}} fixed sleeps; lower its no-fixed-sleep allowlist entry for {{path}} in vite.config.ts to {{count}}, or remove the entry at 0.",
    },
  },
  create(context) {
    const timers = new Set<string>();
    const helpers = new Set<string>();
    const sleeps: ESTree.Node[] = [];
    const effectSleeps: ESTree.Node[] = [];

    function isSleep(node: ESTree.Node) {
      if (node.type === "NewExpression") {
        return (
          node.callee.type === "Identifier" &&
          node.callee.name === "Promise" &&
          resolvesAfterTimeout(node)
        );
      }

      if (node.type !== "CallExpression") {
        return false;
      }

      return (
        (node.callee.type === "Identifier" &&
          (timers.has(node.callee.name) || helpers.has(node.callee.name))) ||
        isMember(node.callee, "scheduler", "wait") ||
        isMember(node.callee, "Bun", "sleep")
      );
    }

    return {
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.init?.type === "ArrowFunctionExpression" &&
          isSleep(node.init.body)
        ) {
          helpers.add(node.id.name);
        }
      },
      ImportDeclaration(node) {
        if (!timerModules.has(node.source.value)) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "setTimeout"
          ) {
            timers.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const [argument] = node.arguments;

        if (
          isMember(node.callee, "TestClock", "withLive") &&
          argument?.type === "CallExpression" &&
          isMember(argument.callee, "Effect", "sleep")
        ) {
          effectSleeps.push(node);
        } else if (
          isMember(node.callee, "Effect", "sleep") &&
          inLiveTest(node) &&
          !(node.parent.type === "CallExpression" &&
            isMember(node.parent.callee, "TestClock", "withLive"))
        ) {
          effectSleeps.push(node);
        }
      },
      AwaitExpression(node) {
        if (isSleep(node.argument) && inTestBody(node)) {
          sleeps.push(node);
        }
      },
      "Program:exit"(program) {
        reportAllowed(context, program, [...sleeps, ...effectSleeps], "sleep");
      },
    };
  },
});
