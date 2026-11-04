import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectSession } from "./projectSession.ts";

function openProject(files) {
  return {
    files,
    patch({ set = {}, delete: deleted = [] }) {
      const next = { ...this.files };
      for (const path of deleted) delete next[path];
      Object.assign(next, set);
      return openProject(next);
    },
  };
}

test("successive project edits preserve earlier file changes", () => {
  const session = createProjectSession(openProject);
  session.update({ "a.mcl": "emit {a: 1}", "b.mcl": "emit {b: 1}" });
  session.update({ "a.mcl": "emit {a: 2}", "b.mcl": "emit {b: 1}" });
  const project = session.update({ "a.mcl": "emit {a: 2}", "b.mcl": "emit {b: 2}" });

  assert.deepEqual(project.files, { "a.mcl": "emit {a: 2}", "b.mcl": "emit {b: 2}" });
});
