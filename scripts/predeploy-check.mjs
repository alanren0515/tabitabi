import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateDeploymentPreflight, parseEnvironmentFile } from "../server/deployment-preflight.mjs";
import { evaluateReleaseEvidence } from "../server/release-evidence.mjs";
import { readMacKeychainSecret } from "../server/keychain-secret.mjs";
import { currentGitState } from "../server/release-revision.mjs";

const [localEnv, flyConfig, dockerfile, cases, matrix, audits, candidateResults, decisionResults, testResults, remoteSecretEvidence] = await Promise.all([
  readText(".env.local"), readText("fly.toml"), readText("Dockerfile"), readJson("eval/cases.json"), readJson("eval/coverage-matrix.json"),
  readJson("eval/manual-audits.json"), readJson("eval/latest-candidate-results.json"), readJson("eval/latest-decision-results.json"), readJsonIfPresent("data/release-evidence/latest-tests.json"), readJsonIfPresent("data/release-evidence/latest-fly.json")
]);
const env = { ...parseEnvironmentFile(localEnv), ...process.env };
if (!env.PILOT_ACCESS_CODE) env.PILOT_ACCESS_CODE = await readMacKeychainSecret({ service: "tabitabi-jp-pilot-access" });
const git = await currentGitState();
const releaseGate = evaluateReleaseEvidence({ cases, matrix, audits, candidateResults, decisionResults, testResults, revision: git.revision });
const result = evaluateDeploymentPreflight({ env, flyConfig, dockerfile, releaseGate, remoteSecretEvidence });
const persisted = { generatedAt: new Date().toISOString(), revision: git.revision, repositoryClean: git.clean, ...result };
const guidance = {
  qwenKey: "在 .env.local 设置 DASHSCOPE_API_KEY。",
  qwenEndpoint: "将 DASHSCOPE_BASE_URL 设为新加坡 International 官方端点。",
  qwenModel: "将 QWEN_VISION_MODEL 设为 qwen3.6-flash。",
  googlePlacesKey: "在 .env.local 设置 GOOGLE_MAPS_API_KEY。",
  pilotAccessCode: "在本机设置至少 24 个字符的 PILOT_ACCESS_CODE，或先运行只读 Fly 审计证明同一应用已部署该 Secret。",
  operatorName: "设置公开显示的 PUBLIC_OPERATOR_NAME。",
  contactEmail: "设置有效的 PUBLIC_CONTACT_EMAIL。",
  providerBudgetCaps: "将三个 DAILY_*_LIMIT 保持在 1–90；Google 控制台配额仍需人工核对为 100/日。",
  flyTokyo: "检查 fly.toml 的 primary_region = \"nrt\"。",
  flyIdleLifecycle: "检查 Fly 自动启动、空闲停止和 min_machines_running=0。",
  flyHttpsAndHealth: "检查 Fly 强制 HTTPS 且路由健康检查为 /healthz；供应商状态另看 /readyz。",
  flyMachineShape: "检查 Fly VM 为 shared-cpu-1x、512mb、1 CPU。",
  flyPersistentData: "检查 tabitabi_data 挂载到 /app/data。",
  flySnapshots: "检查每日快照开启且保留 7 天。",
  pinnedContainerBase: "重新固定 Dockerfile 的 Node 镜像 digest。",
  releaseEvidence: "先运行 npm run eval:release-gate 并修复失败项。"
};
await mkdir("data/release-evidence", { recursive: true });
await writeFile("data/release-evidence/latest-preflight.json", `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...persisted, nextSteps: result.missing.map((key) => guidance[key]) }, null, 2));
if (!result.passed) process.exitCode = 1;

async function readText(path) { try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function readJsonIfPresent(path) { try { return await readJson(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
