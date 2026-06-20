import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SLACK_HITL_AUTHORIZATION_DESCRIPTOR } from "#internal/testing/scenario-apps/slack-hitl-authorization.js";
import { useScenarioApp } from "#internal/testing/scenario-app.js";
import {
  buildInteractionBody,
  buildMentionBody,
  findHitlCard,
  findSlackCall,
  operationOf,
  parseHitlCard,
  postSignedSlackBody,
  readExecutionNotes,
  readFormField,
  readSessionRunIds,
  readSlackCalls,
  startEveDev,
  USER_A,
  USER_B,
  waitForValue,
} from "./slack-hitl-authorization-harness.js";

const SCENARIO_TIMEOUT_MS = 360_000;

const scenarioApp = useScenarioApp();

describe("Slack HITL authorization contract", () => {
  it(
    "binds each durable prompt to the latest verified Slack actor",
    async () => {
      const app = await scenarioApp(SLACK_HITL_AUTHORIZATION_DESCRIPTOR);
      const callsPath = join(app.appRoot, "slack-calls.jsonl");
      const executionsPath = join(app.appRoot, "tool-executions.jsonl");
      await Promise.all([writeFile(callsPath, "", "utf8"), writeFile(executionsPath, "", "utf8")]);

      const server = await startEveDev({
        appRoot: app.appRoot,
        callsPath,
        executionsPath,
      });

      try {
        const rejectedSignature = await postSignedSlackBody({
          body: buildMentionBody({
            eventId: "Ev_bad_signature",
            text: 'Use guarded-echo exactly once with note "must-not-run".',
            ts: "1700000000.000002",
            userId: USER_A,
          }),
          serverUrl: server.url,
          signingSecret: "wrong-secret",
        });
        expect(rejectedSignature.status).toBe(401);

        const firstMention = await postSignedSlackBody({
          body: buildMentionBody({
            eventId: "Ev_owner_a",
            text: 'Use guarded-echo exactly once with note "owner-a".',
            ts: "1700000000.000003",
            userId: USER_A,
          }),
          serverUrl: server.url,
        });
        expect(firstMention.status).toBe(200);

        const firstCard = await waitForValue({
          description: "the first Slack HITL card",
          load: async () => findHitlCard(await readSlackCalls(callsPath), 0),
          server,
        });
        expect(firstCard.blockId).toMatch(/^eve_input_responder:/u);

        const initialSessionRunIds = await waitForValue({
          description: "the durable Slack session run",
          load: async () => {
            const runIds = await readSessionRunIds(app.appRoot);
            return runIds.length > 0 ? runIds : null;
          },
          server,
        });
        expect(initialSessionRunIds).toHaveLength(1);

        const callsBeforeUnauthorizedClick = (await readSlackCalls(callsPath)).length;
        const unauthorizedClick = await postSignedSlackBody({
          body: buildInteractionBody({ card: firstCard, userId: USER_B }),
          contentType: "application/x-www-form-urlencoded",
          serverUrl: server.url,
        });
        expect(unauthorizedClick.status).toBe(200);

        await waitForValue({
          description: "the cross-user rejection notice",
          load: async () =>
            findSlackCall(await readSlackCalls(callsPath), callsBeforeUnauthorizedClick, (call) =>
              operationOf(call) === "chat.postEphemeral" &&
              readFormField(call.body, "user") === USER_B
                ? call
                : null,
            ),
          server,
        });
        expect(await readExecutionNotes(executionsPath)).toEqual([]);
        expect(
          (await readSlackCalls(callsPath))
            .slice(callsBeforeUnauthorizedClick)
            .some((call) => operationOf(call) === "chat.update"),
        ).toBe(false);

        const callsBeforeAuthorizedClick = (await readSlackCalls(callsPath)).length;
        const authorizedClick = await postSignedSlackBody({
          body: buildInteractionBody({ card: firstCard, userId: USER_A }),
          contentType: "application/x-www-form-urlencoded",
          serverUrl: server.url,
        });
        expect(authorizedClick.status).toBe(200);

        await waitForValue({
          description: "the first approved tool execution",
          load: async () => {
            const notes = await readExecutionNotes(executionsPath);
            return notes.includes("owner-a") ? notes : null;
          },
          server,
        });
        const firstUpdate = await waitForValue({
          description: "the first answered-card update",
          load: async () =>
            findSlackCall(await readSlackCalls(callsPath), callsBeforeAuthorizedClick, (call) =>
              operationOf(call) === "chat.update" ? call : null,
            ),
          server,
        });
        expect(firstUpdate.body).not.toContain(USER_A);
        expect(firstUpdate.body).not.toContain(USER_B);

        await waitForValue({
          description: "the first completed Slack reply",
          load: async () =>
            findSlackCall(await readSlackCalls(callsPath), callsBeforeAuthorizedClick, (call) =>
              operationOf(call) === "chat.postMessage" && parseHitlCard(call, 0) === null
                ? call
                : null,
            ),
          server,
        });

        const callsBeforeSecondMention = (await readSlackCalls(callsPath)).length;
        const secondMention = await postSignedSlackBody({
          body: buildMentionBody({
            eventId: "Ev_owner_b",
            text: 'Use guarded-echo exactly once with note "owner-b".',
            ts: "1700000000.000004",
            userId: USER_B,
          }),
          serverUrl: server.url,
        });
        expect(secondMention.status).toBe(200);

        const secondCard = await waitForValue({
          description: "the resumed-session Slack HITL card",
          load: async () => findHitlCard(await readSlackCalls(callsPath), callsBeforeSecondMention),
          server,
        });
        expect(secondCard.blockId).not.toBe(firstCard.blockId);
        expect(await readSessionRunIds(app.appRoot)).toEqual(initialSessionRunIds);

        const callsBeforeStaleOwnerClick = (await readSlackCalls(callsPath)).length;
        const staleOwnerClick = await postSignedSlackBody({
          body: buildInteractionBody({ card: secondCard, userId: USER_A }),
          contentType: "application/x-www-form-urlencoded",
          serverUrl: server.url,
        });
        expect(staleOwnerClick.status).toBe(200);
        await waitForValue({
          description: "the stale-owner rejection notice",
          load: async () =>
            findSlackCall(await readSlackCalls(callsPath), callsBeforeStaleOwnerClick, (call) =>
              operationOf(call) === "chat.postEphemeral" &&
              readFormField(call.body, "user") === USER_A
                ? call
                : null,
            ),
          server,
        });
        expect(await readExecutionNotes(executionsPath)).toEqual(["owner-a"]);

        const callsBeforeSecondApproval = (await readSlackCalls(callsPath)).length;
        const secondApproval = await postSignedSlackBody({
          body: buildInteractionBody({ card: secondCard, userId: USER_B }),
          contentType: "application/x-www-form-urlencoded",
          serverUrl: server.url,
        });
        expect(secondApproval.status).toBe(200);

        await waitForValue({
          description: "the second approved tool execution",
          load: async () => {
            const notes = await readExecutionNotes(executionsPath);
            return notes.length === 2 ? notes : null;
          },
          server,
        });
        const secondUpdate = await waitForValue({
          description: "the second answered-card update",
          load: async () =>
            findSlackCall(await readSlackCalls(callsPath), callsBeforeSecondApproval, (call) =>
              operationOf(call) === "chat.update" ? call : null,
            ),
          server,
        });

        expect(await readExecutionNotes(executionsPath)).toEqual(["owner-a", "owner-b"]);
        expect(secondUpdate.body).not.toContain(USER_A);
        expect(secondUpdate.body).not.toContain(USER_B);
        expect(await readSessionRunIds(app.appRoot)).toEqual(initialSessionRunIds);
      } finally {
        await server.stop();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );
});
