/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(720, 480);
  ns.ui.setTailTitle("Overview");

  const REFRESH_INTERVAL = 2000;
  const RATE_SMOOTHING = 0.3; // EMA weight for new readings each refresh

  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const WHITE = "\x1b[97m";
  const GRAY = "\x1b[90m";

  function colorize(text, color) {
    return color + text + RESET;
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + ns.format.number(Math.abs(n), "0.00a");
  }

  function fmtNum(n) {
    return ns.format.number(n, "0.00a");
  }

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }

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

  // Per-server money history, used to derive a hacking-only income rate that isn't
  // muddied by other income sources (stocks, corp, etc.) hitting home cash directly.
  const moneyHistory = new Map();
  let moneyRateEma = 0;

  let expHistory = null; // { exp, time }
  let expRateEma = 0;

  const sessionStart = Date.now();
  let sessionStartHackMoney = null;
  let sessionStartExp = null;

  const scriptNames = new Set(["hack.js", "grow.js", "weaken.js"]);

  while (true) {
    ns.clearLog();

    const now = Date.now();
    const allServers = getAllServers();
    const rootedServers = allServers.filter(s => ns.hasRootAccess(s));
    const hackTargets = allServers.filter(s => s !== "home" && !s.startsWith("pserv-") && ns.getServerMaxMoney(s) > 0);

    // ---- Hacking income rate: sum of each target's own money delta, not home cash ----
    let totalHackMoneyNow = 0;
    let instMoneyRate = 0;
    for (const s of hackTargets) {
      const money = ns.getServerMoneyAvailable(s);
      totalHackMoneyNow += money;
      const prev = moneyHistory.get(s);
      if (prev) {
        const dt = (now - prev.time) / 1000;
        if (dt > 0) instMoneyRate += (money - prev.money) / dt;
      }
      moneyHistory.set(s, { money, time: now });
    }
    moneyRateEma = RATE_SMOOTHING * instMoneyRate + (1 - RATE_SMOOTHING) * moneyRateEma;

    if (sessionStartHackMoney === null) sessionStartHackMoney = totalHackMoneyNow;

    // ---- Hacking exp rate ----
    const player = ns.getPlayer();
    let hackExp = null;
    try {
      hackExp = player.exp.hacking;
    } catch {
      hackExp = null;
    }
    let instExpRate = 0;
    if (hackExp !== null) {
      if (expHistory) {
        const dt = (now - expHistory.time) / 1000;
        if (dt > 0) instExpRate = (hackExp - expHistory.exp) / dt;
      }
      expRateEma = expHistory ? RATE_SMOOTHING * instExpRate + (1 - RATE_SMOOTHING) * expRateEma : instExpRate;
      expHistory = { exp: hackExp, time: now };
      if (sessionStartExp === null) sessionStartExp = hackExp;
    }

    // ---- RAM utilization across the whole rooted fleet ----
    let totalMaxRam = 0;
    let totalUsedRam = 0;
    for (const s of rootedServers) {
      totalMaxRam += ns.getServerMaxRam(s);
      totalUsedRam += ns.getServerUsedRam(s);
    }
    const ramPct = totalMaxRam > 0 ? totalUsedRam / totalMaxRam : 0;

    // ---- Active batch workers + thread counts in flight ----
    const homeProcs = ns.ps("home");
    const workers = homeProcs.filter(p => p.filename === "batch-worker.js");

    let hackThreads = 0, growThreads = 0, weakenThreads = 0;
    for (const s of rootedServers) {
      for (const p of ns.ps(s)) {
        if (!scriptNames.has(p.filename)) continue;
        if (p.filename === "hack.js") hackThreads += p.threads;
        else if (p.filename === "grow.js") growThreads += p.threads;
        else if (p.filename === "weaken.js") weakenThreads += p.threads;
      }
    }
    const totalThreads = hackThreads + growThreads + weakenThreads;

    const cash = ns.getServerMoneyAvailable("home");

    // ---- Render ----
    ns.print(colorize("=== HACKING OVERVIEW ===", WHITE));
    ns.print("");

    ns.print(
      `Hacking level: ${colorize(String(player.skills.hacking), CYAN)}` +
      (hackExp !== null
        ? `   EXP/sec: ${colorize(fmtNum(expRateEma) + "/s", expRateEma >= 0 ? GREEN : RED)}` +
          `   Gained this session: ${colorize(fmtNum(hackExp - sessionStartExp), CYAN)}`
        : "   EXP tracking unavailable")
    );
    ns.print("");

    ns.print(
      `Hacking income: ${colorize(fmtMoney(moneyRateEma) + "/s", moneyRateEma >= 0 ? GREEN : RED)}` +
      `   Net this session: ${colorize(fmtMoney(totalHackMoneyNow - sessionStartHackMoney), CYAN)}`
    );
    ns.print(`Cash on hand: ${colorize(fmtMoney(cash), WHITE)}`);
    ns.print("");

    const ramColor = ramPct >= 0.9 ? RED : ramPct >= 0.7 ? YELLOW : GREEN;
    ns.print(
      `RAM: ${colorize(ns.format.ram(totalUsedRam), ramColor)} / ${ns.format.ram(totalMaxRam)} ` +
      `(${colorize((ramPct * 100).toFixed(1) + "%", ramColor)}) across ${rootedServers.length} rooted servers`
    );
    ns.print("");

    ns.print(`Active batch targets (${workers.length}):`);
    if (workers.length === 0) {
      ns.print(colorize("  none running", GRAY));
    } else {
      for (const w of workers) {
        ns.print(`  ${colorize(String(w.args[0]), CYAN)}  ${GRAY}(PID ${w.pid})${RESET}`);
      }
    }
    ns.print("");

    ns.print(
      `Threads in flight: ` +
      `hack=${colorize(String(hackThreads), WHITE)} ` +
      `grow=${colorize(String(growThreads), WHITE)} ` +
      `weaken=${colorize(String(weakenThreads), WHITE)} ` +
      `${GRAY}(total ${totalThreads})${RESET}`
    );
    ns.print("");

    ns.print(`${GRAY}Session uptime: ${fmtDuration(now - sessionStart)} | Refresh: ${REFRESH_INTERVAL / 1000}s${RESET}`);

    await ns.sleep(REFRESH_INTERVAL);
  }
}
