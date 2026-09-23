/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  const target = ns.args[0];
  const hostNames = JSON.parse(ns.args[1]);

  const SPACING = 50;             // ms between each action's completion within a batch
  const MAX_HACK_FRACTION = 0.9;  // fraction of current money one batch tries to steal
  const MAX_CONCURRENT_BATCHES = 150; // sanity cap so spacing never gets absurdly tight

  const scripts = { hack: "hack.js", weaken: "weaken.js", grow: "grow.js" };
  const hackRam = ns.getScriptRam(scripts.hack, "home");
  const growRam = ns.getScriptRam(scripts.grow, "home");
  const weakenRam = ns.getScriptRam(scripts.weaken, "home");

  const PAUSE_FILE = "/data/paused-servers.txt";
  function getPausedHosts() {
    const raw = ns.read(PAUSE_FILE);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  }

  function getHosts() {
    const paused = getPausedHosts();
    return hostNames
      .filter(h => !paused.has(h))
      .map(h => ({ host: h, ram: ns.getServerMaxRam(h) - ns.getServerUsedRam(h) }))
      .filter(h => h.ram > 0);
  }

  function totalRam(hosts) {
    return hosts.reduce((sum, h) => sum + h.ram, 0);
  }

  function execDistributed(script, target, delay, threadsWanted, hosts) {
    const scriptRam = ns.getScriptRam(script, "home");
    let remaining = threadsWanted;
    let dispatched = 0;
    for (const h of hosts) {
      if (remaining <= 0) break;
      const canFit = Math.floor(h.ram / scriptRam);
      const threads = Math.min(canFit, remaining);
      if (threads > 0) {
        ns.exec(script, h.host, threads, target, delay);
        h.ram -= threads * scriptRam;
        remaining -= threads;
        dispatched += threads;
      }
    }
    return dispatched;
  }

  // ---- PREP: bring target to min security / max money before batching starts ----
  async function prep() {
    while (true) {
      const secMin = ns.getServerMinSecurityLevel(target);
      const secNow = ns.getServerSecurityLevel(target);
      const moneyMax = ns.getServerMaxMoney(target);
      const moneyNow = ns.getServerMoneyAvailable(target);
      if (secNow <= secMin + 0.5 && moneyNow >= moneyMax * 0.99) return;

      const hosts = getHosts();
      const mode = secNow > secMin + 0.5 ? "weaken" : "grow";
      if (mode === "weaken") {
        const threads = Math.floor(totalRam(hosts) / weakenRam);
        execDistributed(scripts.weaken, target, 0, threads, hosts);
        ns.print(`[prep] weakening: ${threads} threads (sec ${secNow.toFixed(1)}/${secMin.toFixed(1)})`);
      } else {
        const ratio = ns.growthAnalyzeSecurity(1) / ns.weakenAnalyze(1);
        const growThreads = Math.floor(totalRam(hosts) / (growRam + ratio * weakenRam));
        const weakenThreads = Math.ceil(growThreads * ratio);
        execDistributed(scripts.grow, target, 0, growThreads, hosts);
        execDistributed(scripts.weaken, target, 0, weakenThreads, hosts);
        ns.print(`[prep] growing: ${growThreads} grow + ${weakenThreads} stabilizing weaken`);
      }
      await ns.sleep(ns.getWeakenTime(target) + 200);
    }
  }

  await prep();
  ns.print(`${target} ready — switching to continuous batching`);

  // ---- Timing + hack yield: use Formulas.exe against an idealized server model
  // (min security, max money) when available, for stable non-drifting math. Without
  // it, fall back to the plain live-stat NS functions — slightly less precise since
  // they reflect the target's actual current state rather than a locked ideal one,
  // but prep already gets us close to min security first, so the gap is small.
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let hackTime, growTime, weakenTime, hackPercentPerThread;

  if (hasFormulas) {
    const player = ns.getPlayer();
    const idealServer = ns.getServer(target);
    idealServer.hackDifficulty = idealServer.minDifficulty;
    idealServer.moneyAvailable = idealServer.moneyMax;

    hackTime = ns.formulas.hacking.hackTime(idealServer, player);
    growTime = ns.formulas.hacking.growTime(idealServer, player);
    weakenTime = ns.formulas.hacking.weakenTime(idealServer, player);
    hackPercentPerThread = ns.formulas.hacking.hackPercent(idealServer, player);
    ns.print(`${target}: using Formulas.exe for precise batch math.`);
  } else {
    hackTime = ns.getHackTime(target);
    growTime = ns.getGrowTime(target);
    weakenTime = ns.getWeakenTime(target);
    hackPercentPerThread = ns.hackAnalyze(target);
    ns.print(`${target}: no Formulas.exe — using live-stat approximations.`);
  }

  const hackThreads = Math.max(1, Math.floor(MAX_HACK_FRACTION / hackPercentPerThread));
  const actualHackFraction = hackThreads * hackPercentPerThread;

  const weaken1Threads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads) / ns.weakenAnalyze(1)));
  const growMultNeeded = 1 / (1 - actualHackFraction);
  const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, growMultNeeded)));
  const weaken2Threads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads) / ns.weakenAnalyze(1)));

  const ramPerBatch =
    hackThreads * hackRam + weaken1Threads * weakenRam +
    growThreads * growRam + weaken2Threads * weakenRam;

  const totalCycleTime = weakenTime + 3 * SPACING;

  const startHosts = getHosts();
  const availableRam = totalRam(startHosts);
  let maxConcurrentBatches = Math.max(1, Math.floor(availableRam / ramPerBatch));
  maxConcurrentBatches = Math.min(maxConcurrentBatches, MAX_CONCURRENT_BATCHES);

  const period = totalCycleTime / maxConcurrentBatches;

  ns.print(
    `Plan for ${target}: steal ${(actualHackFraction * 100).toFixed(1)}%/batch | ` +
    `hack=${hackThreads} w1=${weaken1Threads} grow=${growThreads} w2=${weaken2Threads} | ` +
    `${ns.format.number(ramPerBatch)}GB/batch | up to ${maxConcurrentBatches} in flight | ` +
    `launching every ${period.toFixed(0)}ms`
  );

  let batchCount = 0;
  let skipped = 0;

  while (true) {
    const hosts = getHosts();

    if (totalRam(hosts) >= ramPerBatch) {
      const weaken1Delay = 0;
      const weaken2Delay = 2 * SPACING;
      const hackDelay = Math.max(0, weakenTime - SPACING - hackTime);
      const growDelay = Math.max(0, weakenTime + SPACING - growTime);

      execDistributed(scripts.hack, target, hackDelay, hackThreads, hosts);
      execDistributed(scripts.weaken, target, weaken1Delay, weaken1Threads, hosts);
      execDistributed(scripts.grow, target, growDelay, growThreads, hosts);
      execDistributed(scripts.weaken, target, weaken2Delay, weaken2Threads, hosts);

      batchCount++;
      if (batchCount % 25 === 0) {
        ns.print(`${target}: ${batchCount} batches launched so far (${skipped} skipped for RAM).`);
      }
    } else {
      skipped++;
    }

    await ns.sleep(period);
  }
}