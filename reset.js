/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Pass "monitors" as an arg to also relaunch the dashboard scripts.
  const includeMonitors = ns.args.includes("monitors");

  const CORE_SCRIPTS = ["buy-servers.js", "batch.js"];
  const MONITOR_SCRIPTS = ["monitor.js", "overview.js"];
  const SETTLE_DELAY = 1000; // ms to let RAM free up after killing everything

  // ---- Kill everything, inline rather than calling kill-all.js as a subprocess —
  // a subprocess can only spare ITS OWN pid, which would leave this script's own
  // process vulnerable to getting killed mid-reset. ----
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

  ns.tprint("=== RESET: killing all running scripts ===");
  const servers = getAllServers();

  for (const s of servers) {
    if (s === "home") continue;
    const running = ns.ps(s);
    if (running.length > 0) {
      ns.killall(s);
      ns.tprint(`Killed ${running.length} script(s) on ${s}`);
    }
  }

  const homeRunning = ns.ps("home").filter(p => p.pid !== ns.pid);
  if (homeRunning.length > 0) {
    for (const p of homeRunning) ns.kill(p.pid);
    ns.tprint(`Killed ${homeRunning.length} script(s) on home`);
  }

  ns.tprint(`Waiting ${SETTLE_DELAY}ms for RAM to free up...`);
  await ns.sleep(SETTLE_DELAY);

  // ---- Relaunch ----
  ns.tprint("=== RESET: relaunching core scripts ===");
  const toLaunch = includeMonitors ? [...CORE_SCRIPTS, ...MONITOR_SCRIPTS] : CORE_SCRIPTS;

  for (const script of toLaunch) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`SKIPPED ${script} — not found on home.`);
      continue;
    }
    const pid = ns.run(script);
    if (pid === 0) {
      ns.tprint(`FAILED to launch ${script} — check available RAM on home.`);
    } else {
      ns.tprint(`Launched ${script} (PID ${pid})`);
    }
  }

  ns.tprint("=== RESET complete ===");
}
