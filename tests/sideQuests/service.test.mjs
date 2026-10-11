import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { firestore, snapshotOf, FakeTimestamp } from "./firestoreStub.mjs";
import {
  SideQuestInstance, SideQuestStatus, SideQuestCategory
} from "../../public/modules/sideQuests/sideQuests.models.js";

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

const GENERATED_AT = FakeTimestamp.fromMillis(Date.UTC(2026, 9, 11, 12, 0, 0));

describe("generateSideQuest", () => {
  let requestedPaths;
  let writes;

  beforeEach(() => {
    requestedPaths = [];
    writes = [];
    mock.restoreAll();
    firestore.getDocs = async (ref) => {
      requestedPaths.push(ref.path);
      return snapshotOf(RECORDS);
    };
    firestore.setDoc = async (ref, data) => {
      writes.push({ ref, data });
    };
    firestore.now = () => GENERATED_AT;
    firestore.autoId = () => "auto-id-1";
  });

  it("loads templates from the user's sideQuestTemplates collection", async () => {
    await generateSideQuest("user-123");
    assert.deepEqual(requestedPaths, ["users/user-123/sideQuestTemplates"]);
  });

  it("returns a SideQuestInstance for the template picked by Math.random", async () => {
    mock.method(Math, "random", () => 0.99);
    const result = await generateSideQuest("user-123");
    assert.ok(result instanceof SideQuestInstance);
    assert.equal(result.templateId, RECORDS[1].id);

    Math.random.mock.mockImplementation(() => 0);
    assert.equal((await generateSideQuest("user-123")).templateId, RECORDS[0].id);
  });

  it("initialises the instance as AVAILABLE with a generation timestamp and no expiry or completion", async () => {
    mock.method(Math, "random", () => 0);
    const result = await generateSideQuest("user-123");
    assert.deepEqual({ ...result }, {
      id: "auto-id-1",
      templateId: "decompression-walk-20",
      status: SideQuestStatus.AVAILABLE,
      generatedAt: GENERATED_AT,
      expiresAt: null,
      completedAt: null
    });
  });

  it("stamps generatedAt with a Firestore Timestamp taken at generation time", async () => {
    let nowCalls = 0;
    firestore.now = () => { nowCalls++; return GENERATED_AT; };
    const result = await generateSideQuest("user-123");
    assert.equal(nowCalls, 1);
    assert.ok(result.generatedAt instanceof FakeTimestamp);
    assert.equal(result.generatedAt, GENERATED_AT);
  });

  it("persists the instance once, through saveInstance, under the user's sideQuestInstances collection", async () => {
    const result = await generateSideQuest("user-123");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].ref.path, "users/user-123/sideQuestInstances/auto-id-1");
    assert.deepEqual(writes[0].data, { ...result });
  });

  it("gives each generation its own Firestore-generated id", async () => {
    let n = 0;
    firestore.autoId = () => `auto-id-${++n}`;
    const first = await generateSideQuest("user-123");
    const second = await generateSideQuest("user-123");
    assert.notEqual(first.id, second.id);
    assert.deepEqual(writes.map(w => w.ref.id), [first.id, second.id]);
  });

  it("rejects with a clear error and saves nothing when the user has no templates", async () => {
    firestore.getDocs = async () => snapshotOf([]);
    await assert.rejects(generateSideQuest("user-123"), /No side quest templates available/);
    assert.equal(writes.length, 0);
  });

  it("propagates template-loading failures unchanged and saves nothing", async () => {
    const failure = new Error("permission-denied");
    firestore.getDocs = async () => { throw failure; };
    await assert.rejects(generateSideQuest("user-123"), (err) => err === failure);
    assert.equal(writes.length, 0);
  });

  it("propagates persistence failures unchanged instead of returning an instance", async () => {
    const failure = new Error("unavailable");
    firestore.setDoc = async () => { throw failure; };
    await assert.rejects(generateSideQuest("user-123"), (err) => err === failure);
  });
});
