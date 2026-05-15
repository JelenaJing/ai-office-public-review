import {
  createSyncPlan,
  fetchPackageMeta,
  fetchEntitlements,
  installSkill,
  requestInstallToken,
  runSkill
} from "./syncClient.js";

async function run() {
  const entitlements = await fetchEntitlements();
  process.stdout.write(`[adapter] entitlements: ${JSON.stringify(entitlements, null, 2)}\n`);

  const plan = await createSyncPlan([]);
  process.stdout.write(`[adapter] sync plan: ${JSON.stringify(plan, null, 2)}\n`);

  for (const item of plan.to_install) {
    const token = await requestInstallToken(item.package_id);
    process.stdout.write(`[adapter] install token: ${JSON.stringify(token, null, 2)}\n`);
    const packageMeta = await fetchPackageMeta(item.package_id);
    const installed = await installSkill(item.skill_id, item.version, packageMeta);
    process.stdout.write(`[adapter] installed: ${JSON.stringify(installed, null, 2)}\n`);
  }

  const result = await runSkill({
    schema_version: "ai-office-skill-run-v1",
    run_id: `run_${Date.now()}`,
    skill_id: "paper_writer_v1",
    operation: "generate_paper",
    workspace_id: "workspace_001",
    input: {
      source_artifacts: [{ artifact_id: "artifact_doc_001", type: "document" }]
    },
    options: {
      quality_mode: "standard"
    }
  });
  process.stdout.write(`[adapter] run result: ${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`[adapter] failed: ${error.stack || error.message}\n`);
  process.exit(1);
});

