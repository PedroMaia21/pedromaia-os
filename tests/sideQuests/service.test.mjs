import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { firestore, snapshotOf } from "./firestoreStub.mjs";
import { SideQuestTemplate, SideQuestCategory } from "../../public/modules/sideQuests/sideQuests.models.js";

const { generateSideQuest } = await import("../../public/modules/sideQuests/sideQuests.service.js");

const RECORDS = [
  {
    id: "decompression-walk-20",
    title: "Take a 20 minute walk",
    description: "Walk with no destination.",
    category: SideQuestCategory.DECOMPRESSION,
    durationMinutes: 20,
    cooldownDays: 1,
    tags: ["outdoor", "movement"]
  },
  {
    id: "skill-typing",
    title: "Typing practice",
    description: "Do a typing drill.",
    category: SideQuestCategory.SKILL,
    durationMinutes: 10,
    cooldownDays: 2,
    tags: []
  }
];

describe("generateSideQuest", () => {
  let requestedPaths;

  beforeEach(() => {
    requestedPaths = [];
    mock.restoreAll();
    firestore.getDocs = async (ref) => {
      requestedPaths.push(ref.path);
      return snapshotOf(RECORDS);
    };
  });

  it("loads templates from the user's sideQuestTemplates collection", async () => {
    await generateSideQuest("user-123");
    assert.deepEqual(requestedPaths, ["users/user-123/sideQuestTemplates"]);
  });

  it("returns the loaded SideQuestTemplate picked by Math.random, with all fields intact", async () => {
    mock.method(Math, "random", () => 0.99);
    const result = await generateSideQuest("user-123");
    assert.ok(result instanceof SideQuestTemplate);
    assert.deepEqual({ ...result }, RECORDS[1]);

    Math.random.mock.mockImplementation(() => 0);
    assert.deepEqual({ ...(await generateSideQuest("user-123")) }, RECORDS[0]);
  });

  it("applies model defaults for fields missing from the stored document", async () => {
    firestore.getDocs = async () => snapshotOf([{ id: "minimal", title: "Minimal" }]);
    const result = await generateSideQuest("user-123");
    assert.equal(result.cooldownDays, 1);
    assert.deepEqual(result.tags, []);
  });

  it("rejects with a clear error when the user has no templates", async () => {
    firestore.getDocs = async () => snapshotOf([]);
    await assert.rejects(generateSideQuest("user-123"), /No side quest templates available/);
  });

  it("propagates template-loading failures unchanged", async () => {
    const failure = new Error("permission-denied");
    firestore.getDocs = async () => { throw failure; };
    await assert.rejects(generateSideQuest("user-123"), (err) => err === failure);
  });
});
