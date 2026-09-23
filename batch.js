/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  const explicitTarget = ns.args[0] || null;
  const HOME_RESERVE_RAM = 128; // headroom for many more worker processes now running on home
  const MAX_PARALLEL_TARGETS = 40; // spread across far more targets — one target can't absorb this much RAM
  const FEASIBLE_CYCLE_CAP = 50;

  const scripts = { hack: "hack.js", weaken: "weaken.js", grow: "grow.js" };
  const WORKER = "batch-worker.js";
  const growRam = ns.getScriptRam(scripts.grow, "home");

  const crackPrograms = [
    { file: "BruteSSH.exe", fn: (ns, s) => ns.brutessh(s) },
    { file: "FTPCrack.exe", fn: (ns, s) => ns.ftpcrack(s) },
    { file: "relaySMTP.exe", fn: (ns, s) => ns.relaysmtp(s) },
    { file: "HTTPWorm.exe", fn: (ns, s) => ns.httpworm(s) },
    { file: "SQLInject.exe", fn: (ns, s) => ns.sqlinject(s) },
  ];

  function getAllServers() {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of ns.scan(cur)) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return [...visited];
  }

  function tryRoot(server) {
    if (ns.hasRootAccess(server)) return true;
    let portsOpened = 0;
    for (const prog of crackPrograms) {
      if (ns.fileExists(prog.file, "home")) {
        prog.fn(ns, server);
        portsOpened++;
      }
    }
    if (ns.getServerNumPortsRequired(server) <= portsOpened) ns.nuke(server);
    return ns.hasRootAccess(server);
  }

  function estimateThreadBudget(hosts) {
    const total = hosts.reduce((sum, h) => sum + h.ram, 0);
    return Math.max(Math.floor(total / growRam), 1);
  }

  function scoreTargets(rootedServers, threadBudget) {
    return rootedServers
      .filter(s => s !== "home" && !s.startsWith("pserv"))
      .filter(s => ns.getServerMaxMoney(s) > 0)
      .filter(s => ns.getServerRequiredHackingLevel(s) <= ns.getPlayer().skills.hacking)
      .map(s => {
        const maxMoney = ns.getServerMaxMoney(s);
        const moneyNow = Math.max(ns.getServerMoneyAvailable(s), 1);
        const weakenTime = ns.getWeakenTime(s);
        const growMultNeeded = Math.max(maxMoney / moneyNow, 1);
        const growThreadsNeeded = growMultNeeded > 1 ? ns.growthAnalyze(s, growMultNeeded) : 0;
        const cyclesToFill = Math.max(Math.ceil(growThreadsNeeded / threadBudget), 1);
        const score = cyclesToFill <= FEASIBLE_CYCLE_CAP
          ? maxMoney / weakenTime
          : maxMoney / (cyclesToFill * weakenTime);
        return { s, score, cyclesToFill };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ---- setup ----
  const allServers = getAllServers();
  for (const s of allServers) tryRoot(s);
  const rootedServers = allServers.filter(s => ns.hasRootAccess(s));

  for (const s of rootedServers) {
    if (s === "home") continue;
    if (ns.getServerMaxRam(s) > 0) await ns.scp(Object.values(scripts), s);
  }

  // Hosts available to hand out to workers — home is excluded from the hacking pool
  // since home itself runs the worker processes.
  const hosts = rootedServers
    .filter(s => s !== "home" && ns.getServerMaxRam(s) > 0)
    .map(s => ({ host: s, ram: ns.getServerMaxRam(s) }))
    .sort((a, b) => b.ram - a.ram);

  const threadBudget = estimateThreadBudget(hosts);

  let selected;
  if (explicitTarget) {
    selected = [{ s: explicitTarget, weight: 1 }];
    ns.print(`--- Locked to explicit target: ${explicitTarget} ---`);
  } else {
    const scored = scoreTargets(rootedServers, threadBudget);
    if (scored.length === 0) {
      ns.print("No valid targets found.");
      return;
    }
    const top = scored.slice(0, Math.min(MAX_PARALLEL_TARGETS, scored.length));
    ns.print(`--- Launching ${top.length} parallel workers (thread budget: ~${threadBudget}) ---`);
    for (const c of top) {
      ns.print(`  ${c.s}: score=${ns.format.number(c.score)} maxMoney=${ns.format.number(ns.getServerMaxMoney(c.s))} cyclesToFill=${c.cyclesToFill}`);
    }
    selected = top.map(c => ({ s: c.s, weight: c.score }));
  }

  // Greedily assign whole hosts to whichever selected target currently has the
  // lowest (RAM assigned so far / its score weight) — keeps allocation roughly
  // proportional to score without splitting any single host between targets.
  const hostGroups = selected.map(() => []);
  const assignedRam = selected.map(() => 0);
  for (const host of hosts) {
    let bestIdx = 0;
    let bestRatio = Infinity;
    for (let i = 0; i < selected.length; i++) {
      const ratio = assignedRam[i] / selected[i].weight;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestIdx = i;
      }
    }
    hostGroups[bestIdx].push(host.host);
    assignedRam[bestIdx] += host.ram;
  }

  for (let i = 0; i < selected.length; i++) {
    const target = selected[i].s;
    const hostList = hostGroups[i];
    if (hostList.length === 0) {
      ns.print(`Skipping ${target} — no hosts assigned.`);
      continue;
    }
    const pid = ns.exec(WORKER, "home", 1, target, JSON.stringify(hostList));
    if (pid === 0) {
      ns.print(`FAILED to launch worker for ${target} — not enough RAM on home. Try raising HOME_RESERVE_RAM budget or freeing up home RAM.`);
    } else {
      ns.print(`Launched worker for ${target} (PID ${pid}) with ${hostList.length} hosts.`);
    }
  }
}
