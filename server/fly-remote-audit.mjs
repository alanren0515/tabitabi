export const REQUIRED_FLY_SECRETS = Object.freeze([
  "PILOT_ACCESS_CODE", "DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "GOOGLE_MAPS_API_KEY", "HOTPEPPER_API_KEY",
  "PUBLIC_CONTACT_EMAIL", "PUBLIC_OPERATOR_NAME", "QWEN_VISION_MODEL", "VISION_FALLBACK_TIMEOUT_MS",
  "VISION_MAX_OUTPUT_TOKENS", "VISION_PROVIDER_ORDER", "VISION_TIMEOUT_MS"
]);

export function evaluateFlyRemoteState({ machines = [], volumes = [], checks = [], secrets = [] } = {}) {
  const machine = machines[0] || {};
  const guest = machine.config?.guest || machine.guest || {};
  const volume = volumes[0] || {};
  const mounts = Array.isArray(machine.config?.mounts) ? machine.config.mounts : [];
  const machineId = String(machine.id || "");
  const volumeId = String(volume.id || "");
  const healthStatuses = checks.map((item) => String(item.status || "").toLowerCase());
  const targetServices = (Array.isArray(machine.config?.services) ? machine.config.services : []).filter((item) =>
    Number(item.internal_port ?? item.internalPort) === 4173
      && Array.isArray(item.checks)
      && item.checks.some((check) => String(check.path || "") === "/healthz"));
  const service = targetServices.length === 1 ? targetServices[0] : {};
  const deployedSecrets = new Set(secrets
    .filter((item) => String(item.status || "").toLowerCase() === "deployed")
    .map((item) => String(item.name || "")));
  const results = {
    exactlyOneMachine: machines.length === 1,
    machineStarted: String(machine.state || "").toLowerCase() === "started",
    machineTokyo: machine.region === "nrt",
    machineShape: Number(guest.cpus) === 1 && Number(guest.memory_mb ?? guest.memoryMb) === 512 && String((guest.cpu_kind ?? guest.cpuKind) || "") === "shared",
    machineIdleLifecycle: targetServices.length === 1 && service.autostart === true && service.autostop === true && Number(service.min_machines_running ?? service.minMachinesRunning) === 0,
    exactlyOneVolume: volumes.length === 1,
    volumeCreated: String(volume.state || "").toLowerCase() === "created",
    volumeTokyo: volume.region === "nrt",
    volumeName: String(volume.name || "") === "tabitabi_data",
    volumeSize: Number(volume.size_gb ?? volume.sizeGb) === 1,
    volumeEncrypted: volume.encrypted === true,
    volumeSnapshots: Number(volume.snapshot_retention ?? volume.snapshotRetention) === 7 && (volume.auto_backup_enabled ?? volume.autoBackupEnabled) === true,
    volumeAttached: Boolean(machineId && volumeId && String((volume.attached_machine_id ?? volume.attachedMachineId) || "") === machineId),
    volumeMounted: Boolean(volumeId && mounts.some((item) => String(item.volume || item.volume_id || "") === volumeId && String(item.path || item.destination || "") === "/app/data")),
    healthChecksPresent: checks.length > 0,
    healthChecksForMachine: Boolean(machineId && checks.length > 0 && checks.every((item) => String(item.machineId || item.machine_id || "") === machineId)),
    healthChecksPassing: healthStatuses.length > 0 && healthStatuses.every((status) => ["passing", "pass"].includes(status)),
    requiredSecretsDeployed: REQUIRED_FLY_SECRETS.every((name) => deployedSecrets.has(name))
  };
  const guidance = {
    exactlyOneMachine: "只读检查：flyctl machine list -a <app>；应恰好一台。",
    machineStarted: "先运行 provider-free smoke 唤醒 Machine，再重试只读审计。",
    machineTokyo: "只读检查 Machine region；应为 nrt。",
    machineShape: "只读检查 guest 配置；应为 shared、1 CPU、512 MB。",
    machineIdleLifecycle: "确认唯一 Machine 为 autostart=true、autostop=true、min_machines_running=0。",
    exactlyOneVolume: "只读检查：flyctl volumes list -a <app>；应恰好一个。",
    volumeCreated: "等待 Volume 进入 created；不要重复创建。",
    volumeTokyo: "Volume region 应为 nrt。",
    volumeName: "Volume 名称应为 tabitabi_data。",
    volumeSize: "Volume 大小应为 1 GB。",
    volumeEncrypted: "确认唯一 Volume 的 encrypted=true。",
    volumeSnapshots: "确认 scheduled snapshots 已启用且保留 7 天。",
    volumeAttached: "确认唯一 Volume attached_machine_id 对应唯一 Machine。",
    volumeMounted: "确认 Machine 将该 Volume 挂载到 /app/data。",
    healthChecksPresent: "先运行 provider-free smoke，再执行 flyctl checks list -a <app>。",
    healthChecksForMachine: "健康检查必须属于唯一 Machine。",
    healthChecksPassing: "任何 warning/critical/unknown 都不通过；先检查 /healthz，再读取 /readyz 的供应商降级状态。",
    requiredSecretsDeployed: "只读运行 flyctl secrets list --json；12 个必需 Secret 必须全部为 Deployed。"
  };
  const missing = Object.entries(results).filter(([, value]) => !value).map(([name]) => name);
  return {
    passed: missing.length === 0,
    checks: results,
    missing,
    nextSteps: missing.map((name) => guidance[name]),
    deployment: {
      machineUpdatedAt: machine.updated_at ?? machine.updatedAt ?? null,
      imageDigest: machine.image_ref?.digest ?? machine.imageRef?.digest ?? null
    }
  };
}

export function parseFlyJson(value, label) {
  let parsed;
  try { parsed = JSON.parse(String(value || "")); }
  catch { throw new Error(`${label} did not return valid JSON`); }
  if (!Array.isArray(parsed)) throw new Error(`${label} did not return a JSON array`);
  return parsed;
}

export function parseFlyChecksJson(value, label = "flyctl checks list") {
  let parsed;
  try { parsed = JSON.parse(String(value || "")); }
  catch { throw new Error(`${label} did not return valid JSON`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${label} did not return a checks map`);
  return Object.entries(parsed).flatMap(([machineId, machineChecks]) => {
    const items = Array.isArray(machineChecks) ? machineChecks : Array.isArray(machineChecks?.checks) ? machineChecks.checks : [];
    return items.map((item) => ({ ...item, machineId }));
  });
}
