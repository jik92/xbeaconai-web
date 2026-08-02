import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AccountStore } from "../server/accounts/account-store";
import { SqliteJobStore } from "../server/jobs/sqlite-job-store";
import { CustomPortraitStore } from "../server/portraits/custom-portrait-store";
import { isArkRealPersonPrivacyError, SeedanceVideoJob } from "../worker/jobs/job-seedance-video";

const jobId = process.argv.find((value) => value.startsWith("--job="))?.slice("--job=".length);
if (!jobId) throw new Error("Usage: --job=<failed-script-remix-job-id>");

const store = new SqliteJobStore();
const accounts = new AccountStore();
const customPortraits = new CustomPortraitStore();
try {
  const job = store.get(jobId);
  if (job?.moduleId !== "script-remix-next" || job.values.workflowPhase !== "shot-generation")
    throw new Error("SCRIPT_REMIX_SHOT_JOB_NOT_FOUND");
  if (!isArkRealPersonPrivacyError(new Error(typeof job.error === "string" ? job.error : job.error?.message || "")))
    throw new Error("JOB_DID_NOT_FAIL_WITH_REAL_PERSON_PRIVACY_ERROR");
  if (!job.videoModel) throw new Error("VIDEO_MODEL_REQUIRED");
  const repaired = store.update(job.id, {
    providerStatus: "rejected",
    providerTaskId: undefined,
    providerSubmittedAt: undefined,
    providerDeadlineAt: undefined,
    values: { ...job.values, privacyFallbackPortraitReference: job.values.privacyFallbackPortraitReference || "" },
  });
  if (!repaired) throw new Error("JOB_REPAIR_FAILED");
  const result = await new SeedanceVideoJob({
    store,
    accounts,
    customPortraits,
    change: (id, patch) => store.update(id, patch),
  }).execute(repaired, job.videoModel);
  const outputDir = resolve("artifacts/api-tests/seedance-privacy-fallback");
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${job.id}.mp4`);
  await Bun.write(outputPath, result.bytes);
  const final = store.get(job.id);
  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        outputPath,
        bytes: result.bytes.byteLength,
        durationSec: result.durationSec,
        providerTaskId: final?.providerTaskId,
        privacyFallbackAttempted: final?.values.privacyFallbackAttempted,
        privacyFallbackApplied: final?.values.privacyFallbackApplied,
      },
      null,
      2,
    ),
  );
} finally {
  customPortraits.close();
  accounts.close();
  store.close();
}
